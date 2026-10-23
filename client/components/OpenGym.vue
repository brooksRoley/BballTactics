<template>
  <section class="open-gym" aria-labelledby="og-title">
    <!-- A playground court at golden hour: painted asphalt lines, a chain net,
         the fence's shadow across the key. Pure SVG, no assets. -->
    <svg class="og-court" viewBox="0 0 800 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="og-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1b2a44" />
          <stop offset="0.55" stop-color="#3a3b55" />
          <stop offset="1" stop-color="#c7743a" />
        </linearGradient>
        <linearGradient id="og-asphalt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3b3f4a" />
          <stop offset="1" stop-color="#22252c" />
        </linearGradient>
        <pattern id="og-fence" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="18" stroke="#000" stroke-opacity="0.22" stroke-width="2" />
        </pattern>
      </defs>
      <rect width="800" height="210" fill="url(#og-sky)" />
      <circle cx="610" cy="200" r="70" fill="#f2b45f" opacity="0.55" />
      <rect y="200" width="800" height="220" fill="url(#og-asphalt)" />
      <rect y="200" width="800" height="220" fill="url(#og-fence)" opacity="0.6" />
      <!-- painted half court, in perspective -->
      <g fill="none" stroke="#e9e3d6" stroke-opacity="0.75" stroke-width="3">
        <path d="M120 410 L260 225 L540 225 L680 410" />
        <path d="M330 225 L310 330 L490 330 L470 225" stroke="#f2b45f" stroke-opacity="0.85" />
        <ellipse cx="400" cy="330" rx="90" ry="22" />
        <path d="M200 410 Q400 250 600 410" />
      </g>
      <!-- backboard, rim, chain net -->
      <rect x="395" y="172" width="10" height="58" fill="#22252c" />
      <rect x="360" y="120" width="80" height="52" fill="#e9e3d6" fill-opacity="0.12" stroke="#e9e3d6" stroke-opacity="0.8" stroke-width="2" />
      <ellipse cx="400" cy="176" rx="20" ry="5" fill="none" stroke="#d9773a" stroke-width="3" />
      <g stroke="#c9ccd1" stroke-opacity="0.8" stroke-width="1.5" class="og-net">
        <path d="M381 177 L388 205 M387 178 L392 206 M394 179 L396 207 M400 180 L400 208 M406 179 L404 207 M413 178 L408 206 M419 177 L412 205" />
        <path d="M384 190 Q400 196 416 190 M388 202 Q400 207 412 202" fill="none" />
      </g>
    </svg>

    <div class="og-content">
      <p class="og-kicker">{{ pitch.kicker }}</p>
      <h2 id="og-title" class="og-title">{{ pitch.title }}</h2>
      <p class="og-line">{{ pitch.line }}</p>
      <ul class="og-why">
        <li v-for="w in pitch.why" :key="w">{{ w }}</li>
      </ul>

      <div class="og-actions">
        <button class="og-run" data-sfx="none" @click="$emit('run')">
          {{ inRun ? 'Back to the run' : 'Run It' }}
        </button>
        <button class="og-btn" @click="howOpen = true">How to Play</button>
        <button class="og-btn" @click="$emit('controls')">Controls</button>
        <button
          class="og-btn og-sound"
          :aria-pressed="!muted"
          @click="$emit('toggle-sound')"
        >{{ muted ? '🔇 Sound off' : '🔊 Sound on' }}</button>
      </div>
      <p v-if="!muted" class="og-volume">
        <label for="og-music">Music</label>
        <input id="og-music" type="range" min="0" max="1" step="0.05" :value="musicVolume"
               @input="$emit('music-volume', Number($event.target.value))" />
      </p>
      <p v-if="showReplay" class="og-replay">
        <button class="og-link" @click="$emit('replay-tutorial')">↻ Replay the guided first round</button>
      </p>
    </div>

    <HowToPlay v-if="howOpen" @close="howOpen = false" />
  </section>
</template>

<script setup>
import { ref } from 'vue';
import HowToPlay from './HowToPlay.vue';
import { PITCH } from '../game/howToPlay.js';

defineProps({
  inRun: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  musicVolume: { type: Number, default: 0.5 },
  showReplay: { type: Boolean, default: false },
});
defineEmits(['run', 'controls', 'toggle-sound', 'music-volume', 'replay-tutorial']);

const pitch = PITCH;
const howOpen = ref(false);
</script>

<style scoped>
.open-gym {
  position: relative;
  min-height: 520px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid #3a4352;
  background: #101b2b;
}
.og-court { position: absolute; inset: 0; width: 100%; height: 100%; }
.og-net { animation: og-sway 4s ease-in-out infinite; transform-origin: 400px 177px; }
@keyframes og-sway { 50% { transform: skewX(2deg); } }

.og-content {
  position: relative;
  padding: 36px 32px 32px;
  max-width: 540px;
  background: linear-gradient(90deg, rgba(16, 27, 43, 0.94) 60%, rgba(16, 27, 43, 0));
  min-height: 520px;
}
.og-kicker {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: #f2b45f;
}
.og-title {
  margin: 10px 0 6px;
  font-size: clamp(2rem, 6vw, 3.1rem);
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.01em;
  color: #fff;
  transform: rotate(-2deg);
  transform-origin: left;
  text-shadow: 3px 3px 0 #d9773a, 6px 6px 0 rgba(0, 0, 0, 0.35);
}
.og-line { margin: 18px 0 14px; font-size: 1.12rem; color: #e9e3d6; font-weight: 600; }
.og-why { margin: 0 0 24px; padding-left: 18px; color: #c9c3b6; line-height: 1.5; font-size: 0.95rem; }
.og-why li { margin-bottom: 6px; }

.og-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.og-run, .og-btn {
  border-radius: 999px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.og-run {
  padding: 14px 30px;
  font-size: 1.15rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: none;
  color: #101b2b;
  background: #f2b45f;
  box-shadow: 0 4px 0 #a8642a, 0 10px 24px rgba(242, 180, 95, 0.25);
}
.og-run:hover { background: #f6c47a; }
.og-run:active { transform: translateY(3px); box-shadow: 0 1px 0 #a8642a; }
.og-btn {
  padding: 10px 18px;
  font-size: 0.95rem;
  color: #e9e3d6;
  background: rgba(233, 227, 214, 0.08);
  border: 1px solid rgba(233, 227, 214, 0.3);
}
.og-btn:hover { background: rgba(233, 227, 214, 0.16); }
.og-btn:active { transform: scale(0.96); }
.og-run:focus-visible, .og-btn:focus-visible, .og-link:focus-visible, .og-volume input:focus-visible {
  outline: 3px solid #f2b45f;
  outline-offset: 3px;
}
.og-volume { margin: 14px 0 0; display: flex; gap: 10px; align-items: center; color: #c9c3b6; font-size: 0.85rem; }
.og-volume input { accent-color: #f2b45f; width: 160px; }
.og-replay { margin: 14px 0 0; }
.og-link { background: none; border: none; color: #c9c3b6; text-decoration: underline; cursor: pointer; padding: 0; font-size: 0.85rem; }

@media (max-width: 600px) {
  .og-content { padding: 26px 18px; background: rgba(16, 27, 43, 0.9); max-width: none; }
  .og-run { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .og-net { animation: none; }
  .og-run, .og-btn { transition: none; }
}
</style>
