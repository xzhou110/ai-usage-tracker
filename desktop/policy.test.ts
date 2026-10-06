import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { sidebarBounds, isAppUrl, isExternalUrl } = createRequire(import.meta.url)('./policy.cjs');
describe('Desktop Boundaries', () => {
  it('fits the right edge of offset and small display work areas', () => {
    expect(sidebarBounds({ x: -1920, y: 40, width: 1920, height: 1040 })).toEqual({ x: -400, y: 40, width: 400, height: 900 });
    expect(sidebarBounds({ x: 10, y: 0, width: 320, height: 600 })).toEqual({ x: 10, y: 0, width: 320, height: 600 });
  });
  it('limits privileged content to the exact local origin and opens only known links externally', () => {
    expect(isAppUrl('http://127.0.0.1:8175/#sidebar')).toBe(true);
    for (const url of ['https://example.com/', 'http://127.0.0.1:8176/', 'http://user@127.0.0.1:8175/', 'file:///C:/Windows/', 'http://127.0.0.1:8175/untrusted', 'http://127.0.0.1:8175/?redirect=https://example.com']) expect(isAppUrl(url)).toBe(false);
    expect(isExternalUrl('https://claude.ai/settings/usage')).toBe(true);
    for (const url of ['file:///C:/Windows/', 'javascript:alert(1)', 'https://claude.ai.evil.invalid/settings/usage', 'https://claude.ai/settings/usage?redirect=evil']) expect(isExternalUrl(url)).toBe(false);
  });
});
