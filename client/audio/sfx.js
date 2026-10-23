/**
 * sfx.js — every sound in Hardwood, synthesized with the Web Audio API.
 *
 * No samples, no files, nothing to license: each sound is a few oscillators
 * and filtered noise shaped by envelopes (docs/design/open-gym.md, "Audio
 * direction"). Inspired by how NBA Street Vol. 2 made a menu feel like a
 * court; nothing is taken from it.
 *
 *   import { sfx } from '../audio/sfx.js';
 *   sfx.unlock();          // inside a user gesture (browsers block audio before one)
 *   sfx.play('buy');       // fire-and-forget; a no-op when muted or unsupported
 *   sfx.music.start();     // the menu bed (boom-bap, ~90 BPM)
 *
 * Fails silent: without an AudioContext (Node, old browsers, blocked audio)
 * every call returns quietly and the game plays on without sound.
 */

const PREFS_KEY = 'hardwood_sound';

/** Sound starts off on the embedded site build and on everywhere else. */
export function defaultMuted(baseUrl) {
  return typeof baseUrl === 'string' && baseUrl.replace(/\/+$/, '') === '/hardwood';
}

const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';

function loadPrefs() {
  const fallback = { muted: defaultMuted(BASE_URL), music: 0.5 };
  try {
    const raw = globalThis.localStorage && localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function savePrefs(p) {
  try { globalThis.localStorage && localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

const prefs = loadPrefs();
let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let noiseBuf = null;

const AC = () => globalThis.AudioContext || globalThis.webkitAudioContext;

function ensure() {
  if (ctx) return ctx;
  const Ctor = AC();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = prefs.muted ? 0 : 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.8;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = prefs.music * 0.35;
    musicBus.connect(master);
    // One second of white noise, shared by every noisy sound.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
  return ctx;
}

// ── building blocks ─────────────────────────────────────────────────────────
const jitter = (amount = 0.04) => 1 + (Math.random() * 2 - 1) * amount;

function tone(t, { freq, to, type = 'sine', dur = 0.12, gain = 0.3, attack = 0.004, bus = sfxBus }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

function noise(t, { dur = 0.1, gain = 0.2, type = 'bandpass', freq = 2000, to, q = 1, attack = 0.004, bus = sfxBus }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// ── the sound list ──────────────────────────────────────────────────────────
const SOUNDS = {
  // UI
  tap: (t) => tone(t, { freq: 1150 * jitter(), dur: 0.05, gain: 0.12, type: 'triangle' }),
  open: (t) => { tone(t, { freq: 520, to: 880, dur: 0.12, gain: 0.12, type: 'triangle' }); },
  buy: (t) => { // register ka-ching
    noise(t, { dur: 0.05, gain: 0.15, type: 'highpass', freq: 5000 });
    tone(t + 0.02, { freq: 1318 * jitter(0.01), dur: 0.12, gain: 0.18, type: 'triangle' });
    tone(t + 0.09, { freq: 1760 * jitter(0.01), dur: 0.32, gain: 0.2, type: 'triangle' });
  },
  broke: (t) => tone(t, { freq: 220, to: 160, dur: 0.16, gain: 0.14, type: 'square' }),
  reroll: (t) => { // card shuffle
    for (let i = 0; i < 5; i++) noise(t + i * 0.035, { dur: 0.04, gain: 0.12, freq: 2600 * jitter(0.2), q: 2 });
  },
  pickup: (t) => tone(t, { freq: 420, to: 620, dur: 0.07, gain: 0.1, type: 'triangle' }),
  place: (t) => { // a soft thud on hardwood
    tone(t, { freq: 150 * jitter(), to: 60, dur: 0.14, gain: 0.32 });
    noise(t, { dur: 0.05, gain: 0.08, type: 'lowpass', freq: 900 });
  },
  sell: (t) => [1568, 1175, 880].forEach((f, i) => tone(t + i * 0.06, { freq: f, dur: 0.09, gain: 0.12, type: 'triangle' })),
  star: (t) => [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.07, { freq: f, dur: 0.22, gain: 0.16, type: 'triangle' })),
  whistle: (t) => {
    const o = tone(t, { freq: 2750, dur: 0.38, gain: 0.14, attack: 0.02 });
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 32;
    depth.gain.value = 90;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.4);
  },
  // court
  swish: (t) => noise(t, { dur: 0.28, gain: 0.22, freq: 6000, to: 1800, q: 0.9, attack: 0.03 }),
  clank: (t) => { // inharmonic partials: a rim, not a bell
    [523, 787, 1331].forEach((f) => tone(t, { freq: f * jitter(0.02), dur: 0.35, gain: 0.08, type: 'square' }));
    noise(t, { dur: 0.06, gain: 0.12, freq: 3000, q: 3 });
  },
  squeak: (t) => noise(t, { dur: 0.09, gain: 0.13, freq: 1800, to: 3400, q: 12 }),
  crowd: (t, { intensity = 0.5 } = {}) => noise(t, {
    dur: 1.2 + intensity, gain: 0.06 + intensity * 0.16, type: 'lowpass', freq: 700 + intensity * 900, attack: 0.25,
  }),
  horn: (t) => { [220, 233].forEach((f) => tone(t, { freq: f, dur: 0.7, gain: 0.1, type: 'square', attack: 0.01 })); },
  win: (t) => [392, 494, 587, 784].forEach((f, i) => tone(t + i * 0.09, { freq: f, dur: 0.5, gain: 0.14, type: 'triangle' })),
  loss: (t) => [392, 349, 311].forEach((f, i) => tone(t + i * 0.14, { freq: f, dur: 0.45, gain: 0.12, type: 'triangle' })),
};

export const SOUND_NAMES = Object.keys(SOUNDS);

// ── the menu bed ────────────────────────────────────────────────────────────
// A short boom-bap loop scheduled ahead of time: kick, snare, hats, and a
// soft two-note pad over four chords. 16th-note grid, light swing.
const BPM = 90;
const CHORDS = [[220, 262, 330], [175, 220, 262], [131, 165, 196], [196, 247, 294]]; // Am, F, C, G
const music = (() => {
  let timer = null;
  let step = 0;
  let nextTime = 0;
  const sixteenth = 60 / BPM / 4;

  const schedule = () => {
    while (nextTime < ctx.currentTime + 0.15) {
      const s = step % 64;
      const swing = s % 2 ? sixteenth * 0.12 : 0;
      const t = nextTime + swing;
      const beat = s % 16;
      if (beat === 0 || beat === 10) tone(t, { freq: 140, to: 42, dur: 0.22, gain: 0.5, bus: musicBus });
      if (beat === 4 || beat === 12) {
        noise(t, { dur: 0.14, gain: 0.22, freq: 1900, q: 0.8, bus: musicBus });
        tone(t, { freq: 190, to: 140, dur: 0.08, gain: 0.12, bus: musicBus });
      }
      if (s % 2 === 0) noise(t, { dur: 0.03, gain: s % 4 ? 0.04 : 0.07, type: 'highpass', freq: 8000, bus: musicBus });
      if (beat === 0) {
        CHORDS[Math.floor(s / 16) % 4].forEach((f) =>
          tone(t, { freq: f, dur: sixteenth * 15, gain: 0.05, type: 'triangle', attack: 0.08, bus: musicBus }));
      }
      nextTime += sixteenth;
      step++;
    }
  };

  return {
    start() {
      if (timer || !ensure() || prefs.muted || prefs.music <= 0) return;
      nextTime = ctx.currentTime + 0.05;
      step = 0;
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setTargetAtTime(prefs.music * 0.35, ctx.currentTime, 0.3);
      timer = setInterval(schedule, 50);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      if (ctx) musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
    },
    get playing() { return !!timer; },
  };
})();

// ── public API ──────────────────────────────────────────────────────────────
export const sfx = {
  /** Call from a click or keypress: creates/resumes the AudioContext. */
  unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    return !!c;
  },
  play(name, opts) {
    const make = SOUNDS[name];
    if (!make || prefs.muted || !ensure() || ctx.state !== 'running') return false;
    try { make(ctx.currentTime + 0.005, opts); return true; } catch { return false; }
  },
  /** One sound per game-feel event from game/events.js. */
  forEvent(e) {
    if (!e) return;
    if (e.type === 'make') {
      this.play('swish');
      this.play('crowd', { intensity: e.team === 'home' ? 0.5 : 0.25 });
    } else if (e.type === 'miss') this.play('clank');
    else if (e.type === 'steal') this.play('squeak');
    else if (e.type === 'gameWinner') this.play('crowd', { intensity: 1 });
  },
  get muted() { return prefs.muted; },
  setMuted(muted) {
    prefs.muted = !!muted;
    savePrefs(prefs);
    if (!ctx) return;
    master.gain.setTargetAtTime(prefs.muted ? 0 : 0.9, ctx.currentTime, 0.05);
    if (prefs.muted) music.stop();
  },
  get musicVolume() { return prefs.music; },
  setMusicVolume(v) {
    prefs.music = Math.max(0, Math.min(1, Number(v) || 0));
    savePrefs(prefs);
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(prefs.music * 0.35, ctx.currentTime, 0.1);
    if (prefs.music <= 0) music.stop();
  },
  music,
};
