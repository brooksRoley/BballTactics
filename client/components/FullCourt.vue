<template>
  <section class="fc" aria-labelledby="fc-title">
    <!-- 1. Pick a player -->
    <div v-if="screen === 'pick'" class="fc-pick">
      <header class="fc-head">
        <div>
          <p class="fc-kicker">Full Court · 5v5 · new</p>
          <h2 id="fc-title" class="fc-title">Pick your player</h2>
          <p class="fc-line">You run one player live. Nine others play around you. Their four moves come from their stats.</p>
        </div>
        <button class="fc-btn" @click="$emit('exit')">Back to Open Gym</button>
      </header>

      <p v-if="loadError" class="fc-error">{{ loadError }}</p>

      <div class="fc-pick-body" v-else>
        <ul class="fc-roster" aria-label="Roster">
          <li v-for="p in roster" :key="p.id">
            <button
              class="fc-card"
              :class="{ on: picked && picked.id === p.id }"
              :aria-pressed="!!(picked && picked.id === p.id)"
              @click="picked = p"
            >
              <span class="fc-card-name">{{ p.name }}</span>
              <span class="fc-card-meta">{{ p.team }} · {{ sigName(p) }}</span>
              <span class="fc-bars">
                <span v-for="k in STAT_KEYS" :key="k" class="fc-bar">
                  <span class="fc-bar-label">{{ k.slice(0, 3) }}</span>
                  <span class="fc-bar-track"><span class="fc-bar-fill" :style="{ width: p.stats[k] + '%' }"></span></span>
                  <span class="fc-bar-num">{{ p.stats[k] }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>

        <aside class="fc-kit" v-if="picked" aria-live="polite">
          <h3>{{ picked.name }}</h3>
          <ul class="fc-kit-list">
            <li v-for="s in SLOTS" :key="s">
              <kbd>{{ s }}</kbd>
              <div>
                <strong>{{ pickedKit[s].name }}</strong>
                <span class="fc-kit-blurb">{{ pickedKit[s].blurb }}</span>
                <span class="fc-kit-nums">{{ pickedKit[s].cooldown }}s cooldown · {{ pickedKit[s].cost }} stamina<template v-if="pickedKit[s].distance"> · {{ pickedKit[s].distance }} reach</template></span>
              </div>
            </li>
          </ul>
          <button class="fc-go" data-sfx="none" @click="tipOff">Tip off</button>
          <p class="fc-controls">{{ controlsLine(touchUI) }}</p>
        </aside>
      </div>
    </div>

    <!-- 2. Play -->
    <div v-show="screen === 'play' || screen === 'final'" class="fc-play">
      <div class="fc-score" :class="{ clutch: hud.clutch }" role="status">
        <span class="fc-team home">You <b>{{ hud.homeScore }}</b><span v-if="hud.rally && hud.rally.home" class="fc-rally" :title="rallyTitle">Rally +{{ Math.round(hud.rally.bonus * 100) }}%</span></span>
        <span class="fc-clock">
          <span>{{ periodLabel }}</span>
          <b :class="{ hot: hud.clutch }">{{ fmtClock(hud.clock) }}</b>
          <span v-if="hud.shotClockOff" class="fc-shot off" title="Less game clock than shot clock: the shot clock is off">—</span>
          <span v-else class="fc-shot" :class="{ low: hud.shotClock <= 4 }" :title="'Shot clock'">{{ Math.ceil(hud.shotClock) }}</span>
        </span>
        <span class="fc-team away"><span v-if="hud.rally && hud.rally.away" class="fc-rally" :title="rallyTitle">Rally +{{ Math.round(hud.rally.bonus * 100) }}%</span><b>{{ hud.awayScore }}</b> Them</span>
      </div>

      <p class="fc-coach" :class="prompt ? 'tone-' + prompt.tone : 'tone-none'" aria-live="polite">{{ prompt ? (touchUI ? forTouch(prompt.text) : prompt.text) : '\u00a0' }}</p>
      <div v-if="hints && !hints.done && screen === 'play'" class="fc-hint" role="region" aria-label="How to play" aria-live="polite">
        <div class="fc-hint-head">
          <span class="fc-hint-step">{{ hints.step + 1 }} of {{ HINT_STEPS.length }} · {{ HINT_STEPS[hints.step].title }}</span>
          <button class="fc-hint-x" aria-label="Dismiss hints" @click="skipHints">×</button>
        </div>
        <p>{{ hintText(HINT_STEPS[hints.step], touchUI) }}</p>
        <button class="fc-hint-skip" @click="skipHints">Skip the tutorial</button>
      </div>

      <div class="fc-stage" ref="stageEl">
        <!-- The renderer draws everything, guides included (CourtGuides.js);
             this div only takes input. -->
        <div
          ref="pixiEl"
          class="fc-pixi"
          tabindex="0"
          role="application"
          :aria-label="touchUI ? 'Court. Tap to move, tap a teammate to pass, tap the ball carrier to reach.' : 'Court. Right-click to move, left-click to pass or reach, Space to shoot, Q W E R for abilities.'"
          @contextmenu.prevent
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        ></div>

        <div
          v-if="me.hasBall && me.shot && hud.phase === 'live'"
          class="fc-shottag"
          :class="'is-' + me.shot.label"
          :style="tagStyle"
          aria-hidden="true"
        >{{ Math.round(me.shot.chance * 100) }}%<small>{{ me.shot.points }}PT{{ me.shot.stepback ? ' · step-back' : '' }}</small></div>

        <div class="fc-floaters" aria-hidden="true">
          <span v-for="f in floaters" :key="f.k" class="fc-float" :class="f.kind" :style="{ left: f.left, top: f.top, '--shift': f.shift }">{{ f.text }}</span>
        </div>

        <div v-if="hud.phase === 'break'" class="fc-banner">{{ banner }}</div>
        <div v-else-if="flash" class="fc-banner flash">{{ flash }}</div>
        <div v-if="paused && screen === 'play'" class="fc-banner">Paused. Press Esc to play.</div>
      </div>

      <div class="fc-bottom">
        <div class="fc-me">
          <div class="fc-me-name">{{ me.name }}<span v-if="me.hasBall" class="fc-tag">ball</span><span v-else-if="me.onDefense" class="fc-tag def">defense</span></div>
          <div class="fc-stamina" :aria-label="'Stamina ' + Math.round(me.stamina)">
            <span :style="{ width: me.stamina + '%' }"></span>
          </div>
          <div class="fc-shotline" v-if="me.hasBall && me.shot">{{ shotDetail }}</div>
          <div class="fc-shotline" v-else-if="me.onDefense && me.man">Your man: {{ me.man.name }}<template v-if="me.man.hasBall"> (has the ball)</template></div>
          <div class="fc-shotline" v-else>{{ me.open ? 'You are open' : 'Covered: move to get open' }}</div>
        </div>

        <div class="fc-abilities">
          <button
            v-for="s in SLOTS"
            :key="s"
            class="fc-ab"
            :class="{
              cooling: me.cooldowns[s] > 0,
              poor: me.stamina < (me.kit[s] ? me.kit[s].cost : 0),
              ready: readyPulse[s],
              active: activeFrac(s) > 0,
            }"
            :title="me.kit[s] ? me.kit[s].name + ': ' + me.kit[s].blurb : s"
            @click="castFromButton(s)"
          >
            <span class="fc-ab-sweep" :style="{ '--pct': cdPct(s) }"></span>
            <span v-if="activeFrac(s) > 0" class="fc-ab-active" :style="{ '--left': activeFrac(s) }"></span>
            <kbd>{{ s }}</kbd>
            <span class="fc-ab-name">{{ me.kit[s] ? me.kit[s].name : '' }}</span>
            <span v-if="me.cooldowns[s] > 0" class="fc-ab-cd">{{ Math.ceil(me.cooldowns[s]) }}</span>
          </button>
          <button class="fc-ab shoot" :class="me.shot ? 'is-' + me.shot.label : ''" :disabled="!me.hasBall" @click="send({ type: 'shoot' })">
            <kbd v-if="!touchUI">Space</kbd>
            <span class="fc-ab-name">Shoot</span>
            <span v-if="me.shot" class="fc-ab-pct">{{ Math.round(me.shot.chance * 100) }}%</span>
          </button>
        </div>

        <ol class="fc-ticker" aria-live="polite">
          <li v-for="t in ticker" :key="t.k" :class="t.kind">{{ t.text }}</li>
        </ol>
      </div>
    </div>

    <!-- 3. Final -->
    <div v-if="screen === 'final'" class="fc-final" role="dialog" aria-labelledby="fc-final-title">
      <div class="fc-final-card">
        <p class="fc-kicker">{{ won ? 'Win' : 'Loss' }}</p>
        <h2 id="fc-final-title" class="fc-title">{{ hud.homeScore }} to {{ hud.awayScore }}</h2>
        <div class="fc-box-wrap" v-for="side in ['home', 'away']" :key="side">
          <h3>{{ side === 'home' ? 'Your team' : 'Them' }}</h3>
          <table class="fc-box">
            <thead><tr><th scope="col">Player</th><th>PTS</th><th>FG</th><th>AST</th><th>REB</th><th>STL</th><th>TO</th></tr></thead>
            <tbody>
              <tr v-for="r in box[side]" :key="r.id" :class="{ me: r.isHuman }">
                <th scope="row">{{ r.name }}</th><td>{{ r.pts }}</td><td>{{ r.fgm }}-{{ r.fga }}</td><td>{{ r.ast }}</td><td>{{ r.reb }}</td><td>{{ r.stl }}</td><td>{{ r.to }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="fc-final-actions">
          <button class="fc-go" data-sfx="none" @click="tipOff">Run it back</button>
          <button class="fc-btn" @click="toPick">Pick another player</button>
          <button class="fc-btn" @click="$emit('exit')">Open Gym</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { CourtRenderer } from '../rendering/CourtRenderer.js';
import { sfx } from '../audio/sfx.js';
import { buildKit, SIGNATURES, signatureStat, SLOTS } from '../moba/kits.js';
import { createMatch, boxScore, COURT_W, COURT_H } from '../moba/match.js';
import { HINT_STEPS, startHints, advanceHints, hintsSeen, markHintsSeen, hintText, controlsLine, forTouch } from '../moba/onboarding.js';

defineEmits(['exit']);

const STAT_KEYS = ['shooting', 'speed', 'defense'];

const screen = ref('pick');
const roster = ref([]);
const loadError = ref('');
const picked = ref(null);
const pickedKit = computed(() => (picked.value ? buildKit(picked.value) : null));
const sigName = (p) => SIGNATURES[signatureStat(p)].name;

const stageEl = ref(null);
const pixiEl = ref(null);
const readyPulse = ref({ Q: false, W: false, E: false, R: false });
const pulseTimers = {};

const emptyHud = () => ({ homeScore: 0, awayScore: 0, clock: 0, shotClock: 14, quarter: 1, quarters: 4, phase: 'live', clutch: false, shotClockOff: false, rally: null });
const hud = ref(emptyHud());
const me = ref({ name: '', stamina: 100, cooldowns: { Q: 0, W: 0, E: 0, R: 0 }, kit: {}, hasBall: false, onDefense: false });
const ticker = ref([]);
const banner = ref('');
const paused = ref(false);
const box = ref({ home: [], away: [] });
const won = ref(false);
const prompt = ref(null);
const floaters = ref([]);
const flash = ref('');
const hints = ref(null);
const humanAt = ref({ x: COURT_W / 2, y: COURT_H / 2 });
// Touch copy and touch aiming: on for a coarse pointer (a phone), and
// switched by whichever input was used last (a tablet with a mouse).
const touchUI = ref(false);
let coarseQuery = null;
const onCoarseChange = (e) => { touchUI.value = e.matches; };
let floatKey = 0;
let flashTimer = 0;

// localStorage can throw (private windows, blocked site data): never let it.
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const rallyTitle = computed(() => {
  const r = hud.value.rally;
  return r ? `Rally rule: a team down ${r.deficit} or more shoots ${Math.round(r.bonus * 100)}% better until it gets back within ${r.deficit - 1}` : '';
});

const pctOf = (v) => `${Math.round(v * 100)}%`;
const shotDetail = computed(() => {
  const b = me.value.shot;
  if (!b) return '';
  const parts = [`${pctOf(b.chance)} for ${b.points}`];
  if (b.wall) parts.push(`in ${b.wall}'s Wall`);
  else if (b.contestBy && b.contest >= 0.1) parts.push(`${b.locked ? 'closed out' : 'contested'} by ${b.contestBy}`);
  else parts.push('open');
  if (b.stepback) parts.push('step-back');
  if (b.zone === 'deep') parts.push('deep');
  if (b.rally) parts.push('rally');
  return parts.join(' · ');
});

// The shot tag rides just above your player, in court percentages so it
// scales with the stage and stays readable at phone width.
const tagStyle = computed(() => ({ left: `${(humanAt.value.x / COURT_W) * 100}%`, top: `${(humanAt.value.y / COURT_H) * 100}%` }));

let match = null;
let renderer = null;
let raf = 0;
let last = 0;
let cursor = { x: COURT_W / 2, y: COURT_H / 2 };
let rightDown = false;
let lastView = null;
let tickerKey = 0;
let seed = 1;

onMounted(async () => {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'engine_roster.json');
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    roster.value = list.filter((p) => p.is_active !== false).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
    picked.value = roster.value[0] || null;
  } catch {
    loadError.value = 'The roster did not load. Reload the page to try again.';
  }
  window.addEventListener('keydown', onKey);
  try {
    coarseQuery = window.matchMedia('(pointer: coarse)');
    touchUI.value = coarseQuery.matches;
    coarseQuery.addEventListener('change', onCoarseChange);
  } catch {
    coarseQuery = null;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  if (coarseQuery) coarseQuery.removeEventListener('change', onCoarseChange);
  clearTimeout(flashTimer);
  stopLoop();
  if (renderer) renderer.destroy();
  renderer = null;
});

