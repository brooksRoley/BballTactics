// Balance sweep: run many fights through the real WASM engine in Node and
// report win rates, scoring, and two motion measures.
//
//   node scripts/balance-sweep.mjs [engineDir=public] [sims=300]
//
// A fight is set up the way App.vue's syncEngineForRound does it (SpawnUnit for
// home, SetAwayTeamJSON for the ghost board, StartRound) and ticked the way
// CourtCanvas does it: fixed 1/60 s steps, 30 s of sim time (12 s on screen at
// 2.5x), then sudden-death overtime up to 15 s; a tie after OT is a home loss.
//
// Matchups:
//   top vs bottom   the five most expensive players vs the five cheapest:
//                   does talent decide games? (build review: 86%)
//   random mirror   the same random five on both sides: what does the home
//                   side get for free? (build review: 56%, ties count as losses)
//
// Motion measures, per sim second:
//   bunching        pairs of players closer than BUNCH_PX, averaged over ticks
//   teleports       ticks where the ball moved more than TELEPORT_PX
//   shots / passes  flights started per game (engines that report ball.flight)
//
// Pass an engine directory to compare builds: `node scripts/balance-sweep.mjs
// /tmp/old-engine` vs the default `public/`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const engineDir = resolve(process.argv[2] ?? 'public');
const SIMS = Number(process.argv[3] ?? 300);
const DT = 1 / 60;
const REGULATION_TICKS = 30 * 60;
const OT_TICKS = 15 * 60;
const BUNCH_PX = 20;
const TELEPORT_PX = 30;

const factory = new Function('require', '__dirname', `${readFileSync(join(engineDir, 'engine.js'), 'utf8')}; return Module;`)(
  createRequire(import.meta.url),
  engineDir,
);
const wasm = await factory({ locateFile: (file) => join(engineDir, file) });
const roster = JSON.parse(readFileSync(resolve('public/engine_roster.json'), 'utf8')).filter((p) => p.is_active !== false);

// A spread opening on the planning grid (cells 0–4), the same for both sides.
const FORMATION = [[2, 1], [1, 2], [3, 2], [1, 3], [3, 3]];

function fight(home, away) {
  const gm = new wasm.GameManager();
  home.forEach((p, i) => {
    gm.SpawnUnit(i + 1, p.name, p.team || '', p.stats.speed, p.stats.shooting, p.stats.defense);
    const [x, y] = FORMATION[i];
    gm.SetPlayerCoordinates(i + 1, x, y, x, y);
  });
  gm.SetAwayTeamJSON(JSON.stringify({
    units: away.map((p, i) => ({ id: 100 + i, name: p.name, x: FORMATION[i][0], y: FORMATION[i][1], stats: p.stats })),
  }));
  gm.StartRound();

  let bunchSum = 0;
  let teleports = 0;
  let ticks = 0;
  let shots = 0;
  let passes = 0;
  let prevFlight = 'none';
  let prevBall = null;
  let s = JSON.parse(gm.GetGameStateJSON());
  const step = () => {
    gm.TickSimulation(DT);
    s = JSON.parse(gm.GetGameStateJSON());
    ticks++;
    const all = [...(s.players || []), ...(s.bots || [])];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) < BUNCH_PX) bunchSum++;
      }
    }
    if (prevBall && Math.hypot(s.ball.x - prevBall.x, s.ball.y - prevBall.y) > TELEPORT_PX) teleports++;
    prevBall = { x: s.ball.x, y: s.ball.y };
    // Older engines don't report flights; there every shot turned the ball
    // loose (made shots reset it, misses arced off), so count held → loose.
    const flight = s.ball.flight ?? (s.ball.isPossessed ? 'none' : 'loose');
    if (flight !== prevFlight && (flight === 'shot' || (flight === 'loose' && prevFlight === 'none'))) shots++;
    if (flight !== prevFlight && flight === 'pass') passes++;
    prevFlight = flight;
  };
  for (let t = 0; t < REGULATION_TICKS; t++) step();
  for (let t = 0; t < OT_TICKS && s.homeScore === s.awayScore; t++) step();
  gm.delete();
  const secs = ticks * DT;
  return { home: s.homeScore, away: s.awayScore, bunchPerSec: bunchSum / ticks, teleportsPerSec: teleports / secs, shots, passes };
}

function sweep(label, pick) {
  const results = Array.from({ length: SIMS }, () => fight(...pick()));
  const n = results.length;
  const avg = (f) => results.reduce((a, r) => a + f(r), 0) / n;
  const row = {
    matchup: label,
    homeWin: `${((100 * results.filter((r) => r.home > r.away).length) / n).toFixed(0)}%`,
    avgScore: `${avg((r) => r.home).toFixed(1)}–${avg((r) => r.away).toFixed(1)}`,
    scoreless: `${((100 * results.filter((r) => r.home + r.away === 0).length) / n).toFixed(0)}%`,
    bunching: avg((r) => r.bunchPerSec).toFixed(2),
    teleportsPerSec: avg((r) => r.teleportsPerSec).toFixed(3),
    shots: avg((r) => r.shots).toFixed(1),
    passes: avg((r) => r.passes).toFixed(1),
  };
  return row;
}

const byCost = [...roster].sort((a, b) => b.cost - a.cost || b.stats.shooting - a.stats.shooting);
const top = byCost.slice(0, 5);
const bottom = byCost.slice(-5);
const randomFive = () => [...roster].sort(() => Math.random() - 0.5).slice(0, 5);

console.log(`engine: ${engineDir} · ${SIMS} sims per matchup`);
console.table([
  sweep('top vs bottom', () => [top, bottom]),
  sweep('random mirror', () => { const five = randomFive(); return [five, five]; }),
]);
