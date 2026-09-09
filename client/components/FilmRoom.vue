<template>
  <div class="film-room">
    <div class="fr-header">
      <button class="fr-back" @click="$emit('exit')">&larr; Back to Season</button>
      <div class="fr-title-block">
        <span class="fr-eyebrow">COACH MILLER'S</span>
        <h2 class="fr-title">Film Room</h2>
      </div>
      <div class="fr-streak" :class="{ hot: displayStreak > 0 }" :title="streakTooltip">
        <span class="fr-flame">{{ displayStreak > 0 ? '🔥' : '🎬' }}</span>
        <span class="fr-streak-num">{{ displayStreak }}</span>
        <span class="fr-streak-label">day streak</span>
      </div>
    </div>

    <div class="fr-body">
      <!-- Scenario card -->
      <div class="fr-scenario">
        <div class="fr-meta">
          <span class="fr-badge" v-if="isDailyPuzzle">DAILY FILM</span>
          <span class="fr-badge practice" v-else>PRACTICE REEL</span>
          <span class="fr-difficulty">
            Difficulty
            <span class="fr-dots">
              <span
                v-for="n in 5"
                :key="n"
                class="fr-dot"
                :class="{ filled: n <= puzzle.difficulty }"
              ></span>
            </span>
          </span>
        </div>

        <h3 class="fr-scenario-title">{{ puzzle.title }}</h3>
        <p class="fr-scenario-desc">{{ puzzle.description }}</p>

        <!-- Court diagram -->
        <div class="fr-court-wrap">
          <svg class="fr-court" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid meet" role="img"
               :aria-label="`Court diagram for ${puzzle.title}`">
            <!-- Floor -->
            <rect x="0" y="0" width="800" height="420" fill="#3a2a1a" />
            <rect x="6" y="6" width="788" height="408" fill="#4a3620" stroke="#8b5a2b" stroke-width="4" />
            <!-- Paint / key (basket at top) -->
            <rect x="310" y="6" width="180" height="180" fill="none" stroke="#c9a36a" stroke-width="3" />
            <!-- Free-throw circle -->
            <circle cx="400" cy="186" r="60" fill="none" stroke="#c9a36a" stroke-width="3" />
            <!-- Backboard + rim -->
            <line x1="360" y1="30" x2="440" y2="30" stroke="#e0e0e0" stroke-width="4" />
            <circle cx="400" cy="46" r="14" fill="none" stroke="#e8853b" stroke-width="4" />
            <!-- 3-point arc (baseline at top) -->
            <path d="M 70 6 L 70 120 A 340 340 0 0 0 730 120 L 730 6"
                  fill="none" stroke="#c9a36a" stroke-width="3" />
            <!-- Half-court arc at the bottom -->
            <path d="M 280 414 A 120 120 0 0 1 520 414" fill="none" stroke="#c9a36a" stroke-width="3" />

            <!-- Players -->
            <g v-for="p in puzzle.players" :key="p.id">
              <circle
                :cx="p.x"
                :cy="p.y"
                r="26"
                :fill="p.isBallHandler ? '#e8853b' : '#2980b9'"
                stroke="#0d0d0d"
                stroke-width="3"
              />
              <text
                :x="p.x"
                :y="p.y + 7"
                text-anchor="middle"
                class="fr-player-letter"
              >{{ p.name.charAt(0) }}</text>
              <text
                :x="p.x"
                :y="p.y + 48"
                text-anchor="middle"
                class="fr-player-name"
              >{{ p.name }}</text>
            </g>
          </svg>
          <div class="fr-legend">
            <span><span class="dot bh"></span> Ball handler</span>
            <span><span class="dot off"></span> Off-ball</span>
          </div>
        </div>

        <!-- Analytics context -->
        <div class="fr-analytics">
          <span class="fr-analytics-label">📊 Analytics Context</span>
          <p>{{ puzzle.analyticsContext }}</p>
        </div>
      </div>

      <!-- Coach dialogue + options -->
      <div class="fr-interaction">
        <div class="dialogue-box">
          <div class="coach-portrait">
            <span class="coach-name">COACH MILLER</span>
          </div>
          <p class="dialogue-text" :class="{ correct: answered && isCorrect, wrong: answered && !isCorrect }">
            {{ coachLine }}
          </p>
        </div>

        <div v-if="!answered" class="fr-question">
          <p class="fr-prompt">What should the defense call here?</p>
          <div class="fr-options">
            <button
              v-for="opt in puzzle.options"
              :key="opt"
              class="fr-option"
              @click="answer(opt)"
            >
              {{ coverageLabel(opt) }}
            </button>
          </div>
        </div>

        <div v-else class="fr-result">
          <div class="fr-verdict" :class="{ correct: isCorrect, wrong: !isCorrect }">
            <span class="fr-verdict-icon">{{ isCorrect ? '✓' : '✕' }}</span>
            <div>
              <strong>{{ isCorrect ? 'Correct call' : 'Not the best call' }}</strong>
              <span class="fr-answer-line">
                Correct coverage: <b>{{ coverageLabel(puzzle.correct) }}</b>
                <template v-if="!isCorrect"> &mdash; you called {{ coverageLabel(selected) }}</template>
              </span>
            </div>
          </div>

          <div class="fr-actions">
            <button v-if="!isCorrect" class="fr-retry" @click="retry">Try again</button>
            <button class="fr-next" @click="nextPuzzle">Next scenario &rarr;</button>
          </div>

          <p class="fr-progress-note">
            Scenario {{ puzzleIndex + 1 }} of {{ puzzles.length }}
            <span v-if="justScored" class="fr-scored">· streak +1 for today 🔥</span>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { FILM_ROOM_PUZZLES, COVERAGES } from '../data/filmRoomPuzzles.js';

