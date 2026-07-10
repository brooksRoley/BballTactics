<template>
  <div class="sim-container">
    <div class="sim-header">
      <div class="team-score home">YOU: <span class="score-val" :key="'h' + homeScore">{{ homeScore }}</span></div>
      <div class="sim-timer">{{ timeLeft.toFixed(1) }}s</div>
      <div class="team-score away">OPP: <span class="score-val" :key="'a' + awayScore">{{ awayScore }}</span></div>
    </div>

    <div class="court-scaler" ref="courtScaler" :style="{ height: (COURT_H * courtScale) + 'px' }">
      <canvas ref="courtCanvas"
              :width="COURT_W * dpr"
              :height="COURT_H * dpr"
              class="court-canvas"
              :style="{ width: COURT_W + 'px', height: COURT_H + 'px', transform: `scale(${courtScale})`, transformOrigin: 'top left' }">
      </canvas>
    </div>

    <div class="sim-status">{{ statusText }}</div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, inject } from 'vue';
import { FEEL, Shake, prefersReducedMotion, easeOutBack, easeOutCubic } from '../fx/feel.js';
import { createFallbackSim } from '../game/fallbackSim.js';

export default {
  props: {
    engine: { type: Object, default: null },
    courtLineup: { type: Array, default: () => [] },
    // Ghost board + tactics multipliers: applied by the engine via App.vue's
    // syncEngineForRound in the normal case; consumed directly by the JS
    // backup ref (fallbackSim.js) when the engine failed to load.
    opponentUnits: { type: Array, default: () => [] },
    homeMultiplier: { type: Number, default: 1 },
    awayMultiplier: { type: Number, default: 1 },
    roundStats: { type: Object, default: () => ({ playerScoring: [], events: [] }) }
  },
  emits: ['sim-complete'],
  setup(props, { emit }) {
    const livePlayers = ref([]);
    const botPlayers = ref([]);
    const ball = ref({ x: 400, y: 200, z: 0, possessorId: -1, isPossessed: false });
    const homeScore = ref(0);
    const awayScore = ref(0);
    const timeLeft = ref(10.0);
    const statusText = ref('Tip-off!');
    let animationFrameId = null;
    let lastTime = 0;
    let simDone = false;
    let fallback = null; // pure-JS backup ref, built only when the engine is missing

    // Scoring attribution tracking
    const playerPoints = {};
    const eventLog = [];

    const COURT_W = 800;
    const COURT_H = 400;
    const SIM_DURATION = 10.0;
    const dpr = Math.ceil(window.devicePixelRatio || 1);

    // Rims: home attacks right, bots attack left (matches the WASM engine)
    const RIMS = {
      left:  { x: 24, y: COURT_H / 2 },
      right: { x: COURT_W - 24, y: COURT_H / 2 },
    };

    const courtScaler = ref(null);
    const courtCanvas = ref(null);
    const courtScale = ref(1);
    let resizeObserver = null;
    let ctx = null;
    let floorGradient = null;

    const getEngine = () => props.engine || inject('engine', null);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const gridToSim = (gx, gy) => ({ x: gx * 70 + 40, y: gy * 70 + 40 });

    // ── FX state ──────────────────────────────────────────────────
    const reduced = prefersReducedMotion();
    const shake = new Shake();
    const trail = [];                       // ball motion trail samples {x, y}
    const ripples = [];                     // {x, y, age, delay}
    const pulses = [];                      // {playerId, isHome, age, strength}
    const floaters = [];                    // {x, y, vx, vy, text, color, age, life, size}
    const netFlick = { left: 0, right: 0 }; // seconds remaining
    const boardShudder = { left: 0, right: 0 };
    let simTime = 0;
    let lastScoreT = -10;
    let prevPoss = -2;                      // -2 = uninitialized
    let flight = null;                      // shot-in-flight tracker
    let crowd = [];                         // ambient edge shimmer particles

    const initCrowd = () => {
      if (reduced) return;
      const cfg = FEEL.particles;
      crowd = [];
      for (let i = 0; i < cfg.crowdCount; i++) {
        const top = i % 2 === 0;
        crowd.push({
          x: Math.random() * COURT_W,
          y: top ? 3 + Math.random() * 6 : COURT_H - 9 + Math.random() * 6,
          vx: (Math.random() - 0.5) * 2 * cfg.crowdDriftSpeed,
          phase: Math.random() * Math.PI * 2,
          size: 1 + Math.random() * 1.6,
        });
      }
    };

    const isHomeId = (id) => livePlayers.value.some(p => p.id === id);
    const isBotId  = (id) => botPlayers.value.some(p => p.id === id);

    const addPulse = (playerId, isHome, strength = 1) => {
      if (reduced) return;
      pulses.push({ playerId, isHome, age: 0, strength });
      if (pulses.length > 8) pulses.shift();
    };

    const spawnFloater = (x, y, text, color, size = FEEL.floaters.fontPx) => {
      const cfg = FEEL.floaters;
      if (floaters.length >= cfg.maxActive) floaters.shift();
      floaters.push({
        x, y,
        vx: (Math.random() - 0.5) * 24,
        vy: reduced ? 0 : cfg.launchVy,
        text, color, size,
        age: 0,
        life: cfg.life,
      });
    };

    const triggerMake = (side) => {
      const rim = RIMS[side];
      if (!reduced) {
        const cfg = FEEL.rim;
        for (let i = 0; i < cfg.rippleRings; i++) {
          ripples.push({ x: rim.x, y: rim.y, age: 0, delay: i * 0.09 });
        }
        netFlick[side] = cfg.netFlickDuration;
      }
      shake.add(FEEL.shake.weights.score);
    };

    const triggerMiss = (side) => {
      if (!reduced) boardShudder[side] = FEEL.rim.boardShudderDuration;
      shake.add(FEEL.shake.weights.miss);
      statusText.value = 'Off the iron!';
      setTimeout(() => { if (!simDone && statusText.value === 'Off the iron!') statusText.value = ''; }, 900);
    };

    const attributeScore = (pts, isHome) => {
      const possId = ball.value.possessorId;
      lastScoreT = simTime;
      const side = isHome ? 'right' : 'left';
      const rim = RIMS[side];

      if (isHome) {
        const scorer = livePlayers.value.find(p => p.id === possId) ||
                       livePlayers.value.find(p => p.id === (flight && flight.fromId));
        const name = scorer?.name || `Player ${possId}`;
        const sid = scorer?.id ?? possId;
        playerPoints[sid] = (playerPoints[sid] || { id: sid, name, points: 0 });
        playerPoints[sid].points += pts;
        const label = pts === 3 ? 'Three!' : 'Score!';
        const shortName = name.split(' ').pop();
        eventLog.push(`${shortName} hits a ${pts === 3 ? 'three-pointer' : 'bucket'} (+${pts})`);
        spawnFloater(rim.x - 44, rim.y - 34, `+${pts}`, '#ffd75e');
        if (scorer) addPulse(scorer.id, true, 1);
        statusText.value = `${shortName} — ${label}`;
      } else {
        eventLog.push(`Opponent scores (+${pts})`);
        spawnFloater(rim.x + 44, rim.y - 34, `+${pts}`, '#7fd4f2');
        statusText.value = 'Opponent scores...';
      }
      triggerMake(side);
      setTimeout(() => { if (!simDone) statusText.value = ''; }, 1000);
    };

    // ── Possession / shot event detection ─────────────────────────
    const detectEvents = () => {
      const b = ball.value;
      const poss = b.possessorId ?? -1;
      const justScored = simTime - lastScoreT < 0.6;

      if (prevPoss === -2) { prevPoss = poss; return; }

      if (poss === -1) {
        // Ball in the air → start tracking a potential shot
        if (!flight && prevPoss !== -1) {
          flight = {
            fromId: prevPoss,
            fromHome: isHomeId(prevPoss),
            startHome: homeScore.value,
            startAway: awayScore.value,
            maxZ: 0,
          };
        }
        if (flight) flight.maxZ = Math.max(flight.maxZ, b.z || 0);
      } else {
        if (flight) {
          // A flight just resolved into someone's hands
          const scored = homeScore.value !== flight.startHome || awayScore.value !== flight.startAway;
          if (!scored && !justScored) {
            const wasShot = flight.maxZ > 6;
            const nearLeft = Math.hypot(b.x - RIMS.left.x, b.y - RIMS.left.y) < 160;
            const nearRight = Math.hypot(b.x - RIMS.right.x, b.y - RIMS.right.y) < 160;
            if (wasShot && (nearLeft || nearRight)) {
              triggerMiss(nearRight ? 'right' : 'left');
            } else if (poss !== flight.fromId) {
              const catcherHome = isHomeId(poss);
              const known = isHomeId(poss) || isBotId(poss);
              if (known && catcherHome !== flight.fromHome) {
                shake.add(FEEL.shake.weights.steal);   // mid-air turnover
                addPulse(poss, catcherHome, 0.9);
              } else if (known) {
                shake.add(FEEL.shake.weights.pass);    // completed pass
                addPulse(poss, catcherHome, 0.5);
              }
            }
          }
          flight = null;
        } else if (prevPoss !== poss && prevPoss !== -1 && !justScored) {
          // Direct hand-off / rip: A → B with no airborne gap
          const prevHome = isHomeId(prevPoss);
          const newHome = isHomeId(poss);
          const bothKnown = (isHomeId(poss) || isBotId(poss)) && (isHomeId(prevPoss) || isBotId(prevPoss));
          if (bothKnown && prevHome !== newHome) {
            shake.add(FEEL.shake.weights.steal);
            addPulse(poss, newHome, 0.9);
            const stealer = (newHome ? livePlayers.value : botPlayers.value).find(p => p.id === poss);
            if (stealer) {
              spawnFloater(stealer.x + 15, stealer.y - 8, 'STEAL', newHome ? '#ffd75e' : '#7fd4f2', 12);
              eventLog.push(`${newHome ? (stealer.name || 'Player').split(' ').pop() : 'Opponent'} with the steal!`);
            }
          } else if (bothKnown) {
            shake.add(FEEL.shake.weights.pass);
            addPulse(poss, newHome, 0.5);
          }
        }
      }
      prevPoss = poss;
    };

    // ── FX simulation step ────────────────────────────────────────
    const fxUpdate = (dt) => {
      simTime += dt;
      shake.update(dt);

      // Ball trail sampling
      const b = ball.value;
      const airborne = b.x !== null && (b.z || 0) > FEEL.ball.trailMinZ;
      if (airborne && !reduced) {
        trail.push({
          x: clamp(b.x + 6, 6, COURT_W - 6),
          y: clamp(b.y - (b.z || 0) * FEEL.ball.liftPerZ + 6, -40, COURT_H - 6),
        });
        while (trail.length > FEEL.ball.trailLength) trail.shift();
      } else if (trail.length) {
        trail.shift();               // let the trail dissolve tail-first
        if (trail.length) trail.shift();
      }

      // Timed FX
      for (const r of ripples) r.age += dt;
      for (let i = ripples.length - 1; i >= 0; i--) {
        if (ripples[i].age - ripples[i].delay > FEEL.rim.rippleDuration) ripples.splice(i, 1);
      }
      for (const p of pulses) p.age += dt;
      for (let i = pulses.length - 1; i >= 0; i--) {
        if (pulses[i].age > FEEL.pulse.duration) pulses.splice(i, 1);
      }
      for (const f of floaters) {
        f.age += dt;
        f.vy += (reduced ? 0 : FEEL.floaters.gravity) * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      }
      for (let i = floaters.length - 1; i >= 0; i--) {
        if (floaters[i].age > floaters[i].life) floaters.splice(i, 1);
      }
      netFlick.left = Math.max(0, netFlick.left - dt);
      netFlick.right = Math.max(0, netFlick.right - dt);
      boardShudder.left = Math.max(0, boardShudder.left - dt);
      boardShudder.right = Math.max(0, boardShudder.right - dt);

      // Crowd shimmer drift
      for (const s of crowd) {
        s.x += s.vx * dt;
        if (s.x < -4) s.x = COURT_W + 4;
        if (s.x > COURT_W + 4) s.x = -4;
      }
    };

    // ── Drawing helpers ───────────────────────────────────────────
    const drawBasket = (c, side) => {
      const rim = RIMS[side];
      const cfg = FEEL.rim;
      const dir = side === 'left' ? 1 : -1; // toward court center
      const boardX = side === 'left' ? 10 : COURT_W - 10;

      // Backboard, with shudder on misses
      let bOff = 0;
      if (boardShudder[side] > 0) {
        const t = cfg.boardShudderDuration - boardShudder[side];
        bOff = Math.sin(t * cfg.boardShudderFreq) * cfg.boardShudderAmp * (boardShudder[side] / cfg.boardShudderDuration);
      }
      c.strokeStyle = 'rgba(255,240,215,0.5)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(boardX + bOff, COURT_H / 2 - 20);
      c.lineTo(boardX + bOff, COURT_H / 2 + 20);
      c.stroke();

      // Rim
      c.strokeStyle = '#e8734f';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(rim.x, rim.y, 8, 0, Math.PI * 2);
      c.stroke();

      // Net strands (stylized top-down): short curves radiating court-ward,
      // flicking after a make
      let flick = 0;
      if (netFlick[side] > 0) {
        const t = cfg.netFlickDuration - netFlick[side];
        flick = Math.sin(t * 26) * cfg.netFlickAmp * (netFlick[side] / cfg.netFlickDuration);
      }
      c.strokeStyle = 'rgba(255,255,255,0.55)';
      c.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        const baseY = rim.y + i * 5;
        c.beginPath();
        c.moveTo(rim.x + dir * 7, baseY);
        c.quadraticCurveTo(
          rim.x + dir * 12, baseY + flick * 0.5,
          rim.x + dir * 16, baseY + flick * (1 - Math.abs(i) * 0.3)
        );
        c.stroke();
      }

      // Make ripples anchored to this rim
      for (const r of ripples) {
        if (Math.abs(r.x - rim.x) > 1) continue;
        const t = (r.age - r.delay) / FEEL.rim.rippleDuration;
        if (t < 0 || t > 1) continue;
        const [rr, gg, bb] = FEEL.rim.rippleColor;
        c.strokeStyle = `rgba(${rr},${gg},${bb},${(0.7 * (1 - t)).toFixed(3)})`;
        c.lineWidth = 2.5 * (1 - t) + 0.5;
        c.beginPath();
        c.arc(rim.x, rim.y, 8 + easeOutCubic(t) * FEEL.rim.rippleMaxRadius, 0, Math.PI * 2);
        c.stroke();
      }
    };

    const drawTrail = (c) => {
      if (trail.length < 2) return;
      const [tr, tg, tb] = FEEL.ball.trailColor;
      c.lineCap = 'round';
      for (let i = 1; i < trail.length; i++) {
        const t = i / trail.length; // 0 old → 1 new
        c.strokeStyle = `rgba(${tr},${tg},${tb},${(t * 0.5).toFixed(3)})`;
        c.lineWidth = Math.max(0.5, FEEL.ball.trailWidth * t);
        c.beginPath();
        c.moveTo(trail[i - 1].x, trail[i - 1].y);
        c.lineTo(trail[i].x, trail[i].y);
        c.stroke();
      }
      c.lineCap = 'butt';
    };

    const drawPulses = (c) => {
      for (const p of pulses) {
        const list = p.isHome ? livePlayers.value : botPlayers.value;
        const unit = list.find(u => u.id === p.playerId);
        if (!unit) continue;
        const t = p.age / FEEL.pulse.duration;
        const [r, g, b] = FEEL.pulse.color;
        c.strokeStyle = `rgba(${r},${g},${b},${(0.8 * (1 - t) * p.strength).toFixed(3)})`;
        c.lineWidth = 2.5 * (1 - t) + 0.5;
        c.beginPath();
        c.arc(
          clamp(unit.x + 15, 15, COURT_W - 15),
          clamp(unit.y + 15, 15, COURT_H - 15),
          16 + easeOutCubic(t) * FEEL.pulse.maxRadius * p.strength,
          0, Math.PI * 2
        );
        c.stroke();
      }
    };

    const drawFloaters = (c) => {
      const cfg = FEEL.floaters;
      for (const f of floaters) {
        const t = f.age / f.life;
        const popT = Math.min(1, f.age / 0.25);
        const scale = cfg.popScale + (1 - cfg.popScale) * easeOutBack(popT);
        const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        c.save();
        c.translate(f.x, f.y);
        c.scale(scale, scale);
        c.font = `900 ${f.size}px sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = 3;
        c.strokeStyle = `rgba(10,6,4,${(alpha * 0.85).toFixed(3)})`;
        c.strokeText(f.text, 0, 0);
        c.fillStyle = f.color;
        c.globalAlpha = alpha;
        c.fillText(f.text, 0, 0);
        c.globalAlpha = 1;
        c.restore();
      }
    };

    const drawCrowd = (c) => {
      const cfg = FEEL.particles;
      const [r, g, b] = cfg.crowdColor;
      for (const s of crowd) {
        const tw = 0.5 + 0.5 * Math.sin(simTime * Math.PI * 2 * cfg.crowdTwinkleHz + s.phase);
        c.fillStyle = `rgba(${r},${g},${b},${(0.08 + 0.2 * tw).toFixed(3)})`;
        c.beginPath();
        c.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        c.fill();
      }
    };

    // ── Canvas rendering ──────────────────────────────────────────
    const renderFrame = () => {
      if (!ctx) return;
      const c = ctx;
      c.save();
      c.scale(dpr, dpr);

      // Letterbox behind the shake so edges never show raw canvas
      c.fillStyle = '#140c07';
      c.fillRect(0, 0, COURT_W, COURT_H);

      c.translate(shake.offsetX, shake.offsetY);

      // Court floor — dark walnut with a warm center glow
      c.fillStyle = floorGradient || '#33231a';
      c.fillRect(0, 0, COURT_W, COURT_H);

      // Court border
      c.strokeStyle = 'rgba(255,214,150,0.35)';
      c.lineWidth = 4;
      c.strokeRect(2, 2, COURT_W - 4, COURT_H - 4);

      // Half-court line
      c.strokeStyle = 'rgba(255,235,200,0.22)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(COURT_W / 2, 0);
      c.lineTo(COURT_W / 2, COURT_H);
      c.stroke();

      // Center circle
      c.beginPath();
      c.arc(COURT_W / 2, COURT_H / 2, 40, 0, Math.PI * 2);
      c.stroke();

      // Three-point arcs (left and right)
      c.beginPath();
      c.arc(0, COURT_H / 2, 160, -Math.PI * 0.4, Math.PI * 0.4);
      c.stroke();
      c.beginPath();
      c.arc(COURT_W, COURT_H / 2, 160, Math.PI * 0.6, Math.PI * 1.4);
      c.stroke();

      // Paint / key areas
      c.strokeStyle = 'rgba(255,235,200,0.16)';
      c.strokeRect(0, COURT_H / 2 - 60, 120, 120);
      c.strokeRect(COURT_W - 120, COURT_H / 2 - 60, 120, 120);

      // Baskets (backboard + rim + net + make ripples)
      drawBasket(c, 'left');
      drawBasket(c, 'right');

      // Ambient crowd shimmer along the sidelines
      if (!simDone) drawCrowd(c);

      const b = ball.value;
      const possId = b.possessorId;

      // Ball floor shadow — tightens and fades as the ball rises
      if (b.x !== null) {
        const z = b.z || 0;
        const alpha = Math.max(0.06, FEEL.ball.shadowMaxAlpha - z * FEEL.ball.shadowShrink * 0.35);
        const spread = 1 + Math.min(1, z * FEEL.ball.shadowShrink);
        c.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
        c.beginPath();
        c.ellipse(
          clamp(b.x + 6, 6, COURT_W - 6),
          clamp(b.y + 10, 6, COURT_H - 6),
          7 * spread, 3 * spread, 0, 0, Math.PI * 2
        );
        c.fill();
      }

      // Ball motion trail
      drawTrail(c);

      // Away players (cool blue)
      for (const bot of botPlayers.value) {
        const bx = clamp(bot.x + 15, 15, COURT_W - 15);
        const by = clamp(bot.y + 15, 15, COURT_H - 15);
        const hasBall = possId === bot.id;

        if (hasBall) {
          c.shadowColor = 'rgba(244, 163, 0, 0.8)';
          c.shadowBlur = 10;
        }

        c.globalAlpha = hasBall ? 1.0 : 0.85;
        c.fillStyle = '#4aa8c9';
        c.strokeStyle = hasBall ? '#f4a300' : 'rgba(255,255,255,0.85)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, 15, 0, Math.PI * 2);
        c.fill();
        c.stroke();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.globalAlpha = 1.0;

        const botLabel = bot.name ? bot.name.split(' ').pop().slice(0, 3) : 'OPP';
        c.fillStyle = '#fff';
        c.font = 'bold 8px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(botLabel, bx, by);
      }

      // Home players (warm red)
      for (const player of livePlayers.value) {
        const px = clamp(player.x + 15, 15, COURT_W - 15);
        const py = clamp(player.y + 15, 15, COURT_H - 15);
        const hasBall = possId === player.id;

        if (hasBall) {
          c.shadowColor = 'rgba(244, 163, 0, 0.8)';
          c.shadowBlur = 10;
        }

        c.fillStyle = '#e05a4e';
        c.strokeStyle = hasBall ? '#f4a300' : 'rgba(255,255,255,0.85)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(px, py, 15, 0, Math.PI * 2);
        c.fill();
        c.stroke();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;

        const label = player.name ? player.name.split(' ').pop().slice(0, 3) : String(player.id);
        c.fillStyle = '#fff';
        c.font = 'bold 8px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, px, py);
      }

      // Acting-unit highlight pulses
      drawPulses(c);

      // Ball
      if (b.x !== null) {
        const z = b.z || 0;
        const lift = z * FEEL.ball.liftPerZ;
        const radius = 6 * (1 + z * 0.04);
        const bx = clamp(b.x + 6, 6, COURT_W - 6);
        const by = clamp(b.y - lift + 6, 6, COURT_H - 6);

        c.shadowColor = '#f4a300';
        c.shadowBlur = 6 + Math.min(10, z * 0.5);
        c.fillStyle = '#f4a300';
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, radius, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
      }

      // Floating stat numbers (over everything)
      drawFloaters(c);

      c.restore();
    };

    // ── Sim helpers ───────────────────────────────────────────────
    // The engine and the JS backup ref emit the same state shape, so one
    // apply path drives rendering, scoring, and attribution for both.
    const applySimState = (state) => {
      livePlayers.value = state.players || [];
      botPlayers.value  = state.bots    || [];
      if (state.ball) ball.value = state.ball;

      const prevHome = homeScore.value;
      const prevAway = awayScore.value;
      homeScore.value = state.homeScore ?? homeScore.value;
      awayScore.value = state.awayScore ?? awayScore.value;

      if (homeScore.value > prevHome) {
        attributeScore(homeScore.value - prevHome, true);
      } else if (awayScore.value > prevAway) {
        attributeScore(awayScore.value - prevAway, false);
      }
    };

    // ── Game loop ─────────────────────────────────────────────────
    const syncLoop = (timestamp) => {
      if (simDone) return;

      const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
      lastTime = timestamp;
      timeLeft.value -= dt;

      if (timeLeft.value <= 0) {
        timeLeft.value = 0;
        fxUpdate(dt);
        renderFrame();
        finishSim();
        return;
      }

      const engine = getEngine();
      if (engine) {
        engine.TickSimulation(dt);
        try {
          applySimState(JSON.parse(engine.GetGameStateJSON()));
        } catch (e) { /* engine may not have state yet */ }
      } else if (fallback) {
        // Backup ref: pure-JS sim over the real ghost board with the round's
        // tactics multipliers (see client/game/fallbackSim.js).
        applySimState(fallback.step(dt));
      } else {
        // No engine AND no fallback (unmounted mid-flight edge) — stop clean.
        statusText.value = 'Engine unavailable — refresh the page.';
        simDone = true;
        renderFrame();
        return;
      }

      detectEvents();
      fxUpdate(dt);
      renderFrame();
      animationFrameId = requestAnimationFrame(syncLoop);
    };

    const finishSim = () => {
      simDone = true;
      const outcome = homeScore.value > awayScore.value ? 'win' : 'loss';
      statusText.value = outcome === 'win'
        ? 'Final — You win!'
        : homeScore.value === awayScore.value
          ? 'Final — Draw counts as a loss!'
          : 'Final — You lose.';

      // Build per-player scoring sorted by points
      const playerScoring = Object.values(playerPoints)
        .sort((a, b) => b.points - a.points);

      setTimeout(() => {
        emit('sim-complete', {
          outcome,
          homeScore: homeScore.value,
          awayScore: awayScore.value,
          playerScoring,
          events: eventLog,
        });
      }, 1500);
    };

    onMounted(() => {
      // Initialize canvas 2D context + cached floor gradient
      const canvas = courtCanvas.value;
      if (canvas) {
        ctx = canvas.getContext('2d');
        floorGradient = ctx.createRadialGradient(
          COURT_W / 2, COURT_H / 2, 60,
          COURT_W / 2, COURT_H / 2, 520
        );
        floorGradient.addColorStop(0, '#463122');
        floorGradient.addColorStop(0.65, '#33231a');
        floorGradient.addColorStop(1, '#231710');
      }

      initCrowd();
      if (!getEngine()) {
        // The WASM engine failed to load: build the pure-JS backup ref so the
        // fight still happens against the actual ghost board, with the same
        // tactics multipliers the engine would have baked into shooting.
        fallback = createFallbackSim({
          homeUnits: props.courtLineup,
          awayUnits: props.opponentUnits,
          homeMultiplier: props.homeMultiplier,
          awayMultiplier: props.awayMultiplier,
          seed: Date.now() >>> 0,
        });
        statusText.value = 'Backup ref — simplified sim';
      }
      lastTime = performance.now();
      timeLeft.value = SIM_DURATION;
      renderFrame();
      animationFrameId = requestAnimationFrame(syncLoop);

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
      simDone = true;
      cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();
    });

    return { homeScore, awayScore, timeLeft, statusText, courtScaler, courtCanvas, courtScale, COURT_W, COURT_H, dpr };
  }
};
</script>

<style scoped>
.sim-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.court-scaler {
  width: 100%;
  max-width: 800px;
  overflow: hidden;
}

.sim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 800px;
  padding: 8px 20px;
  background: #16100b;
  border: 1px solid #3a2b1c;
  border-radius: 4px;
}
.team-score { font-size: 1.3rem; font-weight: bold; }
.team-score.home { color: #e05a4e; }
.team-score.away { color: #4aa8c9; }
.sim-timer { font-size: 1.5rem; font-variant-numeric: tabular-nums; color: #ffd700; }

/* Score pop — the re-keyed span restarts this animation on every change */
.score-val {
  display: inline-block;
  animation: score-pop 0.45s cubic-bezier(0.18, 1.6, 0.4, 1);
}
@keyframes score-pop {
  0%   { transform: scale(1.7); filter: brightness(1.8); }
  100% { transform: scale(1);   filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .score-val { animation: none; }
}

.court-canvas {
  display: block;
  border-radius: 4px;
}

.sim-status {
  height: 24px;
  font-size: 1rem;
  color: #ffd700;
  font-weight: bold;
}
</style>
