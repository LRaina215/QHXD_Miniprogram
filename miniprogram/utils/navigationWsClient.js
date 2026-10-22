const config = require('./config');

class NavigationWebSocketClient {
  constructor() {
    this.socketTask = null;
    this.connected = false;
    this.connecting = false;
    this.closedManually = false;
    this.reconnectTimer = null;
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
    if (!config.WS_NAVIGATION_URL || this.connected || this.connecting) return;
    this.closedManually = false;
    this.connecting = true;

    try {
      this.socketTask = wx.connectSocket({
        url: config.WS_NAVIGATION_URL,
        success: () => {},
        fail: (err) => {
          this._handleError(err);
          this._scheduleReconnect();
        }
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
    const socketTask = this.socketTask;

    socketTask.onOpen(() => {
      if (this.socketTask !== socketTask) return;
      this.connected = true;
      this.connecting = false;
      this._emit('open', { connected: true });
    });

    socketTask.onMessage((event) => {
      if (this.socketTask !== socketTask) return;
      let payload = event.data;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (e) {
        this._emit('error', { error: 'navigation_ws_invalid_json' });
        return;
      }
      this._emit('message', payload);
    });

    socketTask.onError((err) => {
      if (this.socketTask !== socketTask) return;
      this._handleError(err);
      if (!this.closedManually) this._scheduleReconnect();
    });

    socketTask.onClose((event) => {
      if (this.socketTask !== socketTask) return;
      this.connected = false;
      this.connecting = false;
      this.socketTask = null;
      this._emit('close', event || {});
      if (!this.closedManually) this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    this._stopReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), 5000);
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
    this._emit('error', err || { error: 'navigation_ws_error' });
  }

  _emit(event, payload) {
    (this.callbacks[event] || []).forEach((callback) => {
      try {
        callback(payload);
      } catch (e) {}
    });
  }
}

module.exports = new NavigationWebSocketClient();
