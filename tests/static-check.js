/**
 * 静态检查（node tests/static-check.js）：JSON 合法、页面 / 组件文件齐全、WXML 标签配对、
 * 事件绑定的方法都存在、引用的图片资源都存在。退出码非 0 表示有问题。
 */
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./wx-sim');

const problems = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel.replace(/^\//, '')));

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  });
  return out;
}

const files = walk(ROOT, []);
files.filter((f) => f.endsWith('.json')).forEach((f) => {
  try { JSON.parse(read(f)); } catch (e) { problems.push(f + ': JSON 解析失败 ' + e.message); }
});

const app = JSON.parse(read('app.json'));
const units = app.pages.map((p) => ({ rel: p, kind: 'page' }));
Object.values(app.usingComponents || {}).forEach((c) => units.push({ rel: c.replace(/^\//, ''), kind: 'component' }));
app.tabBar.list.forEach((t) => {
  [t.iconPath, t.selectedIconPath].forEach((icon) => { if (!exists(icon)) problems.push('tabBar 图标不存在：' + icon); });
  if (app.pages.indexOf(t.pagePath) < 0) problems.push('tabBar 页面未注册：' + t.pagePath);
});

function checkTags(rel, wxml) {
  const stack = [];
  const re = /<\/?([a-z][a-z0-9-]*)\b([^>]*?)(\/?)>/gi;
  let m;
  while ((m = re.exec(wxml))) {
    const [all, tag, , selfClose] = m;
    if (all.startsWith('</')) {
      const top = stack.pop();
      if (top !== tag) problems.push(rel + ': 标签不配对 </' + tag + '>，期望 </' + top + '>');
    } else if (!selfClose) stack.push(tag);
  }
  if (stack.length) problems.push(rel + ': 未闭合标签 ' + stack.join(','));
}

const ICON_VARIANTS = {
  '/assets/icons/task-{{hero.icon}}.png': ['search', 'follow', 'home', 'route', 'pin'].map((k) => '/assets/icons/task-' + k + '.png'),
  "/assets/icons/cls-{{item.icon}}{{item.id === cls ? '-on' : ''}}.png":
    ['bottle', 'cup', 'person', 'ball', 'chair', 'backpack'].reduce((a, k) => a.concat(['/assets/icons/cls-' + k + '.png', '/assets/icons/cls-' + k + '-on.png']), []),
  "/assets/icons/{{inputMode === 'voice' ? 'keyboard' : 'mic'}}.png": ['/assets/icons/keyboard.png', '/assets/icons/mic.png']
};

units.forEach(({ rel, kind }) => {
  ['.js', '.json', '.wxml', '.wxss'].forEach((ext) => { if (!exists(rel + ext)) problems.push(rel + ext + ' 不存在'); });
  if (!exists(rel + '.wxml')) return;
  const wxml = read(rel + '.wxml');
  checkTags(rel + '.wxml', wxml);
  const def = load(rel + '.js');
  const methods = kind === 'component' ? (def.methods || {}) : def;
  const re = /\b(?:bind|catch)(?::)?([a-z]+)="([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml))) {
    if (typeof methods[m[2]] !== 'function') problems.push(rel + '.wxml: ' + m[1] + ' 绑定的方法 ' + m[2] + ' 不存在');
  }
  // Only image resources: a video src is a runtime media URL, not a package asset.
  const srcRe = /<image\b[^>]*?\bsrc="([^"]+)"/g;
  while ((m = srcRe.exec(wxml))) {
    const src = m[1];
    if (src.indexOf('{{') < 0) {
      if (!exists(src)) problems.push(rel + '.wxml: 图片不存在 ' + src);
    } else if (ICON_VARIANTS[src]) {
      ICON_VARIANTS[src].forEach((v) => { if (!exists(v)) problems.push(rel + '.wxml: 图片不存在 ' + v); });
    } else if (src !== '{{frameSrc}}') {
      problems.push(rel + '.wxml: 未登记的动态图片路径 ' + src);
    }
  }
  const json = JSON.parse(read(rel + '.json'));
  Object.values(json.usingComponents || {}).forEach((c) => { if (!exists(c.replace(/^\//, '') + '.js')) problems.push(rel + '.json: 组件不存在 ' + c); });
});

const pkg = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
console.log('文件 ' + files.length + ' 个，主包约 ' + (pkg / 1024).toFixed(1) + ' KB（上限 2048 KB）');
if (pkg > 2 * 1024 * 1024) problems.push('主包超过 2 MB');
if (problems.length) {
  console.log('发现 ' + problems.length + ' 个问题：\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('静态检查通过：' + units.length + ' 个页面 / 组件');