const periodLabel = computed(() => {
  const q = hud.value.quarter;
  return q > hud.value.quarters ? 'OT' : `Q${q}`;
});

const fmtClock = (s) => {
  const t = Math.max(0, s);
  return t >= 10 ? String(Math.ceil(t)) : t.toFixed(1);
};

// How much of an ability's effect is left (0..1), for the HUD's "active" bar.
const TIMED = new Set(['burst', 'stepback', 'limitless', 'fastbreak', 'wall']);
const activeFrac = (s) => {
  const k = me.value.kit && me.value.kit[s];
  const live = me.value.live;
  if (!k || !live || !TIMED.has(k.id)) return 0;
  const total = k.id === 'stepback' ? k.window + 0.18 : k.duration;
  return Math.min(1, (live[k.id] || 0) / total);
};

const cdPct = (s) => {
  const k = me.value.kit[s];
  if (!k || !me.value.cooldowns[s]) return 0;
  return Math.round((me.value.cooldowns[s] / k.cooldown) * 100);
};

async function tipOff() {
  if (!picked.value) return;
  sfx.unlock();
  seed = (Date.now() & 0xffff) || 1;
  const teach = !hintsSeen(storage());
  // Dev builds only: end-to-end tests can shorten quarters (window.__fullCourtTest).
  const testOpts = (import.meta.env.DEV && window.__fullCourtTest) || {};
  const quarterLength = Number(testOpts.quarterLength) > 0 ? { quarterLength: Number(testOpts.quarterLength) } : {};
  match = createMatch({ roster: roster.value, humanId: picked.value.id, seed, tutorial: teach, ...quarterLength });
  hints.value = teach ? startHints() : null;
  floaters.value = [];
  flash.value = '';
  ticker.value = [];
  paused.value = false;
  screen.value = 'play';
  await nextTick();
  if (!renderer) {
    renderer = new CourtRenderer(pixiEl.value, { width: COURT_W, height: COURT_H });
    await renderer.ready;
  }
  sfx.play('whistle');
  pixiEl.value && pixiEl.value.focus();
  touchAim = null;
  steering = null;
  if (import.meta.env.DEV) window.__fullCourt = match; // dev only: screenshot and e2e scripts read state
  startLoop();
}

