function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getData(payload) {
  if (!payload) return null;
  return payload.data !== undefined ? payload.data : payload;
}

function getMapMetadata(payload) {
  const data = getData(payload);
  if (!data || typeof data !== 'object') return null;
  const width = numberOrNull(data.width);
  const height = numberOrNull(data.height);
  const resolution = numberOrNull(data.resolution);
  if (!width || !height || !resolution) return null;
  return {
    mapId: data.map_id || data.mapId || 'navigation-map',
    version: data.version || data.map_version || '',
    frameId: data.frame_id || 'map',
    timestamp: data.timestamp || data.updated_at || '',
    width,
    height,
    resolution,
    origin: {
      x: numberOrNull(data.origin && data.origin.x) || 0,
      y: numberOrNull(data.origin && data.origin.y) || 0,
      yaw: numberOrNull(data.origin && data.origin.yaw) || 0
    }
  };
}

function getPose(navigation) {
  if (!navigation) return null;
  const pose = navigation.pose || navigation.robot_pose || navigation.robotPose;
  if (!pose) return null;
  const x = numberOrNull(pose.x);
  const y = numberOrNull(pose.y);
  if (x === null || y === null) return null;
  return {
    x,
    y,
    yaw: numberOrNull(pose.yaw) || 0
  };
}

function getGoal(navigation) {
  if (!navigation) return null;
  const goal = navigation.goal || navigation.current_goal_pose || navigation.target_pose;
  if (!goal) return null;
  const x = numberOrNull(goal.x);
  const y = numberOrNull(goal.y);
  if (x === null || y === null) return null;
  return {
    x,
    y,
    yaw: numberOrNull(goal.yaw) || 0
  };
}

function getPath(navigation, key) {
  if (!navigation) return [];
  const path = navigation[key] || navigation[key.replace(/_([a-z])/g, (_, chr) => chr.toUpperCase())] || [];
  if (!Array.isArray(path)) return [];
  return path.map((point) => {
    const x = numberOrNull(point && point.x);
    const y = numberOrNull(point && point.y);
    if (x === null || y === null) return null;
    return { x, y };
  }).filter(Boolean);
}

function createViewport(metadata, canvasWidth, canvasHeight, padding = 14) {
  if (!metadata || !canvasWidth || !canvasHeight) return null;
  const usableWidth = Math.max(1, canvasWidth - padding * 2);
  const usableHeight = Math.max(1, canvasHeight - padding * 2);
  const scale = Math.min(usableWidth / metadata.width, usableHeight / metadata.height);
  const drawWidth = metadata.width * scale;
  const drawHeight = metadata.height * scale;
  return {
    x: (canvasWidth - drawWidth) / 2,
    y: (canvasHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
    scale
  };
}

function worldToPixel(point, metadata) {
  if (!point || !metadata) return null;
  const dx = point.x - metadata.origin.x;
  const dy = point.y - metadata.origin.y;
  const yaw = metadata.origin.yaw || 0;
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: rx / metadata.resolution,
    y: metadata.height - (ry / metadata.resolution)
  };
}

function worldToCanvas(point, metadata, viewport) {
  const pixel = worldToPixel(point, metadata);
  if (!pixel || !viewport) return null;
  return {
    x: viewport.x + pixel.x * viewport.scale,
    y: viewport.y + pixel.y * viewport.scale
  };
}

module.exports = {
  getMapMetadata,
  getPose,
  getGoal,
  getPath,
  createViewport,
  worldToCanvas
};
