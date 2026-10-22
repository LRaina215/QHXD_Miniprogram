const config = require('./config');
const api = require('./api');

function toMs(value) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function adaptTask(task) {
  if (!task) return null;
  return {
    id: task.task_id || task.id || 'current-task',
    type: task.task_type || task.type || 'placeholder',
    status: task.state || task.status || 'idle',
    state: task.state || task.status || 'idle',
    progress: firstDefined(task.progress, 0),
    source: task.source || 'backend',
    timestamp: Math.floor(toMs(task.updated_at) / 1000) || Math.floor(Date.now() / 1000),
    raw: task
  };
}

function pickPrimaryObject(objects) {
  if (!Array.isArray(objects) || objects.length === 0) return null;
  return objects.slice().sort((a, b) => (getObjectConfidence(b) || 0) - (getObjectConfidence(a) || 0))[0];
}

function getObjectLabel(object) {
  if (!object) return '';
  return firstDefined(object.class_name, object.label, object.name, object.class, object.type, '');
}

function getObjectConfidence(object) {
  if (!object) return 0;
  return firstDefined(object.confidence, object.score, object.probability, 0);
}

function getSystemMode(systemMode) {
  if (!systemMode) return { mode: 'unknown', updatedAt: null };
  if (typeof systemMode === 'string') return { mode: systemMode, updatedAt: null };
  return {
    mode: systemMode.mode || systemMode.state || 'unknown',
    updatedAt: systemMode.updated_at || systemMode.timestamp || null
  };
}

function adaptAlerts(alerts) {
  if (!Array.isArray(alerts)) return [];
  return alerts.map((item, index) => ({
    id: item.alert_id || `alert-${index}`,
    time: toMs(item.timestamp) || Date.now(),
    timestamp: Math.floor((toMs(item.timestamp) || Date.now()) / 1000),
    level: item.level || 'info',
    message: item.message || '',
    source: item.source || 'backend',
    acknowledged: !!item.acknowledged,
    raw: item
  }));
}

function adaptState(rawState, extras = {}) {
  const state = rawState || {};
  const pose = state.robot_pose || {};
  const nav = state.nav_status || {};
  const task = adaptTask(state.task_status);
  const device = state.device_status || {};
  const env = state.env_sensor || {};
  const detection = state.detection_status || null;
  const objects = detection && Array.isArray(detection.objects) ? detection.objects : [];
  const events = detection && Array.isArray(detection.events) ? detection.events : [];
  const primaryObject = pickPrimaryObject(objects);
  const alerts = adaptAlerts(extras.alerts || []);
  const latestAlarm = alerts.find((item) => ['warning', 'error', 'critical'].includes(item.level)) || alerts[0] || null;

  const updatedAtMs = toMs(state.updated_at);
  const ageMs = updatedAtMs ? Date.now() - updatedAtMs : 0;
  const isStale = !updatedAtMs || ageMs > config.STALE_AFTER_MS;
  const staleReason = !updatedAtMs
    ? '后端状态缺少 updated_at'
    : isStale
      ? `状态已 ${Math.round(ageMs / 1000)} 秒未更新`
      : '';

  const navState = nav.state || 'offline';
  const battery = firstDefined(device.battery_percent, 0);
  const frameAvailable = extras.frameStatus !== 'missing';
  const frameMissing = extras.frameStatus === 'missing';
  const systemMode = getSystemMode(state.system_mode || state.mode);

  return {
    timestamp: Math.floor(Date.now() / 1000),
    sensors: {
      co: null,
      ch4: null,
      air_quality: null,
      flame: 0,
      temperature: firstDefined(env.temperature_c, null),
      humidity: firstDefined(env.humidity_percent, null),
      status: env.status || 'unknown'
    },
    robot: {
      battery,
      status: navState,
      online: device.online === undefined ? false : !!device.online,
      emergency_stop: !!device.emergency_stop,
      emergencyStop: !!device.emergency_stop,
      fault_code: firstDefined(device.fault_code, null),
      faultCode: firstDefined(device.fault_code, null),
      pose: {
        x: firstDefined(pose.x, 0),
        y: firstDefined(pose.y, 0),
        yaw: firstDefined(pose.yaw, 0),
        frame_id: pose.frame_id || 'map'
      },
      current_target: nav.current_goal || '--',
      currentGoal: nav.current_goal || null,
      remaining_distance: firstDefined(nav.remaining_distance, null),
      remainingDistance: firstDefined(nav.remaining_distance, null),
      navMode: nav.mode || '--',
      navState,
      running_hours: null,
      firmware_version: 'RK3588'
    },
    perception: {
      detection: primaryObject ? getObjectLabel(primaryObject) : '',
      confidence: primaryObject ? getObjectConfidence(primaryObject) : 0,
      objects,
      events,
      source: detection ? detection.source : '',
      updatedAt: detection ? detection.timestamp : null,
      hasData: !!detection
    },
    alarm: {
      active: !!latestAlarm && latestAlarm.level !== 'info',
      message: latestAlarm ? latestAlarm.message : '',
      list: alerts
    },
    tasks: task ? [task] : [],
    currentTask: task,
    commandLogs: Array.isArray(extras.commandLogs) ? extras.commandLogs : [],
    navigation: extras.navigation || null,
    image: {
      url: api.getLatestFrameUrl(),
      timestamp: Math.floor(Date.now() / 1000),
      available: frameAvailable,
      missing: frameMissing
    },
    health: extras.health || null,
    imu: extras.imu || null,
    system: {
      mode: systemMode.mode,
      updatedAt: systemMode.updatedAt
    },
    meta: {
      robotId: config.ROBOT_ID,
      updatedAt: state.updated_at || null,
      updatedAtMs,
      isStale,
      staleReason,
      ageSeconds: updatedAtMs ? Math.max(0, Math.round(ageMs / 1000)) : null,
      dataSource: extras.dataSource || 'rest',
      restOnline: !!extras.restOnline,
      wsConnected: !!extras.wsConnected,
      navigationWsConnected: !!extras.navigationWsConnected,
      cloudOnline: !!(extras.health && extras.health.status === 'ok'),
      rkOnline: !!(extras.health && extras.health.rk_online),
      publicControlEnabled: !!(extras.health && extras.health.public_control_enabled),
      frameStatus: extras.frameStatus || 'unknown',
      frameStatusText: frameAvailable ? '视觉图片可用' : frameMissing ? '视觉画面未更新' : '视觉状态待检测',
      lastError: extras.lastError || ''
    },
    raw: state
  };
}

module.exports = {
  adaptState,
  adaptTask,
  adaptAlerts
};
