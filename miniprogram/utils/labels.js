/** 与 Web 控制台（QHXD_Web frontend/src/labels.ts）保持一致的文案与状态色。 */

const TASK_TYPE = {
  placeholder: '待命',
  go_to_waypoint: '定点导航',
  start_patrol: '巡检',
  return_home: '返航',
  search_target: '寻找目标',
  follow_target: '跟随'
};

const TASK_STATE = {
  idle: '空闲', pending: '下发中', running: '执行中', paused: '已暂停',
  completed: '已完成', failed: '失败', cancelled: '已取消'
};

const PHASE = {
  sending_goal: '下发目标点', navigating: '导航中', dwell: '巡检点停留', blocked: '受阻重规划',
  searching: '探索搜索', tracking: '接近目标', exploring: '探索搜索', starting: '启动中', paused: '已暂停'
};

const FPGA_STATE = {
  idle: '空闲', moving: '行进', arrived: '到达', blocked: '受阻', tracking: '跟踪', searching: '探索', estop: '急停'
};

const FPGA_MODE = { idle: '空闲', goto: '定点', track: '跟踪', search: '探索', estop: '急停' };

const LOC = { mapless: '无图', aligning: '对准中', ok: '正常', degraded: '退化', lost: '丢失' };

const CLASSES = [
  { id: 'bottle', name: '水瓶' },
  { id: 'cup', name: '杯子' },
  { id: 'person', name: '人' },
  { id: 'sports ball', name: '球', icon: 'ball' },
  { id: 'chair', name: '椅子' },
  { id: 'backpack', name: '背包' }
];
const CLASS_NAME = {};
CLASSES.forEach((c) => { CLASS_NAME[c.id] = c.name; });

const COLORS = [
  { id: 'red', name: '红', hex: '#ff4d5e' },
  { id: 'green', name: '绿', hex: '#3ddc84' },
  { id: 'blue', name: '蓝', hex: '#4c8dff' },
  { id: 'yellow', name: '黄', hex: '#ffd23f' },
  { id: 'white', name: '白', hex: '#f2f5f7' },
  { id: 'black', name: '黑', hex: '#2b3036' }
];
const COLOR_NAME = {};
const COLOR_HEX = {};
COLORS.forEach((c) => { COLOR_NAME[c.id] = c.name; COLOR_HEX[c.id] = c.hex; });

function targetLabel(cls, color) {
  return (color ? (COLOR_NAME[color] || color) + '色' : '') + (CLASS_NAME[cls] || cls);
}

/** 目标显示名：板载 LLM 有时把类别英文名（bottle）当 label，这时按类别 + 颜色换成中文 */
function displayTarget(label, cls, color) {
  if (label && /[\u4e00-\u9fff]/.test(label)) return label;
  const c = cls || label;
  return c ? targetLabel(c, color) : '';
}

function taskTone(state) {
  if (state === 'running' || state === 'pending') return 'run';
  if (state === 'completed') return 'ok';
  if (state === 'failed') return 'bad';
  if (state === 'paused') return 'wait';
  return 'off';
}

function linkTone(link) {
  return { online: 'ok', mock: 'mock', offline: 'bad' }[link] || 'off';
}

function linkLabel(link) {
  return { online: '在线', mock: '模拟', offline: '离线' }[link] || '未接入';
}

function eventTone(type) {
  const v = String(type || '').toLowerCase();
  if (/fail|error|critical/.test(v)) return 'bad';
  if (/blocked|warn/.test(v)) return 'warn';
  if (/pause|cancel|lost/.test(v)) return 'wait';
  if (/complete|arrive|found/.test(v)) return 'ok';
  return 'run';
}

function fmt(value, digits, suffix) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toFixed(digits === undefined ? 2 : digits) + (suffix || '');
}

function clock(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function sinceText(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return s + ' 秒前';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前';
  return clock(iso);
}

module.exports = {
  TASK_TYPE, TASK_STATE, PHASE, FPGA_STATE, FPGA_MODE, LOC, CLASSES, CLASS_NAME, COLORS, COLOR_NAME, COLOR_HEX,
  targetLabel, displayTarget, taskTone, linkTone, linkLabel, eventTone, fmt, clock, sinceText
};