const STREAK_KEY = 'filmRoomStreak';

// Local (not UTC) calendar day as YYYY-MM-DD.
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayNumber(d = new Date()) {
  // Whole days since the epoch in local time — used for day diffs and the
  // deterministic "daily" puzzle pick.
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(local.getTime() / 86400000);
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { count: 0, lastDay: null };
    const parsed = JSON.parse(raw);
    if (typeof parsed.count === 'number' && (parsed.lastDay === null || typeof parsed.lastDay === 'number')) {
      return { count: parsed.count, lastDay: parsed.lastDay };
    }
  } catch (e) {
    /* corrupt / unavailable storage — start fresh */
  }
  return { count: 0, lastDay: null };
}

function saveStreak(state) {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable (private mode) — streak is best-effort */
  }
}

export default {
  name: 'FilmRoom',
  emits: ['exit'],
  setup() {
    const puzzles = FILM_ROOM_PUZZLES;

    const today = dayNumber();
    // Deterministic "puzzle of the day" so everyone sees the same daily film.
    const dailyIndex = ((today % puzzles.length) + puzzles.length) % puzzles.length;

    const puzzleIndex = ref(dailyIndex);
    const puzzle = computed(() => puzzles[puzzleIndex.value]);
    const isDailyPuzzle = computed(() => puzzleIndex.value === dailyIndex);

    const selected = ref(null);
    const answered = ref(false);
    const isCorrect = computed(() => answered.value && selected.value === puzzle.value.correct);
    const justScored = ref(false);

    const streak = ref(loadStreak());

    // The streak the UI shows: if the last scored day is neither today nor
    // yesterday, the run is already broken, so display 0 until a new score.
    const displayStreak = computed(() => {
      if (streak.value.lastDay === null) return 0;
      const gap = today - streak.value.lastDay;
      if (gap <= 1) return streak.value.count;
      return 0;
    });

    const streakTooltip = computed(() => {
      if (displayStreak.value === 0) return 'Complete today\'s film to start a streak';
      return `Last completed on day ${streak.value.lastDay} — keep it going daily!`;
    });

    const coachLines = [
      "Sit down, let's watch some film. Read the floor before you call the coverage.",
      "Alright, next clip. What's the personnel telling you?",
      "Eyes up. The analytics don't lie — pick your poison.",
      "Here's the look. Where do you want to funnel this possession?",
    ];
    const promptLine = ref(coachLines[Math.floor(Math.random() * coachLines.length)]);

    const coachLine = computed(() => {
      if (!answered.value) return promptLine.value;
      return puzzle.value.explanation;
    });

    // Streak bookkeeping: increments at most once per calendar day, on the
    // first correctly-solved scenario. Resets to 1 if a day was missed.
    function recordDailyCompletion() {
      const s = streak.value;
      if (s.lastDay === today) {
        justScored.value = false; // already counted today
        return;
      }
      let next;
      if (s.lastDay !== null && today - s.lastDay === 1) {
        next = { count: s.count + 1, lastDay: today }; // consecutive day
      } else {
        next = { count: 1, lastDay: today }; // first ever, or streak broken
      }
      streak.value = next;
      saveStreak(next);
      justScored.value = true;
    }

    function answer(opt) {
      if (answered.value) return;
      selected.value = opt;
      answered.value = true;
      if (opt === puzzle.value.correct) {
        recordDailyCompletion();
      }
    }

    function retry() {
      answered.value = false;
      selected.value = null;
      justScored.value = false;
    }

    function nextPuzzle() {
      puzzleIndex.value = (puzzleIndex.value + 1) % puzzles.length;
      selected.value = null;
      answered.value = false;
      justScored.value = false;
      promptLine.value = coachLines[Math.floor(Math.random() * coachLines.length)];
    }

    function coverageLabel(key) {
      return COVERAGES[key] || key;
    }

    return {
      puzzles,
      puzzle,
      puzzleIndex,
      isDailyPuzzle,
      selected,
      answered,
      isCorrect,
      justScored,
      displayStreak,
      streakTooltip,
      coachLine,
      answer,
      retry,
      nextPuzzle,
      coverageLabel,
    };
  },
};
</script>

