/**
 * 设计预览（node tests/preview/render.js）：把 WXML/WXSS 粗略转成 HTML，用 e2e.js 留下的真实数据快照渲染，
 * 方便没有微信开发者工具时在浏览器里看版式。只支持本项目用到的语法子集，不能替代真机验收。
 * 输出 tests/preview/out/*.html；在仓库根目录起静态服务后打开（资源路径按 /miniprogram/... 引用）。
 */
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('../wx-sim');

const W = 390;
const OUT = path.join(__dirname, 'out');
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshot.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

/* ---------- WXML 解析 ---------- */
function parse(src) {
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1]) { stack.pop(); continue; }
    if (m[2]) {
      const attrs = {};
      (m[3].match(/[\w:.-]+(?:="[^"]*")?/g) || []).forEach((a) => {
        const i = a.indexOf('=');
        if (i < 0) attrs[a] = 'true';
        else attrs[a.slice(0, i)] = a.slice(i + 2, -1);
      });
      const node = { tag: m[2], attrs, children: [] };
      top.children.push(node);
      if (!m[4]) stack.push(node);
      continue;
    }
    if (m[5].trim()) top.children.push({ text: m[5] });
  }
  return root;
}

/* ---------- 求值 ---------- */
function evalExpr(expr, scope) {
  try {
    // eslint-disable-next-line no-new-func
    return Function('scope', 'with (scope) { return (' + expr + '); }')(scope);
  } catch (e) {
    return '';
  }
}

function interp(value, scope) {
  if (value === undefined) return undefined;
  const whole = value.match(/^\{\{((?:(?!\}\})[\s\S])+)\}\}$/);
  if (whole) return evalExpr(whole[1], scope);
  return value.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return v === undefined || v === null ? '' : String(v);
  });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TAG = { view: 'div', text: 'span', image: 'img', 'scroll-view': 'div', input: 'input', canvas: 'canvas', block: null };
const FIT = { aspectFit: 'contain', aspectFill: 'cover' };

function asset(src) {
  return /^\/assets\//.test(src) ? '/miniprogram' + src : src;
}

function renderNodes(nodes, scope, comps) {
  let out = '';
  let chain = null;
  nodes.forEach((n) => {
    if (n.text !== undefined) {
      out += esc(interp(n.text, scope));
      chain = null;
      return;
    }
    const a = n.attrs;
    if (a['wx:if'] !== undefined) {
      chain = !!interp(a['wx:if'], scope);
      if (!chain) return;
    } else if (a['wx:elif'] !== undefined) {
      if (chain === null || chain) { chain = chain === null ? null : true; return; }
      chain = !!interp(a['wx:elif'], scope);
      if (!chain) return;
    } else if (a['wx:else'] !== undefined) {
      const show = chain === false;
      chain = null;
      if (!show) return;
    } else {
      chain = null;
    }
    if (a['wx:for'] !== undefined) {
      const list = interp(a['wx:for'], scope) || [];
      const itemName = a['wx:for-item'] || 'item';
      const indexName = a['wx:for-index'] || 'index';
      list.forEach((item, index) => {
        const s = Object.assign(Object.create(scope), { [itemName]: item, [indexName]: index });
        out += renderEl(n, s, comps);
      });
      return;
    }
    out += renderEl(n, scope, comps);
  });
  return out;
}