function toPick() {
  stopLoop();
  screen.value = 'pick';
}

function startLoop() {
  stopLoop();
  last = performance.now();
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused.value) match.step(dt);
    const v = match.view();
    lastView = v;
    renderer && renderer.render({ ...v, cursor: aimPoint(), overlay: { ...v.overlay, passLanes: v.hud.passLanes || [] } });
    syncHud(v);
    for (const e of match.drainEvents()) onEvent(e);
    if (v.hud.phase === 'final') return finish();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function finish() {
  stopLoop();
  box.value = boxScore(match);
  won.value = box.value.score.home > box.value.score.away;
  sfx.play('horn');
  sfx.play(won.value ? 'win' : 'loss');
  screen.value = 'final';
}

function syncHud(v) {
  const h = v.hud;
  hud.value = {
    homeScore: v.homeScore, awayScore: v.awayScore, clock: h.clock, shotClock: h.shotClock, quarter: h.quarter, quarters: h.quarters,
    phase: h.phase, clutch: !!h.clutch, shotClockOff: !!h.shotClockOff, rally: h.rally || null,
  };
  const prev = me.value.cooldowns || {};
  // Every live effect on you, signature ones included (client/moba/anim.js).
  const mine = v.players.find((p) => p.isHuman);
  me.value = { ...h.human, live: mine && mine.anim ? mine.anim.buffs : {} };
  // Ready pulse: a key lights up the moment its cooldown runs out.
  for (const s of SLOTS) {
    if (prev[s] > 0 && h.human.cooldowns[s] === 0) {
      readyPulse.value = { ...readyPulse.value, [s]: true };
      clearTimeout(pulseTimers[s]);
      pulseTimers[s] = setTimeout(() => { readyPulse.value = { ...readyPulse.value, [s]: false }; }, 900);
    }
  }
  prompt.value = h.prompt || null;
  humanAt.value = v.overlay.human;
  if (h.human.hasBall) hint({ type: 'hasBall' });
  const now = performance.now();
  if (floaters.value.length && floaters.value[0].until < now) floaters.value = floaters.value.filter((f) => f.until > now);
}