<style scoped>
.film-room {
  color: #e0e0e0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  padding-bottom: 30px;
}

/* Header */
.fr-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.fr-back {
  background: #1f1f1f;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 0.85rem;
}
.fr-back:hover { background: #2a2a2a; border-color: #8b5a2b; }
.fr-title-block { text-align: center; flex: 1; }
.fr-eyebrow {
  display: block;
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: #d9534f;
  font-weight: 900;
}
.fr-title {
  margin: 0;
  font-size: 1.5rem;
  color: #ffd700;
  letter-spacing: 0.02em;
}
.fr-streak {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1a1a1a;
  border: 2px solid #444;
  border-radius: 6px;
  padding: 6px 12px;
}
.fr-streak.hot { border-color: #d9534f; box-shadow: 0 0 12px rgba(217, 83, 79, 0.35); }
.fr-flame { font-size: 1.3rem; line-height: 1; }
.fr-streak-num { font-size: 1.4rem; font-weight: 900; color: #ffd700; }
.fr-streak-label { font-size: 0.65rem; color: #888; text-transform: uppercase; letter-spacing: 0.08em; }

/* Body layout */
.fr-body {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 18px;
  align-items: start;
}

/* Scenario card */
.fr-scenario {
  background: #1a1a1a;
  border: 2px solid #8b5a2b;
  border-radius: 8px;
  padding: 16px;
}
.fr-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 8px;
}
.fr-badge {
  background: #8b5a2b;
  color: #ffd700;
  font-size: 0.6rem;
  font-weight: bold;
  letter-spacing: 0.15em;
  padding: 3px 10px;
  border-radius: 3px;
}
.fr-badge.practice { background: #333; color: #5bc0de; }
.fr-difficulty { font-size: 0.7rem; color: #888; display: flex; align-items: center; gap: 6px; }
.fr-dots { display: inline-flex; gap: 3px; }
.fr-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #333; border: 1px solid #555;
}
.fr-dot.filled { background: #d9534f; border-color: #d9534f; }

.fr-scenario-title { margin: 0 0 6px; font-size: 1.15rem; color: #e0e0e0; }
.fr-scenario-desc { margin: 0 0 14px; font-size: 0.9rem; color: #bbb; line-height: 1.45; }

/* Court */
.fr-court-wrap { margin-bottom: 14px; }
.fr-court {
  width: 100%;
  height: auto;
  border-radius: 8px;
  display: block;
  background: #3a2a1a;
}
.fr-player-letter {
  fill: #fff;
  font-size: 24px;
  font-weight: 900;
  font-family: 'Segoe UI', sans-serif;
}
.fr-player-name {
  fill: #f0e6d2;
  font-size: 20px;
  font-weight: 600;
  font-family: 'Segoe UI', sans-serif;
  paint-order: stroke;
  stroke: #1a1109;
  stroke-width: 4px;
}
.fr-legend {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 8px;
  font-size: 0.72rem;
  color: #999;
}
.fr-legend .dot {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
.fr-legend .dot.bh { background: #e8853b; }
.fr-legend .dot.off { background: #2980b9; }

/* Analytics */
.fr-analytics {
  background: rgba(41, 128, 185, 0.12);
  border: 1px solid rgba(41, 128, 185, 0.4);
  border-radius: 6px;
  padding: 10px 12px;
}
.fr-analytics-label {
  display: block;
  font-size: 0.65rem;
  font-weight: bold;
  letter-spacing: 0.1em;
  color: #5bc0de;
  margin-bottom: 6px;
}
.fr-analytics p { margin: 0; font-size: 0.82rem; color: #cdd; line-height: 1.45; }

/* Interaction column */
.fr-interaction { display: flex; flex-direction: column; gap: 14px; }

/* Dialogue box — mirrors TutorialPhase1.vue */
.dialogue-box {
  background: #1e1e1e;
  border: 2px solid #8b5a2b;
  border-left: 8px solid #d9534f;
  padding: 16px 18px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  border-radius: 4px;
}
.coach-name {
  font-weight: 900;
  color: #d9534f;
  letter-spacing: 2px;
  font-size: 0.85rem;
}
.dialogue-text {
  font-size: 1.02rem;
  line-height: 1.5;
  margin: 12px 0 0;
  font-style: italic;
  color: #e6e6e6;
}
.dialogue-text.correct { border-left: none; color: #b6e6b6; }
.dialogue-text.wrong { color: #e6b6b6; }

/* Question / options */
.fr-prompt { font-size: 0.95rem; color: #ddd; margin: 0 0 10px; font-weight: 600; }
.fr-options { display: flex; flex-direction: column; gap: 8px; }
.fr-option {
  text-align: left;
  background: #1a1a1a;
  color: #e0e0e0;
  border: 2px solid #444;
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.15s ease;
}
.fr-option:hover { border-color: #5bc0de; transform: translateX(4px); background: #202020; }

/* Result */
.fr-verdict {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.fr-verdict.correct { background: rgba(39, 174, 96, 0.12); border: 1px solid #27ae60; }
.fr-verdict.wrong { background: rgba(217, 83, 79, 0.12); border: 1px solid #d9534f; }
.fr-verdict-icon {
  font-size: 1.5rem;
  font-weight: 900;
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}
.fr-verdict.correct .fr-verdict-icon { background: #27ae60; color: #0d0d0d; }
.fr-verdict.wrong .fr-verdict-icon { background: #d9534f; color: #0d0d0d; }
.fr-verdict strong { display: block; font-size: 1rem; }
.fr-verdict.correct strong { color: #6ddf9c; }
.fr-verdict.wrong strong { color: #e88; }
.fr-answer-line { font-size: 0.78rem; color: #aaa; }
.fr-answer-line b { color: #ffd700; }

.fr-actions { display: flex; gap: 10px; }
.fr-retry, .fr-next {
  padding: 10px 18px;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  border: none;
}
.fr-retry { background: #333; color: #e0e0e0; border: 1px solid #555; }
.fr-retry:hover { background: #444; }
.fr-next { background: #d9534f; color: #fff; font-weight: 600; }
.fr-next:hover { background: #c9302c; }
.fr-progress-note { font-size: 0.75rem; color: #888; margin: 12px 0 0; }
.fr-scored { color: #ffd700; font-weight: 600; }

@media (max-width: 720px) {
  .fr-body { grid-template-columns: 1fr; }
  .fr-title-block { order: -1; width: 100%; }
}
</style>
