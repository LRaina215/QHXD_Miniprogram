/**
 * MQTT over WebSocket 客户端（适配微信小程序）
 * 实现 MQTT 3.1.1 协议的基本功能
 */

// 消息类型常量
const PACKET_TYPE = {
  CONNECT: 0x10,
  CONNACK: 0x20,
  PUBLISH: 0x30,
  PUBACK: 0x40,
  SUBSCRIBE: 0x82,
  SUBACK: 0x90,
  UNSUBSCRIBE: 0xA2,
  UNSUBACK: 0xB0,
  PINGREQ: 0xC0,
  PINGRESP: 0xD0,
  DISCONNECT: 0xE0
};

class MQTTClient {
  constructor() {
    this.socketTask = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.messageId = 1;
    this._onMessageCallback = null;
    this._onConnectCallback = null;
    this._onDisconnectCallback = null;
    this._onErrorCallback = null;
    this._pendingSubacks = {};
    this._pendingPubacks = {};

    // 配置
    this.config = {
      brokerUrl: '',
      username: '',
      password: '',
      clientId: 'sentinel_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      keepalive: 30,
      cleanSession: true,
      reconnectPeriod: 5000,
      subscribeTopic: 'sentinel/telemetry',
      publishTopic: 'sentinel/cmd'
    };
  }

  /**
   * 设置回调
   */
  onMessage(callback) { this._onMessageCallback = callback; }
  onConnect(callback) { this._onConnectCallback = callback; }
  onDisconnect(callback) { this._onDisconnectCallback = callback; }
  onError(callback) { this._onErrorCallback = callback; }

  /**
   * 连接 MQTT Broker
   */
  connect(config) {
    if (this.isConnected || this.isConnecting) {
      console.warn('[MQTT] 已经连接或正在连接中');
      return;
    }

    if (config) {
      Object.assign(this.config, config);
    }

    this.isConnecting = true;
    console.log('[MQTT] 正在连接:', this.config.brokerUrl);

    try {
      this.socketTask = wx.connectSocket({
        url: this.config.brokerUrl,
        header: {
          'content-type': 'application/octet-stream'
        },
        protocols: ['mqtt'],
        method: 'GET',
        success: () => {
          console.log('[MQTT] WebSocket 连接已发起');
        },
        fail: (err) => {
          console.error('[MQTT] WebSocket 连接失败:', err);
          this.isConnecting = false;
          if (this._onErrorCallback) {
            this._onErrorCallback(err);
          }
          this._scheduleReconnect();
        }
      });

      this._bindSocketEvents();
    } catch (err) {
      console.error('[MQTT] 连接异常:', err);
      this.isConnecting = false;
      if (this._onErrorCallback) {
        this._onErrorCallback(err);
      }
      this._scheduleReconnect();
    }
  }

  /**
   * 绑定 WebSocket 事件
   */
  _bindSocketEvents() {
    if (!this.socketTask) return;

    this.socketTask.onOpen(() => {
      console.log('[MQTT] WebSocket 已打开，发送 CONNECT 报文');
      this._sendConnect();
    });

    this.socketTask.onMessage((res) => {
      if (res.data instanceof ArrayBuffer) {
        this._handlePacket(res.data);
      } else {
        console.warn('[MQTT] 收到非二进制消息，尝试转换');
        try {
          const buf = this._stringToArrayBuffer(res.data);
          this._handlePacket(buf);
        } catch (e) {
          console.error('[MQTT] 消息解析失败:', e);
        }
      }
    });

    this.socketTask.onClose((res) => {
      console.log('[MQTT] WebSocket 已关闭, code:', res.code, 'reason:', res.reason);
      this.isConnected = false;
      this.isConnecting = false;
      this._stopPingTimer();
      if (this._onDisconnectCallback) {
        this._onDisconnectCallback(res);
      }
      this._scheduleReconnect();
    });

    this.socketTask.onError((err) => {
      console.error('[MQTT] WebSocket 错误:', err);
      this.isConnected = false;
      this.isConnecting = false;
      if (this._onErrorCallback) {
        this._onErrorCallback(err);
      }
    });
  }

