const api = require('./api');
const config = require('./config');

function getToken() {
  return (wx.getStorageSync(config.TOKEN_STORAGE_KEY) || '').trim();
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function post(path, data) {
  const token = getToken();
  if (!token) {
    return Promise.resolve({ ok: false, error: 'missing_public_api_token', statusCode: 0 });
  }
  return api.request(path, {
    method: 'POST',
    data,
    header: {
      'Content-Type': 'application/json',
      ...authHeader()
    }
  });
}

function goToWaypoint(waypointId) {
  return post('/api/mission/go_to_waypoint', {
    waypoint_id: waypointId,
    source: 'wechat-miniprogram',
    requested_by: 'operator'
  });
}

function startPatrol(patrolId = 'default_patrol') {
  return post('/api/mission/start_patrol', {
    patrol_id: patrolId,
    source: 'wechat-miniprogram',
    requested_by: 'operator'
  });
}

function pause() {
  return post('/api/mission/pause', {
    source: 'wechat-miniprogram',
    requested_by: 'operator'
  });
}

function resume() {
  return post('/api/mission/resume', {
    source: 'wechat-miniprogram',
    requested_by: 'operator'
  });
}

function returnHome() {
  return post('/api/mission/return_home', {
    source: 'wechat-miniprogram',
    requested_by: 'operator'
  });
}

function cancel() {
  return post('/api/mission/cancel', {
    source: 'wechat-miniprogram',
    requested_by: 'operator'
  });
}

function smartCommand(text) {
  const headers = {
    'Content-Type': 'application/json',
    ...authHeader()
  };
  return api.request('/api/voice/smart_command', {
    method: 'POST',
    data: {
      text,
      source: 'wechat-miniprogram-smart',
      requested_by: 'operator',
      generate_tts: true
    },
    header: headers,
    timeout: 45000
  });
}

function confirmVoiceCommand(pendingCommandId, confirmed) {
  return post('/api/voice/confirm_command', {
    pending_command_id: pendingCommandId,
    confirmed,
    requested_by: 'operator'
  });
}

function switchMode(mode) {
  const token = getToken();
  if (!token) {
    return Promise.resolve({ ok: false, error: 'missing_public_api_token', statusCode: 0 });
  }
  return api.request('/api/system/mode/switch', {
    method: 'POST',
    data: {
      mode,
      source: 'wechat-miniprogram',
      requested_by: 'operator'
    },
    header: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    timeout: 15000
  });
}

function getVideoSession() {
  return post('/api/video/session', {});
}

module.exports = {
  getToken,
  goToWaypoint,
  startPatrol,
  pause,
  resume,
  returnHome,
  cancel,
  smartCommand,
  confirmVoiceCommand,
  switchMode,
  getVideoSession
};
