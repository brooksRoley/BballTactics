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
          <p class="fc-controls">Right-click to move · Space to shoot · Left-click a teammate to pass, the ball carrier to reach · Q W E R aim at the cursor · Esc pauses</p>
        </aside>
      </div>
    </div>

    <!-- 2. Play -->
    <div v-show="screen === 'play' || screen === 'final'" class="fc-play">
      <div class="fc-score" role="status">
        <span class="fc-team home">You <b>{{ hud.homeScore }}</b></span>
        <span class="fc-clock">
          <span>{{ periodLabel }}</span>
          <b>{{ fmtClock(hud.clock) }}</b>
          <span class="fc-shot" :class="{ low: hud.shotClock < 4 }">{{ Math.ceil(hud.shotClock) }}</span>
        </span>
        <span class="fc-team away"><b>{{ hud.awayScore }}</b> Them</span>
      </div>

      <div class="fc-stage" ref="stageEl">
        <div ref="pixiEl" class="fc-pixi"></div>
        <canvas
          ref="overlayEl"
          class="fc-overlay"
          width="800"
          height="400"
          tabindex="0"
          aria-label="Court. Right-click to move, left-click to pass or reach, Space to shoot, Q W E R for abilities."
          @contextmenu.prevent
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
        ></canvas>

        <div v-if="hud.phase === 'break'" class="fc-banner">{{ banner }}</div>
        <div v-if="paused && screen === 'play'" class="fc-banner">Paused. Press Esc to play.</div>
      </div>

      <div class="fc-bottom">
        <div class="fc-me">
          <div class="fc-me-name">{{ me.name }}<span v-if="me.hasBall" class="fc-tag">ball</span><span v-else-if="me.onDefense" class="fc-tag def">defense</span></div>
          <div class="fc-stamina" :aria-label="'Stamina ' + Math.round(me.stamina)">
            <span :style="{ width: me.stamina + '%' }"></span>
          </div>
          <div class="fc-shotline" v-if="me.hasBall">Space: {{ Math.round((me.shotChance || 0) * 100) }}% for {{ me.shotPoints }}</div>
          <div class="fc-shotline" v-else-if="me.onDefense">Guard your man: the dashed line</div>
          <div class="fc-shotline" v-else>Get open; left-click the carrier to call for it</div>
        </div>

        <div class="fc-abilities">
          <button
            v-for="s in SLOTS"
            :key="s"
            class="fc-ab"
            :class="{ cooling: me.cooldowns[s] > 0, poor: me.stamina < (me.kit[s] ? me.kit[s].cost : 0) }"
            :title="me.kit[s] ? me.kit[s].name + ': ' + me.kit[s].blurb : s"
            @click="castFromButton(s)"
          >
            <span class="fc-ab-sweep" :style="{ '--pct': cdPct(s) }"></span>
            <kbd>{{ s }}</kbd>
            <span class="fc-ab-name">{{ me.kit[s] ? me.kit[s].name : '' }}</span>
            <span v-if="me.cooldowns[s] > 0" class="fc-ab-cd">{{ Math.ceil(me.cooldowns[s]) }}</span>
          </button>
          <button class="fc-ab shoot" :disabled="!me.hasBall" @click="send({ type: 'shoot' })"><kbd>Space</kbd><span class="fc-ab-name">Shoot</span></button>
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
const overlayEl = ref(null);

const emptyHud = () => ({ homeScore: 0, awayScore: 0, clock: 0, shotClock: 14, quarter: 1, quarters: 4, phase: 'live' });
const hud = ref(emptyHud());
const me = ref({ name: '', stamina: 100, cooldowns: { Q: 0, W: 0, E: 0, R: 0 }, kit: {}, hasBall: false, onDefense: false });
const ticker = ref([]);
const banner = ref('');
const paused = ref(false);
const box = ref({ home: [], away: [] });
const won = ref(false);

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
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
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

const cdPct = (s) => {
  const k = me.value.kit[s];
  if (!k || !me.value.cooldowns[s]) return 0;
  return Math.round((me.value.cooldowns[s] / k.cooldown) * 100);
};

