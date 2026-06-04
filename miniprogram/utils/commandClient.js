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

function startPatrol(patrolId = 'patrol_default') {
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

function smartCommand(text) {
  return post('/api/voice/smart_command', {
    text,
    source: 'wechat-miniprogram-smart',
    requested_by: 'operator',
    generate_tts: true
  });
}

function confirmVoiceCommand(pendingCommandId, confirmed) {
  return post('/api/voice/confirm_command', {
    pending_command_id: pendingCommandId,
    confirmed,
    requested_by: 'operator'
  });
}

module.exports = {
  getToken,
  goToWaypoint,
  startPatrol,
  pause,
  resume,
  returnHome,
  smartCommand,
  confirmVoiceCommand
};