  /**
   * 发送 CONNECT 报文
   */
  _sendConnect() {
    const c = this.config;
    // 可变头部
    const protocolName = this._encodeString('MQTT');
    const protocolLevel = 0x04; // MQTT 3.1.1
    let connectFlags = 0x02; // Clean Session
    if (c.username) connectFlags |= 0x80;
    if (c.password) connectFlags |= 0x40;

    const keepalive = new Uint8Array([(c.keepalive >> 8) & 0xFF, c.keepalive & 0xFF]);

    // 载荷
    const clientIdBytes = this._encodeString(c.clientId || ('sentinel_' + Date.now()));
    let payload = clientIdBytes;

    if (c.username) {
      payload = this._concatBytes(payload, this._encodeString(c.username));
    }
    if (c.password) {
      payload = this._concatBytes(payload, this._encodeString(c.password));
    }

    const variableHeader = this._concatBytes(
      this._concatBytes(protocolName, new Uint8Array([protocolLevel, connectFlags])),
      keepalive
    );

    const packet = this._buildPacket(PACKET_TYPE.CONNECT, this._concatBytes(variableHeader, payload));
    this._send(packet);
  }

  /**
   * 处理接收到的 MQTT 报文
   */
  _handlePacket(data) {
    const array = new Uint8Array(data);
    if (array.length < 2) return;

    const packetType = array[0] & 0xF0;

    switch (packetType) {
      case PACKET_TYPE.CONNACK:
        this._handleConnAck(array);
        break;
      case PACKET_TYPE.PUBLISH:
        this._handlePublish(array);
        break;
      case PACKET_TYPE.PUBACK:
        this._handlePubAck(array);
        break;
      case PACKET_TYPE.SUBACK:
        this._handleSubAck(array);
        break;
      case PACKET_TYPE.PINGRESP:
        console.log('[MQTT] 收到 PINGRESP');
        break;
      case PACKET_TYPE.UNSUBACK:
        console.log('[MQTT] 收到 UNSUBACK');
        break;
      default:
        console.log('[MQTT] 未知报文类型:', packetType.toString(16));
    }
  }

  /**
   * 处理 CONNACK
   */
  _handleConnAck(array) {
    const connectFlags = array[2];
    const returnCode = array[3];
    const sessionPresent = !!(connectFlags & 0x01);

    if (returnCode === 0) {
      console.log('[MQTT] 连接成功, Session Present:', sessionPresent);
      this.isConnected = true;
      this.isConnecting = false;
      this._startPingTimer();

      if (this._onConnectCallback) {
        this._onConnectCallback({ sessionPresent });
      }

      // 订阅主题
      this.subscribe(this.config.subscribeTopic);
    } else {
      const errors = {
        1: '协议版本错误',
        2: '标识符被拒绝',
        3: '服务器不可用',
        4: '用户名或密码错误',
        5: '未授权'
      };
      const errorMsg = errors[returnCode] || '未知错误 (' + returnCode + ')';
      console.error('[MQTT] 连接拒绝:', errorMsg);
      this.isConnecting = false;
      if (this._onErrorCallback) {
        this._onErrorCallback({ message: errorMsg });
      }
    }
  }

