const ORIGIN = 'http://127.0.0.1:8175';
const officialPages = new Set([
  'https://claude.ai/settings/usage',
  'https://chatgpt.com/codex/settings/usage',
  'https://cursor.com/dashboard?tab=usage',
]);
function isAppUrl(value) {
  try { const url = new URL(value); return url.origin === ORIGIN && url.pathname === '/' && !url.search && !url.username && !url.password; }
  catch { return false; }
}
function isExternalUrl(value) { return officialPages.has(value) || value === `${ORIGIN}/#overview`; }
function sidebarBounds(area) {
  const width = Math.min(400, area.width);
  const height = Math.min(900, area.height);
  return { x: area.x + area.width - width, y: area.y, width, height };
}
function rightEdgeBounds(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return { x: area.x + area.width - width, y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height };
}
module.exports = { ORIGIN, isAppUrl, isExternalUrl, sidebarBounds, rightEdgeBounds };
