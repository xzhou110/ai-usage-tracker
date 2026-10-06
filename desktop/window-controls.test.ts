import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { createWindowControls } = createRequire(import.meta.url)('./window-controls.cjs');

function fixture() {
  const window = Object.assign(new EventEmitter(), {
    pinned: false, minimized: false, maximized: false, maximizable: true, destroyed: false, raised: 0,
    bounds: { x: 150, y: 150, width: 400, height: 600 },
    isAlwaysOnTop() { return this.pinned; },
    setAlwaysOnTop(value: boolean) { this.pinned = value; this.emit('always-on-top-changed'); },
    moveTop() { this.raised++; },
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    isFullScreen() { return false; },
    isMaximized() { return this.maximized; },
    unmaximize() { this.maximized = false; },
    isMaximizable() { return this.maximizable; },
    setMaximizable(value: boolean) { this.maximizable = value; },
    getBounds() { return { ...this.bounds }; },
    setBounds(value: typeof this.bounds) { this.bounds = value; this.emit('moved'); },
  });
  const screen = Object.assign(new EventEmitter(), {
    area: { x: 0, y: 0, width: 1920, height: 1040 },
    getDisplayMatching() { return { workArea: this.area }; },
  });
  const updates: unknown[] = [];
  const controls = createWindowControls(window, screen, (state: unknown) => updates.push(state));
  return { window, screen, updates, controls };
}
describe('Sidebar Window Controls', () => {
  it('reports native pin state across renderer reloads and restores a minimized pinned window', () => {
    const { window, controls, updates } = fixture();
    expect(controls.setPinned(true)).toEqual({ pinned: true, rightEdge: false });
    expect(window.raised).toBe(1);
    expect(controls.state().pinned).toBe(true); // A newly mounted renderer queries this.
    window.pinned = false;
    window.emit('restore');
    expect(controls.state().pinned).toBe(true);
    expect(controls.setPinned(false).pinned).toBe(false);
    window.emit('restore');
    expect(updates.at(-1)).toEqual({ pinned: false, rightEdge: false });
  });
  it('does not claim success when the native pin operation fails', () => {
    const { window, controls } = fixture();
    window.setAlwaysOnTop = () => {};
    expect(() => controls.setPinned(true)).toThrow('Windows did not apply');
    expect(controls.state().pinned).toBe(false);
  });
  it('keeps the right edge aligned after movement, resizing, and display changes, then releases it', () => {
    const { window, screen, controls } = fixture();
    controls.setRightEdge(true);
    expect(window.bounds).toEqual({ x: 1520, y: 150, width: 400, height: 600 });
    expect(window.maximizable).toBe(false);
    window.bounds = { x: 10, y: 600, width: 500, height: 700 };
    window.emit('resized');
    expect(window.bounds).toEqual({ x: 1420, y: 340, width: 500, height: 700 });
    screen.area = { x: -1280, y: 40, width: 1280, height: 680 };
    screen.emit('display-metrics-changed');
    expect(window.bounds).toEqual({ x: -500, y: 40, width: 500, height: 680 });
    controls.setRightEdge(false);
    expect(window.maximizable).toBe(true);
    window.bounds.x = -1000; window.emit('moved');
    expect(window.bounds.x).toBe(-1000);
    window.emit('closed');
    expect(screen.listenerCount('display-metrics-changed')).toBe(0);
  });
  it('waits until restore to reposition a minimized window and rejects invalid commands', () => {
    const { window, controls } = fixture();
    window.minimized = true;
    controls.setRightEdge(true);
    expect(window.bounds.x).toBe(150);
    window.minimized = false; window.emit('restore');
    expect(window.bounds.x).toBe(1520);
    expect(() => controls.setPinned('true')).toThrow('Invalid state');
    expect(() => controls.setRightEdge(null)).toThrow('Invalid state');
  });
});