function renderEl(n, scope, comps) {
  if (comps[n.tag]) return comps[n.tag](n, scope);
  const tag = TAG[n.tag] === undefined ? 'div' : TAG[n.tag];
  const inner = renderNodes(n.children, scope, comps);
  if (tag === null) return inner;
  const a = n.attrs;
  let attrs = '';
  const cls = interp(a.class, scope);
  let style = interp(a.style, scope) || '';
  if (n.tag === 'text') style = 'white-space:pre-wrap;' + style;
  if (n.tag === 'scroll-view') style += a['scroll-x'] !== undefined ? ';overflow-x:auto;' : ';overflow-y:auto;';
  if (cls) attrs += ' class="' + esc(cls) + '"';
  if (a.id) attrs += ' id="' + esc(interp(a.id, scope)) + '"';
  if (tag === 'img') {
    attrs += ' src="' + esc(asset(interp(a.src, scope) || '')) + '"';
    style += ';object-fit:' + (FIT[a.mode] || 'fill') + ';';
  }
  if (tag === 'input') {
    if (a.password !== undefined) attrs += ' type="password"';
    if (a.placeholder) attrs += ' placeholder="' + esc(interp(a.placeholder, scope)) + '"';
    if (a.value) attrs += ' value="' + esc(interp(a.value, scope)) + '"';
  }
  if (style) attrs += ' style="' + esc(style) + '"';
  if (tag === 'img' || tag === 'input') return '<' + tag + attrs + '>';
  return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
}

/* ---------- WXSS -> CSS ---------- */
function css(src) {
  return src
    .replace(/(-?\d*\.?\d+)rpx/g, (_, v) => (parseFloat(v) * W / 750).toFixed(2) + 'px')
    .replace(/env\(safe-area-inset-bottom\)/g, '0px')
    .replace(/([^{}]+)\{/g, (_, sel) => sel
      .replace(/\bview, text, button, input, image, scroll-view\b/, '*')
      .replace(/(^|[\s,>+~])page\b/g, '$1.wxpage')
      .replace(/\bimage\b/g, 'img')
      .replace(/(^|[\s,>+~])text\b/g, '$1span') + '{');
}

/* ---------- 组件 ---------- */
function component(rel) {
  const def = load(rel + '.js');
  const tree = parse(fs.readFileSync(path.join(ROOT, rel + '.wxml'), 'utf8'));
  const defaults = {};
  Object.keys(def.properties || {}).forEach((k) => { defaults[k] = def.properties[k].value; });
  return { tree, defaults, data: def.data || {}, css: css(fs.readFileSync(path.join(ROOT, rel + '.wxss'), 'utf8')) };
}

const COMPS = {
  'confirm-sheet': component('components/confirm-sheet/confirm-sheet'),
  'estop-fab': component('components/estop-fab/estop-fab')
};

function compRenderers(extra) {
  const r = {};
  Object.keys(COMPS).forEach((name) => {
    r[name] = (n, scope) => {
      const c = COMPS[name];
      const props = Object.assign({}, c.defaults, c.data, (extra && extra[name]) || {});
      Object.keys(n.attrs).forEach((k) => { if (!/^bind/.test(k)) props[k] = interp(n.attrs[k], scope); });
      return renderNodes(c.tree.children, props, {});
    };
  });
  return r;
}

/* ---------- 页面 ---------- */
function page(name, rel, data, opts) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, rel + '.json'), 'utf8'));
  const tree = parse(fs.readFileSync(path.join(ROOT, rel + '.wxml'), 'utf8'));
  const body = renderNodes(tree.children, data, compRenderers(opts && opts.comps));
  const custom = json.navigationStyle === 'custom';
  const tabIndex = app.tabBar.list.findIndex((t) => t.pagePath === rel);
  const tabs = app.tabBar.list.map((t, i) => '<div class="tb-item' + (i === tabIndex ? ' on' : '') + '"><img src="/miniprogram/' +
    (i === tabIndex ? t.selectedIconPath : t.iconPath) + '"><span>' + t.text + '</span></div>').join('');
  const styles = css(fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8')) + css(fs.readFileSync(path.join(ROOT, rel + '.wxss'), 'utf8')) +
    Object.values(COMPS).map((c) => c.css).join('');
  // 页面内容放进 iframe：position:fixed 才会像小程序一样相对页面视口（急停按钮、自定义导航栏）
  const inner = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>html,body{margin:0}*{box-sizing:border-box}html::-webkit-scrollbar{display:none}.wxpage{min-height:100vh}${styles}</style>
</head><body class="wxpage">${body}${opts && opts.script ? '<script>' + opts.script + '</script>' : ''}</body></html>`;
  fs.writeFileSync(path.join(OUT, name + '.page.html'), inner);
  const top = custom ? 0 : 88;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title>
<style>
html,body{margin:0;background:#c9c6bd;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.phone{position:relative;width:${W}px;height:844px;margin:0 auto;background:#f2f1ec;overflow:hidden}
.sb{position:absolute;left:0;right:0;top:0;height:44px;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 28px;font:600 15px sans-serif;color:#15171a;pointer-events:none}
.navbar{position:absolute;left:0;right:0;top:44px;height:44px;z-index:150;display:flex;align-items:center;justify-content:center;background:${json.navigationBarBackgroundColor || app.window.navigationBarBackgroundColor};font:600 17px "PingFang SC",sans-serif;color:#15171a}
.capsule{position:absolute;right:7px;top:50px;width:87px;height:32px;border-radius:16px;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.7);z-index:210}
iframe{position:absolute;left:0;top:${top}px;width:${W}px;height:${844 - 84 - top}px;border:0}
.tabbar{position:absolute;left:0;right:0;bottom:0;height:50px;padding-bottom:34px;box-sizing:content-box;background:#fff;display:flex;z-index:160;box-shadow:0 -1px 0 rgba(0,0,0,.04)}
.tb-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;color:#8a8f97}
.tb-item.on{color:#2f5bff}.tb-item img{width:27px;height:27px;margin-bottom:2px}
</style></head><body>
<div class="phone">
<div class="sb"><span>9:41</span><span>●●● 100%</span></div>
${custom ? '' : '<div class="navbar">' + esc(json.navigationBarTitleText || app.window.navigationBarTitleText) + '</div>'}
<div class="capsule"></div>
<iframe id="vp" src="${name}.page.html"></iframe>
<div class="tabbar">${tabs}</div>
</div>
</body></html>`;
  fs.writeFileSync(path.join(OUT, name + '.html'), html);
}

