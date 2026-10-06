const { rightEdgeBounds } = require('./policy.cjs');

// Native state is the source of truth; React never guesses the pin state.
function createWindowControls(window, screen, changed = () => {}) {
  let rightEdge = false;
  let desiredPinned = window.isAlwaysOnTop();
  let adjusting = false;
  const wasMaximizable = window.isMaximizable();
  const state = () => ({ pinned: window.isAlwaysOnTop(), rightEdge });
  const publish = () => { if (!window.isDestroyed()) changed(state()); };
  function align() {
    if (!rightEdge || adjusting || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    const bounds = window.getBounds();
    const next = rightEdgeBounds(bounds, screen.getDisplayMatching(bounds).workArea);
    if (Object.keys(next).every(key => bounds[key] === next[key])) return;
    adjusting = true;
    try { window.setBounds(next); } finally { adjusting = false; }
  }
  function restore() {
    if (desiredPinned) window.setAlwaysOnTop(true, 'floating');
    align(); publish();
  }
  const windowListeners = { moved: align, resized: align, restore, show: restore, 'leave-full-screen': align, 'always-on-top-changed': publish };
  for (const [event, listener] of Object.entries(windowListeners)) window.on(event, listener);
  const displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'];
  for (const event of displayEvents) screen.on(event, align);
  window.once('closed', () => { for (const event of displayEvents) screen.off(event, align); });
  return {
    state,
    setPinned(value) {
      if (typeof value !== 'boolean') throw new Error('Invalid state.');
      desiredPinned = value;
      window.setAlwaysOnTop(value, 'floating');
      if (value) window.moveTop();
      if (window.isAlwaysOnTop() !== value) throw new Error('Windows did not apply the pin state.');
      publish(); return state();
    },
    setRightEdge(value) {
      if (typeof value !== 'boolean') throw new Error('Invalid state.');
      if (value && window.isFullScreen()) throw new Error('Leave full screen before attaching to the edge.');
      if (value && window.isMaximized()) window.unmaximize();
      rightEdge = value;
      window.setMaximizable(value ? false : wasMaximizable);
      align(); publish(); return state();
    },
  };
}
module.exports = { createWindowControls };
