/**
 * 场地态势画布（Canvas 2D，与 Web 控制台 FieldMap 同一画法）：
 * 点阵网格、先验代价图、点位、渐隐轨迹、当前目标、视觉目标脉冲、机器人与相机视场。
 * 只用标准 Canvas 2D API（不依赖 roundRect），小程序与浏览器预览共用。
 */

const FIELD = { x0: -1, y0: -3, x1: 6, y1: 3 };
const CAM_FOV = 60 * Math.PI / 180;
const CAM_RANGE = 3.0;
const C = {
  dot: 'rgba(255,255,255,0.11)', axis: 'rgba(255,255,255,0.24)', label: 'rgba(238,241,244,0.45)',
  brand: '#5b7cff', goal: '#ffb020', target: '#ff4d5e', wp: 'rgba(238,241,244,0.9)', wpFill: '#171b21'
};

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.arcTo(x + w, y, x + w, y + k, k);
  ctx.lineTo(x + w, y + h - k);
  ctx.arcTo(x + w, y + h, x + w - k, y + h, k);
  ctx.lineTo(x + k, y + h);
  ctx.arcTo(x, y + h, x, y + h - k, k);
  ctx.lineTo(x, y + k);
  ctx.arcTo(x, y, x + k, y, k);
  ctx.closePath();
}

function hasPrior(meta) {
  return !!meta && !String(meta.version || '').startsWith('canvas');
}

function bounds(scene) {
  const meta = scene.meta;
  const b = hasPrior(meta)
    ? { x0: meta.origin.x, y0: meta.origin.y, x1: meta.origin.x + meta.width * meta.resolution, y1: meta.origin.y + meta.height * meta.resolution }
    : { x0: FIELD.x0, y0: FIELD.y0, x1: FIELD.x1, y1: FIELD.y1 };
  const pts = (scene.trail || []).slice();
  if (scene.pose) pts.push(scene.pose);
  (scene.waypoints || []).forEach((w) => { if (w.pose) pts.push(w.pose); });
  pts.forEach((p) => {
    b.x0 = Math.min(b.x0, p.x - 0.6); b.x1 = Math.max(b.x1, p.x + 0.6);
    b.y0 = Math.min(b.y0, p.y - 0.6); b.y1 = Math.max(b.y1, p.y + 0.6);
  });
  return b;
}

function view(scene, w, h) {
  const b = bounds(scene);
  const pad = scene.compact ? 10 : 26;
  const s = Math.min((w - 2 * pad) / (b.x1 - b.x0), (h - 2 * pad) / (b.y1 - b.y0));
  return { s, ox: (w - s * (b.x1 - b.x0)) / 2 - s * b.x0, oy: (h + s * (b.y1 - b.y0)) / 2 + s * b.y0, w, h };
}

function px(v, p) {
  return [v.ox + v.s * p.x, v.oy - v.s * p.y];
}

function pill(ctx, x, y, text, fg, bg) {
  ctx.font = '600 11px sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = bg;
  rr(ctx, x, y - 10, w, 20, 10);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x + 6, y + 4);
}

/** 先验代价图：灰度 PNG -> 白色半透明（未知 205 透明）。makeCanvas(w, h) 返回离屏画布，失败时原图直接用 */
function prepareRaster(image, makeCanvas) {
  try {
    const off = makeCanvas(image.width, image.height);
    const octx = off.getContext('2d');
    octx.drawImage(image, 0, 0);
    const img = octx.getImageData(0, 0, image.width, image.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i];
      if (g === 205) { d[i + 3] = 0; continue; }
      const occ = (254 - g) / 254;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = 10 + occ * 200;
    }
    octx.putImageData(img, 0, 0);
    return off;
  } catch (e) {
    return image;
  }
}