fs.mkdirSync(OUT, { recursive: true });
const p = snap.pages;
const s = snap.store;
const fieldScript = `
(async () => {
  const src = await (await fetch('/miniprogram/utils/fieldMap.js')).text();
  const module = { exports: {} };
  Function('module', 'exports', src)(module, module.exports);
  const fm = module.exports;
  const scene = ${JSON.stringify({ meta: s.mapMeta, waypoints: s.waypoints, trail: s.trail, pose: s.nav && s.nav.pose, goal: s.nav && s.nav.goal, target: s.nav && s.nav.target })};
  const c = document.getElementById('field');
  if (!c) return;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  fm.draw(ctx, r.width, r.height, scene, 400);
})();`;

page('home', 'pages/home/home', p.home, { script: fieldScript });
page('mission', 'pages/mission/mission', Object.assign({}, p.mission, { tab: 'vision' }));
page('mission-goto', 'pages/mission/mission', Object.assign({}, p.mission, { tab: 'goto' }));
const sheet = require('../../miniprogram/utils/actions').sheetFor('search_target', { label: '红色水瓶', timeout_s: 180 }, { waypoints: s.waypoints, task: () => null });
page('mission-confirm', 'pages/mission/mission', Object.assign({}, p.mission, { sheet: { show: true, title: sheet.title, rows: sheet.rows, loading: false, error: '' } }));
page('assistant', 'pages/assistant/assistant', Object.assign({}, p.assistant, { inputMode: 'voice' }));
page('assistant-empty', 'pages/assistant/assistant', Object.assign({}, p.assistant, { messages: [], inputMode: 'text' }));
page('me', 'pages/me/me', p.me);
console.log('预览已生成：' + fs.readdirSync(OUT).join(', '));
