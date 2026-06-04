/**
 * 通用工具函数
 */

/**
 * 格式化时间戳
 */
function formatTime(timestamp, showSeconds = true) {
  if (!timestamp) return '--';
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  if (showSeconds) {
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  return `${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化日期（相对时间）
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '--';
  const now = Date.now();
  const then = timestamp * 1000;
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return formatTime(timestamp);
}

/**
 * 格式化位姿角度
 */
function formatYaw(yaw) {
  if (yaw === undefined || yaw === null) return '--';
  const degrees = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
  return degrees.toFixed(1) + '°';
}

/**
 * 格式化百分比
 */
function formatPercent(value) {
  if (value === undefined || value === null) return '--%';
  return Math.round(value) + '%';
}

/**
 * 格式化小数
 */
function formatDecimal(value, digits = 2) {
  if (value === undefined || value === null) return '--';
  return Number(value).toFixed(digits);
}

/**
 * 获取状态文本
 */
function getStatusText(status) {
  const map = {
    'idle': '待机中',
    'navigating': '导航中',
    'charging': '充电中',
    'error': '故障',
    'offline': '离线',
    'emergency_stop': '已急停',
    'completed': '已完成',
    'pending': '待执行',
    'running': '执行中',
    'cancelled': '已取消'
  };
  return map[status] || status || '未知';
}

/**
 * 获取状态颜色
 */
function getStatusColor(status) {
  const map = {
    'idle': '#8E8E93',
    'navigating': '#007AFF',
    'charging': '#FF9500',
    'error': '#FF3B30',
    'emergency_stop': '#FF3B30',
    'completed': '#34C759',
    'pending': '#FF9500',
    'running': '#007AFF',
    'cancelled': '#8E8E93'
  };
  return map[status] || '#8E8E93';
}

/**
 * 空气质量等级
 */
function getAirQualityLevel(index) {
  if (index === undefined || index === null) return { level: '未知', color: '#8E8E93' };
  if (index <= 50) return { level: '优', color: '#34C759' };
  if (index <= 100) return { level: '良', color: '#007AFF' };
  if (index <= 150) return { level: '轻度污染', color: '#FF9500' };
  if (index <= 200) return { level: '中度污染', color: '#FF9500' };
  if (index <= 300) return { level: '重度污染', color: '#FF3B30' };
  return { level: '严重污染', color: '#8B0000' };
}

/**
 * 任务类型映射
 */
function getTaskTypeText(type) {
  const map = {
    'patrol': '巡逻',
    'delivery': '配送',
    'inspect': '检查',
    'charge': '充电',
    'go_to': '导航',
    'go_to_waypoint': '导航',
    'start_patrol': '巡检',
    'return_home': '返航',
    'placeholder': '占位',
    'custom': '自定义'
  };
  return map[type] || type || '未知';
}

/**
 * 任务类型图标
 */
function getTaskTypeIcon(type) {
  const map = {
    'patrol': '🔍',
    'delivery': '📦',
    'inspect': '🔧',
    'charge': '⚡',
    'go_to': '📍',
    'go_to_waypoint': '📍',
    'start_patrol': '🔍',
    'return_home': '⚡',
    'placeholder': '📋',
    'custom': '📋'
  };
  return map[type] || '📋';
}

/**
 * 节流函数
 */
function throttle(fn, delay = 200) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

/**
 * 防抖函数
 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

/**
 * 生成唯一ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

/**
 * 安全解析JSON
 */
function safeParseJSON(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

module.exports = {
  formatTime,
  formatRelativeTime,
  formatYaw,
  formatPercent,
  formatDecimal,
  getStatusText,
  getStatusColor,
  getAirQualityLevel,
  getTaskTypeText,
  getTaskTypeIcon,
  throttle,
  debounce,
  generateId,
  safeParseJSON
};
