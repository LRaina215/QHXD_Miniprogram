/**
 * 全局数据仓：WebSocket 实时推送为主，REST 轮询兜底（WS 断开或数据超过 6 s 未更新时拉取）。
 * 页面通过 store.on('state' | 'nav' | 'map' | 'events' | 'waypoints' | 'conn' | 'alerts', fn) 订阅。
 */
const api = require('./api');
const config = require('./config');
const LiveSocket = require('./socket');

const TRAIL_MAX = 400;

class Store {
  constructor() {
    this.state = null;
    this.nav = null;
    this.mapMeta = null;
    this.mapImagePath = '';
    this.waypoints = [];
    this.events = [];
    this.alerts = [];
    this.trail = [];
    this.health = null;
    this.conn = { gateway: 'unknown', rk: false, publicControl: null, live: false, navLive: false, error: '' };
    this.lastStateAt = 0;
    this.lastNavAt = 0;
    this.lastHealthAt = 0;
    this.lastEventsAt = 0;
    this.lastWaypointsAt = 0;
    this.listeners = {};
    this.running = false;
    this.timer = null;
    this.inflight = null;
    this.session = 0;
    this.mapVersion = '';

    this.stateSocket = new LiveSocket(() => config.wsUrl('/ws/state'), 'state');
    this.navSocket = new LiveSocket(() => config.wsUrl('/ws/navigation'), 'navigation');
    this.stateSocket.on('message', (msg) => {
      if (msg && msg.type === 'robot_state' && msg.data) this.setState(msg.data);
    });
    this.navSocket.on('message', (msg) => {
      if (msg && msg.type === 'navigation') this.setNav(msg.data);
    });
    const live = () => {
      this.conn.live = this.stateSocket.connected;
      this.conn.navLive = this.navSocket.connected;
      this.emit('conn');
    };
    ['open', 'close'].forEach((evt) => {
      this.stateSocket.on(evt, live);
      this.navSocket.on(evt, live);
    });
  }

  on(event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
    return () => { this.listeners[event] = (this.listeners[event] || []).filter((f) => f !== fn); };
  }

