/** 数据层连接切换回归：仅本地模拟异步返回，不访问网络或设备。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function harness() {
  const h = { now: 100000, name: 'old', delay: false, pending: [], calls: [], downloads: [], responses: {} };
  const snapshot = (name) => ({
    getState: { data: { name } },
    getNavigation: { data: { pose: { x: 1, y: 2 }, map_version: 'canvas-' + name } },
    getGatewayHealth: { status: 'ok', public_control_enabled: true },
    getTaskEvents: { data: [{ event_id: name }] },
    getAlerts: { data: [{ alert_id: name }] },
    getWaypoints: { data: [{ waypoint_id: name }] },
    getMapMetadata: { data: { version: 'canvas-' + name } }
  });
  const api = {
    unwrap: (res) => res.ok ? (res.data.data === undefined ? res.data : res.data.data) : null,
    explain: (error) => error,
    mapImageUrl: (version) => 'https://local-test.invalid/' + version
  };
  Object.keys(snapshot('')).forEach((name) => {
    api[name] = () => {
      h.calls.push(name);
      const result = h.responses[name] || { ok: true, data: snapshot(h.name)[name] };
      if (!h.delay) return Promise.resolve(result);
      return new Promise((resolve) => h.pending.push(() => resolve(result)));
    };
  });
  class Socket {
    constructor() { this.connected = false; this.handlers = {}; }
    on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
    connect() {}
    disconnect() {
      this.connected = false;
      (this.handlers.close || []).forEach((fn) => fn());
    }
  }
  const sandbox = {
    module: { exports: {} }, console, Math, Date: { now: () => h.now },
    setInterval: () => 1, clearInterval() {},
    wx: { downloadFile: (options) => h.downloads.push(options) },
    require(name) {
      if (name === './api') return api;
      if (name === './socket') return Socket;
      if (name === './config') return {
        POLL_INTERVAL_MS: 3000, HEALTH_INTERVAL_MS: 15000, EVENTS_INTERVAL_MS: 5000,
        STALE_AFTER_MS: 10000, wsUrl: (p) => 'wss://local-test.invalid' + p
      };
      throw new Error('未模拟模块：' + name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/store.js'), 'utf8'), sandbox);
  h.store = sandbox.module.exports;
  h.finishPending = () => h.pending.splice(0).forEach((resolve) => resolve());
  return h;
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

(async () => {
  {
    const h = harness(); const s = h.store;
    s.start(); await s.refresh(); await flush();
    assert.strictEqual(s.state.name, 'old');
    h.delay = true;
    const changed = [];
    ['state', 'nav', 'map', 'events', 'alerts', 'waypoints', 'conn'].forEach((event) => s.on(event, () => changed.push(event)));
    s.restart();
    assert.strictEqual(s.state, null, '切换地址后应立即清除旧状态');
    assert.strictEqual(s.nav, null, '切换地址后应立即清除旧位姿');
    assert.strictEqual(s.health, null);
    ['events', 'alerts', 'waypoints', 'trail'].forEach((key) => assert.strictEqual(s[key].length, 0, key));
    ['lastStateAt', 'lastNavAt'].forEach((key) => assert.strictEqual(s[key], 0, key));
    assert.strictEqual(s.conn.rk, false);
    assert.strictEqual(s.conn.gateway, 'unknown');
    assert.strictEqual(s.conn.publicControl, null);
    assert.strictEqual(new Set(changed).size, 7, '页面订阅者应收到清空通知');
    s.stop(); h.finishPending(); await flush();
    console.log('  ✓ 切换地址立即清除旧状态并通知页面');
  }
  {
    const h = harness(); const s = h.store;
    h.delay = true; s.start();
    h.delay = false; h.name = 'new'; s.restart();
    assert.strictEqual(h.calls.filter((name) => name === 'getState').length, 2, '旧请求不应阻塞新连接');
    await s.refresh(); await flush();
    h.finishPending(); await flush();
    assert.strictEqual(s.state.name, 'new');
    assert.strictEqual(s.nav.map_version, 'canvas-new');
    assert.strictEqual(s.events[0].event_id, 'new');
    assert.strictEqual(s.alerts[0].alert_id, 'new');
    assert.strictEqual(s.waypoints[0].waypoint_id, 'new');
    assert.strictEqual(s.conn.gateway, 'online');
    s.stop();
    console.log('  ✓ 新连接立即请求，旧服务器迟到响应不能覆盖新数据');
  }
  {
    const h = harness(); const s = h.store;
    h.delay = true; s.start();
    const old = h.pending.splice(0);
    h.name = 'new'; s.restart();
    const current = s.refresh();
    old.forEach((resolve) => resolve()); await flush();
    assert.strictEqual(s.refresh(), current, '旧轮询结束不能解除新轮询的并发保护');
    h.finishPending(); await current; await flush();
    assert.strictEqual(s.state.name, 'new');
    s.stop();
    console.log('  ✓ 旧轮询结束不会干扰新轮询，刷新等待当前结果');
  }
  {
    const h = harness(); const s = h.store;
    h.delay = true;
    const oldMap = s.loadMap();
    h.delay = false; h.name = 'new'; s.restart();
    await s.refresh(); await flush();
    h.finishPending(); await oldMap;
    assert.strictEqual(s.mapMeta.version, 'canvas-new', '旧地图元数据不能写回');
    s.stop();
    console.log('  ✓ 旧地图元数据迟到时丢弃');
  }
  {
    const h = harness(); const s = h.store;
    h.responses.getMapMetadata = { ok: true, data: { data: { version: 'raster-old' } } };
    const oldMap = s.loadMap(); await flush();
    assert.strictEqual(h.downloads.length, 1);
    delete h.responses.getMapMetadata;
    h.name = 'new'; s.restart(); await s.refresh(); await flush();
    h.downloads[0].success({ statusCode: 200, tempFilePath: 'old-map.png' }); await oldMap;
    assert.strictEqual(s.mapMeta.version, 'canvas-new');
    assert.strictEqual(s.mapImagePath, '', '旧地图下载完成后不能覆盖新地图');
    s.stop();
    console.log('  ✓ 旧地图图片下载完成时丢弃');
  }
  {
    const h = harness(); const s = h.store;
    s.setState({ name: 'old' });
    h.now += 11000;
    h.responses.getGatewayHealth = { ok: false, error: 'network_error' };
    await s.pullHealth();
    assert.strictEqual(s.conn.gateway, 'offline', '不能凭历史上收到过状态一直显示网关在线');
    console.log('  ✓ 状态已过期且健康检查失败时显示离线');
  }
  console.log('数据层连接生命周期检查通过（纯本地模拟）');
})().catch((error) => { console.error(error); process.exitCode = 1; });
