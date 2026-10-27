// Full Court sweep: play many seeded games with a stand-in human and report
// whether the human matters, how fast the game moves, and which abilities do
// anything.
//
//   node scripts/full-court-sweep.mjs [seeds=10] [rulesDir=client/moba]
//
// Pass a different rules directory (a copy of client/moba from another
// commit, with ../game/fallbackSim.js beside it) to compare before and after.
//
// The stand-in human is a decent, not perfect, player who decides four times a
// second, the pace of a person clicking:
//   offense, no ball   run to the open spot nearest the ball side; when open,
//                      left-click the carrier to call for it
//   with the ball      bring it up; step-back (Q) when crowded and shoot off
//                      it; shoot a good look or a late clock; otherwise drive
//   defense            stay between your man and the rim; reach when close;
//                      Closeout (E) when he has the ball and you're late, or
//                      onto him off the ball when he's a pass away
//   W and R            Burst to catch up, the ultimate when its moment comes
// It reads the court from the match's internal state (where everyone is, the
// shot chance), the way a person reads the screen. It never reads `hud`, so the
// same policy runs against rules that predate the HUD fields.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEEDS = Number(process.argv[2] ?? 10);
const rulesDir = resolve(process.argv[3] ?? 'client/moba');
const { createMatch, shotChance, boxScore } = await import(pathToFileURL(resolve(rulesDir, 'match.js')).href);
const roster = JSON.parse(readFileSync(resolve('public/engine_roster.json'), 'utf8'));