// --- Hints and callouts --------------------------------------------------------

function hint(signal) {
  if (!hints.value || hints.value.done) return;
  const next = advanceHints(hints.value, signal);
  if (next === hints.value) return;
  hints.value = next;
  if (next.done) markHintsSeen(storage());
}

function skipHints() {
  hint({ type: 'skip' });
  pixiEl.value && pixiEl.value.focus();
}

function float(at, text, kind) {
  if (!at) return;
  // Keep the label on the court: it slides from left-aligned at the left
  // edge to right-aligned at the right (translateX(-x%)). Stack it above any
  // live callout close by so two reasons never print on each other.
  const x = Math.min(100, Math.max(0, (at.x / COURT_W) * 100));
  const y = Math.max(12, (at.y / COURT_H) * 100);
  const now = performance.now();
  const live = floaters.value.filter((f) => f.until > now);
  const near = live.filter((f) => Math.abs(f.x - x) < 30 && Math.abs(f.y - y) < 12).length;
  const f = { k: ++floatKey, text, kind, x, y, left: `${x}%`, top: `calc(${y}% - ${near * 1.7}em)`, shift: `-${x}%`, until: now + 2000 };
  floaters.value = [...live.slice(-3), f];
}

function showFlash(text, ms = 1600) {
  flash.value = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.value = ''; }, ms);
}

// Every outcome explains itself where it happened on the court.
function callout(e) {
  const mine = e.playerId === me.value.id || e.victimId === me.value.id || e.byId === me.value.id;
  const side = e.team === 'home' ? 'us' : 'them';
  const kind = `${side}${mine ? ' mine' : ''}`;
  switch (e.type) {
    case 'make': return float(e.at, `+${e.points} · ${e.reason}`, kind);
    case 'miss': return float(e.at, `Miss · ${e.reason}`, kind);
    case 'steal': return float(e.at, `${e.kind === 'interception' ? 'Picked off' : 'Stolen'} · ${e.reason}`, kind);
    case 'stepback': return float(e.at, `Step-back ${pctOf(e.before)} → ${pctOf(e.after)}`, kind);
    case 'lock': return float(e.at, `Closeout ${pctOf(e.before)} → ${pctOf(e.after)}`, kind);
    case 'deny': return float(e.at, 'Denied: no passes', kind);
    case 'whiff': return float(e.at, 'Closeout fell short', kind);
    case 'reach': return float(e.at, e.text.replace(/^Reached in on [^,]+, /, 'Reach: '), kind);
    case 'turnover': return float(e.at, `Shot clock · ${e.reason}`, kind);
    default: return undefined;
  }
}

