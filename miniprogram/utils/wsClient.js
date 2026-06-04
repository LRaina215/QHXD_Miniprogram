const config = require('./config');

class StateWebSocketClient {
  constructor() {
    this.socketTask = null;
    this.connected = false;
    this.connecting = false;
    this.closedManually = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastMessageAt = 0;
    this.callbacks = {
      open: [],
      message: [],
      error: [],
      close: []
    };
  }

  on(event, callback) {
    if (!this.callbacks[event]) return;
    this.callbacks[event].push(callback);
  }

  off(event, callback) {
    if (!this.callbacks[event]) return;
    this.callbacks[event] = this.callbacks[event].filter((item) => item !== callback);
  }

  connect() {
    if (this.connected || this.connecting) return;
    this.closedManually = false;
    this.connecting = true;

    try {
      this.socketTask = wx.connectSocket({
        url: config.WS_STATE_URL,
        success: () => {},
        fail: (err) => this._handleError(err)
      });
      this._bind();
    } catch (err) {
      this._handleError(err);
      this._scheduleReconnect();
    }
  }

  disconnect() {
    this.closedManually = true;
    this._stopReconnect();
    this._stopHeartbeat();
    if (this.socketTask) {
      try {
        this.socketTask.close();
      } catch (e) {}
    }
    this.socketTask = null;
    this.connected = false;
    this.connecting = false;
  }

  _bind() {
    if (!this.socketTask) return;

    this.socketTask.onOpen(() => {
      this.connected = true;
      this.connecting = false;
      this.lastMessageAt = Date.now();
      this._emit('open', { connected: true });
      this._startHeartbeat();
    });

    this.socketTask.onMessage((event) => {
      this.lastMessageAt = Date.now();
      let payload = event.data;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (e) {
        this._emit('error', { error: 'ws_invalid_json', raw: event.data });
        return;
      }
      this._emit('message', payload);
    });

    this.socketTask.onError((err) => {
      this._handleError(err);
    });

    this.socketTask.onClose((event) => {
      this.connected = false;
      this.connecting = false;
      this.socketTask = null;
      this._stopHeartbeat();
      this._emit('close', event || {});
      if (!this.closedManually) this._scheduleReconnect();
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socketTask || !this.connected) return;
      if (Date.now() - this.lastMessageAt > 15000) {
        this._emit('error', { error: 'ws_message_timeout' });
      }
      try {
        this.socketTask.send({ data: 'ping' });
      } catch (e) {}
    }, 5000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    this._stopReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  _stopReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _handleError(err) {
    this.connected = false;
    this.connecting = false;
    this._emit('error', err || { error: 'ws_error' });
  }

  _emit(event, payload) {
    (this.callbacks[event] || []).forEach((callback) => {
      try {
        callback(payload);
      } catch (e) {}
    });
  }
}

module.exports = new StateWebSocketClient();
