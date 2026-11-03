/**
 * The site's shared game events — plain Node:
 *   node client/game/__tests__/telemetry.test.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GAME_SLUG, SESSION_ID_KEY, ANON_ID_KEY,
  buildEventBody, sendGameEvent, createRunTracker,
} from '../telemetry.js';

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};
const blockedStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
};

// A same-origin iframe at /hardwood/ inside the site page /games/hardwood.
const embedEnv = (over = {}) => {
  const self = {};
  return {
    self,
    top: { location: { pathname: '/games/hardwood', search: '?utm_source=linkedin&x=1' }, document: { referrer: 'https://www.linkedin.com/' } },
    location: { pathname: '/hardwood/', search: '' },
    document: { referrer: 'http://localhost:3000/games/hardwood' },
    sessionStorage: memoryStorage({ [SESSION_ID_KEY]: 'sess-1' }),
    localStorage: memoryStorage({ [ANON_ID_KEY]: 'anon-1' }),
    navigator: {},
    fetch: undefined,
    crypto: { randomUUID: () => 'new-uuid' },
    ...over,
  };
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; };

test('body reuses the site ids and reports the host page', () => {
  const body = buildEventBody('game_start', { mode: 'autochess' }, embedEnv());
  assert.deepEqual(body, {
    session_id: 'sess-1',
    anon_id: 'anon-1',
    page: '/games/hardwood',
    event_type: 'game_start',
    metadata: { mode: 'autochess', game: 'hardwood', utm: { source: 'linkedin' } },
    referrer: 'https://www.linkedin.com/',
  });
  assert.equal(GAME_SLUG, 'hardwood');
  assert.equal(SESSION_ID_KEY, 'br_session_id', 'same key as zero-next analytics.ts');
  assert.equal(ANON_ID_KEY, 'br_anon_id', 'same key as zero-next analytics.ts');
});

test('the game slug cannot be overridden by metadata', () => {
  const body = buildEventBody('game_end', { game: 'other' }, embedEnv());
  assert.equal(body.metadata.game, 'hardwood');
});

test('missing ids are created under the site keys and then reused', () => {
  const env = embedEnv({ sessionStorage: memoryStorage(), localStorage: memoryStorage() });
  const a = buildEventBody('game_start', {}, env);
  assert.equal(a.session_id, 'new-uuid');
  assert.equal(env.sessionStorage.map.get(SESSION_ID_KEY), 'new-uuid');
  assert.equal(env.localStorage.map.get(ANON_ID_KEY), 'new-uuid');
  env.crypto = { randomUUID: () => 'second' };
  assert.equal(buildEventBody('game_end', {}, env).anon_id, 'new-uuid');
});

test('blocked storage and a cross-origin parent still give a body', () => {
  const env = embedEnv({ sessionStorage: blockedStorage, localStorage: blockedStorage });
  Object.defineProperty(env, 'top', { get() { return { get location() { throw new Error('cross-origin'); }, get document() { throw new Error('cross-origin'); } }; } });
  const body = buildEventBody('game_start', {}, env);
  assert.equal(body.session_id, null);
  assert.equal(body.anon_id, null);
  assert.equal(body.page, '/hardwood/');
  assert.equal(body.referrer, 'http://localhost:3000/games/hardwood');
  assert.deepEqual(body.metadata, { game: 'hardwood' });
});

test('top-level page (not embedded) uses its own location', () => {
  const env = embedEnv();
  env.top = env.self;
  env.location = { pathname: '/BballTactics/', search: '' };
  assert.equal(buildEventBody('game_start', {}, env).page, '/BballTactics/');
});

test('same-origin send prefers sendBeacon to /api/events', () => {
  const beacons = [];
  const env = embedEnv({ navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } }, fetch: () => { throw new Error('should not fetch'); } });
  sendGameEvent('game_start', { mode: 'autochess' }, { apiBase: '', env });
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].url, '/api/events');
  assert.equal(beacons[0].blob.type, 'application/json');
});

test('cross-origin send uses fetch with keepalive at the API base', () => {
  const calls = [];
  const env = embedEnv({
    navigator: { sendBeacon: () => { throw new Error('beacon is same-origin only'); } },
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true }); },
  });
  sendGameEvent('game_end', { result: 'win', round: 10 }, { apiBase: 'https://brooksroley.com', env });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://brooksroley.com/api/events');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.keepalive, true);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.event_type, 'game_end');
  assert.deepEqual(body.metadata, { result: 'win', round: 10, game: 'hardwood', utm: { source: 'linkedin' } });
});

test('a refused beacon falls back to fetch', () => {
  const calls = [];
  const env = embedEnv({ navigator: { sendBeacon: () => false }, fetch: (url) => { calls.push(url); return Promise.resolve(); } });
  sendGameEvent('game_start', {}, { env });
  assert.deepEqual(calls, ['/api/events']);
});

test('a failing network never throws into the game', () => {
  const rejecting = embedEnv({ fetch: () => Promise.reject(new Error('offline')) });
  assert.doesNotThrow(() => sendGameEvent('game_start', {}, { apiBase: 'https://x.test', env: rejecting }));
  const throwing = embedEnv({ fetch: () => { throw new TypeError('Failed to fetch'); } });
  assert.doesNotThrow(() => sendGameEvent('game_start', {}, { apiBase: 'https://x.test', env: throwing }));
  const none = embedEnv({ fetch: undefined });
  assert.doesNotThrow(() => sendGameEvent('game_start', {}, { apiBase: 'https://x.test', env: none }));
});

test('run tracker: one start and one end per run, re-armed by reset', () => {
  const sent = [];
  let t = 1000;
  const tracker = createRunTracker((event, metadata) => sent.push([event, metadata]), () => t);
  assert.equal(tracker.end({ result: 'loss', round: 1 }), false, 'no end before a start');
  assert.equal(tracker.start({ mode: 'autochess' }), true);
  assert.equal(tracker.start({ mode: 'autochess' }), false, 'later lock-ins in the same run do not restart it');
  assert.equal(tracker.active, true);
  t = 61000;
  assert.equal(tracker.end({ mode: 'autochess', result: 'loss', round: 6, wins: 1, losses: 5 }), true);
  assert.equal(tracker.end({ result: 'loss', round: 6 }), false, 'one end per run');
  assert.equal(tracker.start({}), false, 'a finished run is not restarted until reset');
  assert.deepEqual(sent, [
    ['game_start', { mode: 'autochess' }],
    ['game_end', { mode: 'autochess', wins: 1, losses: 5, result: 'loss', round: 6, duration_ms: 60000 }],
  ]);
  tracker.reset();
  assert.equal(tracker.active, false);
  assert.equal(tracker.start({ mode: 'autochess' }), true);
  assert.equal(tracker.end({ result: 'win', round: 10 }), true);
  assert.equal(sent.length, 4);
  assert.equal(sent[3][1].result, 'win');
});

test('result is always win or loss', () => {
  const sent = [];
  const tracker = createRunTracker((e, m) => sent.push(m), () => 0);
  tracker.start();
  tracker.end({ result: 'lost', round: 3 });
  assert.equal(sent[1].result, 'loss');
});

test('App.vue wires the tracker into the run', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const app = readFileSync(join(here, '../../App.vue'), 'utf8');
  assert.match(app, /runTracker\.start\(/, 'game_start on lock-in');
  assert.match(app, /runTracker\.end\(/, 'game_end when the run is over');
  assert.match(app, /runTracker\.reset\(\)/, 'Play Again starts a new run');
  assert.match(app, /sendGameEvent\(event, metadata, \{ apiBase: API_BASE \}\)/);
});

console.log(`telemetry: ${passed} tests passed`);