function onEvent(e) {
  if (renderer && (e.type === 'make' || e.type === 'miss' || e.type === 'steal')) renderer.fx(e);
  callout(e);
  if (e.type === 'shot' && e.playerId === me.value.id) hint({ type: 'shot' });
  if (e.type === 'cast' && e.playerId === me.value.id) hint({ type: 'cast', slot: e.slot });
  if (e.type === 'clutch') showFlash(e.text);
  if (e.type === 'make' && e.buzzer) showFlash(`${e.text.split(' (')[0]}!`, 2200);
  if (e.type === 'make' || e.type === 'miss' || e.type === 'steal') sfx.forEvent(e);
  if (e.type === 'period') {
    banner.value = e.text;
    sfx.play('horn');
  }
  if (e.type === 'cast' && e.playerId === me.value.id) sfx.play('squeak');
  if (!e.text || e.type === 'shot') return;
  const kind = e.type === 'denied' ? 'denied' : e.team === 'home' ? 'us' : e.team === 'away' ? 'them' : '';
  ticker.value = [{ k: ++tickerKey, text: e.text, kind }, ...ticker.value].slice(0, 4);
}

// --- Input ------------------------------------------------------------------

function toCourt(ev) {
  const r = pixiEl.value.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * COURT_W, y: ((ev.clientY - r.top) / r.height) * COURT_H };
}

function send(cmd) {
  if (!match || screen.value !== 'play' || paused.value) return;
  if (cmd.type === 'move') hint({ type: 'move' });
  match.command(cmd);
}

// Mouse: right-click (held) moves, left-click passes, calls or reaches, and
// abilities aim at the cursor. Touch and pen: one tap does what the click
// would, snapped to the nearest player within TAP_SNAP so a fingertip finds
// him; a tap on open floor moves, and a held finger keeps steering. With no
// cursor, abilities aim where you last tapped (aimPoint()).
const TAP_SNAP = 28; // court px
let steering = null; // pointerId of the finger steering the player
let touchAim = null; // { id } a player tapped, or { dx, dy } the way you last moved

const isTouch = (ev) => ev.pointerType === 'touch' || ev.pointerType === 'pen';
const centerOf = (p) => ({ x: p.x + 15, y: p.y + 15 }); // view() positions are top-left

function humanPos() {
  const me = lastView && lastView.players.find((p) => p.isHuman);
  return me ? centerOf(me) : humanAt.value;
}

/** The nearest player other than you within TAP_SNAP of `at`, from the last frame drawn. */
function snapTarget(at) {
  if (!lastView) return null;
  let best = null;
  for (const p of [...lastView.players, ...lastView.bots]) {
    if (p.isHuman) continue;
    const c = centerOf(p);
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d <= TAP_SNAP && (!best || d < best.d)) best = { id: p.id, ...c, d };
  }
  return best;
}

/** Where an ability aims: the cursor on a mouse; the last tap on touch. */
function aimPoint() {
  if (!touchUI.value || !touchAim) return cursor;
  if (touchAim.id != null && lastView) {
    const p = [...lastView.players, ...lastView.bots].find((q) => q.id === touchAim.id);
    if (p) return centerOf(p);
  }
  const len = Math.hypot(touchAim.dx || 0, touchAim.dy || 0);
  if (!len) return cursor;
  const me = humanPos();
  const reach = 120; // past any dash's range, so the full dash is used
  return { x: me.x + (touchAim.dx / len) * reach, y: me.y + (touchAim.dy / len) * reach };
}

function onTouchDown(ev) {
  const at = cursor;
  const snap = snapTarget(at);
  if (snap) {
    // A teammate: pass to him, or call for it. The carrier on defense:
    // reach. Anyone else: run to him (match.js treats it as a move).
    touchAim = { id: snap.id };
    send({ type: 'click', x: snap.x, y: snap.y });
    return;
  }
  const me = humanPos();
  touchAim = { dx: at.x - me.x, dy: at.y - me.y };
  steering = ev.pointerId;
  try { pixiEl.value.setPointerCapture(ev.pointerId); } catch { /* the pointer already left */ }
  send({ type: 'move', ...at });
}

function onPointerDown(ev) {
  sfx.unlock();
  cursor = toCourt(ev);
  if (isTouch(ev)) {
    touchUI.value = true;
    ev.preventDefault();
    onTouchDown(ev);
    return;
  }
  if (ev.pointerType === 'mouse') touchUI.value = false;
  if (ev.button === 2) {
    rightDown = true;
    pixiEl.value.setPointerCapture(ev.pointerId);
    send({ type: 'move', ...cursor });
  } else if (ev.button === 0) {
    send({ type: 'click', ...cursor });
  }
}

function onPointerMove(ev) {
  if (isTouch(ev)) {
    if (steering !== ev.pointerId) return;
    cursor = toCourt(ev);
    const me = humanPos();
    touchAim = { dx: cursor.x - me.x, dy: cursor.y - me.y };
    send({ type: 'move', ...cursor });
    return;
  }
  cursor = toCourt(ev);
  if (rightDown && (ev.buttons & 2)) send({ type: 'move', ...cursor });
}

function onPointerUp(ev) {
  if (isTouch(ev)) {
    if (steering === ev.pointerId) steering = null;
    return;
  }
  if (ev.button === 2) rightDown = false;
}

function onKey(ev) {
  if (screen.value !== 'play') return;
  if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape') { paused.value = !paused.value; ev.preventDefault(); return; }
  if (k === ' ') { send({ type: 'shoot' }); ev.preventDefault(); return; }
  if (k === 's') { send({ type: 'stop' }); return; }
  const slot = k.toUpperCase();
  if (SLOTS.includes(slot) && !ev.repeat) {
    send({ type: 'cast', slot, ...aimPoint() });
    ev.preventDefault();
  }
}

