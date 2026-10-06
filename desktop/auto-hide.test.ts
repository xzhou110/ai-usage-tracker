import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { createWindowControls } = createRequire(import.meta.url)('./auto-hide.cjs');

function fixture() {
  const window = Object.assign(new EventEmitter(), {
    pinned: false, minimized: false, maximized: false, maximizable: true, destroyed: false, visible: true, focused: false,
    bounds: { x: 150, y: 150, width: 400, height: 600 },
    isAlwaysOnTop() { return this.pinned; }, setAlwaysOnTop(value: boolean) { this.pinned = value; }, moveTop() {},
    isDestroyed() { return this.destroyed; }, isMinimized() { return this.minimized; }, isFullScreen() { return false; },
    isMaximized() { return this.maximized; }, unmaximize() { this.maximized = false; },
    minimize() { this.minimized = true; this.visible = false; this.focused = false; this.emit('minimize'); this.emit('moved'); },
    restore() { this.minimized = false; this.visible = true; this.emit('restore'); },
    isMaximizable() { return this.maximizable; }, setMaximizable(value: boolean) { this.maximizable = value; },
    getBounds() { return this.minimized ? { ...this.bounds, x: -32000, y: -32000 } : { ...this.bounds }; }, setBounds(value: typeof this.bounds) { this.bounds = value; this.emit('moved'); },
    hide() { throw new Error('Hide removes the taskbar entry.'); },
    show() { this.minimized = false; this.visible = true; this.focused = true; this.emit('show'); },
    showInactive() { this.minimized = false; this.visible = true; this.emit('show'); },
  });
  const screen = Object.assign(new EventEmitter(), {
    displays: [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    point: { x: 1600, y: 300 },
    getDisplayMatching() { return this.displays[0]; }, getAllDisplays() { return this.displays; }, getCursorScreenPoint() { return this.point; },
  });
  let now = 0;
  let poll: (() => void) | null = null;
  const clock = { now: () => now, every: (callback: () => void) => { poll = callback; return 1; }, cancel: () => { poll = null; } };
  const advance = (milliseconds: number) => { for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) { now += 100; poll?.(); } };
  const controls = createWindowControls(window, screen, () => {}, clock);
  return { window, screen, controls, advance, polling: () => poll !== null };
}
describe('Upper-Right Corner Auto-Hide', () => {
  it('docks at the top, ignores the rest of the right edge, and reveals from the corner without stealing focus', () => {
    const { window, screen, controls, advance } = fixture();
    controls.setAutoHide(true);
    expect(window.bounds.x).toBe(1520);
    expect(window.bounds.y).toBe(0);
    advance(2000); expect(window.visible).toBe(true);
    screen.point = { x: 1000, y: 300 }; advance(800);
    expect(controls.state()).toEqual({ autoHide: true, hidden: true });
    expect(window.minimized).toBe(true);
    screen.point = { x: 1919, y: 300 }; advance(1000);
    expect(window.visible).toBe(false);
    screen.point = { x: 1919, y: 20 }; advance(100);
    expect(window.visible).toBe(false);
    advance(200); expect(window.visible).toBe(true); expect(window.focused).toBe(false);
    expect(controls.state().hidden).toBe(false);
  });
  it('does not hide while editing or reveal after an explicit minimize', () => {
    const { window, screen, controls, advance } = fixture();
    controls.setAutoHide(true); controls.setInteractionHold(true);
    screen.point = { x: 50, y: 50 }; advance(3000); expect(window.visible).toBe(true);
    controls.setInteractionHold(false); advance(900); expect(window.visible).toBe(false);
    window.restore(); controls.minimize(); screen.point = { x: 1919, y: 20 }; advance(1000);
    expect(window.visible).toBe(false);
    window.restore(); window.show(); advance(500); expect(window.visible).toBe(true);
  });
  it('recovers a hidden window after display removal and releases pinning on disable', () => {
    const { window, screen, controls, advance, polling } = fixture();
    controls.setAutoHide(true); screen.point = { x: 50, y: 50 }; advance(2000);
    screen.displays = [{ id: 2, workArea: { x: -1280, y: 40, width: 1280, height: 680 } }];
    screen.emit('display-removed');
    screen.point = { x: -1, y: 60 }; advance(300); expect(window.visible).toBe(true);
    expect(window.bounds).toEqual({ x: -400, y: 40, width: 400, height: 600 });
    controls.setAutoHide(false);
    expect(window.pinned).toBe(false); expect(window.maximizable).toBe(true); expect(polling()).toBe(false);
    window.bounds.x = -1000; window.emit('moved'); expect(window.bounds.x).toBe(-1000);
    window.emit('closed'); expect(screen.listenerCount('display-removed')).toBe(0);
  });
  it('supports keyboard/taskbar reopening and cancels polling on close', () => {
    const { window, screen, controls, advance, polling } = fixture();
    controls.setAutoHide(true); screen.point = { x: 50, y: 50 }; advance(2000);
    window.restore(); expect(controls.state().hidden).toBe(false); advance(500); expect(window.visible).toBe(true);
    expect(() => controls.setAutoHide('true')).toThrow('Invalid state');
    expect(() => controls.setInteractionHold(null)).toThrow('Invalid state');
    window.emit('closed'); expect(polling()).toBe(false);
  });
  it('reveals an automatically minimized window when disabling Auto-Hide', () => {
    const { window, screen, controls, advance, polling } = fixture();
    controls.setAutoHide(true); screen.point = { x: 50, y: 50 }; advance(2000);
    expect(window.minimized).toBe(true);
    controls.setAutoHide(false);
    expect(window.minimized).toBe(false); expect(window.visible).toBe(true);
    expect(controls.state()).toEqual({ autoHide: false, hidden: false });
    expect(polling()).toBe(false);
  });
});
