/**
 * telemetry.js — the two shared game events brooksroley.com counts for every
 * game: `game_start` when a run begins and `game_end` when it ends, both with
 * `metadata.game = 'hardwood'`. They POST to the site's first-party
 * /api/events, the same endpoint and payload as the site's own `track()`
 * (zero-next src/lib/analytics.ts), so /admin/analytics can report how many
 * runs are finished.
 *
 * Joining the visitor's page views: the site keeps a per-tab session id in
 * sessionStorage ('br_session_id') and a durable anonymous id in localStorage
 * ('br_anon_id'). The /hardwood/ embed is same-origin with the site, so it
 * reads (or, if absent, creates) the very same keys. Nothing personal is sent:
 * the ids are random, and the metadata is game state only.
 *
 * Best-effort by design: no call here throws, awaits, or blocks the game. On
 * another origin (GitHub Pages) the POST goes to API_BASE and may be refused;
 * that failure is swallowed like any other.
 *
 * Pure enough for plain `node`: every browser global is reached through an
 * injectable `env`, so the tests pass fakes.
 */

export const GAME_SLUG = 'hardwood';
export const SESSION_ID_KEY = 'br_session_id';
export const ANON_ID_KEY = 'br_anon_id';

function newId(env) {
  try {
    if (env.crypto && typeof env.crypto.randomUUID === 'function') return env.crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storedId(storage, key, env) {
  try {
    if (!storage) return null;
    let id = storage.getItem(key);
    if (!id) {
      id = newId(env);
      storage.setItem(key, id);
    }
    return id;
  } catch {
    return null; // storage blocked (private mode): the event still records, unattributed
  }
}

/** The site page hosting the embed (/games/hardwood) when same-origin, else this page. */
function hostLocation(env) {
  try {
    const top = env.top;
    if (top && top !== env.self && top.location && typeof top.location.pathname === 'string') {
      return top.location;
    }
  } catch { /* cross-origin parent: reading it throws */ }
  return env.location || null;
}

function hostReferrer(env) {
  try {
    const top = env.top;
    if (top && top !== env.self && top.document) return top.document.referrer || null;
  } catch { /* cross-origin parent */ }
  try {
    return (env.document && env.document.referrer) || null;
  } catch {
    return null;
  }
}

function readUtm(loc) {
  try {
    const params = new URLSearchParams(loc ? loc.search : '');
    const utm = {};
    for (const key of ['source', 'medium', 'campaign']) {
      const value = params.get(`utm_${key}`);
      if (value) utm[key] = value.slice(0, 80);
    }
    return Object.keys(utm).length ? utm : null;
  } catch {
    return null;
  }
}

function browserEnv() {
  const g = typeof window !== 'undefined' ? window : globalThis;
  const pick = (fn) => { try { return fn(); } catch { return undefined; } };
  return {
    self: g,
    top: pick(() => g.top),
    location: pick(() => g.location),
    document: pick(() => g.document),
    localStorage: pick(() => g.localStorage),
    sessionStorage: pick(() => g.sessionStorage),
    navigator: pick(() => g.navigator),
    fetch: typeof g.fetch === 'function' ? g.fetch.bind(g) : undefined,
    crypto: pick(() => g.crypto),
  };
}

/** The JSON body /api/events accepts, built from the host page's ids and location. */
export function buildEventBody(eventType, metadata = {}, env = browserEnv()) {
  const loc = hostLocation(env);
  const utm = readUtm(loc);
  const meta = { ...metadata, game: GAME_SLUG };
  return {
    session_id: storedId(env.sessionStorage, SESSION_ID_KEY, env),
    anon_id: storedId(env.localStorage, ANON_ID_KEY, env),
    page: (loc && loc.pathname) || null,
    event_type: eventType,
    metadata: utm ? { ...meta, utm } : meta,
    referrer: hostReferrer(env),
  };
}

/**
 * Fire one event at `${apiBase}/api/events`. Same-origin (apiBase '') prefers
 * sendBeacon, which survives the tab closing; otherwise fetch with keepalive.
 * Never throws, never returns a promise the caller must handle.
 */
export function sendGameEvent(eventType, metadata = {}, { apiBase = '', env = browserEnv() } = {}) {
  try {
    const url = `${apiBase}/api/events`;
    const body = JSON.stringify(buildEventBody(eventType, metadata, env));
    if (!apiBase && env.navigator && typeof env.navigator.sendBeacon === 'function' && typeof Blob !== 'undefined') {
      try {
        if (env.navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
      } catch { /* fall through to fetch */ }
    }
    if (typeof env.fetch !== 'function') return;
    const pending = env.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {
    /* analytics must never break the game */
  }
}

/**
 * Exactly one game_start and one game_end per run. A run starts on its first
 * lock-in (the first move; looking at the shop is a page view, not a game) and
 * ends when the season is won or the team is eliminated. reset() re-arms it
 * for the next run; a run abandoned mid-season sends no game_end, which is
 * what makes finish rate = game_end / game_start.
 */
export function createRunTracker(emit = sendGameEvent, now = Date.now) {
  let startedAt = null;
  let ended = false;
  return {
    get active() { return startedAt !== null && !ended; },
    start(metadata = {}) {
      if (startedAt !== null) return false;
      startedAt = now();
      ended = false;
      emit('game_start', { ...metadata });
      return true;
    },
    end({ result, round, ...rest } = {}) {
      if (startedAt === null || ended) return false;
      ended = true;
      emit('game_end', {
        ...rest,
        result: result === 'win' ? 'win' : 'loss',
        round,
        duration_ms: now() - startedAt,
      });
      return true;
    },
    reset() {
      startedAt = null;
      ended = false;
    },
  };
}
