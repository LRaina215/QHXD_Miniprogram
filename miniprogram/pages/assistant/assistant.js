/**
 * 语音助手：微信同声传译（WechatSI）把语音转成文字 -> /api/voice/smart_command（规则 + 本地大模型解析）。
 * 运动类命令返回 pending_command_id，弹出确认面板，确认后 /api/voice/confirm_command 才真正下发。
 */
const api = require('../../utils/api');
const store = require('../../utils/store');
const L = require('../../utils/labels');

const HISTORY_KEY = 'yuntuo_chat_history';
const EXAMPLES = ['找到红色水瓶并移动到它旁边', '跟着我', '去 B 点', '开始巡检', '暂停', '你是谁'];

let recognizer = null;
function getRecognizer() {
  if (recognizer) return recognizer;
  try {
    recognizer = requirePlugin('WechatSI').getRecordRecognitionManager();
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
    const rec = getRecognizer();
    if (rec) {
      rec.onStop = (res) => {
        this.setData({ recording: false });
        const text = (res && res.result || '').replace(/[。！？]$/, '');
        if (text) this.ask(text);
        else wx.showToast({ title: '没有听清，请再说一次', icon: 'none' });
      };
      rec.onError = (err) => {
        this.setData({ recording: false });
        const msg = err && err.retcode === -30011 ? '请先允许使用麦克风' : '语音识别失败，请重试';
        wx.showToast({ title: msg, icon: 'none' });
      };
    }
  },

  onShow() {
    this.scrollBottom();
  },

  push(role, text, meta) {
    this.seq += 1;
    const messages = this.data.messages.concat([{ id: this.seq, role, text, meta: meta || '' }]).slice(-40);
    this.setData({ messages });
    wx.setStorageSync(HISTORY_KEY, messages);
    this.scrollBottom();
  },

  scrollBottom() {
    this.setData({ anchor: '' }, () => this.setData({ anchor: 'bottom' }));
  },

  onToggleMode() {
    this.setData({ inputMode: this.data.inputMode === 'voice' ? 'text' : 'voice' });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  onSend() {
    const text = this.data.text.trim();
    if (!text) return;
    this.setData({ text: '' });
    this.ask(text);
  },

  onExample(e) {
    this.ask(e.currentTarget.dataset.text);
  },

  onTalkStart() {
    const rec = getRecognizer();
    if (!rec) {
      wx.showModal({ title: '语音不可用', content: '同声传译插件没有加载，请改用文字输入。', showCancel: false });
      this.setData({ inputMode: 'text' });
      return;
    }
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        wx.vibrateShort({ type: 'light' });
        this.setData({ recording: true });
        rec.start({ duration: 10000, lang: 'zh_CN' });
      },
      fail: () => {
        wx.showModal({
          title: '需要麦克风权限',
          content: '请在设置里允许云拓使用麦克风。',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting({}); }
        });
      }
    });
  },

  onTalkEnd() {
    if (!this.data.recording) return;
    const rec = getRecognizer();
    if (rec) rec.stop();
  },

  async ask(text) {
    if (this.data.thinking) return;
    this.push('me', text);
    this.setData({ thinking: true });
    const res = await api.smartCommand(text);
    this.setData({ thinking: false });
    const data = api.unwrap(res);
    if (!res.ok || !data) {
      this.push('sys', api.explain(res.error));
      return;
    }
    const meta = [data.intent || 'unknown', data.parser, data.llm_model].filter(Boolean).join(' · ');
    this.push('bot', data.reply_text || data.error_reason || '好的', meta);
    const c = data.mission_candidate;
    if (c && c.pending_command_id) {
      const p = c.payload || {};
      let targetText = '';
      if (p.target_class) targetText = p.label || L.targetLabel(p.target_class, p.color);
      else if (p.waypoint_id) {
        const w = store.waypoints.find((x) => x.waypoint_id === p.waypoint_id);
        targetText = w ? w.name : String(p.waypoint_id);
      }
      this.pending = c.pending_command_id;
      this.setData({
        sheet: {
          show: true,
          title: (L.TASK_TYPE[c.command] || c.command) + (targetText ? '：' + targetText : ''),
          rows: [
            { k: '听到', v: data.recognized_text || text },
            { k: '命令', v: c.command },
            { k: '解析', v: meta + ' · 置信度 ' + L.fmt(data.confidence, 2) }
          ],
          loading: false,
          error: ''
        }
      });
    }
  },

  async decide(confirmed) {
    const id = this.pending;
    if (!id) return;
    this.setData({ 'sheet.loading': true, 'sheet.error': '' });
    const res = await api.confirmCommand(id, confirmed);
    const data = api.unwrap(res);
    if (!res.ok || !data) {
      this.setData({ 'sheet.loading': false, 'sheet.error': api.explain(res.error) });
      return;
    }
    this.pending = null;
    this.setData({ sheet: { show: false, title: '', rows: [], loading: false, error: '' } });
    this.push(confirmed && data.accepted ? 'bot' : 'sys', data.detail || (confirmed ? '已执行' : '已取消'));
    store.refresh();
  },

  onSheetConfirm() {
    return this.decide(true);
  },

  onSheetCancel() {
    return this.decide(false);
  }
});
