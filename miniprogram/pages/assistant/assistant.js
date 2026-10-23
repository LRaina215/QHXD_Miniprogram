/**
 * 语音助手：微信同声传译（WechatSI）把语音转成文字 -> /api/voice/smart_command（规则 + 本地大模型解析）。
 * 运动类命令返回 pending_command_id，弹出确认面板，确认后 /api/voice/confirm_command 才真正下发。
 */
const api = require('../../utils/api');
const store = require('../../utils/store');
const L = require('../../utils/labels');
const confirmation = require('../../utils/confirmation');

const HISTORY_KEY = 'yuntuo_chat_history';
const EXAMPLES = ['找到红色水瓶并移动到它旁边', '跟着我', '去 B 点', '开始巡检', '暂停', '你是谁'];

let recognizer = null;
let recordingOwner = null;
function getRecognizer() {
  if (recognizer) return recognizer;
  try {
    recognizer = requirePlugin('WechatSI').getRecordRecognitionManager();
    recognizer.onStop = (res) => {
      const owner = recordingOwner;
      recordingOwner = null;
      if (owner) owner.onRecognitionStop(res);
    };
    recognizer.onError = (err) => {
      const owner = recordingOwner;
      recordingOwner = null;
      if (owner) owner.onRecognitionError(err);
    };
  } catch (e) {
    recognizer = null;
  }
  return recognizer;
}

