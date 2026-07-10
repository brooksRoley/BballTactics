<template>
  <span class="spring-bar" role="progressbar"
        :aria-valuenow="Math.round(value)" :aria-valuemin="0" :aria-valuemax="max">
    <span class="spring-bar-label"><slot>HP</slot></span>
    <span class="spring-bar-track">
      <!-- Ghost fill shows the damage just taken, draining behind the live fill -->
      <span class="spring-bar-ghost" :style="{ width: ghostPct + '%' }"></span>
      <span class="spring-bar-fill" :class="barClass" :style="{ width: displayPct + '%' }"></span>
    </span>
    <span class="spring-bar-text">{{ Math.round(displayValue) }}</span>
  </span>
</template>

<script>
// SpringBar — a stat bar that drains with a damped spring instead of jumping.
// Drop-in for App.vue's HP bar:  <SpringBar :value="health" />
// Tuning lives in FEEL.hpBar (client/fx/feel.js).
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { FEEL, Spring, prefersReducedMotion } from '../fx/feel.js';

export default {
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 100 },
  },
  setup(props) {
    const displayValue = ref(props.value);
    const ghostValue = ref(props.value);
    const spring = new Spring(props.value, FEEL.hpBar.stiffness, FEEL.hpBar.damping);
    const ghostSpring = new Spring(props.value, FEEL.hpBar.stiffness * 0.25, FEEL.hpBar.damping);
    let rafId = null;
    let last = 0;
    const reduced = prefersReducedMotion();

    const loop = (ts) => {
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      spring.update(dt);
      ghostSpring.update(dt);
      displayValue.value = Math.max(0, Math.min(props.max, spring.value));
      ghostValue.value = Math.max(0, Math.min(props.max, ghostSpring.value));
      if (spring.settled(0.05) && ghostSpring.settled(0.05)) {
        displayValue.value = props.value;
        ghostValue.value = props.value;
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(loop);
    };

    const kick = () => {
      if (rafId !== null) return;
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    };

    watch(() => props.value, (v) => {
      if (reduced) {
        spring.snap(v);
        ghostSpring.snap(v);
        displayValue.value = v;
        ghostValue.value = v;
        return;
      }
      spring.target = v;
      ghostSpring.target = v;
      kick();
    });

    onMounted(() => {
      spring.snap(props.value);
      ghostSpring.snap(props.value);
    });

    onUnmounted(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    });

    const displayPct = computed(() => (displayValue.value / props.max) * 100);
    const ghostPct = computed(() => (ghostValue.value / props.max) * 100);
    const barClass = computed(() => {
      const pct = displayPct.value;
      return pct < 25 ? 'critical' : pct < 55 ? 'hurt' : 'healthy';
    });

    return { displayValue, displayPct, ghostPct, barClass };
  }
};
</script>

<style scoped>
.spring-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: bold;
  color: #ccc;
}
.spring-bar-track {
  position: relative;
  width: 110px;
  height: 10px;
  background: #241811;
  border: 1px solid #3a2b1c;
  border-radius: 5px;
  overflow: hidden;
}
.spring-bar-ghost {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(224, 90, 78, 0.45);
  border-radius: 5px;
}
.spring-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 5px;
}
.spring-bar-fill.healthy  { background: linear-gradient(90deg, #2f9e5f, #4fc97f); }
.spring-bar-fill.hurt     { background: linear-gradient(90deg, #d99a2b, #f0b93e); }
.spring-bar-fill.critical { background: linear-gradient(90deg, #c0392b, #e05a4e); }
.spring-bar-text {
  min-width: 26px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
