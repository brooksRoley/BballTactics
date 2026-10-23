<template>
  <div v-if="active" class="tour" @keydown="onKey" tabindex="-1" ref="root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <!-- Dim everything except the real element this stop is about. -->
    <div class="tour-spot" :style="spotStyle"></div>
    <div class="tour-card" :style="cardStyle">
      <p class="tour-step">{{ index + 1 }} / {{ stops.length }}</p>
      <h3 id="tour-title" class="tour-title">{{ stop.title }}</h3>
      <p class="tour-text">{{ stop.text }}</p>
      <div class="tour-nav">
        <button class="tour-btn" :disabled="index === 0" @click="go(index - 1)">← Back</button>
        <button v-if="index < stops.length - 1" class="tour-btn primary" @click="go(index + 1)">Next →</button>
        <button v-else class="tour-btn primary" @click="$emit('done')">Done</button>
      </div>
      <button class="tour-close" aria-label="Close the controls tour" @click="$emit('done')">×</button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CONTROLS_TOUR } from '../game/howToPlay.js';
import { sfx } from '../audio/sfx.js';

const props = defineProps({ active: { type: Boolean, default: false } });
const emit = defineEmits(['done']);

const root = ref(null);
const index = ref(0);
const rect = ref(null);
// Only stops whose element is on screen right now.
const stops = ref(CONTROLS_TOUR);
const stop = computed(() => stops.value[index.value] || CONTROLS_TOUR[0]);

const PAD = 8;
const measure = () => {
  const el = document.querySelector(`[data-tour="${stop.value.target}"]`);
  if (!el) { rect.value = null; return; }
  const r = el.getBoundingClientRect();
  rect.value = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
};

const spotStyle = computed(() => {
  if (!rect.value) return { display: 'none' };
  const { top, left, width, height } = rect.value;
  return { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` };
});

const cardStyle = computed(() => {
  if (!rect.value) return { top: '30%', left: '50%', transform: 'translateX(-50%)' };
  const below = rect.value.top + rect.value.height + 12;
  const fitsBelow = below + 190 < window.innerHeight;
  const top = fitsBelow ? below : Math.max(12, rect.value.top - 202);
  const left = Math.min(Math.max(12, rect.value.left), window.innerWidth - 332);
  return { top: `${top}px`, left: `${left}px` };
});

const go = async (i) => {
  if (i < 0 || i >= stops.value.length) return;
  index.value = i;
  sfx.play('open');
  const el = document.querySelector(`[data-tour="${stop.value.target}"]`);
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await nextTick();
  measure();
  setTimeout(measure, 350); // after the smooth scroll settles
};

const onKey = (e) => {
  if (e.key === 'ArrowRight' || e.key === 'Enter') go(index.value + 1);
  else if (e.key === 'ArrowLeft') go(index.value - 1);
  else if (e.key === 'Escape') emit('done');
};

const relayout = () => props.active && measure();
watch(() => props.active, async (on) => {
  if (!on) return;
  stops.value = CONTROLS_TOUR.filter((s) => document.querySelector(`[data-tour="${s.target}"]`));
  index.value = 0;
  await nextTick();
  go(0);
  root.value && root.value.focus();
}, { immediate: true });
onMounted(() => {
  window.addEventListener('resize', relayout);
  window.addEventListener('scroll', relayout, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', relayout);
  window.removeEventListener('scroll', relayout, true);
});
</script>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 70; outline: none; }
.tour-spot {
  position: fixed;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(8, 12, 20, 0.74), 0 0 0 3px #f2b45f;
  transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
  pointer-events: none;
}
.tour-card {
  position: fixed;
  width: min(320px, calc(100vw - 24px));
  padding: 18px 18px 14px;
  border-radius: 14px;
  background: #16202f;
  border: 1px solid #3a4352;
  color: #e9e3d6;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
}
.tour-step { margin: 0; font-size: 0.72rem; letter-spacing: 0.2em; font-weight: 800; color: #f2b45f; }
.tour-title { margin: 4px 0 6px; font-size: 1.15rem; color: #fff; }
.tour-text { margin: 0 0 12px; line-height: 1.5; font-size: 0.95rem; }
.tour-nav { display: flex; justify-content: space-between; gap: 8px; }
.tour-btn { padding: 8px 14px; border-radius: 999px; font-weight: 800; cursor: pointer; border: 1px solid #3a4352; background: transparent; color: #e9e3d6; }
.tour-btn.primary { background: #f2b45f; color: #101b2b; border-color: #f2b45f; }
.tour-btn:disabled { opacity: 0.35; cursor: default; }
.tour-btn:focus-visible, .tour-close:focus-visible { outline: 3px solid #f2b45f; outline-offset: 2px; }
.tour-close { position: absolute; top: 8px; right: 10px; background: none; border: none; color: #9aa3ae; font-size: 1.5rem; cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .tour-spot { transition: none; } }
</style>
