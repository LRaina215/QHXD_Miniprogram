/**
 * REST 客户端：所有请求都 resolve（不 reject），返回 { ok, status, data, error }。
 * 写接口带 Bearer Token；网关的拒绝原因统一翻译成中文（explain）。
 */
const config = require('./config');

const ERROR_TEXT = {
  missing_token: '还没有设置访问 Token，请到「我的」里填写',
  unauthorized: 'Token 不正确或已失效，请到「我的」里重新填写',
  public_control_disabled: '云端已关闭公网运动控制（PUBLIC_CONTROL_ENABLED=false）',
  public_endpoint_disabled: '该接口不对公网开放',
  not_in_public_whitelist: '云端网关版本较旧，暂不支持这个操作',
  robot_offline: '机器人离线，命令没有发出',
  robot_emergency_stop: '机器人处于急停状态，请先解除急停',
  rate_limited: '操作太频繁，请稍后再试',
  request_timeout: '请求超时，请检查连接并查看最新状态',
  network_error: '网络不可用，请检查手机网络',
  latest_frame_stale: '相机画面已过期，正在等待新画面',
  latest_frame_not_found: '相机还没有画面，正在等待感知节点输出'
};

function getToken() {
  try {
    const token = (wx.getStorageSync(config.TOKEN_STORAGE_KEY) || '').trim();
    if (token) return token;
    return (wx.getStorageSync(config.LEGACY_TOKEN_STORAGE_KEY) || '').trim();
  } catch (e) {
    return '';
  }
}

function setToken(token) {
  const value = (token || '').trim();
  if (value) wx.setStorageSync(config.TOKEN_STORAGE_KEY, value);
  else wx.removeStorageSync(config.TOKEN_STORAGE_KEY);
  wx.removeStorageSync(config.LEGACY_TOKEN_STORAGE_KEY);
}

function explain(error) {
  if (!error) return '请求失败';
  const code = String(error);
  if (code.indexOf('robot_fault:') === 0) return '机器人存在故障：' + code.slice(12);
  if (code.indexOf('rk_forward_failed') === 0) return 'RK3588 后端暂时连不上';
  if (/timeout/i.test(code)) return ERROR_TEXT.request_timeout;
  if (/request:fail/i.test(code)) return ERROR_TEXT.network_error;
  return ERROR_TEXT[code] || code;
}

function failureText(result) {
  if (result && result.uncertain) return '请求结果未确认，命令可能已被接收。请先查看总览中的任务状态，避免重复下发。';
  return explain(result && result.error);
}

// 只合并仍在等待的相同写请求，不自动重试；急停与暂停不会被其他命令阻塞。
const writes = new Map();

// 图片接口的错误正文也是 ArrayBuffer；只解析有界的 UTF-8 JSON 错误，不处理成功图片。
function errorPayload(body) {
  if (!body || typeof body.byteLength !== 'number' || body.byteLength > 65536) return body;
  try {
    const escaped = Array.from(new Uint8Array(body), (b) => '%' + ('0' + b.toString(16)).slice(-2)).join('');
    return JSON.parse(decodeURIComponent(escaped));
  } catch (e) {
    return null;
  }
}

