<template>
  <div class="planning-phase">

    <!-- Half-court grid -->
    <div class="court-wrapper">
      <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
      <div class="court"
           ref="courtEl"
           :style="{ transform: `scale(${courtScale})`, transformOrigin: 'top left' }">

        <!-- Court markings -->
        <div class="court-paint"></div>
        <div class="court-arc"></div>
        <div class="court-ft-line"></div>
        <div class="court-hoop"></div>

        <!-- Grid overlay for drop zones -->
        <div v-for="cell in gridCells"
             :key="cell.id"
             class="court-cell"
             :class="{ 'cell-highlight': selectedPlayer, 'cell-shake': shakeCellId === cell.id }"
             :data-x="cell.x"
             :data-y="cell.y"
             :style="cellStyle(cell)"
             @click="onTapCell(cell)">
        </div>

        <!-- Placed players -->
        <div v-for="player in onCourt"
             :key="'court-' + player.id"
             class="court-player"
             :class="{
               selected: selectedPlayer && selectedPlayer.id === player.id,
               land: landedId === player.id,
               'two-star': player.star === 2,
               'drag-ghost': dragAvatar.active && dragAvatar.playerId === player.id
             }"
             :style="playerStyle(player)"
             @pointerdown="onPointerDown($event, player, 'court')"
             @click.stop="onTapCourtPlayer(player)">
          <span class="unit-body" :style="breatheStyle(player)">
            <span class="player-name">{{ shortName(player.name) }}</span>
          </span>
        </div>

        <!-- FX overlay: dust puffs on landings -->
        <canvas ref="fxCanvas" class="court-fx" :width="COURT_W" :height="COURT_H"></canvas>
      </div>
      </div>

      <div class="court-label">{{ selectedPlayer ? 'Tap a court cell to place, or tap bench to return' : 'Tap or drag players onto the court' }}</div>
    </div>

    <!-- Bench -->
    <div class="bench-area" ref="benchEl">
      <div class="bench-label">Bench ({{ benchPlayers.length }})</div>
      <div class="bench-row">
        <div v-for="player in benchPlayers"
             :key="'bench-' + player.id"
             class="bench-player"
             :class="[`cost-${player.cost}`, {
               selected: selectedPlayer && selectedPlayer.id === player.id,
               'drag-ghost': dragAvatar.active && dragAvatar.playerId === player.id
             }]"
             @pointerdown="onPointerDown($event, player, 'bench')"
             @click="onTapBench(player)">
          <span class="bp-name"><span v-if="player.star === 2" class="star-badge">★★</span>{{ player.name }}</span>
          <span class="bp-stats">
            SPD {{ player.stats.speed }} / SHT {{ player.stats.shooting }} / DEF {{ player.stats.defense }}
          </span>
          <button class="sell-btn"
                  @click.stop="$emit('sell-player', player)"
                  :title="'Sell for ' + sellValue(player) + 'G'">
            Sell ({{ sellValue(player) }}G)
          </button>
        </div>
        <div v-if="benchPlayers.length === 0" class="bench-empty">
          Draft players from the shop below
        </div>
      </div>
    </div>

    <!-- Spring-following drag avatar (page space, above everything) -->
    <div v-if="dragAvatar.active"
         class="drag-avatar"
         :style="dragAvatarStyle">
      <span class="player-name">{{ dragAvatar.label }}</span>
    </div>

    <!-- Lock in -->
    <div class="lock-in-bar">
      <div class="lock-in-left">
        <span class="roster-count" :class="{ ready: onCourt.length >= Math.min(3, maxOnCourt) }">
          {{ onCourt.length }}/{{ maxOnCourt }} on court
        </span>
        <span v-if="onCourt.length > 0 && onCourt.length < Math.min(3, maxOnCourt)" class="roster-warning">
          Add at least {{ Math.min(3, maxOnCourt) }} players for a fair fight
        </span>
      </div>
      <button
        class="lock-in-btn"
        :disabled="onCourt.length < 1"
        @click="$emit('locked-in', onCourt)">
        Lock In &amp; Fight
      </button>
    </div>
  </div>
</template>

<script>
import { ref, computed, inject, onMounted, onUnmounted, reactive } from 'vue';
import { FEEL, Spring, ParticlePool, spawnDust, drawParticles, prefersReducedMotion } from '../fx/feel.js';
import { sellValue } from '../game/economy.js';

