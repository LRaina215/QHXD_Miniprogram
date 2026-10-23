/** 页面确认的本地有效窗口；后端仍独立校验命令是否过期，不据此推定后端 TTL。 */
const api = require('./api');
const config = require('./config');
const WINDOW_MS = 30000;

function context() { return { base: config.baseUrl(), token: api.getToken() }; }
function sameContext(saved) {
  return saved && saved.base === config.baseUrl() && saved.token === api.getToken();
}
function empty() { return { show: false, title: '', rows: [], loading: false, error: '' }; }
function close(page) {
  clearTimeout(page._confirmationTimer);
  page._confirmationTimer = null;
  page.pending = null;
  page.setData({ sheet: empty() });
}
function show(page) { page._confirmationHidden = false; page._confirmationVisit = (page._confirmationVisit || 0) + 1; }
function leave(page) { page._confirmationHidden = true; close(page); }
function busy(page) { return !!(page.pending || page._confirmationRequest); }
function capture(page) { return { visit: page._confirmationVisit || 0, context: context() }; }
function current(page, saved) {
  return !page._confirmationHidden && saved.visit === (page._confirmationVisit || 0) && sameContext(saved.context);
}

function open(page, value, sheet) {
  if (page._confirmationHidden || busy(page)) return false;
  const pending = { value, context: context(), expiresAt: Date.now() + WINDOW_MS };
  page.pending = pending;
  page.setData({ sheet: Object.assign(empty(), sheet, { show: true }) });
  page._confirmationTimer = setTimeout(() => {
    if (page.pending !== pending) return;
    close(page);
    wx.showToast({ title: '确认已过期，请重新发起', icon: 'none' });
  }, WINDOW_MS);
  return true;
}

async function run(page, execute) {
  const pending = page.pending;
  if (!pending || page._confirmationRequest || page._confirmationHidden) return null;
  if (!sameContext(pending.context) || Date.now() >= pending.expiresAt) {
    close(page);
    wx.showToast({ title: '确认已失效，请重新发起', icon: 'none' });
    return null;
  }
  page._confirmationRequest = pending;
  clearTimeout(page._confirmationTimer);
  page._confirmationTimer = null;
  page.setData({ 'sheet.loading': true, 'sheet.error': '' });
  let result;
  try {
    result = await execute(pending.value);
  } catch (e) {
    result = { ok: false, uncertain: true, detail: api.failureText({ uncertain: true }) };
  } finally {
    if (page._confirmationRequest === pending) page._confirmationRequest = null;
  }
  const current = page.pending === pending && !page._confirmationHidden && sameContext(pending.context);
  if (page.pending === pending) close(page);
  // 已发送的请求不能因离开页面而撤销；只阻止旧结果和确认回到页面，不宣称命令取消。
  return current ? result : null;
}

module.exports = { context, sameContext, empty, show, leave, busy, capture, current, open, run, close };
