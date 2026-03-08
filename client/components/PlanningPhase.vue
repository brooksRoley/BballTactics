<template>
  <div class="planning-phase">

    <!-- Half-court grid -->
    <div class="court-wrapper">
      <div class="court"
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
             :data-x="cell.x"
             :data-y="cell.y"
             :style="cellStyle(cell)">
        </div>

        <!-- Placed players -->
        <div v-for="player in onCourt"
             :key="'court-' + player.id"
             class="court-player"
             :style="playerStyle(player)"
             draggable="true"
             @dragstart="onDragStart($event, player, 'court')">
          <span class="player-name">{{ shortName(player.name) }}</span>
        </div>
      </div>

      <div class="court-label">Drag players from the bench onto the court</div>
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
             :class="[`cost-${player.cost}`]"
             draggable="true"
             @dragstart="onDragStart($event, player, 'bench')">
          <span class="bp-name">{{ player.name }}</span>
          <span class="bp-stats">
            SPD {{ player.stats.speed }} / SHT {{ player.stats.shooting }}
          </span>
        </div>
        <div v-if="benchPlayers.length === 0" class="bench-empty">
          Draft players from the shop below
        </div>
      </div>
    </div>

    <!-- Lock in -->
    <div class="lock-in-bar">
      <span class="roster-count" :class="{ ready: onCourt.length >= 1 }">
        {{ onCourt.length }}/5 on court
      </span>
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
import { ref, computed, inject } from 'vue';

export default {
  props: {
    engine: { type: Object, default: null },
    bench: { type: Array, default: () => [] }
  },
  emits: ['locked-in', 'update:bench'],
  setup(props, { emit }) {
    const onCourt = ref([]);
    const dragState = ref({ player: null, from: null });
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

      // Find which cell was dropped on
      const courtEl = event.currentTarget;
      const rect = courtEl.getBoundingClientRect();
      const dropX = Math.floor((event.clientX - rect.left) / CELL_W);
      const dropY = Math.floor((event.clientY - rect.top) / CELL_H);
      const cx = Math.max(0, Math.min(COLS - 1, dropX));
      const cy = Math.max(0, Math.min(ROWS - 1, dropY));

      // Check if cell is occupied
      if (onCourt.value.find(p => p.courtX === cx && p.courtY === cy && p.id !== player.id)) {
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

    return {
      onCourt, benchPlayers, gridCells,
      cellStyle, playerStyle, shortName,
      onDragStart, onDropCourt, onDropBench
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
.court-label { color: #666; font-size: 0.8rem; margin-top: 6px; }

.court {
  position: relative;
  width: 500px;
  height: 400px;
  background: #c59b6d;
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

/* Lock-in bar */
.lock-in-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
}
.roster-count { color: #888; font-size: 0.9rem; }
.roster-count.ready { color: #27ae60; }

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
</style>
