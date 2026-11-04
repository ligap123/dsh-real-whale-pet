function layout(size, area, aspect = 1672 / 941) {
  const height = Math.min(size, area.height - 192, (area.width - 96) / aspect);
  return { width: Math.round(height * aspect + 96), height: Math.round(height + 192), petHeight: height };
}
function clampBounds(bounds, area) {
  return { ...bounds, x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))) };
}
function cornerBounds(dimensions, area, pet) {
  return clampBounds({ width: dimensions.width, height: dimensions.height,
    x: pet.corner.endsWith('right') ? area.x + area.width - dimensions.width - pet.marginX : area.x + pet.marginX,
    y: pet.corner.startsWith('bottom') ? area.y + area.height - dimensions.height - pet.marginY : area.y + pet.marginY }, area);
}
function contains(point, rect) { return rect && point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height; }
function projectedOrigin(point, bounds) {
  return { x: Math.max(0, Math.min(bounds.width, point.x - bounds.x)), y: Math.max(0, Math.min(bounds.height, point.y - bounds.y)) };
}
function alphaHit(point, rect, mask) {
  if (!contains(point, rect) || !mask) return false;
  const x = Math.min(mask.width - 1, Math.floor((point.x - rect.x) / rect.width * mask.width));
  const y = Math.min(mask.height - 1, Math.floor((point.y - rect.y) / rect.height * mask.height));
  return mask.bytes[(y * mask.width + x) * 4 + 3] > 24;
}
module.exports = { layout, clampBounds, cornerBounds, contains, projectedOrigin, alphaHit };
