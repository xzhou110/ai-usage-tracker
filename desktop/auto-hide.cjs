const { upperRightBounds } = require('./policy.cjs');

const HOVER_DELAY = 180;
const HIDE_DELAY = 700;
const EDGE_WIDTH = 3;
const CORNER_HEIGHT = 48;
function contains(point, bounds) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

function createWindowControls(window, screen, changed = () => {}, clock = { now: Date.now, every: setInterval, cancel: clearInterval }) {
  let autoHide = false;
  let hidden = false;
  let hold = false;
  let adjusting = false;
  let hoverSince = null;
  let outsideSince = null;
  let graceUntil = 0;
  let displayId = null;
  let timer = null;
  let normalBounds = window.getBounds();
  const wasMaximizable = window.isMaximizable();
  const wasAlwaysOnTop = window.isAlwaysOnTop();
  const state = () => ({ autoHide, hidden });
  const publish = () => { if (!window.isDestroyed()) changed(state()); };
  function area() {
    return (screen.getAllDisplays().find(display => display.id === displayId) ?? screen.getDisplayMatching(normalBounds)).workArea;
  }
  function align() {
    if (!autoHide || adjusting || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const bounds = window.getBounds();
    const next = upperRightBounds(bounds, area());
    normalBounds = next;
    if (Object.keys(next).every(key => bounds[key] === next[key])) return;
    adjusting = true;
    try { window.setBounds(next); } finally { adjusting = false; }
  }
  function reveal(focus = false) {
    if (!autoHide || window.isDestroyed() || (window.isMinimized() && !hidden)) return;
    hidden = false; hoverSince = null; outsideSince = null;
    graceUntil = clock.now() + HIDE_DELAY;
    window.setAlwaysOnTop(true, 'floating');
    // Hover reveals without stealing keyboard focus from the user's other app.
    if (focus) window.show(); else window.showInactive();
    align();
    window.moveTop(); publish();
  }
  function tick() {
    if (!autoHide || window.isDestroyed() || (window.isMinimized() && !hidden) || window.isFullScreen()) return;
    const now = clock.now();
    const point = screen.getCursorScreenPoint();
    if (hidden) {
      const workArea = area();
      const edge = { x: workArea.x + workArea.width - EDGE_WIDTH, y: workArea.y, width: EDGE_WIDTH, height: Math.min(CORNER_HEIGHT, workArea.height) };
      if (!contains(point, edge)) { hoverSince = null; return; }
      if (hoverSince === null) hoverSince = now;
      if (now - hoverSince >= HOVER_DELAY) reveal();
      return;
    }
    if (hold || now < graceUntil || contains(point, window.getBounds())) { outsideSince = null; return; }
    if (outsideSince === null) outsideSince = now;
    if (now - outsideSince >= HIDE_DELAY) {
      hidden = true; hoverSince = null; outsideSince = null;
      normalBounds = window.getBounds();
      // Minimize preserves the Windows taskbar recovery path; hide removes it.
      window.minimize(); publish();
    }
  }
  function shown() {
    if (!autoHide || window.isMinimized()) return;
    hidden = false; outsideSince = null; hoverSince = null; graceUntil = clock.now() + HIDE_DELAY;
    align(); window.setAlwaysOnTop(true, 'floating'); publish();
  }
  function moved() {
    if (adjusting || !autoHide || window.isMinimized()) return;
    normalBounds = window.getBounds();
    displayId = screen.getDisplayMatching(window.getBounds()).id;
    align(); outsideSince = null; graceUntil = clock.now() + HIDE_DELAY;
  }
  function displayChanged() {
    if (!autoHide) return;
    const display = screen.getAllDisplays().find(item => item.id === displayId) ?? screen.getDisplayMatching(normalBounds);
    displayId = display.id;
    align();
  }
  const listeners = { moved, resized: align, restore: shown, show: shown, 'leave-full-screen': shown };
  for (const [event, listener] of Object.entries(listeners)) window.on(event, listener);
  const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
  for (const event of displayEvents) screen.on(event, displayChanged);
  window.once('closed', () => {
    if (timer !== null) clock.cancel(timer);
    for (const event of displayEvents) screen.off(event, displayChanged);
  });
  return {
    state,
    minimize() {
      hidden = false; hoverSince = null; outsideSince = null;
      window.minimize(); publish();
    },
    setInteractionHold(value) {
      if (typeof value !== 'boolean') throw new Error('Invalid state.');
      hold = value; outsideSince = null;
      if (value && hidden) reveal();
    },
    setAutoHide(value) {
      if (typeof value !== 'boolean') throw new Error('Invalid state.');
      if (value && window.isFullScreen()) throw new Error('Leave full screen before enabling auto-hide.');
      if (value && window.isMaximized()) window.unmaximize();
      if (value && window.isMinimized()) window.restore();
      autoHide = value;
      if (timer !== null) { clock.cancel(timer); timer = null; }
      window.setMaximizable(value ? false : wasMaximizable);
      if (value) {
        displayId = screen.getDisplayMatching(window.getBounds()).id;
        reveal();
        timer = clock.every(tick, 100);
        timer?.unref?.();
      } else {
        hidden = false; hoverSince = null; outsideSince = null;
        window.setAlwaysOnTop(wasAlwaysOnTop, 'floating');
        window.show();
      }
      publish(); return state();
    },
  };
}
module.exports = { createWindowControls };