export default {
  props: {
    engine: { type: Object, default: null },
    bench: { type: Array, default: () => [] },
    maxOnCourt: { type: Number, default: 5 }
  },
  emits: ['locked-in', 'update:bench', 'update:court', 'sell-player'],
  setup(props, { emit }) {
    const onCourt = ref([]);
    const selectedPlayer = ref(null);
    const courtScaler = ref(null);
    const courtScale = ref(1);
    const shakeCellId = ref(null);
    const courtEl = ref(null);
    const benchEl = ref(null);
    const fxCanvas = ref(null);
    const landedId = ref(null);
    let resizeObserver = null;
    let landTimer = null;

    const reduced = prefersReducedMotion();

    const triggerShake = (cx, cy) => {
      shakeCellId.value = `c-${cx}-${cy}`;
      setTimeout(() => { shakeCellId.value = null; }, 400);
    };
    const getEngine = () => props.engine || inject('engine', null);

    const COURT_W = 500;
    const COURT_H = 400;
    const COLS = 5;
    const ROWS = 5;
    const CELL_W = COURT_W / COLS;
    const CELL_H = COURT_H / ROWS;

    const benchPlayers = computed(() => props.bench);

    const gridCells = computed(() => {
      const cells = [];
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          cells.push({ id: `c-${x}-${y}`, x, y });
        }
      }
      return cells;
    });

    const cellStyle = (cell) => ({
      left: (cell.x * CELL_W) + 'px',
      top: (cell.y * CELL_H) + 'px',
      width: CELL_W + 'px',
      height: CELL_H + 'px'
    });

    const playerStyle = (player) => ({
      left: (player.courtX * CELL_W + CELL_W / 2 - 22) + 'px',
      top: (player.courtY * CELL_H + CELL_H / 2 - 22) + 'px',
      '--squash-x': FEEL.land.squashX,
      '--squash-y': FEEL.land.squashY,
      '--land-dur': FEEL.land.duration + 's',
    });

    // Idle breathing: each unit gets a phase offset so they don't sync up
    const breatheStyle = (player) => ({
      animationDelay: (-(player.id % 8) * 0.37) + 's',
      animationDuration: FEEL.breathe.period + 's',
      '--breathe-scale': 1 + FEEL.breathe.scaleAmp,
    });

    const shortName = (name) => {
      const parts = name.split(' ');
      if (parts.length >= 2) return parts[0][0] + '. ' + parts[parts.length - 1];
      return name;
    };

    // ── Dust particle overlay (court-space canvas) ────────────────
    const pool = new ParticlePool(FEEL.particles.maxActive);
    let fxCtx = null;
    let fxRunning = false;
    let fxLast = 0;

    const fxLoop = (ts) => {
      if (!fxCtx) { fxRunning = false; return; }
      const dt = Math.min((ts - fxLast) / 1000, 0.05);
      fxLast = ts;
      pool.update(dt);
      fxCtx.clearRect(0, 0, COURT_W, COURT_H);
      drawParticles(fxCtx, pool);
      if (pool.length > 0) {
        requestAnimationFrame(fxLoop);
      } else {
        fxCtx.clearRect(0, 0, COURT_W, COURT_H);
        fxRunning = false;
      }
    };

    const kickFx = () => {
      if (fxRunning || !fxCtx || pool.length === 0) return;
      fxRunning = true;
      fxLast = performance.now();
      requestAnimationFrame(fxLoop);
    };

    const puffAt = (cx, cy) => {
      spawnDust(pool, cx * CELL_W + CELL_W / 2, cy * CELL_H + CELL_H / 2 + 16);
      kickFx();
    };

    const markLanded = (id) => {
      if (reduced) return;
      landedId.value = null;
      clearTimeout(landTimer);
      // next frame so a re-placed unit restarts its landing animation
      requestAnimationFrame(() => { landedId.value = id; });
      landTimer = setTimeout(() => { landedId.value = null; }, FEEL.land.duration * 1000 + 60);
    };

    // ── Placement logic (shared by drag + tap) ────────────────────
    const cellOccupied = (cx, cy, exceptId) =>
      onCourt.value.some(p => p.courtX === cx && p.courtY === cy && p.id !== exceptId);

    const placeOnCourt = (player, from, cx, cy) => {
      if (cellOccupied(cx, cy, player.id)) {
        triggerShake(cx, cy);
        return false;
      }
      if (from === 'bench') {
        if (onCourt.value.length >= props.maxOnCourt) return false;
        const { _from, ...cleanPlayer } = player;
        const placed = { ...cleanPlayer, courtX: cx, courtY: cy };
        onCourt.value = [...onCourt.value, placed];
        emit('update:bench', props.bench.filter(p => p.id !== player.id));
        const eng = getEngine();
        if (eng) {
          eng.SpawnPlayer(player.id, player.name, player.stats.speed, player.stats.shooting);
          eng.SetPlayerCoordinates(player.id, cx, cy, cx, cy);
        }
      } else {
        onCourt.value = onCourt.value.map(p =>
          p.id === player.id ? { ...p, courtX: cx, courtY: cy } : p
        );
        const eng = getEngine();
        if (eng) eng.SetPlayerCoordinates(player.id, cx, cy, cx, cy);
      }
      emit('update:court', onCourt.value);
      return true;
    };

    const returnToBench = (player) => {
      onCourt.value = onCourt.value.filter(p => p.id !== player.id);
      const { courtX, courtY, _from, ...benchPlayer } = player;
      emit('update:bench', [...props.bench, benchPlayer]);
      emit('update:court', onCourt.value);
      const eng = getEngine();
      if (eng) eng.RemovePlayer(player.id);
    };

    // ── External court ops (called by App.vue via template ref) ────
    // Cross-zone combines consume on-court copies and drop the merged
    // 2-star into a cell without going through the bench.

    /** Remove court units by uid. Returns true only if every uid was found. */
    const removeUnits = (uids) => {
      const wanted = new Set(uids);
      const removed = onCourt.value.filter(p => wanted.has(p.uid));
      if (removed.length !== uids.length) return false;
      onCourt.value = onCourt.value.filter(p => !wanted.has(p.uid));
      const eng = getEngine();
      if (eng) for (const p of removed) eng.RemovePlayer(p.id);
      emit('update:court', onCourt.value);
      return true;
    };

    /** Place an already-owned unit (a fresh 2-star) straight onto a cell. */
    const placeUnit = (unit, cx, cy) => {
      let x = cx, y = cy;
      if (cellOccupied(x, y, unit.id)) {
        // Anchor cell taken (shouldn't happen for a combine) — first free cell.
        const free = gridCells.value.find(c => !cellOccupied(c.x, c.y, unit.id));
        if (!free) return false;
        x = free.x;
        y = free.y;
      }
      onCourt.value = [...onCourt.value, { ...unit, courtX: x, courtY: y }];
      const eng = getEngine();
      if (eng) {
        eng.SpawnPlayer(unit.id, unit.name, unit.stats.speed, unit.stats.shooting);
        eng.SetPlayerCoordinates(unit.id, x, y, x, y);
      }
      emit('update:court', onCourt.value);
      puffAt(x, y);
      markLanded(unit.id);
      return true;
    };

    // ── Pointer-driven spring drag ────────────────────────────────
    const dragAvatar = reactive({
      active: false,
      playerId: null,
      label: '',
      x: 0, y: 0, rot: 0,
      phase: 'follow', // 'follow' | 'return'
    });

    const springX = new Spring(0, FEEL.drag.followStiffness, FEEL.drag.followDamping);
    const springY = new Spring(0, FEEL.drag.followStiffness, FEEL.drag.followDamping);

    let drag = null;          // { player, from, startX, startY, originX, originY, moved }
    let dragLoopId = null;
    let dragLast = 0;
    let lastDragEndT = 0;

    const dragJustEnded = () => performance.now() - lastDragEndT < 350;

    const dragAvatarStyle = computed(() => ({
      transform: `translate(${dragAvatar.x - 22}px, ${dragAvatar.y - 22}px) ` +
                 `scale(${FEEL.drag.liftScale}) rotate(${dragAvatar.rot}deg)`,
    }));

    const endAvatar = () => {
      dragAvatar.active = false;
      dragAvatar.playerId = null;
      if (dragLoopId) cancelAnimationFrame(dragLoopId);
      dragLoopId = null;
    };

    const dragLoop = (ts) => {
      if (!dragAvatar.active) return;
      const dt = Math.min((ts - dragLast) / 1000, 0.05);
      dragLast = ts;

      if (reduced) {
        springX.snap(springX.target);
        springY.snap(springY.target);
      } else {
        springX.update(dt);
        springY.update(dt);
      }
      dragAvatar.x = springX.value;
      dragAvatar.y = springY.value;
      dragAvatar.rot = reduced ? 0 : Math.max(-14, Math.min(14, springX.velocity * 0.018));

      if (dragAvatar.phase === 'return') {
        const eps = FEEL.drag.settleEps;
        if (reduced || (springX.settled(eps) && springY.settled(eps))) {
          endAvatar();
          return;
        }
      }
      dragLoopId = requestAnimationFrame(dragLoop);
    };

    const onPointerDown = (e, player, from) => {
      if (e.target.closest && e.target.closest('.sell-btn')) return;
      if (dragAvatar.active) return;   // one drag at a time
      if (e.button !== undefined && e.button !== 0) return;

      const rect = e.currentTarget.getBoundingClientRect();
      drag = {
        player, from,
        startX: e.clientX,
        startY: e.clientY,
        originX: rect.left + rect.width / 2,
        originY: rect.top + rect.height / 2,
        moved: false,
      };
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    };

    const onPointerMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (!drag.moved) {
        if (Math.hypot(dx, dy) < FEEL.drag.slopPx) return;
        // Crossed the slop threshold → this is a drag, not a tap
        drag.moved = true;
        selectedPlayer.value = null;
        dragAvatar.active = true;
        dragAvatar.playerId = drag.player.id;
        dragAvatar.label = shortName(drag.player.name);
        dragAvatar.phase = 'follow';
        springX.stiffness = FEEL.drag.followStiffness;
        springX.damping = FEEL.drag.followDamping;
        springY.stiffness = FEEL.drag.followStiffness;
        springY.damping = FEEL.drag.followDamping;
        springX.snap(drag.originX);
        springY.snap(drag.originY);
        dragLast = performance.now();
        dragLoopId = requestAnimationFrame(dragLoop);
      }
      if (e.cancelable) e.preventDefault();
      springX.target = e.clientX;
      springY.target = e.clientY;
    };

    const rubberBandBack = () => {
      if (reduced || !drag) { endAvatar(); return; }
      dragAvatar.phase = 'return';
      springX.stiffness = FEEL.drag.returnStiffness;
      springX.damping = FEEL.drag.returnDamping;
      springY.stiffness = FEEL.drag.returnStiffness;
      springY.damping = FEEL.drag.returnDamping;
      springX.target = drag.originX;
      springY.target = drag.originY;
    };

    const removeWindowListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };

    const onPointerUp = (e) => {
      removeWindowListeners();
      if (!drag) return;

      if (!drag.moved) {
        // Tap — let the click handlers take it from here
        drag = null;
        return;
      }
      lastDragEndT = performance.now();

      const { player, from } = drag;
      let handled = false;

      // Drop on court?
      const courtRect = courtEl.value ? courtEl.value.getBoundingClientRect() : null;
      if (courtRect &&
          e.clientX >= courtRect.left && e.clientX <= courtRect.right &&
          e.clientY >= courtRect.top && e.clientY <= courtRect.bottom) {
        const scale = courtScale.value || 1;
        const cx = Math.max(0, Math.min(COLS - 1, Math.floor((e.clientX - courtRect.left) / scale / CELL_W)));
        const cy = Math.max(0, Math.min(ROWS - 1, Math.floor((e.clientY - courtRect.top) / scale / CELL_H)));
        if (placeOnCourt(player, from, cx, cy)) {
          handled = true;
          puffAt(cx, cy);
          markLanded(player.id);
          endAvatar();
        }
      }

      // Drop on bench? (only meaningful for court units)
      if (!handled && from === 'court' && benchEl.value) {
        const br = benchEl.value.getBoundingClientRect();
        if (e.clientX >= br.left && e.clientX <= br.right &&
            e.clientY >= br.top && e.clientY <= br.bottom) {
          returnToBench(player);
          handled = true;
          endAvatar();
        }
      }

      if (!handled) rubberBandBack();
      drag = null;
    };

    const onPointerCancel = () => {
      removeWindowListeners();
      if (drag && drag.moved) {
        lastDragEndT = performance.now();
        rubberBandBack();
      }
      drag = null;
    };

    // --- Tap-to-place (mobile support) ---
    const onTapBench = (player) => {
      if (dragJustEnded()) return;
      if (selectedPlayer.value && selectedPlayer.value._from === 'court') {
        // A court player is selected — tapping bench returns them
        returnToBench(selectedPlayer.value);
        selectedPlayer.value = null;
        return;
      }
      // Toggle selection of a bench player
      if (selectedPlayer.value && selectedPlayer.value.id === player.id) {
        selectedPlayer.value = null;
      } else {
        selectedPlayer.value = { ...player, _from: 'bench' };
      }
    };

    const onTapCell = (cell) => {
      if (dragJustEnded()) return;
      if (!selectedPlayer.value) return;
      const player = selectedPlayer.value;
      if (placeOnCourt(player, player._from, cell.x, cell.y)) {
        puffAt(cell.x, cell.y);
        markLanded(player.id);
        selectedPlayer.value = null;
      }
    };

    const onTapCourtPlayer = (player) => {
      if (dragJustEnded()) return;
      if (selectedPlayer.value && selectedPlayer.value.id === player.id) {
        selectedPlayer.value = null;
      } else {
        selectedPlayer.value = { ...player, _from: 'court' };
      }
    };

    // --- Responsive scaling ---
    onMounted(() => {
      if (fxCanvas.value) fxCtx = fxCanvas.value.getContext('2d');
      const updateScale = () => {
        if (courtScaler.value) {
          courtScale.value = Math.min(1, courtScaler.value.clientWidth / COURT_W);
        }
      };
      updateScale();
      resizeObserver = new ResizeObserver(updateScale);
      if (courtScaler.value) resizeObserver.observe(courtScaler.value);
    });

    onUnmounted(() => {
      if (resizeObserver) resizeObserver.disconnect();
      if (dragLoopId) cancelAnimationFrame(dragLoopId);
      clearTimeout(landTimer);
      removeWindowListeners();
    });

    return {
      onCourt, benchPlayers, gridCells, sellValue,
      removeUnits, placeUnit,
      cellStyle, playerStyle, breatheStyle, shortName,
      onPointerDown, onTapBench, onTapCell, onTapCourtPlayer,
      selectedPlayer, shakeCellId, courtScaler, courtScale,
      courtEl, benchEl, fxCanvas, landedId,
      dragAvatar, dragAvatarStyle,
      COURT_W, COURT_H
    };
  }
};
</script>

