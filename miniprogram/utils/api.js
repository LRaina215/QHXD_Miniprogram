const config = require('./config');

function normalizeError(err) {
  if (!err) return 'request_failed';
  if (typeof err === 'string') return err;
  return err.errMsg || err.message || 'request_failed';
}

function request(path, options = {}) {
  const url = config.buildUrl(path);
  const method = options.method || 'GET';
  const headers = Object.assign({}, options.header || options.headers || {});

  return new Promise((resolve) => {
    wx.request({
      url,
      method,
      data: options.data,
      header: headers,
      timeout: options.timeout || 8000,
      success(res) {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ ok: true, data: res.data, statusCode, headers: res.header || {}, url });
          return;
        }
        const body = res.data || {};
        resolve({
          ok: false,
          error: body.detail || body.error || body.errMsg || `http_${statusCode}`,
          statusCode,
          data: res.data,
          headers: res.header || {},
          url
        });
      },
      fail(err) {
        resolve({
          ok: false,
          error: normalizeError(err),
          statusCode: 0,
          data: null,
          headers: {},
          url
        });
      }
    });
  });
}

function getHealth() {
  return request('/health');
}

function getStateLatest() {
  return request('/api/state/latest');
}

function getAlerts() {
  return request('/api/alerts');
}

function getCurrentTask() {
  return request('/api/tasks/current');
}

function getImuLatest() {
  return request('/api/imu/latest');
}

function getLatestFrameUrl() {
  return config.buildUrl(`/api/perception/latest_frame?t=${Date.now()}`);
}

function checkLatestFrame() {
  return request(`/api/perception/latest_frame?t=${Date.now()}`, { method: 'HEAD', timeout: 5000 });
}

module.exports = {
  request,
  getHealth,
  getStateLatest,
  getAlerts,
  getCurrentTask,
  getImuLatest,
  getLatestFrameUrl,
  checkLatestFrame
};