function drawBase(ctx, v, scene) {
  const meta = scene.meta;
  if (!scene.raster) {
    const a = px(v, { x: FIELD.x0, y: FIELD.y1 });
    const b = px(v, { x: FIELD.x1, y: FIELD.y0 });
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    rr(ctx, a[0], a[1], b[0] - a[0], b[1] - a[1], 12);
    ctx.fill();
  }
  const step = v.s > 70 ? 0.5 : 1;
  ctx.fillStyle = C.dot;
  for (let x = Math.ceil(-v.ox / v.s / step) * step; x <= (v.w - v.ox) / v.s; x += step) {
    for (let y = Math.ceil((v.oy - v.h) / v.s / step) * step; y <= v.oy / v.s; y += step) {
      const p = px(v, { x, y });
      ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
    }
  }
  const z = px(v, { x: 0, y: 0 });
  ctx.strokeStyle = C.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(z[0], z[1]); ctx.lineTo(z[0] + 0.5 * v.s, z[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(z[0], z[1]); ctx.lineTo(z[0], z[1] - 0.5 * v.s); ctx.stroke();
  if (scene.raster && hasPrior(meta)) {
    const o = px(v, { x: meta.origin.x, y: meta.origin.y + meta.height * meta.resolution });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scene.raster, o[0], o[1], meta.width * meta.resolution * v.s, meta.height * meta.resolution * v.s);
  }
  if (!scene.compact) {
    const y = v.h - 16;
    ctx.strokeStyle = C.label;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, y - 4); ctx.lineTo(16, y); ctx.lineTo(16 + v.s, y); ctx.lineTo(16 + v.s, y - 4); ctx.stroke();
    ctx.font = '600 10px sans-serif';
    ctx.fillStyle = C.label;
    ctx.fillText('1 m', 22 + v.s, y + 3);
  }
}

function drawScene(ctx, v, scene, t) {
  const trail = scene.trail || [];
  if (trail.length > 1) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = scene.compact ? 2 : 3;
    for (let i = 1; i < trail.length; i++) {
      ctx.strokeStyle = 'rgba(91,124,255,' + (0.05 + 0.75 * Math.pow(i / trail.length, 1.5)).toFixed(3) + ')';
      const a = px(v, trail[i - 1]);
      const b = px(v, trail[i]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  (scene.waypoints || []).forEach((w) => {
    if (!w.pose) return;
    const p = px(v, w.pose);
    const sel = w.waypoint_id === scene.selected;
    ctx.fillStyle = sel ? C.brand : C.wpFill;
    ctx.strokeStyle = sel ? C.brand : C.wp;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], sel ? 6.5 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (!scene.compact) pill(ctx, p[0] + 10, p[1], w.name, sel ? '#fff' : '#d7dce2', sel ? 'rgba(47,91,255,0.9)' : 'rgba(255,255,255,0.09)');
  });
  const pose = scene.pose;
  const goal = scene.goal;
  if (pose && goal) {
    const r = px(v, pose);
    const g = px(v, goal);
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = 'rgba(255,176,32,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(r[0], r[1]); ctx.lineTo(g[0], g[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = C.goal;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(g[0], g[1], 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.goal;
    ctx.beginPath(); ctx.arc(g[0], g[1], 2.5, 0, Math.PI * 2); ctx.fill();
  }
  if (scene.target) {
    const p = px(v, scene.target);
    const k = (t % 1600) / 1600;
    ctx.strokeStyle = 'rgba(255,77,94,' + (0.6 * (1 - k)).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], 7 + 16 * k, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.target;
    ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(p[0], p[1], 5.5, 0, Math.PI * 2); ctx.stroke();
    if (!scene.compact) pill(ctx, p[0] + 12, p[1], '视觉目标', '#fff', 'rgba(229,38,59,0.92)');
  }
  if (pose) {
    const p = px(v, pose);
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(-pose.yaw);
    if (!scene.compact) {
      const r = CAM_RANGE * v.s;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, 'rgba(91,124,255,0.30)');
      grad.addColorStop(1, 'rgba(91,124,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, -CAM_FOV / 2, CAM_FOV / 2); ctx.closePath(); ctx.fill();
    }
    const L = Math.max(0.52 * v.s, 16);
    const W = Math.max(0.4 * v.s, 12);
    ctx.shadowColor = 'rgba(91,124,255,0.8)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#fff';
    rr(ctx, -L / 2, -W / 2, L, W, Math.min(7, W / 3));
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.brand;
    ctx.beginPath();
    ctx.moveTo(L / 2 - 2, 0); ctx.lineTo(L / 2 - W * 0.55, -W * 0.3); ctx.lineTo(L / 2 - W * 0.55, W * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

/** scene: { meta, raster, waypoints, trail, pose, goal, target, selected, compact } */
function draw(ctx, w, h, scene, t) {
  ctx.clearRect(0, 0, w, h);
  const v = view(scene, w, h);
  drawBase(ctx, v, scene);
  drawScene(ctx, v, scene, t || 0);
  return v;
}

/** 点击命中点位，返回 waypoint_id 或 '' */
function hitWaypoint(scene, w, h, x, y) {
  const v = view(scene, w, h);
  const hit = (scene.waypoints || []).find((wp) => {
    if (!wp.pose) return false;
    const p = px(v, wp.pose);
    return Math.hypot(p[0] - x, p[1] - y) < 18;
  });
  return hit ? hit.waypoint_id : '';
}

module.exports = { draw, prepareRaster, hitWaypoint, hasPrior };