async function tipOff() {
  if (!picked.value) return;
  sfx.unlock();
  seed = (Date.now() & 0xffff) || 1;
  match = createMatch({ roster: roster.value, humanId: picked.value.id, seed });
  ticker.value = [];
  paused.value = false;
  screen.value = 'play';
  await nextTick();
  if (!renderer) {
    renderer = new CourtRenderer(pixiEl.value, { width: COURT_W, height: COURT_H });
    await renderer.ready;
  }
  sfx.play('whistle');
  overlayEl.value && overlayEl.value.focus();
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
    renderer && renderer.render(v);
    drawOverlay(v);
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
  hud.value = { homeScore: v.homeScore, awayScore: v.awayScore, clock: h.clock, shotClock: h.shotClock, quarter: h.quarter, quarters: h.quarters, phase: h.phase };
  me.value = h.human;
}

function onEvent(e) {
  if (renderer && (e.type === 'make' || e.type === 'miss' || e.type === 'steal')) renderer.fx(e);
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
  const r = overlayEl.value.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * COURT_W, y: ((ev.clientY - r.top) / r.height) * COURT_H };
}

function send(cmd) {
  if (!match || screen.value !== 'play' || paused.value) return;
  match.command(cmd);
}

function onPointerDown(ev) {
  sfx.unlock();
  cursor = toCourt(ev);
  if (ev.button === 2) {
    rightDown = true;
    overlayEl.value.setPointerCapture(ev.pointerId);
    send({ type: 'move', ...cursor });
  } else if (ev.button === 0) {
    send({ type: 'click', ...cursor });
  }
}

function onPointerMove(ev) {
  cursor = toCourt(ev);
  if (rightDown && (ev.buttons & 2)) send({ type: 'move', ...cursor });
}

function onPointerUp(ev) {
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
    send({ type: 'cast', slot, ...cursor });
    ev.preventDefault();
  }
}

function castFromButton(slot) {
  sfx.unlock();
  send({ type: 'cast', slot, ...cursor });
}

// --- Overlay: what only this mode draws --------------------------------------

function drawOverlay(v) {
  const cv = overlayEl.value;
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== COURT_W * dpr) { cv.width = COURT_W * dpr; cv.height = COURT_H * dpr; }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, COURT_W, COURT_H);
  const o = v.overlay;

  for (const z of o.zones) {
    c.beginPath();
    c.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    c.fillStyle = z.team === 'home' ? 'rgba(217, 83, 79, 0.14)' : 'rgba(91, 192, 222, 0.14)';
    c.fill();
    c.setLineDash([6, 6]);
    c.strokeStyle = z.team === 'home' ? 'rgba(239, 138, 134, 0.8)' : 'rgba(157, 220, 238, 0.8)';
    c.lineWidth = 2;
    c.stroke();
    c.setLineDash([]);
  }

  if (o.man) {
    c.setLineDash([4, 6]);
    c.strokeStyle = 'rgba(242, 180, 95, 0.75)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(o.human.x, o.human.y);
    c.lineTo(o.man.x, o.man.y);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.arc(o.man.x, o.man.y, 21, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(242, 180, 95, 0.6)';
    c.stroke();
  }

  for (const l of o.locks) {
    c.beginPath();
    c.arc(l.x, l.y, 22, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255, 90, 60, 0.9)';
    c.lineWidth = 2.5;
    c.stroke();
  }

  if (o.marker) {
    c.strokeStyle = 'rgba(140, 230, 160, 0.9)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(o.marker.x - 6, o.marker.y - 6); c.lineTo(o.marker.x + 6, o.marker.y + 6);
    c.moveTo(o.marker.x + 6, o.marker.y - 6); c.lineTo(o.marker.x - 6, o.marker.y + 6);
    c.stroke();
  }

  // You: a gold ring under the chip, so you never lose yourself in the pack.
  c.beginPath();
  c.arc(o.human.x, o.human.y, 20, 0, Math.PI * 2);
  c.strokeStyle = '#f2b45f';
  c.lineWidth = 3;
  c.stroke();

  // Aim: a faint line from you to the cursor, for the Q and E skillshots.
  c.setLineDash([2, 6]);
  c.strokeStyle = 'rgba(233, 227, 214, 0.25)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(o.human.x, o.human.y);
  c.lineTo(cursor.x, cursor.y);
  c.stroke();
  c.setLineDash([]);
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
.fc-pixi, .fc-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.fc-pixi :deep(canvas) { width: 100% !important; height: 100% !important; }
.fc-overlay { cursor: crosshair; touch-action: none; border-radius: 6px; }
.fc-overlay:focus-visible { outline: 2px solid #f2b45f; outline-offset: 2px; }
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

@media (prefers-reduced-motion: reduce) { .fc-ab-sweep { transition: none; } }
</style>