function castFromButton(slot) {
  sfx.unlock();
  send({ type: 'cast', slot, ...aimPoint() });
}

</script>

<style scoped>
.fc { position: relative; color: #e9e3d6; }
.fc-kicker { margin: 0; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.28em; text-transform: uppercase; color: #f2b45f; }
.fc-title { margin: 6px 0 4px; font-size: clamp(1.6rem, 4vw, 2.3rem); font-weight: 900; color: #fff; line-height: 1.05; }
.fc-line { margin: 0; color: #c9c3b6; max-width: 60ch; }
.fc-error { color: #ff9b8a; }

.fc-btn, .fc-go {
  border-radius: 999px; font-weight: 800; cursor: pointer; padding: 9px 18px; font-size: 0.95rem;
  border: 2px solid #3a4352; background: #182437; color: #e9e3d6;
}
.fc-btn:hover, .fc-btn:focus-visible { border-color: #f2b45f; outline: none; }
.fc-go { background: #d9773a; border-color: #d9773a; color: #101b2b; }
.fc-go:hover, .fc-go:focus-visible { background: #f2b45f; border-color: #f2b45f; outline: none; }

/* Pick */
.fc-pick { display: grid; gap: 18px; }
.fc-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.fc-pick-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; align-items: start; }
@media (max-width: 820px) { .fc-pick-body { grid-template-columns: 1fr; } }
.fc-roster { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.fc-card {
  width: 100%; text-align: left; display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px;
  background: #142033; border: 1.5px solid #2c3a52; color: inherit; cursor: pointer; font: inherit;
}
.fc-card:hover, .fc-card:focus-visible { border-color: #8f9cb3; outline: none; }
.fc-card.on { border-color: #f2b45f; background: #1d2a40; }
.fc-card-name { font-weight: 800; color: #fff; }
.fc-card-meta { font-size: 0.8rem; color: #a9b2c2; }
.fc-bars { display: grid; gap: 3px; margin-top: 4px; }
.fc-bar { display: grid; grid-template-columns: 30px 1fr 24px; gap: 6px; align-items: center; font-size: 0.72rem; color: #a9b2c2; text-transform: uppercase; }
.fc-bar-track { height: 5px; background: #0d1626; border-radius: 3px; overflow: hidden; }
.fc-bar-fill { display: block; height: 100%; background: #d9773a; }
.fc-bar-num { text-align: right; font-variant-numeric: tabular-nums; color: #e9e3d6; }

.fc-kit { position: sticky; top: 12px; background: #142033; border: 1.5px solid #2c3a52; border-radius: 12px; padding: 16px; display: grid; gap: 12px; }
.fc-kit h3 { margin: 0; color: #fff; font-size: 1.2rem; }
.fc-kit-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.fc-kit-list li { display: grid; grid-template-columns: 30px 1fr; gap: 10px; align-items: start; }
.fc-kit-list strong { display: block; color: #fff; }
.fc-kit-blurb { display: block; font-size: 0.85rem; color: #c9c3b6; }
.fc-kit-nums { display: block; font-size: 0.75rem; color: #8f9cb3; font-variant-numeric: tabular-nums; margin-top: 2px; }
.fc-controls { margin: 0; font-size: 0.8rem; color: #a9b2c2; line-height: 1.5; }
kbd {
  display: inline-grid; place-items: center; min-width: 26px; height: 26px; padding: 0 6px; border-radius: 6px;
  background: #0d1626; border: 1px solid #3a4352; border-bottom-width: 3px; font: 800 0.8rem/1 ui-monospace, Menlo, monospace; color: #f2b45f;
}

/* Play */
.fc-play { display: grid; gap: 10px; }
.fc-score {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;
  background: #142033; border: 1.5px solid #2c3a52; border-radius: 10px; padding: 8px 14px; font-variant-numeric: tabular-nums;
}
.fc-team { font-weight: 800; font-size: 1rem; }
.fc-team b { font-size: 1.6rem; color: #fff; margin: 0 6px; }
.fc-team.home { color: #ef8a86; }
.fc-team.away { color: #9ddcee; text-align: right; }
.fc-clock { display: flex; gap: 10px; align-items: baseline; font-weight: 700; color: #c9c3b6; }
.fc-clock b { font-size: 1.3rem; color: #fff; }
.fc-shot { min-width: 28px; text-align: center; border-radius: 6px; background: #0d1626; color: #f2b45f; padding: 2px 6px; }
.fc-shot.low { color: #ff7a5c; }

.fc-stage { position: relative; width: 100%; max-width: 960px; margin: 0 auto; aspect-ratio: 2 / 1; }
.fc-pixi { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; border-radius: 6px; }
.fc-pixi :deep(canvas) { width: 100% !important; height: 100% !important; }
.fc-pixi:focus { outline: none; }
.fc-pixi:focus-visible { outline: 2px solid #f2b45f; outline-offset: 2px; }
.fc-banner {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); pointer-events: none;
  background: rgba(13, 22, 38, 0.88); border: 1.5px solid #f2b45f; color: #fff; font-weight: 900;
  padding: 10px 18px; border-radius: 10px; font-size: 1.05rem; white-space: nowrap;
}

.fc-bottom { display: grid; grid-template-columns: 220px minmax(0, 1fr) 260px; gap: 12px; align-items: stretch; }
@media (max-width: 900px) { .fc-bottom { grid-template-columns: 1fr; } }
.fc-me, .fc-ticker { background: #142033; border: 1.5px solid #2c3a52; border-radius: 10px; padding: 10px 12px; }
.fc-me { display: grid; gap: 6px; align-content: start; }
.fc-me-name { font-weight: 800; color: #fff; display: flex; gap: 8px; align-items: center; }
.fc-tag { font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; background: #d9773a; color: #101b2b; padding: 2px 6px; border-radius: 4px; }
.fc-tag.def { background: #5b8fd9; }
.fc-stamina { height: 8px; background: #0d1626; border-radius: 4px; overflow: hidden; }
.fc-stamina span { display: block; height: 100%; background: linear-gradient(90deg, #3f9c6a, #8cd6a4); }
.fc-shotline { font-size: 0.82rem; color: #c9c3b6; }

.fc-abilities { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.fc-ab {
  position: relative; overflow: hidden; display: grid; justify-items: center; align-content: center; gap: 4px;
  min-height: 74px; padding: 8px 4px; border-radius: 10px; background: #182437; border: 1.5px solid #3a4352;
  color: #e9e3d6; cursor: pointer; font: inherit;
  touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
.fc-ab:hover, .fc-ab:focus-visible { border-color: #f2b45f; outline: none; }
.fc-ab.poor { opacity: 0.6; }
.fc-ab.shoot:disabled { opacity: 0.4; cursor: default; }
.fc-ab-name { position: relative; font-size: 0.75rem; font-weight: 700; text-align: center; line-height: 1.15; }
.fc-ab kbd { position: relative; }
.fc-ab-sweep {
  position: absolute; inset: 0; pointer-events: none;
  background: conic-gradient(rgba(13, 22, 38, 0.78) calc(var(--pct) * 1%), transparent 0);
}
/* Active: the effect is running; the bar drains with it. */
.fc-ab.active { border-color: #f2b45f; box-shadow: inset 0 0 0 1px #f2b45f, 0 0 14px rgba(242, 180, 95, 0.35); }
.fc-ab-active {
  position: absolute; left: 0; bottom: 0; height: 4px; width: calc(var(--left) * 100%);
  background: linear-gradient(90deg, #f2b45f, #ffe1a1); pointer-events: none;
}
/* Ready: a key lights up the moment its cooldown runs out. */
.fc-ab.ready { animation: fc-ready 0.9s ease-out; border-color: #8ce6a0; }
.fc-ab.ready kbd { color: #8ce6a0; border-color: #8ce6a0; }
@keyframes fc-ready {
  0% { box-shadow: 0 0 0 0 rgba(140, 230, 160, 0.85); transform: scale(1); }
  25% { transform: scale(1.06); }
  100% { box-shadow: 0 0 0 14px rgba(140, 230, 160, 0); transform: scale(1); }
}
.fc-ab-cd { position: absolute; top: 6px; right: 8px; font-weight: 900; color: #fff; font-variant-numeric: tabular-nums; }

.fc-ticker { list-style: none; margin: 0; display: grid; gap: 4px; align-content: start; font-size: 0.82rem; min-height: 74px; }
.fc-ticker li { color: #c9c3b6; }
.fc-ticker li:first-child { color: #fff; font-weight: 700; }
.fc-ticker li.us { border-left: 3px solid #ef8a86; padding-left: 6px; }
.fc-ticker li.them { border-left: 3px solid #9ddcee; padding-left: 6px; }
.fc-ticker li.denied { color: #ffb199; }

/* Final */
.fc-final {
  position: fixed; inset: 0; z-index: 30; display: grid; place-items: start center; overflow: auto;
  padding: max(24px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 24px max(12px, env(safe-area-inset-left, 0px));
  background: rgba(8, 13, 22, 0.78);
}
.fc-final-card { width: min(640px, 100%); background: #142033; border: 1.5px solid #f2b45f; border-radius: 14px; padding: 20px; display: grid; gap: 14px; }
.fc-box-wrap { overflow-x: auto; }
.fc-box-wrap h3 { margin: 0 0 6px; font-size: 0.9rem; color: #a9b2c2; text-transform: uppercase; letter-spacing: 0.12em; }
.fc-box { width: 100%; min-width: 420px; table-layout: fixed; border-collapse: collapse; font-size: 0.88rem; font-variant-numeric: tabular-nums; }
.fc-box thead th:first-child { width: 40%; }
.fc-box td { white-space: nowrap; }
.fc-box th, .fc-box td { padding: 5px 8px; text-align: right; border-bottom: 1px solid #2c3a52; }
.fc-box th[scope='row'], .fc-box thead th:first-child { text-align: left; }
.fc-box thead th { color: #8f9cb3; font-weight: 700; }
.fc-box tr.me th, .fc-box tr.me td { color: #f2b45f; font-weight: 800; }
.fc-final-actions { display: flex; flex-wrap: wrap; gap: 10px; }

/* What to do now: one line above the court, coloured by urgency. */
.fc-coach {
  margin: 0; min-height: 1.5em; padding: 6px 12px; border-radius: 8px; font-weight: 800; font-size: 0.95rem;
  background: #142033; border: 1.5px solid #2c3a52; color: #e9e3d6; text-align: center;
}
.fc-coach.tone-good { border-color: #3f9c6a; color: #b8f0c9; }
.fc-coach.tone-warn { border-color: #d9a43a; color: #ffe0a3; }
.fc-coach.tone-urgent { border-color: #ff7a5c; color: #ffd0c4; background: #2a1a1f; }
.fc-coach.tone-none { visibility: hidden; }

.fc-score.clutch { border-color: #ff7a5c; }
.fc-clock b.hot { color: #ff9b7f; }
.fc-shot.low { background: #3a1a17; animation: fc-pulse 0.8s ease-in-out infinite; }
.fc-shot.off { color: #6f7a8f; }
.fc-rally {
  display: inline-block; margin: 0 6px; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; letter-spacing: 0.08em;
  text-transform: uppercase; background: #3a2c12; color: #f2c46f; border: 1px solid #8a6a2a; vertical-align: middle; cursor: help;
}
@keyframes fc-pulse { 50% { color: #fff; } }

/* Make chance over your player, coloured by the contest. */
.fc-shottag {
  position: absolute; transform: translate(-50%, calc(-100% - 22px)); pointer-events: none; z-index: 2;
  padding: 2px 7px; border-radius: 6px; font: 900 0.95rem/1.15 ui-sans-serif, system-ui, sans-serif; color: #101b2b;
  white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45); font-variant-numeric: tabular-nums;
}
.fc-shottag small { margin-left: 5px; font-size: 0.68rem; font-weight: 800; opacity: 0.8; }
.fc-shottag.is-open { background: #8cd6a4; }
.fc-shottag.is-contested { background: #f2c46f; }
.fc-shottag.is-smothered { background: #ff9b7f; }
.fc-ab.shoot.is-open { border-color: #3f9c6a; }
.fc-ab.shoot.is-contested { border-color: #d9a43a; }
.fc-ab.shoot.is-smothered { border-color: #ff7a5c; }
.fc-ab-pct { position: relative; font-weight: 900; font-size: 0.95rem; color: #fff; font-variant-numeric: tabular-nums; }
.fc-ab.shoot.is-open .fc-ab-pct { color: #b8f0c9; }
.fc-ab.shoot.is-contested .fc-ab-pct { color: #ffe0a3; }
.fc-ab.shoot.is-smothered .fc-ab-pct { color: #ffc0b0; }

/* Callouts: the reason, where it happened. */
.fc-floaters { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2; }
.fc-float {
  position: absolute; transform: translate(var(--shift, -50%), -150%); white-space: nowrap; padding: 2px 8px; border-radius: 6px;
  font-weight: 800; font-size: 0.8rem; background: rgba(13, 22, 38, 0.86); color: #e9e3d6; border: 1px solid #3a4352;
  animation: fc-rise 2s ease-out forwards; max-width: 96%; overflow: hidden; text-overflow: ellipsis;
}
.fc-float.us { border-color: #ef8a86; }
.fc-float.them { border-color: #9ddcee; }
.fc-float.mine { font-size: 0.9rem; color: #fff; border-width: 2px; }
@keyframes fc-rise { 0% { opacity: 0; margin-top: 6px; } 12% { opacity: 1; margin-top: 0; } 80% { opacity: 1; } 100% { opacity: 0; margin-top: -14px; } }

/* First-possession hints: a strip above the court, so they never cover it. */
.fc-hint {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: center;
  background: #1d2a40; border: 1.5px solid #f2b45f; border-radius: 10px; padding: 8px 12px; color: #e9e3d6;
}
.fc-hint p { grid-column: 1; }
.fc-hint-skip { grid-column: 2; grid-row: 2; justify-self: end; }
.fc-hint p { margin: 0; font-size: 0.92rem; line-height: 1.35; }
.fc-hint-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.fc-hint-step { font-size: 0.72rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #f2b45f; }
.fc-hint-x { background: none; border: 0; color: #c9c3b6; font-size: 1.3rem; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
.fc-hint-x:hover, .fc-hint-x:focus-visible { color: #fff; outline: 2px solid #f2b45f; }
.fc-hint-skip { background: none; border: 0; padding: 0; color: #a9b2c2; font: inherit; font-size: 0.8rem; text-decoration: underline; cursor: pointer; }
.fc-hint-skip:hover, .fc-hint-skip:focus-visible { color: #fff; outline: none; }
.fc-banner.flash { top: 18%; border-color: #ff7a5c; }

@media (max-width: 600px) {
  .fc-hint { padding: 6px 10px; }
  .fc-hint p { font-size: 0.82rem; }
  .fc-float { font-size: 0.7rem; padding: 1px 6px; }
  .fc-float.mine { font-size: 0.76rem; }
  .fc-shottag { font-size: 0.8rem; transform: translate(-50%, calc(-100% - 12px)); }
  .fc-coach { font-size: 0.85rem; }
}

@media (prefers-reduced-motion: reduce) {
  .fc-ab-sweep { transition: none; }
  .fc-float { animation: fc-fade 2s linear forwards; }
  .fc-shot.low { animation: none; }
  /* No pulse or scale: the green border and key still say "ready". */
  .fc-ab.ready { animation: none; box-shadow: inset 0 0 0 1px #8ce6a0; }
}
@keyframes fc-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
</style>
