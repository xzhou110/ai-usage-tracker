import { expect, mock, test } from 'claude-code/testing';

test('Desktop measurements send only quota fields and preserve cached capture time', async ($, on) => {
  const clock = mock.clock(on);
  const sent: any[] = [];
  on('http.fetch', (_$, e) => { sent.push(e); return { value: { ok: true, status: 200, headers: {}, text: '{}' } }; });
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  const event = { context: { tokens: 100, window: 200, percent: 50 }, cost: { private: 'synthetic-private-marker' },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: '2099-01-01T00:00:00.000Z', private: 'synthetic-private-marker' }], changed: ['rateLimits'] };
  await $.session.measure(event);
  await clock.settle();
  await $.session.measure(event);
  await clock.settle();
  expect(sent.length).toBe(2);
  expect(sent[0].url).toBe('http://127.0.0.1:8175/api/claude-desktop/reading');
  expect(sent[0].init.body.includes('synthetic-private-marker')).toBe(false);
  const first = JSON.parse(sent[0].init.body);
  expect(Object.keys(first).sort()).toEqual(['observedAt', 'rateLimits', 'sentAt']);
  expect(JSON.parse(sent[1].init.body).observedAt).toBe(first.observedAt);
});

test('missing quota sends nothing and a stopped tracker cannot stop a session event', async ($, on) => {
  const clock = mock.clock(on);
  let calls = 0;
  on('http.fetch', () => { calls++; return { deny: 'synthetic-private-marker' }; });
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  await $.session.measure({ context: {}, rateLimits: [], changed: ['context'] });
  expect(calls).toBe(0);
  const answer = await $.session.measure({ context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 12 }], changed: ['rateLimits'] });
  await clock.settle();
  expect(answer.changed).toEqual(['rateLimits']);
  expect(calls).toBe(1);
});

test('Desktop startup never turns a cached quota snapshot into a fresh reading', async ($, on) => {
  const clock = mock.clock(on);
  let sent = 0;
  on('session.usage', () => ({ value: { context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 4 }] } }));
  on('http.fetch', () => { sent++; return { value: { ok: true, status: 200, headers: {}, text: '{}' } }; });
  on('session.start', () => ({ cwd: '/synthetic' }));
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/synthetic' });
  await clock.advance(60_000);
  expect(sent).toBe(0);
});

test('a never-answering localhost server does not stall Claude or accumulate requests', async ($, on) => {
  const clock = mock.clock(on);
  let calls = 0;
  on('http.fetch', () => { calls++; return new Promise(() => {}); });
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/synthetic' });
  const event = { context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }], changed: ['rateLimits'] };
  expect((await $.session.measure(event)).changed).toEqual(['rateLimits']);
  await clock.settle();
  expect((await $.session.measure(event)).changed).toEqual(['rateLimits']);
  await clock.advance(180_000);
  expect(calls).toBe(1);
});

test('clear drops old quota but keeps retry available for the next measurement', async ($, on) => {
  const clock = mock.clock(on);
  let calls = 0;
  on('http.fetch', () => { calls++; return { value: { ok: true, status: 200, headers: {}, text: '{}' } }; });
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.end', () => ({ sessionId: 'synthetic' }));
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/synthetic' });
  await $.session.measure({ context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }], changed: ['rateLimits'] });
  await clock.settle();
  expect(calls).toBe(1);
  await $.session.end({ reason: 'clear' });
  await clock.advance(60_000);
  expect(calls).toBe(1);
  await $.session.measure({ context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 15 }], changed: ['rateLimits'] });
  await clock.settle();
  await clock.advance(60_000);
  expect(calls).toBe(3);
});
