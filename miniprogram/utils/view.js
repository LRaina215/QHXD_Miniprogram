/** 从 store 派生页面视图数据（纯函数，便于测试；所有页面共用同一套文案）。 */
const L = require('./labels');

function waypointName(store, id) {
  if (!id) return '';
  const w = store.waypoints.find((x) => x.waypoint_id === id);
  return w ? w.name : id;
}

function hero(store) {
  const s = store.state;
  const t = s && s.task_status;
  const idle = !t || t.task_type === 'placeholder';
  const goal = (s && s.nav_status && s.nav_status.current_goal) || '';
  const target = goal.indexOf('target:') === 0 ? L.displayTarget(goal.slice(7)) : '';
  let title = '待命';
  if (!idle) {
    if (t.task_type === 'search_target') title = '寻找「' + (target || '目标') + '」';
    else if (t.task_type === 'follow_target') title = '跟随「' + (target || '人员') + '」';
    else if (t.task_type === 'return_home') title = '返回起点';
    else if (t.task_type === 'start_patrol') title = '巡检 · ' + (waypointName(store, t.current_waypoint_id) || '路线');
    else title = '前往 ' + (waypointName(store, t.current_waypoint_id || goal) || '目标点');
  }
  const active = store.taskActive();
  const remaining = s && s.nav_status ? s.nav_status.remaining_distance : null;
  const showPhase = !idle && t.phase && ['completed', 'failed', 'cancelled'].indexOf(t.phase) < 0;
  return {
    idle,
    title,
    eyebrow: idle || active ? '当前任务' : '最近任务',
    tone: idle ? 'off' : L.taskTone(t.state),
    stateText: idle ? '空闲' : (L.TASK_STATE[t.state] || t.state),
    phaseText: showPhase ? (L.PHASE[t.phase] || t.phase) : '',
    stepText: t && t.waypoint_count > 1 ? '第 ' + ((t.waypoint_index || 0) + 1) + ' / ' + t.waypoint_count + ' 点' : '',
    detail: idle ? '在「任务」页选择视觉任务、定点或巡检，或对「助手」说话。' : (t.detail || ''),
    progress: idle ? 0 : Math.max(0, Math.min(100, t.progress || 0)),
    remainingText: active && remaining !== null && remaining !== undefined ? '剩余 ' + L.fmt(remaining, 2) + ' m' : '',
    icon: idle ? 'brand' : ({ search_target: 'search', follow_target: 'follow', return_home: 'home', start_patrol: 'route' }[t.task_type] || 'pin'),
    active,
    canPause: !!t && t.state === 'running',
    canResume: !!t && t.state === 'paused',
    canCancel: active,
    canHome: !active
  };
}

function links(store) {
  const p = store.platform();
  const det = store.state && store.state.detection_status;
  const rk = store.conn.rk;
  return [
    { key: 'rk', label: 'RK3588', tone: rk ? 'ok' : 'bad', value: rk ? '在线' : '离线' },
    { key: 'nav', label: 'FPGA 导航', tone: L.linkTone(p && p.nav_link), value: L.linkLabel(p && p.nav_link) },
    { key: 'ctl', label: 'FPGA 控制', tone: L.linkTone(p && p.control_link), value: L.linkLabel(p && p.control_link) },
    { key: 'cam', label: '视觉', tone: det ? 'ok' : 'off', value: det ? '运行' : '未接入' }
  ];
}

function hud(store) {
  const p = store.platform();
  const pose = store.nav && store.nav.pose;
  return [
    { k: '速度', v: L.fmt(p && p.cmd_vx_mps, 2), u: 'm/s' },
    { k: '位姿', v: pose ? L.fmt(pose.x, 1) + ', ' + L.fmt(pose.y, 1) : '--', u: pose ? Math.round(pose.yaw * 180 / Math.PI) + '°' : '' },
    { k: '定位', v: L.LOC[p && p.loc_state] || '--', u: p && p.loc_quality !== null && p.loc_quality !== undefined ? p.loc_quality + '%' : '' }
  ];
}

