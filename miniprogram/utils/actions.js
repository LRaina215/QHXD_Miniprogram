/**
 * 任务操作：运动类命令先由页面弹出 confirm-sheet，确认后调用 run()；停车类（暂停 / 取消）直接执行。
 * sheetFor() 生成确认面板内容，所有页面共用同一套文案。
 */
const api = require('./api');
const L = require('./labels');

const MOTION = { go_to_waypoint: 1, start_patrol: 1, return_home: 1, search_target: 1, follow_target: 1, resume: 1 };

function isMotion(command) {
  return !!MOTION[command];
}

function sheetFor(command, body, store) {
  const b = body || {};
  if (command === 'search_target') {
    return { title: '寻找' + b.label + '并停在旁边', rows: [
      { k: '目标', v: b.label },
      { k: '方式', v: 'FPGA 自主探索，发现后接近到 0.7 m 并面对目标' },
      { k: '时限', v: (b.timeout_s || 180) + ' 秒内未找到自动停车' }
    ] };
  }
  if (command === 'follow_target') {
    return { title: '跟随' + (b.label || '人员'), rows: [
      { k: '目标', v: '人员（最近的、持续跟踪同一个人）' },
      { k: '时限', v: (b.timeout_s || 300) + ' 秒后自动停车，可随时取消' }
    ] };
  }
  if (command === 'go_to_waypoint') {
    const w = store.waypoints.find((x) => x.waypoint_id === b.waypoint_id);
    return { title: '前往' + (w ? w.name : b.waypoint_id), rows: [
      { k: '目标点', v: w ? w.name : b.waypoint_id },
      { k: '坐标', v: w && w.pose ? L.fmt(w.pose.x, 2) + ', ' + L.fmt(w.pose.y, 2) + ' m' : '--' }
    ] };
  }
  if (command === 'start_patrol') {
    const route = store.waypoints.filter((w) => w.group === 'patrol').map((w) => w.name).join(' → ');
    return { title: '开始巡检', rows: [
      { k: '路线', v: (route || '默认路线') + ' → 起点' },
      { k: '方式', v: '逐点导航，每点停留后继续' }
    ] };
  }
  if (command === 'return_home') return { title: '返回起点', rows: [{ k: '目标点', v: '起点' }] };
  if (command === 'resume') return { title: '继续当前任务', rows: [{ k: '任务', v: (store.task() && store.task().detail) || '--' }] };
  return { title: command, rows: [] };
}

/** 执行任务命令，返回 { ok, detail } */
async function run(command, body) {
  const res = await api.mission(command, body || {});
  const data = api.unwrap(res);
  if (res.ok && data && res.data.success !== false && typeof data.accepted === 'boolean') return { ok: data.accepted, detail: data.detail || (data.accepted ? '已发送' : '任务未受理') };
  return { ok: false, uncertain: !!res.uncertain || res.ok, detail: api.failureText(res.ok ? { uncertain: true } : res) };
}

module.exports = { isMotion, sheetFor, run };
