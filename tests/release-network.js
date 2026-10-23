/** 发布网络配置定向检查：纯本地，不操作微信后台或设备。 */
const assert = require('assert');
const { storage, mount } = require('./wx-sim');
const config = require('../miniprogram/utils/config');
const api = require('../miniprogram/utils/api');
const store = require('../miniprogram/utils/store');

// 2026-10-23 从当前 AppID“项目配置”刷新读取的 request/socket/downloadFile 登记值。
assert.strictEqual(config.baseUrl(), 'https://api.lingxunrobot.cn');
assert.strictEqual(config.wsUrl('/ws/state'), 'wss://api.lingxunrobot.cn/ws/state');
assert.ok(config.buildUrl('/api/state/latest').startsWith('https://api.lingxunrobot.cn/'));
console.log('  ✓ 默认 HTTPS / WSS 使用已核对的 API 域名');

storage.set(config.BASE_URL_STORAGE_KEY, 'https://lingxunrobot.cn///');
assert.strictEqual(config.baseUrl(), 'https://api.lingxunrobot.cn');
console.log('  ✓ 旧版缓存的公网主域名兼容迁移');

storage.set(config.BASE_URL_STORAGE_KEY, 'http://192.168.4.1:8000/');
assert.strictEqual(config.baseUrl(), 'http://192.168.4.1:8000');
assert.strictEqual(config.wsUrl('/ws/state'), 'ws://192.168.4.1:8000/ws/state');
storage.set(config.BASE_URL_STORAGE_KEY, 'https://custom.local-test.invalid/');
assert.strictEqual(config.baseUrl(), 'https://custom.local-test.invalid');
storage.clear();
console.log('  ✓ 自定义局域网及其他服务器地址保持有效');

assert.match(api.explain('request:fail url not in domain list'), /合法域名/);
assert.match(api.explain('request:fail ssl hand shake error'), /证书.*TLS/);
assert.match(api.explain('request:fail timeout'), /超时/);
assert.match(api.explain('request:fail network unavailable'), /网络/);
console.log('  ✓ 微信域名拒绝、证书失败与普通网络错误分别说明');

const page = mount('pages/home/home');
store.conn = { gateway: 'offline', rk: false, error: api.explain('request:fail url not in domain list') };
page.renderConn();
assert.match(page.data.banner, /合法域名/);
assert.ok(page.data.banner.includes('https://api.lingxunrobot.cn'));
console.log('  ✓ 首页保留具体连接错误及目标地址');
console.log('发布网络配置检查通过：5 组（纯本地）');