function platform(store) {
  const p = store.platform() || {};
  const st = p.fpga_state;
  const tone = st === 'estop' || st === 'blocked' ? 'bad' : (['moving', 'tracking', 'searching'].indexOf(st) >= 0 ? 'run' : (st === 'arrived' ? 'ok' : 'off'));
  const flag = (k, v) => ({ k, v: v === null || v === undefined ? 'na' : (v ? 'yes' : 'no') });
  const pct = (v) => Math.min(100, Math.abs(v || 0) / 0.6 * 100);
  return {
    navTone: L.linkTone(p.nav_link),
    navLink: L.linkLabel(p.nav_link),
    ctlTone: L.linkTone(p.control_link),
    ctlLink: L.linkLabel(p.control_link),
    state: L.FPGA_STATE[st] || '--',
    stateTone: tone,
    mode: (L.FPGA_MODE[p.fpga_mode] || '--') + '模式',
    vx: L.fmt(p.cmd_vx_mps, 2),
    wz: L.fmt(p.cmd_wz_radps, 2),
    loc: L.LOC[p.loc_state] || '--',
    locSub: p.loc_quality !== null && p.loc_quality !== undefined ? '质量 ' + p.loc_quality + '%' : (p.status_rate_hz ? L.fmt(p.status_rate_hz, 1) + ' Hz' : ''),
    flags: [flag('雷达', p.lidar_ok), flag('里程计', p.odom_ok), flag('先验图', p.nav_link ? p.map_loaded : null), flag('视觉目标', p.nav_link ? p.target_valid : null)],
    left: L.fmt(p.wheel_left_mps, 2),
    right: L.fmt(p.wheel_right_mps, 2),
    leftPct: pct(p.wheel_left_mps),
    rightPct: pct(p.wheel_right_mps),
    roll: p.roll_deg || 0,
    pitch: p.pitch_deg || 0,
    attText: L.fmt(p.roll_deg, 1) + '° / ' + L.fmt(p.pitch_deg, 1) + '°',
    policy: p.policy_active === null || p.policy_active === undefined ? '策略 --' : (p.policy_active ? '策略运行中' : '策略已停止'),
    policyOk: !!p.policy_active,
    ctlEstop: p.control_estop ? '控制急停锁存' : '控制急停未触发',
    ctlEstopBad: !!p.control_estop,
    faults: (p.control_faults || []).join('，')
  };
}

function objects(store) {
  const det = store.state && store.state.detection_status;
  const list = det && Array.isArray(det.objects) ? det.objects.slice() : [];
  list.sort((a, b) => (a.distance_m === null || a.distance_m === undefined ? 99 : a.distance_m) - (b.distance_m === null || b.distance_m === undefined ? 99 : b.distance_m));
  return {
    meta: det ? (det.model_name || '模型') + ' · ' + L.clock(det.timestamp) : '感知未接入',
    items: list.slice(0, 6).map((o, i) => ({
      key: (o.track_id === null || o.track_id === undefined ? 'n' : o.track_id) + '-' + i,
      name: (o.color ? (L.COLOR_NAME[o.color] || '') + '色' : '') + (L.CLASS_NAME[o.class_name] || o.class_name),
      swatch: o.color ? (L.COLOR_HEX[o.color] || '#c9c6bd') : '#e4e2db',
      sub: '#' + (o.track_id === null || o.track_id === undefined ? '-' : o.track_id) + ' · 置信度 ' + L.fmt(o.confidence, 2),
      dist: o.distance_m === null || o.distance_m === undefined ? '--' : L.fmt(o.distance_m, 2)
    })),
    locked: !!(store.nav && store.nav.target)
  };
}

function events(store, limit) {
  return store.events.slice(0, limit || 30).map((e) => ({
    id: e.event_id,
    tone: L.eventTone(e.event_type),
    text: e.detail,
    time: L.clock(e.timestamp)
  }));
}

module.exports = { hero, links, hud, platform, objects, events, waypointName };