<style scoped>
.planning-phase {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Court */
.court-wrapper { display: flex; flex-direction: column; align-items: center; }
.court-scaler {
  width: 100%;
  max-width: 500px;
  overflow: hidden;
}
.court-label { color: #666; font-size: 0.8rem; margin-top: 6px; }

.court {
  position: relative;
  width: 500px;
  height: 400px;
  background: radial-gradient(ellipse at 50% 85%, #463122 0%, #33231a 55%, #241811 100%);
  border: 3px solid rgba(255, 214, 150, 0.3);
  border-radius: 4px;
  overflow: hidden;
}

/* FX overlay canvas — dust puffs draw here */
.court-fx {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 15;
}

/* Court markings */
.court-paint {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 160px;
  height: 190px;
  transform: translateX(-50%);
  border: 2px solid rgba(255,235,200,0.3);
  border-bottom: none;
}
.court-arc {
  position: absolute;
  left: 50%;
  bottom: -100px;
  width: 300px;
  height: 300px;
  transform: translateX(-50%);
  border: 2px solid rgba(255,235,200,0.22);
  border-radius: 50%;
}
.court-ft-line {
  position: absolute;
  left: 50%;
  bottom: 190px;
  width: 160px;
  height: 0;
  transform: translateX(-50%);
  border-top: 2px dashed rgba(255,235,200,0.18);
}
.court-hoop {
  position: absolute;
  left: 50%;
  bottom: 5px;
  width: 16px;
  height: 16px;
  transform: translateX(-50%);
  border: 3px solid #e8734f;
  border-radius: 50%;
  background: transparent;
}

/* Grid cells (invisible drop targets) */
.court-cell {
  position: absolute;
  border: 1px solid transparent;
  transition: border-color 0.1s;
}
.court-cell:hover {
  border-color: rgba(255,235,200,0.3);
  background: rgba(255,235,200,0.05);
}
.court-cell.cell-shake {
  animation: cell-shake 0.35s ease;
  background: rgba(217, 83, 79, 0.2);
  border-color: rgba(217, 83, 79, 0.6) !important;
}
@keyframes cell-shake {
  0%   { transform: translateX(0); }
  20%  { transform: translateX(-5px); }
  40%  { transform: translateX(5px); }
  60%  { transform: translateX(-4px); }
  80%  { transform: translateX(4px); }
  100% { transform: translateX(0); }
}

/* Placed players — outer div positions + lands, inner body breathes */
.court-player {
  position: absolute;
  width: 44px;
  height: 44px;
  cursor: grab;
  z-index: 10;
  transition: left 0.15s, top 0.15s;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.court-player.land {
  animation: squash-land var(--land-dur, 0.4s) cubic-bezier(0.22, 1.4, 0.36, 1);
}
@keyframes squash-land {
  0%   { transform: scale(var(--squash-x, 1.28), var(--squash-y, 0.72)) translateY(4px); }
  45%  { transform: scale(0.9, 1.12) translateY(-2px); }
  100% { transform: scale(1, 1) translateY(0); }
}

.unit-body {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #d9534f;
  border: 2px solid rgba(255,255,255,0.9);
  border-radius: 50%;
  box-shadow: 0 3px 8px rgba(0,0,0,0.45);
  animation: breathe 2.8s ease-in-out infinite;
}
.court-player:hover .unit-body {
  box-shadow: 0 0 10px 2px rgba(255, 214, 90, 0.5), 0 3px 8px rgba(0,0,0,0.45);
}
@keyframes breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(var(--breathe-scale, 1.03)); }
}

/* Unit being dragged: its original dims out while the avatar flies */
.drag-ghost { opacity: 0.25; }

/* 2-star (combined) units read as gold */
.court-player.two-star .unit-body {
  border-color: #ffd700;
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.55), 0 3px 8px rgba(0,0,0,0.45);
}
.bench-player .star-badge { color: #ffd700; font-size: 0.7rem; margin-right: 3px; }

/* Spring-following drag avatar (page space) */
.drag-avatar {
  position: fixed;
  left: 0;
  top: 0;
  width: 44px;
  height: 44px;
  background: #d9534f;
  border: 2px solid #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 10px 20px rgba(0,0,0,0.5), 0 0 14px rgba(255, 214, 90, 0.35);
  will-change: transform;
}

.player-name {
  font-size: 0.55rem;
  font-weight: bold;
  color: #fff;
  text-align: center;
  line-height: 1.1;
  pointer-events: none;
}

/* Bench */
.bench-area {
  background: #1a1a1a;
  border: 2px solid #333;
  border-radius: 4px;
  padding: 8px 12px;
  min-height: 60px;
}
.bench-label { font-size: 0.8rem; color: #888; margin-bottom: 6px; }
.bench-row { display: flex; gap: 8px; flex-wrap: wrap; }

.bench-player {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  background: #222;
  border: 2px solid #444;
  border-radius: 4px;
  cursor: grab;
  transition: transform 0.1s, opacity 0.15s;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.bench-player:hover { transform: translateY(-2px); }
.bp-name { font-size: 0.85rem; font-weight: bold; }
.bp-stats { font-size: 0.65rem; color: #777; }
.bench-empty { color: #555; font-style: italic; font-size: 0.85rem; padding: 8px; }
.sell-btn {
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 0.65rem;
  background: #5a2b2b;
  color: #ffa07a;
  border: 1px solid #8b4513;
  border-radius: 3px;
  cursor: pointer;
}
.sell-btn:hover { background: #7a3b3b; }

/* Lock-in bar */
.lock-in-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}
.lock-in-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.roster-count { color: #888; font-size: 0.9rem; }
.roster-count.ready { color: #27ae60; }
.roster-warning {
  font-size: 0.75rem;
  color: #f0a500;
}

.lock-in-btn {
  background: #d9534f;
  color: white;
  border: none;
  padding: 10px 24px;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 3px;
}
.lock-in-btn:disabled {
  background: #444;
  cursor: not-allowed;
  opacity: 0.5;
}
.lock-in-btn:not(:disabled):hover { background: #c9302c; }

/* Selection states for tap-to-place */
.court-player.selected .unit-body {
  box-shadow: 0 0 12px 4px rgba(91, 192, 222, 0.8);
  border-color: #5bc0de;
}
.bench-player.selected {
  box-shadow: 0 0 10px 3px rgba(91, 192, 222, 0.8);
  border-color: #5bc0de;
}
.court-cell.cell-highlight:hover {
  border-color: rgba(91, 192, 222, 0.5);
  background: rgba(91, 192, 222, 0.1);
}

@media (prefers-reduced-motion: reduce) {
  .unit-body { animation: none; }
  .court-player.land { animation: none; }
  .court-cell.cell-shake { animation: none; }
}

@media (max-width: 520px) {
  .bench-player { padding: 8px 12px; }
  .bp-name { font-size: 0.9rem; }
  .bp-stats { font-size: 0.7rem; }
  .lock-in-bar { flex-direction: column; gap: 8px; align-items: flex-start; }
  .lock-in-btn { width: 100%; padding: 12px; font-size: 1.1rem; }
}
</style>