  /**
   * 处理 PUBLISH 消息
   */
  _handlePublish(array) {
    let pos = 2;
    // 解析剩余长度
    let remainingLength = 0;
    let multiplier = 1;
    let byte;
    do {
      byte = array[pos++];
      remainingLength += (byte & 0x7F) * multiplier;
      multiplier *= 128;
    } while (byte & 0x80);

    // 主题名
    const topicLen = (array[pos] << 8) | array[pos + 1];
    pos += 2;
    const topic = this._decodeString(array.slice(pos, pos + topicLen));
    pos += topicLen;

    // 报文标识符 (QoS > 0)
    let packetId = null;
    const qos = (array[0] & 0x06) >> 1;
    if (qos > 0) {
      packetId = (array[pos] << 8) | array[pos + 1];
      pos += 2;
    }

    // 载荷
    const payload = array.slice(pos);
    const payloadStr = this._decodeString(payload);

    console.log('[MQTT] 收到消息 - Topic:', topic, 'QoS:', qos);

    try {
      const jsonData = JSON.parse(payloadStr);
      if (this._onMessageCallback) {
        this._onMessageCallback(topic, jsonData);
      }
    } catch (e) {
      console.warn('[MQTT] 消息不是有效JSON，原文:', payloadStr);
      if (this._onMessageCallback) {
        this._onMessageCallback(topic, payloadStr);
      }
    }

    // 回复 PUBACK (QoS 1)
    if (qos === 1) {
      const ackPacket = this._buildPacket(PACKET_TYPE.PUBACK, new Uint8Array([
        (packetId >> 8) & 0xFF, packetId & 0xFF
      ]));
      this._send(ackPacket);
    }
  }

  /**
   * 处理 SUBACK
   */
  _handleSubAck(array) {
    const packetId = (array[2] << 8) | array[3];
    const returnCode = array[4];
    if (this._pendingSubacks[packetId]) {
      this._pendingSubacks[packetId](returnCode);
      delete this._pendingSubacks[packetId];
    }
    console.log('[MQTT] 订阅确认, PacketId:', packetId, 'ReturnCode:', returnCode);
  }

  /**
   * 处理 PUBACK
   */
  _handlePubAck(array) {
    const packetId = (array[2] << 8) | array[3];
    if (this._pendingPubacks[packetId]) {
      this._pendingPubacks[packetId]();
      delete this._pendingPubacks[packetId];
    }
  }

  /**
   * 订阅主题
   */
  subscribe(topic, qos = 0) {
    if (!this.isConnected) {
      console.warn('[MQTT] 未连接，无法订阅');
      return;
    }

    const packetId = this._nextId();
    const topicBytes = this._encodeString(topic);
    const topicQoS = new Uint8Array([qos]);
    const payload = this._concatBytes(topicBytes, topicQoS);
    const variableHeader = new Uint8Array([(packetId >> 8) & 0xFF, packetId & 0xFF]);

    const packet = this._buildPacket(PACKET_TYPE.SUBSCRIBE,
      this._concatBytes(variableHeader, payload));
    this._send(packet);

    return new Promise((resolve) => {
      this._pendingSubacks[packetId] = resolve;
    });
  }

  /**
   * 取消订阅
   */
  unsubscribe(topic) {
    if (!this.isConnected) return;

    const packetId = this._nextId();
    const topicBytes = this._encodeString(topic);
    const variableHeader = new Uint8Array([(packetId >> 8) & 0xFF, packetId & 0xFF]);

    const packet = this._buildPacket(PACKET_TYPE.UNSUBSCRIBE,
      this._concatBytes(variableHeader, topicBytes));
    this._send(packet);
  }

  /**
   * 发布消息
   */
  publish(topic, message, qos = 0) {
    if (!this.isConnected) {
      console.warn('[MQTT] 未连接，无法发布');
      return Promise.reject(new Error('MQTT not connected'));
    }

    const topicBytes = this._encodeString(topic);
    const msgBytes = this._encodeString(message);
    let payload = this._concatBytes(topicBytes, msgBytes);

    let packetId = null;
    if (qos > 0) {
      packetId = this._nextId();
      const idBytes = new Uint8Array([(packetId >> 8) & 0xFF, packetId & 0xFF]);
      payload = this._concatBytes(idBytes, payload);
    }

    const packetType = PACKET_TYPE.PUBLISH | (qos << 1);
    const packet = this._buildPacket(packetType, payload);
    this._send(packet);

    if (qos > 0) {
      return new Promise((resolve) => {
        this._pendingPubacks[packetId] = resolve;
      });
    }
    return Promise.resolve();
  }

