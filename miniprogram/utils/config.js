/**
 * 云拓小程序运行配置。
 *
 * 公网链路：小程序 -> https://api.lingxunrobot.cn -> Cloud Gateway -> RK3588 后端。
 * 使用当前 AppID 已登记的 API 子域名；网站主域名不在小程序服务器域名列表中。
 * 现场联调可在「我的 > 调试」里临时改成 RK3588 局域网地址（需开发者工具或真机调试关闭域名校验）。
 */

const DEFAULT_BASE_URL = 'https://api.lingxunrobot.cn';
const LEGACY_PUBLIC_BASE_URL = 'https://lingxunrobot.cn';
const BASE_URL_STORAGE_KEY = 'yuntuo_base_url';

function storedBaseUrl() {
  try {
    const value = (wx.getStorageSync(BASE_URL_STORAGE_KEY) || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(value)) return '';
    const base = value.replace(/\/+$/, '');
    // 兼容旧版缓存的同一公网网关地址，保留用户自定义的局域网 / 其他服务器地址。
    return base === LEGACY_PUBLIC_BASE_URL ? DEFAULT_BASE_URL : base;
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
