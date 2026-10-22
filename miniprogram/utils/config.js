/**
 * 云拓小程序运行配置。
 *
 * 公网链路：小程序 -> https://lingxunrobot.cn（Nginx）-> Cloud Gateway -> RK3588 后端。
 * 主域名的 /api/ 与 /ws/ 已由 Nginx 转发到网关。api.lingxunrobot.cn 也能用，但统一走主域名，只维护一个域名和一张证书。
 * 现场联调可在「我的 > 调试」里临时改成 RK3588 局域网地址（需开发者工具或真机调试关闭域名校验）。
 */

const DEFAULT_BASE_URL = 'https://lingxunrobot.cn';
const BASE_URL_STORAGE_KEY = 'yuntuo_base_url';

function storedBaseUrl() {
  try {
    const value = (wx.getStorageSync(BASE_URL_STORAGE_KEY) || '').trim();
    return /^https?:\/\/[^\s]+$/i.test(value) ? value.replace(/\/+$/, '') : '';
  } catch (e) {
    return '';
  }
}

function baseUrl() {
  return storedBaseUrl() || DEFAULT_BASE_URL;
}

function wsUrl(path) {
  return baseUrl().replace(/^http/i, 'ws') + path;
}

function buildUrl(path) {
  if (!path) return baseUrl();
  if (/^https?:\/\//i.test(path)) return path;
  return baseUrl() + '/' + String(path).replace(/^\/+/, '');
}

module.exports = {
  DEFAULT_BASE_URL,
  BASE_URL_STORAGE_KEY,
  TOKEN_STORAGE_KEY: 'yuntuo_public_api_token',
  LEGACY_TOKEN_STORAGE_KEY: 'sentinel_public_api_token',
  SOURCE: 'wechat-miniprogram',
  POLL_INTERVAL_MS: 3000,
  HEALTH_INTERVAL_MS: 15000,
  EVENTS_INTERVAL_MS: 5000,
  FRAME_INTERVAL_MS: 2000,
  STALE_AFTER_MS: 10000,
  baseUrl,
  wsUrl,
  buildUrl,
  storedBaseUrl
};