  /**
   * 发送 PINGREQ
   */
  _sendPing() {
    if (!this.isConnected) return;
    this._send(new Uint8Array([PACKET_TYPE.PINGREQ, 0x00]));
  }

  /**
   * 断开连接
   */
  disconnect() {
    this._stopReconnect();
    this._stopPingTimer();

    if (this.isConnected) {
      const packet = new Uint8Array([PACKET_TYPE.DISCONNECT, 0x00]);
      this._send(packet);
    }

    if (this.socketTask) {
      try {
        this.socketTask.close();
      } catch (e) {
        console.warn('[MQTT] 关闭连接异常:', e);
      }
      this.socketTask = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
  }

  /**
   * 发送数据
   */
  _send(data) {
    if (!this.socketTask) {
      console.warn('[MQTT] SocketTask 为空');
      return;
    }
    try {
      this.socketTask.send({
        data: data.buffer || data,
        success: () => { },
        fail: (err) => {
          console.error('[MQTT] 发送失败:', err);
        }
      });
    } catch (e) {
      console.error('[MQTT] 发送异常:', e);
    }
  }

  /**
   * 构建 MQTT 报文
   */
  _buildPacket(type, variableBytes) {
    const remaining = variableBytes.length;
    const header = [type];
    // 剩余长度编码
    let len = remaining;
    do {
      let byte = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) byte |= 0x80;
      header.push(byte);
    } while (len > 0);

    return this._concatBytes(new Uint8Array(header), variableBytes);
  }

  /**
   * 编码字符串为 UTF-8 字节数组（带长度前缀）
   */
  _encodeString(str) {
    if (!str) return new Uint8Array([0x00, 0x00]);
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(str);
    const len = utf8Bytes.length;
    const result = new Uint8Array(len + 2);
    result[0] = (len >> 8) & 0xFF;
    result[1] = len & 0xFF;
    result.set(utf8Bytes, 2);
    return result;
  }

  /**
   * 解码 UTF-8 字节数组为字符串
   */
  _decodeString(bytes) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    try {
      return decoder.decode(bytes);
    } catch (e) {
      return String.fromCharCode.apply(null, bytes);
    }
  }

  /**
   * 合并两个 Uint8Array
   */
  _concatBytes(a, b) {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }

  /**
   * 生成下一个报文标识符
   */
  _nextId() {
    this.messageId = (this.messageId % 65535) + 1;
    return this.messageId;
  }

  /**
   * 字符串转 ArrayBuffer
   */
  _stringToArrayBuffer(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i) & 0xFF);
    }
    return new Uint8Array(bytes).buffer;
  }

  /**
   * 启动心跳定时器
   */
  _startPingTimer() {
    this._stopPingTimer();
    const interval = Math.max(this.config.keepalive * 1000 * 0.5, 10000);
    this.pingTimer = setInterval(() => {
      this._sendPing();
    }, interval);
  }

  /**
   * 停止心跳定时器
   */
  _stopPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * 启动重连
   */
  _scheduleReconnect() {
    this._stopReconnect();
    if (this._reconnectDisabled) return;
    console.log('[MQTT] 将在', this.config.reconnectPeriod, 'ms 后重连');
    this.reconnectTimer = setTimeout(() => {
      console.log('[MQTT] 正在重连...');
      this.connect();
    }, this.config.reconnectPeriod);
  }

  /**
   * 停止重连
   */
  _stopReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 禁用重连
   */
  disableReconnect() {
    this._reconnectDisabled = true;
    this._stopReconnect();
  }

  /**
   * 启用重连
   */
  enableReconnect() {
    this._reconnectDisabled = false;
  }
}

// 单例导出
const mqttManager = new MQTTClient();

module.exports = mqttManager;
