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
  return request('/health', { timeout: 15000 });
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

function getWaypoints() {
  return request('/api/waypoints');
}

function getTaskEvents() {
  return request('/api/tasks/events?limit=50');
}

function getPerceptionEvents(limit = 20) {
  return request(`/api/perception/events?limit=${limit}`);
}

function getVideoHealth() {
  return request('/api/perception/video_health');
}

function getWeatherLatest() {
  return request('/api/external/weather/latest');
}

function getNavigationLatest() {
  return request('/api/navigation/latest');
}

function getNavigationMapMetadata() {
  return request('/api/navigation/map/metadata');
}

function getNavigationMapImageUrl() {
  return config.buildUrl(`/api/navigation/map/image?t=${Date.now()}`);
}

function getCommandLogs() {
  return request('/api/commands/logs');
}

function getImuLatest() {
  return request('/api/imu/latest');
}

function getLatestFrameUrl() {
  const t = Math.floor(Date.now() / 500) * 500;
  const base = config.BASE_URL;
  const path = `/api/perception/latest_frame?t=${t}`;
  if (!base) return path;
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

function checkLatestFrame() {
  const path = `/api/perception/latest_frame?t=${Date.now()}`;
  return request(path, { method: 'HEAD', timeout: 5000 });
}

module.exports = {
  request,
  getHealth,
  getStateLatest,
  getAlerts,
  getCurrentTask,
  getWaypoints,
  getTaskEvents,
  getPerceptionEvents,
  getVideoHealth,
  getWeatherLatest,
  getNavigationLatest,
  getNavigationMapMetadata,
  getNavigationMapImageUrl,
  getCommandLogs,
  getImuLatest,
  getLatestFrameUrl,
  checkLatestFrame
};