  emit(event) {
    (this.listeners[event] || []).forEach((fn) => {
      try { fn(this); } catch (e) { console.error('[store]', event, e); }
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stateSocket.connect();
    this.navSocket.connect();
    this.tick(true);
    this.timer = setInterval(() => this.tick(false), config.POLL_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    // 使本轮尚未返回的 REST / 地图请求失效；新连接不等待旧请求。
    this.session += 1;
    this.inflight = null;
    clearInterval(this.timer);
    this.timer = null;
    this.stateSocket.disconnect();
    this.navSocket.disconnect();
  }

  /** 服务器地址或 Token 变更后重连 */
  restart() {
    this.stop();
    this.state = null;
    this.nav = null;
    this.health = null;
    this.waypoints = [];
    this.events = [];
    this.alerts = [];
    this.trail = [];
    this.mapVersion = '';
    this.mapMeta = null;
    this.mapImagePath = '';
    this.lastStateAt = this.lastNavAt = 0;
    this.lastHealthAt = this.lastEventsAt = this.lastWaypointsAt = 0;
    this.conn = { gateway: 'unknown', rk: false, publicControl: null, live: false, navLive: false, error: '' };
    ['state', 'nav', 'map', 'events', 'alerts', 'waypoints', 'conn'].forEach((event) => this.emit(event));
    this.start();
  }

  refresh() {
    this.lastHealthAt = this.lastEventsAt = this.lastWaypointsAt = 0;
    return this.tick(true);
  }

  tick(force) {
    if (this.inflight) return this.inflight;
    const session = this.session;
    this.inflight = this.poll(force, session).finally(() => {
      // 旧轮询结束时不能解除新连接的并发保护。
      if (session === this.session) this.inflight = null;
    });
    return this.inflight;
  }

  async poll(force, session) {
    const now = Date.now();
    const jobs = [];
    if (force || !this.stateSocket.connected || now - this.lastStateAt > 6000) jobs.push(this.pullState(session));
    if (force || !this.navSocket.connected || now - this.lastNavAt > 6000) jobs.push(this.pullNav(session));
    if (now - this.lastHealthAt > config.HEALTH_INTERVAL_MS) { this.lastHealthAt = now; jobs.push(this.pullHealth(session)); }
    if (now - this.lastEventsAt > config.EVENTS_INTERVAL_MS) { this.lastEventsAt = now; jobs.push(this.pullEvents(session)); }
    if (now - this.lastWaypointsAt > 60000) { this.lastWaypointsAt = now; jobs.push(this.pullWaypoints(session)); }
    await Promise.all(jobs);
    if (session !== this.session) return;
    const rk = this.lastStateAt > 0 && Date.now() - this.lastStateAt < config.STALE_AFTER_MS;
    if (rk !== this.conn.rk) {
      this.conn.rk = rk;
      this.emit('conn');
    }
  }

  async pullState(session = this.session) {
    const res = await api.getState();
    if (session !== this.session) return;
    const data = api.unwrap(res);
    if (data) {
      this.conn.error = '';
      this.setState(data);
    } else if (!this.stateSocket.connected) {
      this.conn.error = api.explain(res.error);
      this.emit('conn');
    }
  }

  async pullNav(session = this.session) {
    const res = await api.getNavigation();
    if (session !== this.session) return;
    if (res.ok) this.setNav(api.unwrap(res));
  }

  async pullHealth(session = this.session) {
    const res = await api.getGatewayHealth();
    if (session !== this.session) return;
    if (res.ok) {
      this.health = res.data;
      this.conn.gateway = 'online';
      // 直连 RK3588 后端（调试地址）时 /health 没有这个字段：公网开关不适用
      this.conn.publicControl = 'public_control_enabled' in res.data ? !!res.data.public_control_enabled : null;
    } else {
      // 旧网关在主域名下没有健康接口：只要 /api 能通就算网关在线，公网控制开关未知
      this.health = null;
      const fresh = this.lastStateAt > 0 && Date.now() - this.lastStateAt < config.STALE_AFTER_MS;
      this.conn.gateway = fresh ? 'online' : (res.error ? 'offline' : 'unknown');
      this.conn.publicControl = null;
    }
    this.emit('conn');
  }

  async pullEvents(session = this.session) {
    const [events, alerts] = await Promise.all([api.getTaskEvents(30), api.getAlerts()]);
    if (session !== this.session) return;
    const ev = api.unwrap(events);
    if (Array.isArray(ev)) {
      this.events = ev;
      this.emit('events');
    }
    const al = api.unwrap(alerts);
    if (Array.isArray(al)) {
      this.alerts = al.filter((a) => a.source !== 'mock-state-generator').slice(0, 30);
      this.emit('alerts');
    }
  }

  async pullWaypoints(session = this.session) {
    const list = api.unwrap(await api.getWaypoints());
    if (session !== this.session) return;
    if (Array.isArray(list)) {
      this.waypoints = list.filter((w) => w.enabled !== false);
      this.emit('waypoints');
    }
  }

  setState(state) {
    this.state = state;
    this.lastStateAt = Date.now();
    if (!this.conn.rk) {
      this.conn.rk = true;
      this.emit('conn');
    }
    this.emit('state');
  }

  setNav(nav) {
    if (!nav) return;
    this.nav = nav;
    this.lastNavAt = Date.now();
    const pose = nav.pose;
    if (pose) {
      const last = this.trail[this.trail.length - 1];
      const d = last ? Math.hypot(last.x - pose.x, last.y - pose.y) : Infinity;
      if (d > 2.0) this.trail = [];
      if (d >= 0.03) {
        this.trail.push({ x: pose.x, y: pose.y });
        if (this.trail.length > TRAIL_MAX) this.trail.shift();
      }
    }
    if (nav.map_version && nav.map_version !== this.mapVersion) {
      this.mapVersion = nav.map_version;
      this.loadMap();
    }
    this.emit('nav');
  }

  async loadMap(session = this.session) {
    const version = this.mapVersion;
    const meta = api.unwrap(await api.getMapMetadata());
    if (!meta || session !== this.session || version !== this.mapVersion) return;
    let imagePath = '';
    if (!String(meta.version || '').startsWith('canvas')) {
      imagePath = await new Promise((resolve) => {
        wx.downloadFile({
          url: api.mapImageUrl(meta.version),
          success: (res) => resolve(res.statusCode === 200 ? res.tempFilePath : ''),
          fail: () => resolve('')
        });
      });
    }
    if (session !== this.session || version !== this.mapVersion) return;
    this.mapMeta = meta;
    this.mapImagePath = imagePath;
    this.emit('map');
  }

  /* ---------- 派生状态 ---------- */
  platform() {
    return (this.state && this.state.platform_status) || null;
  }

  task() {
    return (this.state && this.state.task_status) || null;
  }

  isMock() {
    return !this.state || !this.state.system_mode || this.state.system_mode.mode !== 'real';
  }

  taskActive() {
    const t = this.task();
    return !!t && ['pending', 'running', 'paused'].indexOf(t.state) >= 0;
  }

  estopActive() {
    const p = this.platform();
    const d = this.state && this.state.device_status;
    return !!((p && (p.fpga_state === 'estop' || p.control_estop)) || (d && d.emergency_stop));
  }
}

module.exports = new Store();
