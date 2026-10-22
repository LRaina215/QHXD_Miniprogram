/**
 * Central runtime configuration for the Sentinel mini program.
 *
 * Phase 8C uses the public Cloud Gateway as the primary data path:
 * REST snapshots first, WebSocket stream as an acceleration path.
 */

const ENV = 'prod';

const ENVIRONMENTS = {
  prod: {
    BASE_URL: 'https://api.lingxunrobot.cn',
    WS_STATE_URL: 'wss://api.lingxunrobot.cn/ws/state',
    WS_IMU_URL: 'wss://api.lingxunrobot.cn/ws/imu',
    WS_NAVIGATION_URL: 'wss://api.lingxunrobot.cn/ws/navigation'
  },
  dev: {
    BASE_URL: 'https://api.lingxunrobot.cn',
    WS_STATE_URL: 'wss://api.lingxunrobot.cn/ws/state',
    WS_IMU_URL: 'wss://api.lingxunrobot.cn/ws/imu',
    WS_NAVIGATION_URL: 'wss://api.lingxunrobot.cn/ws/navigation'
  }
};

const ACTIVE = ENVIRONMENTS[ENV] || ENVIRONMENTS.prod;

const CONFIG = {
  ENV,
  BASE_URL: ACTIVE.BASE_URL,
  WS_STATE_URL: ACTIVE.WS_STATE_URL,
  WS_IMU_URL: ACTIVE.WS_IMU_URL,
  WS_NAVIGATION_URL: ACTIVE.WS_NAVIGATION_URL,
  ROBOT_ID: 'lingxun-sentinel-rk3588',
  POLL_INTERVAL_MS: 3000,
  STALE_AFTER_MS: 10000,
  FRAME_REFRESH_MS: 3000,
  PUBLIC_API_TOKEN_PLACEHOLDER: '在设置页保存公网 Token',
  TOKEN_STORAGE_KEY: 'sentinel_public_api_token'
};

function buildUrl(path) {
  if (!path) return CONFIG.BASE_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return CONFIG.BASE_URL.replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
}

module.exports = {
  ...CONFIG,
  buildUrl
};