// The human rotates through five archetypes so no one kit decides the numbers.
const HEROES = ['Steph Curry', 'Rudy Gobert', "De'Aaron Fox", 'Jalen Brunson', 'Derrick White'];
const DT = 1 / 60;
const DECIDE_EVERY = 15; // ticks: four decisions a second
const SPOTS = [{ x: 590, y: 200 }, { x: 650, y: 95 }, { x: 650, y: 305 }, { x: 755, y: 45 }, { x: 755, y: 355 }, { x: 700, y: 200 }];
const OWN_RIM = { x: 780, y: 200 };
const THEIR_RIM = { x: 20, y: 200 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;

function playGame(seed) {
  const heroName = HEROES[seed % HEROES.length];
  const hero = roster.find((p) => p.name === heroName);
  const match = createMatch({ roster, humanId: hero.id, seed });
  const m = match._m;
  const h = m.human;
  const ready = (s) => h.cd[s] <= 0 && h.stamina >= h.kit[s].cost;
  const cast = (slot, at) => match.command({ type: 'cast', slot, x: at.x, y: at.y });
  const nearestDef = (p) => m.teams.away.reduce((best, d) => (dist(d.pos, p.pos) < dist(best.pos, p.pos) ? d : best));

  let heldFor = 0;
  let shootNext = false;
  let callCd = 0;

  const decide = () => {
    const b = m.ball;
    const carrier = b.state === 'held' ? m.byId.get(b.holder) : null;
    callCd -= DECIDE_EVERY * DT;
    if (b.state === 'loose') { match.command({ type: 'move', ...b.pos }); return; }
    if (carrier === h) {
      heldFor += DECIDE_EVERY * DT;
      if (h.pos.x < 420) { match.command({ type: 'move', x: 600, y: 200 }); return; }
      const def = nearestDef(h);
      const crowd = dist(def.pos, h.pos);
      const toRim = dist(h.pos, OWN_RIM);
      if (shootNext || shotChance(m, h) >= 0.42 || m.shotClock < 2.5 || heldFor > 3.5) {
        if (h.kit.R.id === 'limitless' && toRim > 160 && ready('R')) cast('R', OWN_RIM);
        shootNext = false;
        heldFor = 0;
        match.command({ type: 'shoot' });
        return;
      }
      if (crowd < 38 && ready('Q')) { cast('Q', def.pos); shootNext = true; return; }
      if (heldFor > 1.5) {
        const open = m.teams.home.filter((q) => q !== h && dist(nearestDef(q).pos, q.pos) > 60);
        if (open.length) { const q = open[0]; match.command({ type: 'click', x: q.pos.x, y: q.pos.y }); heldFor = 0; return; }
      }
      if (crowd < 45 && ready('W')) cast('W', OWN_RIM);
      match.command({ type: 'move', x: OWN_RIM.x - 40, y: OWN_RIM.y + (h.pos.y < 200 ? -25 : 25) });
      return;
    }
    heldFor = 0;
    shootNext = false;
    if (m.offense === h.team) {
      // Find the open spot: far from defenders and from teammates.
      let best = null;
      for (const s of SPOTS) {
        const dDef = Math.min(...m.teams.away.map((d) => dist(d.pos, s)));
        const dMate = Math.min(...m.teams.home.filter((q) => q !== h).map((q) => dist(q.pos, s)));
        const v = dDef + 0.5 * Math.min(dMate, 80) - 0.15 * dist(h.pos, s);
        if (!best || v > best.v) best = { s, v };
      }
      match.command({ type: 'move', ...best.s });
      if (carrier && carrier.pos.x > 420 && h.pos.x < 400 && ready('W')) cast('W', best.s);
      if (carrier && h.kit.R.id === 'fastbreak' && carrier.pos.x < 400 && ready('R')) cast('R', OWN_RIM);
      const open = dist(nearestDef(h).pos, h.pos) > 55;
      if (carrier && open && callCd <= 0) {
        match.command({ type: 'click', x: carrier.pos.x, y: carrier.pos.y });
        callCd = 2.5;
      }
      return;
    }
    // Defense.
    const man = m.teams.away[h.idx];
    const gap = carrier === man ? 0.12 : 0.28;
    match.command({ type: 'move', x: lerp(man.pos.x, THEIR_RIM.x, gap), y: lerp(man.pos.y, THEIR_RIM.y, gap) });
    const d = dist(h.pos, man.pos);
    if (carrier === man) {
      if (d <= 32 && h.stealCd <= 0) match.command({ type: 'click', x: man.pos.x, y: man.pos.y });
      else if (d > 50 && d < h.kit.E.distance && ready('E')) cast('E', man.pos);
    } else if (carrier && d > 45 && d < h.kit.E.distance && dist(carrier.pos, man.pos) < 220 && ready('E')) {
      cast('E', man.pos); // deny the pass to him (rules that lack the deny just whiff)
    }
    if (carrier && h.kit.R.id === 'wall' && dist(carrier.pos, THEIR_RIM) < 170 && d < 90 && ready('R')) cast('R', h.pos);
    if (d > 120 && ready('W')) cast('W', man.pos);
  };

  const s = {
    seed, hero: heroName, possessions: 0, homePoss: 0, homePossTouched: 0, possSeconds: 0, liveSeconds: 0,
    firstTouch: [], humanCasts: { Q: 0, W: 0, E: 0, R: 0 }, aiCasts: 0, humanLocks: 0, humanDenies: 0,
    sbShots: 0, sbMakes: 0, sbPts: 0, plainShots: 0, plainMakes: 0, plainPts: 0, sbBefore: 0, sbAfter: 0, sbEvents: 0,
    leadChanges: 0, clutchShots: 0, buzzerMakes: 0,
  };
  let prevKey = null;
  let possStart = 0;
  let touched = false;
  let homePoss = false;
  let startedWithBall = false;
  let lastLeader = 0;
  const pendingShots = new Map();

  for (let t = 0; t < 900 * 60 && m.phase !== 'final'; t++) {
    if (m.phase === 'live' && t % DECIDE_EVERY === 0) decide();
    match.step(DT);
    const key = m.phase === 'live' ? m.offense : null;
    if (m.phase === 'live') s.liveSeconds += DT;
    if (key !== prevKey) {
      if (prevKey) s.possSeconds += m.time - possStart;
      if (key) {
        s.possessions += 1;
        possStart = m.time;
        homePoss = key === h.team;
        touched = false;
        startedWithBall = m.ball.holder === h.id;
        if (homePoss) s.homePoss += 1;
      }
      prevKey = key;
    }
    if (homePoss && key && !touched && m.ball.state === 'held' && m.ball.holder === h.id) {
      touched = true;
      s.homePossTouched += 1;
      if (!startedWithBall) s.firstTouch.push(m.time - possStart);
    }
    for (const e of match.drainEvents()) {
      if (e.type === 'cast') { if (e.playerId === h.id) s.humanCasts[e.slot] += 1; else s.aiCasts += 1; }
      if (e.type === 'stepback' && e.playerId === h.id) { s.sbEvents += 1; s.sbBefore += e.before; s.sbAfter += e.after; }
      if (e.type === 'make' && e.buzzer) s.buzzerMakes += 1;
      if (e.type === 'deny' && e.byId === h.id) s.humanDenies += 1;
      if (e.type === 'lock') { const c = m.byId.get(e.playerId); if (c.lock && c.lock.by === h.id) s.humanLocks += 1; }
      if (e.type === 'shot') {
        if (m.clock < 10 || m.shotClock < 3) s.clutchShots += 1;
        if (e.playerId === h.id) pendingShots.set(h.id, h.buffs.stepbackUntil > m.time);
      }
      if ((e.type === 'make' || e.type === 'miss') && e.playerId === h.id && pendingShots.has(h.id)) {
        const sb = pendingShots.get(h.id);
        pendingShots.delete(h.id);
        const pts = e.type === 'make' ? e.points : 0;
        if (sb) { s.sbShots += 1; s.sbPts += pts; if (pts) s.sbMakes += 1; } else { s.plainShots += 1; s.plainPts += pts; if (pts) s.plainMakes += 1; }
      }
      if (e.type === 'make') {
        const lead = Math.sign(m.score.home - m.score.away);
        if (lead !== 0 && lastLeader !== 0 && lead !== lastLeader) s.leadChanges += 1;
        if (lead !== 0) lastLeader = lead;
      }
    }
  }
  const box = boxScore(match);
  const all = [...box.home, ...box.away];
  const me = box.home.find((r) => r.isHuman);
  return {
    ...s,
    finished: m.phase === 'final',
    home: box.score.home, away: box.score.away,
    fga: all.reduce((a, r) => a + r.fga, 0), fgm: all.reduce((a, r) => a + r.fgm, 0),
    homeFga: box.home.reduce((a, r) => a + r.fga, 0),
    meFga: me.fga, mePts: me.pts, meAst: me.ast, meStl: me.stl,
  };
}

const games = Array.from({ length: SEEDS }, (_, i) => playGame(i + 1));
const n = games.length;
const sum = (f) => games.reduce((a, g) => a + f(g), 0);
const avg = (f) => sum(f) / n;
const pct = (num, den) => (den ? `${((100 * num) / den).toFixed(0)}%` : '—');
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const liveMin = sum((g) => g.liveSeconds) / 60;

console.log(`rules: ${rulesDir} · ${n} seeds · heroes rotate: ${HEROES.join(', ')}`);
console.table({
  'points per game (both teams)': avg((g) => g.home + g.away).toFixed(1),
  'possessions per game': avg((g) => g.possessions).toFixed(1),
  'seconds per possession': (sum((g) => g.possSeconds) / sum((g) => g.possessions)).toFixed(1),
  'FG% (all)': pct(sum((g) => g.fgm), sum((g) => g.fga)),
  'games finished': `${sum((g) => (g.finished ? 1 : 0))}/${n}`,
  'human touch share (own possessions)': pct(sum((g) => g.homePossTouched), sum((g) => g.homePoss)),
  'human shots per game': avg((g) => g.meFga).toFixed(1),
  'human share of team shots': pct(sum((g) => g.meFga), sum((g) => g.homeFga)),
  'human points per game': avg((g) => g.mePts).toFixed(1),
  'human assists / steals per game': `${avg((g) => g.meAst).toFixed(1)} / ${avg((g) => g.meStl).toFixed(1)}`,
  's to first touch (median, not inbounder)': median(games.flatMap((g) => g.firstTouch)).toFixed(1),
  'human casts/min Q W E R': ['Q', 'W', 'E', 'R'].map((k) => (sum((g) => g.humanCasts[k]) / liveMin).toFixed(1)).join(' '),
  'AI casts/min (all 9)': (sum((g) => g.aiCasts) / liveMin).toFixed(1),
  'step-back FG% vs other human FG%': `${pct(sum((g) => g.sbMakes), sum((g) => g.sbShots))} (${sum((g) => g.sbShots)}) vs ${pct(sum((g) => g.plainMakes), sum((g) => g.plainShots))}`,
  'step-back pts/shot vs other': `${(sum((g) => g.sbPts) / sum((g) => g.sbShots)).toFixed(2)} vs ${(sum((g) => g.plainPts) / sum((g) => g.plainShots)).toFixed(2)}`,
  'step-back chance before -> after': sum((g) => g.sbEvents) ? `${pct(sum((g) => g.sbBefore), sum((g) => g.sbEvents))} -> ${pct(sum((g) => g.sbAfter), sum((g) => g.sbEvents))}` : 'not reported',
  'human closeouts that lock / deny': `${pct(sum((g) => g.humanLocks), sum((g) => g.humanCasts.E))} / ${pct(sum((g) => g.humanDenies), sum((g) => g.humanCasts.E))}`,
  'human team win rate': pct(sum((g) => (g.home > g.away ? 1 : 0)), n),
  'avg final margin (abs)': avg((g) => Math.abs(g.home - g.away)).toFixed(1),
  'games decided by <=5': pct(sum((g) => (Math.abs(g.home - g.away) <= 5 ? 1 : 0)), n),
  'lead changes per game': avg((g) => g.leadChanges).toFixed(1),
  'clutch shots per game (<10 s or shot clock <3)': avg((g) => g.clutchShots).toFixed(1),
  'buzzer-beaters per game': avg((g) => g.buzzerMakes).toFixed(2),
});