function request(path, options) {
  const opts = options || {};
  const url = config.buildUrl(path);
  const header = Object.assign({}, opts.header || {});
  if (opts.auth) {
    const token = getToken();
    if (!token && opts.auth === 'required') {
      return Promise.resolve({ ok: false, status: 0, data: null, error: 'missing_token' });
    }
    if (token) header.Authorization = 'Bearer ' + token;
  }
  if (opts.method === 'POST') header['Content-Type'] = 'application/json';
  const isWrite = (opts.method || 'GET') !== 'GET';
  const key = opts.dedupe ? JSON.stringify([url, opts.method, header.Authorization || '', opts.data]) : '';
  if (key && writes.has(key)) return writes.get(key);
  const pending = new Promise((resolve) => {
    try { wx.request({
      url,
      method: opts.method || 'GET',
      data: opts.data,
      header,
      timeout: opts.timeout || 8000,
      responseType: opts.responseType || 'text',
      success(res) {
        const status = res.statusCode || 0;
        const body = res.data;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, status, data: body, error: '' });
          return;
        }
        const payload = errorPayload(body);
        // 已知错误码使用统一中文提示，避免把后端文件路径等诊断细节展示给用户。
        const detail = status === 401 ? 'unauthorized' : payload && typeof payload === 'object'
          ? (ERROR_TEXT[payload.error] ? payload.error : (payload.detail || payload.error)) : '';
        resolve({ ok: false, status, data: body, error: (typeof detail === 'string' && detail) || ('http_' + status), uncertain: isWrite && status >= 500 });
      },
      fail(err) {
        resolve({ ok: false, status: 0, data: null, error: (err && (err.errMsg || err.message)) || 'network_error', uncertain: isWrite });
      }
    }); } catch (e) {
      resolve({ ok: false, status: 0, data: null, error: 'network_error' });
    }
  });
  if (!key) return pending;
  const tracked = pending.finally(() => { if (writes.get(key) === tracked) writes.delete(key); });
  writes.set(key, tracked);
  return tracked;
}

function unwrap(result) {
  if (!result || !result.ok || !result.data || typeof result.data !== 'object') return null;
  return result.data.data !== undefined ? result.data.data : result.data;
}

/** 网关健康：新网关在 /api/gateway/health（主域名可达）；旧网关只有 /health（仅 api 子域名） */
async function getGatewayHealth() {
  const fresh = await request('/api/gateway/health', { timeout: 15000 });
  if (fresh.ok && fresh.data && fresh.data.status) return { ok: true, data: fresh.data };
  const legacy = await request('/health', { timeout: 15000 });
  if (legacy.ok && legacy.data && typeof legacy.data === 'object' && legacy.data.status) return { ok: true, data: legacy.data };
  return { ok: false, data: null, error: fresh.error || legacy.error };
}

function post(path, body, auth) {
  return request(path, {
    method: 'POST',
    data: Object.assign({ source: config.SOURCE, requested_by: 'wechat' }, body || {}),
    auth: auth || 'required',
    dedupe: true,
    timeout: 12000
  });
}

module.exports = {
  request,
  unwrap,
  explain,
  failureText,
  getToken,
  setToken,
  getGatewayHealth,
  getState: () => request('/api/state/latest'),
  getNavigation: () => request('/api/navigation/latest'),
  getMapMetadata: () => request('/api/navigation/map/metadata'),
  mapImageUrl: (version) => config.buildUrl('/api/navigation/map/image?v=' + encodeURIComponent(version || Date.now())),
  getWaypoints: () => request('/api/waypoints'),
  getTaskEvents: (limit) => request('/api/tasks/events?limit=' + (limit || 30)),
  getAlerts: () => request('/api/alerts'),
  getLatestFrame: () => request('/api/perception/latest_frame?t=' + Date.now(), { responseType: 'arraybuffer', timeout: 6000 }),
  mission: (command, body) => post('/api/mission/' + command, body),
  estop: (engage) => post('/api/platform/estop', { engage: !!engage }),
  switchMode: (mode) => post('/api/system/mode/switch', { mode }),
  smartCommand: (text) => request('/api/voice/smart_command', {
    method: 'POST',
    auth: 'required',
    dedupe: true,
    timeout: 45000,
    data: { text, source: config.SOURCE + '-voice', requested_by: 'wechat', generate_tts: true }
  }),
  // 确认接口的请求模型不接受 source 字段，单独组包
  confirmCommand: (id, confirmed) => request('/api/voice/confirm_command', {
    method: 'POST',
    auth: 'required',
    dedupe: true,
    timeout: 12000,
    data: { pending_command_id: id, confirmed: !!confirmed, requested_by: 'wechat' }
  })
};
