<template>
  <div class="planning-phase">

    <!-- Cap-space bar: presentation mirror of GameSeason SALARY_CAP / SALARY_FLOOR -->
    <div class="cap-bar" :class="capState">
      <div class="cap-bar-head">
        <span class="cap-label">SALARY CAP</span>
        <span class="cap-space" :class="capState">
          {{ capSpace >= 0
              ? formatMoney(capSpace) + ' cap space'
              : formatMoney(-capSpace) + ' over the cap' }}
        </span>
      </div>
      <div class="cap-track">
        <div class="cap-used" :style="{ width: usedPct + '%' }"></div>
        <div class="cap-floor-marker" :style="{ left: floorPct + '%' }" title="Salary floor"></div>
      </div>
      <div class="cap-bar-foot">
        <span>{{ formatMoney(usedSalary) }} committed</span>
        <span class="cap-limits">Floor {{ formatMoney(SALARY_FLOOR) }} &middot; Cap {{ formatMoney(SALARY_CAP) }}</span>
      </div>
    </div>

    <!-- Half-court grid -->
    <div class="court-wrapper">
      <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
      <div class="court"
           :style="{ transform: `scale(${courtScale})`, transformOrigin: 'top left' }"
           @dragover.prevent
           @drop="onDropCourt($event)">

        <!-- Court markings -->
        <div class="court-paint"></div>
        <div class="court-arc"></div>
        <div class="court-ft-line"></div>
        <div class="court-hoop"></div>

        <!-- Grid overlay for drop zones -->
        <div v-for="cell in gridCells"
             :key="cell.id"
             class="court-cell"
             :class="{ 'cell-highlight': selectedPlayer, 'cell-shake': shakeCellId === cell.id, 'cell-crowded': isCrowdedHover(cell) }"
             :data-x="cell.x"
             :data-y="cell.y"
             :style="[cellStyle(cell), cellGlowStyle(cell)]"
             @dragenter.prevent="onCellDragEnter(cell)"
             @click="onTapCell(cell)">
        </div>

        <!-- Placed players -->
        <div v-for="player in onCourt"
             :key="'court-' + player.id"
             class="court-player"
             :class="{ selected: selectedPlayer && selectedPlayer.id === player.id, 'synergy-lit': isSynergyLit(player.id) }"
             :style="playerStyle(player)"
             draggable="true"
             @dragstart="onDragStart($event, player, 'court')"
             @dragend="onDragEndReset"
             @click.stop="onTapCourtPlayer(player)">
          <span class="player-name">{{ shortName(player.name) }}</span>
        </div>
      </div>
      </div>

      <div class="court-label">{{ selectedPlayer ? 'Tap a court cell to place, or tap bench to return' : 'Tap or drag players onto the court' }}</div>

      <!-- Synergy ghost-preview banner (approximation of the C++ SynergyEngine) -->
      <div v-if="previewCandidate && synergyPreview.synergies.length" class="synergy-preview-banner">
        <span class="spb-tag">SYNERGY</span>
        Placing <strong>{{ shortName(previewCandidate.name) }}</strong> would activate
        <strong>{{ synergyPreview.synergies.join(' + ') }}</strong>
      </div>

      <!-- Shot-zone glow legend -->
      <div class="zone-legend">
        <span class="zl-item"><i class="zl-swatch zl-hot"></i> High-value zone (paint, corner 3)</span>
        <span class="zl-item"><i class="zl-swatch zl-cold"></i> Low-value zone (long mid-range)</span>
      </div>
    </div>

    <!-- Bench -->
    <div class="bench-area"
         @dragover.prevent
         @drop="onDropBench($event)">
      <div class="bench-label">Bench ({{ benchPlayers.length }})</div>
      <div class="bench-row">
        <div v-for="player in benchPlayers"
             :key="'bench-' + player.id"
             class="bench-player"
             :class="[`cost-${player.cost}`, { selected: selectedPlayer && selectedPlayer.id === player.id }]"
             draggable="true"
             @dragstart="onDragStart($event, player, 'bench')"
             @dragend="onDragEndReset"
             @click="onTapBench(player)">
          <span class="bp-name">{{ player.name }}</span>
          <span class="bp-stats">
            SPD {{ player.stats.speed }} / SHT {{ player.stats.shooting }} / DEF {{ player.stats.defense }}
          </span>
          <button class="sell-btn"
                  @click.stop="$emit('sell-player', player)"
                  :title="'Sell for ' + Math.floor(player.cost / 2) + 'G'">
            Sell ({{ Math.floor(player.cost / 2) }}G)
          </button>
        </div>
        <div v-if="benchPlayers.length === 0" class="bench-empty">
          Draft players from the shop below
        </div>
      </div>
    </div>

    <!-- Lock in -->
    <div class="lock-in-bar">
      <div class="lock-in-left">
        <span class="roster-count" :class="{ ready: onCourt.length >= 3 }">
          {{ onCourt.length }}/5 on court
        </span>
        <span v-if="onCourt.length > 0 && onCourt.length < 3" class="roster-warning">
          Add at least 3 players for a fair fight
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
import { ref, computed, inject, onMounted, onUnmounted } from 'vue';
import { getZoneGlowStyle } from '../composables/useZoneEfficiency.js';
import { previewSynergyContributors } from '../composables/useSynergyPreview.js';

