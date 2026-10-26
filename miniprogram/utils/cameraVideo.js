/** Continuous video session. Media requests use a short-lived URL, never the API Token. */
const api = require('./api');
const config = require('./config');

class CameraVideo {
  constructor(notify) {
    this.notify = notify;
    this.ticket = 0;
    this.active = false;
    this.retryDelay = 5000;
    this.state = { src: '', ticket: 0, mode: 'image', hint: '检测图片' };
  }

  context() { return config.baseUrl() + '\n' + api.getToken(); }
  current(ticket) { return this.active && this.ticket === ticket && this.connection === this.context(); }
  publish(patch) {
    this.state = Object.assign({}, this.state, patch, { ticket: this.ticket });
    this.notify(this.state);
  }

  start() {
    this.stop();
    this.active = true;
    this.connection = this.context();
    this.retryDelay = 5000;
    this.timer = setInterval(() => this.tick(), 1000);
    this.connect();
  }

  stop() {
    this.active = false;
    this.ticket++;
    this.pending = false;
    clearInterval(this.timer);
    this.timer = null;
    this.retryAt = 0;
    this.publish({ src: '', mode: 'image', hint: '检测图片' });
  }

  async connect() {
    if (!this.active || this.pending) return;
    if (this.connection !== this.context()) { this.start(); return; }
    this.ticket++;
    const ticket = this.ticket;
    this.retryAt = 0;
    this.lastPosition = -1;
    this.playSeen = false;
    if (!api.getToken()) {
      this.publish({ src: '', mode: 'image', hint: '设置 Token 后可看连续视频' });
      return;
    }
    this.pending = true;
    this.publish({ src: '', mode: 'connecting', hint: '正在连接视频 · 暂显示检测图片' });
    const started = Date.now();
    let result;
    try { result = await api.createVideoSession(); }
    catch (e) { result = { ok: false, error: 'network_error' }; }
    if (!this.current(ticket)) return;
    this.pending = false;
    const data = api.unwrap(result);
    if (!result || !result.ok) {
      result = result || { error: 'network_error' };
      const auth = result.status === 401 || result.error === 'missing_token';
      this.fallback(auth ? api.explain(result.error) : '视频暂不可用 · 显示检测图片', auth);
      return;
    }
    // A relative media URL keeps the player on the selected, registered API origin.
    const path = data && data.playback_url;
    const ttl = Number(data && data.expires_in) * 1000;
    if (!data || data.protocol !== 'hls' || !Number.isFinite(ttl) || ttl < 30000 || ttl > 86400000
      || typeof path !== 'string' || !/^\/api\/video\/miniprogram\/hls\/[A-Za-z0-9._-]+\/[A-Za-z0-9_/.\-]+\.m3u8$/.test(path)
      || path.split('/').some((p) => p === '.' || p === '..')) {
      this.fallback('视频地址暂不可用 · 显示检测图片');
      return;
    }
    this.renewAt = started + ttl - Math.min(30000, ttl * 0.2);
    this.deadline = Date.now() + 30000;
    this.publish({ src: config.buildUrl(path), mode: 'connecting', hint: '正在加载视频 · 可点播放' });
  }

  metadata(ticket) {
    if (this.current(Number(ticket)) && this.state.src && this.state.mode === 'connecting' && !this.playSeen) {
      this.publish({ hint: '视频已加载 · 可点播放' });
    }
  }

  playing(ticket) {
    if (!this.current(Number(ticket)) || !this.state.src) return;
    this.playSeen = true;
    // play / metadata alone do not confirm advancing frames.
    if (this.state.mode === 'connecting') this.publish({ hint: '视频已启动 · 正在缓冲' });
  }

  waiting(ticket) {
    if (!this.current(Number(ticket)) || !this.state.src) return;
    if (this.state.mode === 'video') this.deadline = Date.now() + 15000;
    this.publish({ mode: 'connecting', hint: '视频缓冲中 · 可点播放' });
  }

  requestPlay(ticket) {
    if (!this.current(Number(ticket)) || !this.state.src) return false;
    this.deadline = Date.now() + 30000;
    this.publish({ hint: '正在启动视频…' });
    return true;
  }

  progress(ticket, position) {
    // Native players may report 0 on the first timeupdate. Duplicate timestamps
    // still cannot keep a stalled stream alive indefinitely.
    if (!this.current(Number(ticket)) || !this.state.src || !Number.isFinite(position) || position < 0
      || (position === 0 && !this.playSeen)) return;
    if (position === this.lastPosition) return;
    this.lastPosition = position;
    this.lastProgress = Date.now();
    this.retryDelay = 5000;
    if (this.state.mode !== 'video') this.publish({ mode: 'video', hint: '连续视频' });
  }

  failed(ticket, code, message) {
    if (!this.current(Number(ticket)) || !this.state.src) return;
    // The DevTools HLS adapter also emits error for recoverable buffer events.
    // Preserve its player while it recovers; waiting() keeps a bounded deadline.
    if (typeof message === 'string' && /\b(bufferStalledError|bufferAppendError|bufferSeekOverHole|bufferNudgeOnStall)\b/.test(message)) {
      this.waiting(ticket);
      return;
    }
    // Native errMsg can contain the signed media URL; expose numeric codes only.
    const detail = /^-?\d{1,10}$/.test(String(code)) ? '（错误码 ' + code + '）' : '';
    this.fallback('视频播放失败' + detail + ' · 显示检测图片');
  }

  fallback(hint, noRetry) {
    this.ticket++;
    this.pending = false;
    this.retryAt = noRetry ? 0 : Date.now() + this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 60000);
    this.publish({ src: '', mode: 'image', hint });
  }

  retry() {
    if (!this.active) return;
    this.retryDelay = 5000;
    this.connect();
  }

  tick() {
    if (!this.active) return;
    if (this.connection !== this.context()) { this.start(); return; }
    if (this.pending) return;
    const now = Date.now();
    if (this.state.src && now >= this.renewAt) { this.connect(); return; }
    if (this.state.src && ((this.state.mode === 'video' && now - this.lastProgress >= 8000)
      || (this.state.mode === 'connecting' && now >= this.deadline))) {
      this.fallback('视频等待超时 · 显示检测图片');
    } else if (this.retryAt && now >= this.retryAt) this.connect();
  }
}

module.exports = CameraVideo;