Page({
  data: {
    messages: [],
    examples: EXAMPLES,
    inputMode: 'voice',
    text: '',
    recording: false,
    thinking: false,
    anchor: '',
    sheet: { show: false, title: '', rows: [], loading: false, error: '' }
  },

  onLoad() {
    const saved = wx.getStorageSync(HISTORY_KEY);
    if (Array.isArray(saved)) this.setData({ messages: saved.slice(-40) });
    this.seq = Date.now();
    getRecognizer();
  },

  onShow() {
    confirmation.show(this);
    this.scrollBottom();
  },

  onHide() {
    confirmation.leave(this);
    this.discardRecording();
    this.setData({ thinking: false });
  },

  discardRecording() {
    this._talkHeld = false;
    this._recordSession = null;
    this.setData({ recording: false });
    if (recordingOwner === this) {
      try { getRecognizer().stop(); } catch (e) { recordingOwner = null; }
    }
  },

  onUnload() { this.onHide(); },

  push(role, text, meta) {
    this.seq += 1;
    const messages = this.data.messages.concat([{ id: this.seq, role, text, meta: meta || '' }]).slice(-40);
    this.setData({ messages });
    try { wx.setStorageSync(HISTORY_KEY, messages); } catch (e) { /* 缓存失败不阻断命令状态收尾 */ }
    this.scrollBottom();
  },

  scrollBottom() {
    this.setData({ anchor: '' }, () => this.setData({ anchor: 'bottom' }));
  },

  onToggleMode() {
    this.discardRecording();
    this.setData({ inputMode: this.data.inputMode === 'voice' ? 'text' : 'voice' });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  onSend() {
    const text = this.data.text.trim();
    if (!text || !this.canAsk()) return;
    this.setData({ text: '' });
    this.ask(text);
  },

  onExample(e) {
    this.ask(e.currentTarget.dataset.text);
  },

  onTalkStart() {
    if (!this.canAsk() || this._authorizing || recordingOwner) return;
    const rec = getRecognizer();
    if (!rec) {
      wx.showModal({ title: '语音不可用', content: '同声传译插件没有加载，请改用文字输入。', showCancel: false });
      this.setData({ inputMode: 'text' });
      return;
    }
    this._talkHeld = true;
    const session = { visit: confirmation.capture(this) };
    this._recordSession = session;
    this._authorizing = session;
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        if (this._authorizing === session) this._authorizing = null;
        if (!this._talkHeld || this._recordSession !== session || !confirmation.current(this, session.visit)) return;
        if (this._askRequest || confirmation.busy(this)) { this._recordSession = null; return; }
        wx.vibrateShort({ type: 'light' });
        recordingOwner = this;
        this.setData({ recording: true });
        try { rec.start({ duration: 10000, lang: 'zh_CN' }); }
        catch (e) { recordingOwner = null; this.onRecognitionError({}); }
      },
      fail: () => {
        if (this._authorizing === session) this._authorizing = null;
        if (this._recordSession !== session || !confirmation.current(this, session.visit)) return;
        this._recordSession = null;
        this._talkHeld = false;
        wx.showModal({
          title: '需要麦克风权限',
          content: '请在设置里允许云拓使用麦克风。',
          confirmText: '去设置',
          success: (r) => { if (r.confirm && confirmation.current(this, session.visit)) wx.openSetting({}); }
        });
      }
    });
  },

  onTalkEnd() {
    this._talkHeld = false;
    if (!this.data.recording) { this._recordSession = null; return; }
    const rec = getRecognizer();
    if (rec && recordingOwner === this) {
      try { rec.stop(); } catch (e) { recordingOwner = null; this.onRecognitionError({}); }
    }
  },

  onRecognitionStop(res) {
    const session = this._recordSession;
    this._recordSession = null;
    this._talkHeld = false;
    this.setData({ recording: false });
    if (!session || !confirmation.current(this, session.visit)) return;
    const text = (res && res.result || '').replace(/[。！？]$/, '');
    if (text) this.ask(text);
    else wx.showToast({ title: '没有听清，请再说一次', icon: 'none' });
  },

  onRecognitionError(err) {
    const session = this._recordSession;
    this._recordSession = null;
    this._talkHeld = false;
    this.setData({ recording: false });
    if (!session || !confirmation.current(this, session.visit)) return;
    wx.showToast({ title: err && err.retcode === -30011 ? '请先允许使用麦克风' : '语音识别失败，请重试', icon: 'none' });
  },

  canAsk() {
    if (this._confirmationHidden) return false;
    if (this._askRequest || confirmation.busy(this) || this.data.recording) {
      wx.showToast({ title: '请先完成当前请求或确认', icon: 'none' });
      return false;
    }
    return true;
  },

  async ask(text) {
    if (!this.canAsk() || !text.trim()) return;
    const visit = confirmation.capture(this);
    this._askRequest = visit;
    this.push('me', text);
    this.setData({ thinking: true });
    let res;
    try { res = await api.smartCommand(text); }
    catch (e) { res = { ok: false, uncertain: true }; }
    finally {
      if (this._askRequest === visit) {
        this._askRequest = null;
        if (!this._confirmationHidden) this.setData({ thinking: false });
      }
    }
    if (!confirmation.current(this, visit)) return;
    const data = api.unwrap(res);
    if (!res.ok || !data || res.data.success === false) {
      this.push('sys', (data && data.error_reason) || api.failureText(res.ok ? { uncertain: true } : res));
      return;
    }
    const meta = [data.intent || 'unknown', data.parser, data.llm_model].filter(Boolean).join(' · ');
    this.push('bot', data.reply_text || data.error_reason || '好的', meta);
    const c = data.mission_candidate;
    if (c && c.pending_command_id) {
      const p = c.payload || {};
      let targetText = '';
      if (p.target_class) targetText = L.displayTarget(p.label, p.target_class, p.color);
      else if (p.waypoint_id) {
        const w = store.waypoints.find((x) => x.waypoint_id === p.waypoint_id);
        targetText = w ? w.name : String(p.waypoint_id);
      }
      confirmation.open(this, { id: c.pending_command_id }, {
          title: (L.TASK_TYPE[c.command] || c.command) + (targetText ? '：' + targetText : ''),
          rows: [
            { k: '听到', v: data.recognized_text || text },
            { k: '命令', v: c.command },
            { k: '解析', v: meta + ' · 置信度 ' + L.fmt(data.confidence, 2) }
          ],
          loading: false,
          error: ''
      });
    }
  },

  async decide(confirmed) {
    const r = await confirmation.run(this, async (p) => {
      const res = await api.confirmCommand(p.id, confirmed);
      const data = api.unwrap(res);
      if (res.ok && data && res.data.success !== false && typeof data.accepted === 'boolean') {
        return { ok: confirmed && data.accepted, detail: data.detail || (confirmed ? (data.accepted ? '命令已受理，请查看任务状态' : '命令未受理，请查看任务状态') : '待确认命令已关闭') };
      }
      return { ok: false, detail: api.failureText(res.ok ? { uncertain: true } : res) };
    });
    if (!r) return;
    this.push(r.ok ? 'bot' : 'sys', r.detail);
    store.refresh();
  },

  onSheetConfirm() {
    return this.decide(true);
  },

  onSheetCancel() {
    return this.decide(false);
  }
});