// Mirror of shared-core/include/GameSeason.h (GameState::SALARY_CAP / SALARY_FLOOR).
// Kept as local JS constants for the presentation-layer cap bar — we do NOT call
// into WASM for this. Keep in sync with the header if the engine values change.
const SALARY_CAP = 151000000;
const SALARY_FLOOR = 136000000;

// Representative salary per draft-cost tier. Derived from scraper.py:_determine_cost(),
// which buckets a player's share of the salary cap into a 1-5 gold cost:
//   cost 5 >= 25% cap, 4 >= 15%, 3 >= 8%, 2 >= 3%, else 1. We take a representative
//   percentage inside each band x SALARY_CAP so the cap bar reads in real dollars.
const COST_SALARY = {
  1: Math.round(0.015 * SALARY_CAP), // ~2.3M  (veteran minimum band)
  2: Math.round(0.055 * SALARY_CAP), // ~8.3M  (rotation)
  3: Math.round(0.115 * SALARY_CAP), // ~17.4M (starter)
  4: Math.round(0.200 * SALARY_CAP), // ~30.2M (all-star)
  5: Math.round(0.300 * SALARY_CAP), // ~45.3M (supermax)
};

export default {
  props: {
    engine: { type: Object, default: null },
    bench: { type: Array, default: () => [] }
  },
  emits: ['locked-in', 'update:bench', 'sell-player'],
  setup(props, { emit }) {
    const onCourt = ref([]);
    const dragState = ref({ player: null, from: null });
    const selectedPlayer = ref(null);
    const courtScaler = ref(null);
    const courtScale = ref(1);
    const shakeCellId = ref(null);
    const hoverCellId = ref(null);
    let resizeObserver = null;

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
      top: (player.courtY * CELL_H + CELL_H / 2 - 22) + 'px'
    });

    const shortName = (name) => {
      const parts = name.split(' ');
      if (parts.length >= 2) return parts[0][0] + '. ' + parts[parts.length - 1];
      return name;
    };

    const onDragStart = (event, player, from) => {
      dragState.value = { player, from };
      event.dataTransfer.effectAllowed = 'move';
    };

    const onDropCourt = (event) => {
      const { player, from } = dragState.value;
      if (!player) return;

      // Find which cell was dropped on (adjust for CSS scale)
      const courtEl = event.currentTarget;
      const rect = courtEl.getBoundingClientRect();
      const scale = courtScale.value || 1;
      const dropX = Math.floor((event.clientX - rect.left) / scale / CELL_W);
      const dropY = Math.floor((event.clientY - rect.top) / scale / CELL_H);
      const cx = Math.max(0, Math.min(COLS - 1, dropX));
      const cy = Math.max(0, Math.min(ROWS - 1, dropY));

      // Check if cell is occupied
      if (onCourt.value.find(p => p.courtX === cx && p.courtY === cy && p.id !== player.id)) {
        triggerShake(cx, cy);
        dragState.value = { player: null, from: null };
        return;
      }

      if (from === 'bench') {
        // Max 5 on court
        if (onCourt.value.length >= 5) {
          dragState.value = { player: null, from: null };
          return;
        }

        // Move from bench to court
        const placed = { ...player, courtX: cx, courtY: cy };
        onCourt.value = [...onCourt.value, placed];
        emit('update:bench', props.bench.filter(p => p.id !== player.id));

        // Spawn in engine
        const eng = getEngine();
        if (eng) {
          eng.SpawnPlayer(player.id, player.name, player.stats.speed, player.stats.shooting);
          eng.SetPlayerCoordinates(player.id, cx, cy, cx, cy);
        }
      } else {
        // Reposition on court
        onCourt.value = onCourt.value.map(p =>
          p.id === player.id ? { ...p, courtX: cx, courtY: cy } : p
        );

        const eng = getEngine();
        if (eng) {
          eng.SetPlayerCoordinates(player.id, cx, cy, cx, cy);
        }
      }

      dragState.value = { player: null, from: null };
    };

    const onDropBench = (event) => {
      const { player, from } = dragState.value;
      if (!player || from !== 'court') return;

      // Remove from court
      onCourt.value = onCourt.value.filter(p => p.id !== player.id);
      const { courtX, courtY, ...benchPlayer } = player;
      emit('update:bench', [...props.bench, benchPlayer]);

      const eng = getEngine();
      if (eng) {
        eng.RemovePlayer(player.id);
      }

      dragState.value = { player: null, from: null };
    };

    // --- Tap-to-place (mobile support) ---
    const onTapBench = (player) => {
      if (selectedPlayer.value && selectedPlayer.value._from === 'court') {
        // A court player is selected — tapping bench returns them
        const sp = selectedPlayer.value;
        onCourt.value = onCourt.value.filter(p => p.id !== sp.id);
        const { courtX, courtY, _from, ...benchPlayer } = sp;
        emit('update:bench', [...props.bench, benchPlayer]);
        const eng = getEngine();
        if (eng) eng.RemovePlayer(sp.id);
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
      if (!selectedPlayer.value) return;
      const cx = cell.x;
      const cy = cell.y;

      // Check if cell is occupied
      if (onCourt.value.find(p => p.courtX === cx && p.courtY === cy && p.id !== selectedPlayer.value.id)) {
        triggerShake(cx, cy);
        return;
      }

      const player = selectedPlayer.value;

      if (player._from === 'bench') {
        if (onCourt.value.length >= 5) return;
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
        // Reposition court player
        onCourt.value = onCourt.value.map(p =>
          p.id === player.id ? { ...p, courtX: cx, courtY: cy } : p
        );
        const eng = getEngine();
        if (eng) eng.SetPlayerCoordinates(player.id, cx, cy, cx, cy);
      }

      selectedPlayer.value = null;
    };

    const onTapCourtPlayer = (player) => {
      if (selectedPlayer.value && selectedPlayer.value.id === player.id) {
        selectedPlayer.value = null;
      } else {
        selectedPlayer.value = { ...player, _from: 'court' };
      }
    };

    // --- Geometry glow + crowding ---------------------------------------
    // A cell counts as "crowded" if a unit is currently being dragged, this is
    // the cell the drag is hovering, and an already-placed unit sits in one of
    // the 8 adjacent cells (the dragged unit itself is ignored).
    const hasAdjacentUnit = (x, y) => {
      const draggedId = dragState.value.player ? dragState.value.player.id : null;
      return onCourt.value.some(p =>
        p.id !== draggedId &&
        Math.abs(p.courtX - x) <= 1 &&
        Math.abs(p.courtY - y) <= 1
      );
    };

    const isCrowdedHover = (cell) =>
      !!dragState.value.player &&
      hoverCellId.value === cell.id &&
      hasAdjacentUnit(cell.x, cell.y);

    const cellGlowStyle = (cell) =>
      getZoneGlowStyle(cell.x, cell.y, COLS, ROWS, { crowded: isCrowdedHover(cell) });

    const onCellDragEnter = (cell) => { hoverCellId.value = cell.id; };

    const onDragEndReset = () => {
      dragState.value = { player: null, from: null };
      hoverCellId.value = null;
    };

    // --- Synergy ghost-preview (approximates the C++ SynergyEngine) ------
    // The candidate is whichever bench unit is being dragged toward the court,
    // or a bench unit selected via tap-to-place on mobile.
    const previewCandidate = computed(() => {
      const ds = dragState.value;
      if (ds.player && ds.from === 'bench') return ds.player;
      if (selectedPlayer.value && selectedPlayer.value._from === 'bench') return selectedPlayer.value;
      return null;
    });

    const synergyPreview = computed(() =>
      previewSynergyContributors(onCourt.value, previewCandidate.value)
    );

    const isSynergyLit = (playerId) =>
      !!previewCandidate.value && synergyPreview.value.ids.has(playerId);

    // --- Cap-space bar --------------------------------------------------
    const usedSalary = computed(() => {
      const roster = [...onCourt.value, ...props.bench];
      return roster.reduce((sum, p) => sum + (COST_SALARY[p.cost] || 0), 0);
    });
    const capSpace = computed(() => SALARY_CAP - usedSalary.value);
    const usedPct = computed(() =>
      Math.max(0, Math.min(100, (usedSalary.value / SALARY_CAP) * 100))
    );
    const floorPct = computed(() => (SALARY_FLOOR / SALARY_CAP) * 100);
    const capState = computed(() => {
      if (usedSalary.value > SALARY_CAP) return 'over-cap';
      if (usedSalary.value < SALARY_FLOOR) return 'below-floor';
      return 'healthy';
    });
    const formatMoney = (n) => {
      const m = n / 1000000;
      return '$' + (Math.round(m * 10) / 10).toFixed(1) + 'M';
    };

    // --- Responsive scaling ---
    onMounted(() => {
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
    });

    return {
      onCourt, benchPlayers, gridCells,
      cellStyle, playerStyle, shortName,
      onDragStart, onDropCourt, onDropBench,
      onTapBench, onTapCell, onTapCourtPlayer,
      selectedPlayer, shakeCellId, courtScaler, courtScale, COURT_H,
      // geometry glow + crowding
      cellGlowStyle, isCrowdedHover, onCellDragEnter, onDragEndReset,
      // synergy ghost-preview
      previewCandidate, synergyPreview, isSynergyLit,
      // cap-space bar
      usedSalary, capSpace, usedPct, floorPct, capState, formatMoney,
      SALARY_CAP, SALARY_FLOOR
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
  background: #9c7040;
  border: 3px solid #8b5a2b;
  border-radius: 4px;
  overflow: hidden;
}

/* Court markings */
.court-paint {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 160px;
  height: 190px;
  transform: translateX(-50%);
  border: 2px solid rgba(255,255,255,0.4);
  border-bottom: none;
}
.court-arc {
  position: absolute;
  left: 50%;
  bottom: -100px;
  width: 300px;
  height: 300px;
  transform: translateX(-50%);
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50%;
}
.court-ft-line {
  position: absolute;
  left: 50%;
  bottom: 190px;
  width: 160px;
  height: 0;
  transform: translateX(-50%);
  border-top: 2px dashed rgba(255,255,255,0.25);
}
.court-hoop {
  position: absolute;
  left: 50%;
  bottom: 5px;
  width: 16px;
  height: 16px;
  transform: translateX(-50%);
  border: 3px solid #d9534f;
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
  border-color: rgba(255,255,255,0.3);
  background: rgba(255,255,255,0.05);
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

/* Placed players */
.court-player {
  position: absolute;
  width: 44px;
  height: 44px;
  background: #d9534f;
  border: 2px solid #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 10;
  transition: left 0.15s, top 0.15s;
}
.court-player:hover { transform: scale(1.1); }
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
  transition: transform 0.1s;
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
.court-player.selected {
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

/* Cap-space bar */
.cap-bar {
  background: #1f1f1f;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 10px 14px;
}
.cap-bar.over-cap { border-color: #8b3b3b; }
.cap-bar.below-floor { border-color: #6b5a2b; }
.cap-bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.cap-label {
  font-size: 0.7rem;
  letter-spacing: 2px;
  color: #888;
  font-weight: 700;
}
.cap-space { font-size: 0.95rem; font-weight: bold; color: #ffd700; }
.cap-space.over-cap { color: #ff6b6b; }
.cap-space.below-floor { color: #f0a500; }
.cap-track {
  position: relative;
  height: 12px;
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
}
.cap-used {
  height: 100%;
  background: linear-gradient(90deg, #27ae60, #ffd700);
  transition: width 0.25s ease;
}
.cap-bar.over-cap .cap-used {
  background: linear-gradient(90deg, #d9534f, #ff6b6b);
}
.cap-bar.below-floor .cap-used {
  background: linear-gradient(90deg, #6b5a2b, #f0a500);
}
.cap-floor-marker {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.4);
}
.cap-bar-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 0.68rem;
  color: #777;
}
.cap-limits { color: #666; }

/* Synergy ghost-preview */
.court-player.synergy-lit {
  box-shadow: 0 0 14px 5px rgba(255, 215, 0, 0.85);
  border-color: #ffd700;
  animation: synergy-pulse 1.1s ease-in-out infinite;
}
@keyframes synergy-pulse {
  0%   { box-shadow: 0 0 8px 2px rgba(255, 215, 0, 0.55); }
  50%  { box-shadow: 0 0 18px 7px rgba(255, 215, 0, 0.95); }
  100% { box-shadow: 0 0 8px 2px rgba(255, 215, 0, 0.55); }
}
.synergy-preview-banner {
  margin-top: 8px;
  padding: 6px 12px;
  background: #1e1e1e;
  border: 1px solid #8b7a2b;
  border-left: 4px solid #ffd700;
  border-radius: 3px;
  font-size: 0.8rem;
  color: #e0e0e0;
}
.spb-tag {
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 2px;
  color: #ffd700;
  margin-right: 8px;
}

/* Shot-zone glow legend */
.zone-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 0.68rem;
  color: #777;
}
.zl-item { display: inline-flex; align-items: center; gap: 6px; }
.zl-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  display: inline-block;
}
.zl-hot { background: hsla(35, 80%, 57%, 0.85); box-shadow: inset 0 0 6px hsla(35, 80%, 69%, 0.6); }
.zl-cold { background: hsla(200, 35%, 45%, 0.5); }

/* Crowded cell (units packed too close) */
.court-cell.cell-crowded {
  border-style: dashed !important;
  border-color: rgba(217, 83, 79, 0.6) !important;
}

@media (max-width: 520px) {
  .bench-player { padding: 8px 12px; }
  .bp-name { font-size: 0.9rem; }
  .bp-stats { font-size: 0.7rem; }
  .lock-in-bar { flex-direction: column; gap: 8px; align-items: flex-start; }
  .lock-in-btn { width: 100%; padding: 12px; font-size: 1.1rem; }
}
</style>
