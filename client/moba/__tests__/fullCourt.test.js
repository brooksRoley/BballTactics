/**
 * Full Court rules tests — no framework, plain Node:
 *   node client/moba/__tests__/fullCourt.test.js
 *
 * Covers the kit math (stats really change the kit), team balance, the
 * determinism a replay needs, a whole AI-played game reaching a final, and
 * each human command doing what the controls card promises.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildKit, signatureStat, moveSpeed } from '../kits.js';
import { createMatch, pickTeams, shotChance, boxScore, cast } from '../match.js';

const roster = JSON.parse(readFileSync(new URL('../../../public/engine_roster.json', import.meta.url)));
const byName = (n) => roster.find((p) => p.name === n);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

// A minimal stand-in for a person: shoot after holding the ball a beat, and
// otherwise run to a spot on whichever end is in play.
const runToEnd = (match, maxSeconds = 600) => {
  const m = match._m;
  let held = 0;
  for (let t = 0; t < maxSeconds * 60 && m.phase !== 'final'; t++) {
    if (m.ball.state === 'held' && m.ball.holder === m.human.id) {
      held += 1 / 60;
      if (held > 1.2) { match.command({ type: 'shoot' }); held = 0; }
    } else {
      held = 0;
      if (t % 30 === 0) match.command({ type: 'move', ...(m.offense === 'home' ? { x: 650, y: 300 } : { x: 200, y: 200 }) });
    }
    match.step(1 / 60);
  }
  return match.view();
};

test('kits scale with the stat they are built on', () => {
  const curry = buildKit(byName('Steph Curry'));
  const haslem = buildKit(byName('Udonis Haslem'));
  assert.ok(curry.Q.distance > haslem.Q.distance, 'better shooter steps back further');
  assert.ok(curry.Q.cooldown < haslem.Q.cooldown, 'better shooter steps back more often');
  const wemby = buildKit(byName('Victor Wembanyama'));
  assert.ok(wemby.E.distance > curry.E.distance, 'better defender closes out further');
  assert.ok(moveSpeed(byName("De'Aaron Fox")) > moveSpeed(byName('Rudy Gobert')));
});

test('the ultimate follows the highest stat', () => {
  assert.equal(signatureStat(byName('Luka Doncic')), 'shooting');
  assert.equal(signatureStat(byName('Rudy Gobert')), 'defense');
  assert.equal(signatureStat(byName('Jose Alvarado')), 'speed');
  assert.equal(buildKit(byName('Rudy Gobert')).R.id, 'wall');
});

test('teams are two fives, human leads home, costs stay close', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { home, away } = pickTeams(roster, byName('Steph Curry').id, seed);
    assert.equal(home.length, 5);
    assert.equal(away.length, 5);
    assert.equal(home[0].name, 'Steph Curry');
    const ids = new Set([...home, ...away].map((p) => p.id));
    assert.equal(ids.size, 10, 'no player on both sides');
    const cost = (t) => t.reduce((s, p) => s + p.cost, 0);
    assert.ok(Math.abs(cost(home) - cost(away)) <= 3, `seed ${seed}: ${cost(home)} vs ${cost(away)}`);
  }
});

test('same seed and same commands replay identically', () => {
  const play = () => {
    const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 42 });
    for (let i = 0; i < 60 * 30; i++) {
      if (i === 120) mt.command({ type: 'move', x: 600, y: 120 });
      if (i === 400) mt.command({ type: 'cast', slot: 'W', x: 0, y: 0 });
      mt.step(1 / 60);
    }
    return JSON.stringify(mt.view());
  };
  assert.equal(play(), play());
});

test('a full AI-played game reaches a final with a winner', () => {
  for (const seed of [3, 7, 11]) {
    const mt = createMatch({ roster, humanId: byName('Derrick White').id, seed, quarterLength: 45 });
    const v = runToEnd(mt);
    assert.equal(v.hud.phase, 'final', `seed ${seed} never ended`);
    assert.notEqual(v.homeScore, v.awayScore, 'no ties at the final');
    const total = v.homeScore + v.awayScore;
    assert.ok(total >= 20 && total <= 120, `seed ${seed}: implausible total ${total}`);
    const box = boxScore(mt);
    const pts = (t) => box[t].reduce((s, r) => s + r.pts, 0);
    assert.equal(pts('home'), v.homeScore, 'box score sums to the home score');
    assert.equal(pts('away'), v.awayScore, 'box score sums to the away score');
  }
});

test('players stay on the court', () => {
  const mt = createMatch({ roster, humanId: byName('Bam Adebayo').id, seed: 5 });
  for (let i = 0; i < 60 * 40; i++) {
    mt.step(1 / 60);
    const v = mt.view();
    for (const p of [...v.players, ...v.bots]) {
      assert.ok(p.x + 15 >= 12 && p.x + 15 <= 788 && p.y + 15 >= 12 && p.y + 15 <= 388, 'on court');
    }
  }
});

test('Space shoots only with the ball', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 9 });
  const m = mt._m;
  assert.equal(m.ball.holder, m.teams.home[0].id, 'home tips off to the human');
  mt.command({ type: 'shoot' });
  assert.equal(m.ball.state, 'shot');
  assert.equal(m.human.line.fga, 1);
  mt.drainEvents();
  mt.command({ type: 'shoot' });
  assert.equal(mt.drainEvents()[0].type, 'denied');
});

test('left-click on a teammate passes, and the pass arrives', () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 4 });
  const m = mt._m;
  const mate = m.teams.home[1];
  mt.command({ type: 'click', x: mate.pos.x, y: mate.pos.y });
  assert.equal(m.ball.state, 'pass');
  for (let i = 0; i < 120 && m.ball.state === 'pass'; i++) mt.step(1 / 60);
  assert.equal(m.ball.state, 'held');
  assert.equal(m.offense, 'home', 'still our ball, or a pick-off flipped it');
});

test('abilities spend stamina, start cooldowns, and refuse when they should', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 8 });
  const m = mt._m;
  const h = m.human;
  mt.command({ type: 'cast', slot: 'Q', x: h.pos.x + 50, y: h.pos.y });
  assert.ok(h.cd.Q > 0, 'step-back on cooldown');
  assert.equal(h.stamina, 100 - h.kit.Q.cost);
  mt.drainEvents();
  mt.command({ type: 'cast', slot: 'Q', x: 0, y: 0 });
  assert.match(mt.drainEvents()[0].text, /cooldown/);
  mt.command({ type: 'cast', slot: 'E', x: 0, y: 0 });
  assert.match(mt.drainEvents()[0].text, /defense/, 'closeout is defense-only');
  h.stamina = 5;
  mt.command({ type: 'cast', slot: 'W', x: 0, y: 0 });
  assert.match(mt.drainEvents()[0].text, /stamina/);
});

test('step-back lowers the contest on the next shot', () => {
  const mt = createMatch({ roster, humanId: byName('Luka Doncic').id, seed: 2 });
  const m = mt._m;
  const h = m.human;
  const def = m.teams.away[0];
  h.pos = { x: 600, y: 200 };
  def.pos = { x: 620, y: 200 };
  const before = shotChance(m, h);
  h.buffs.stepbackUntil = m.time + 1;
  h.buffs.stepbackIgnore = h.kit.Q.contestIgnore;
  assert.ok(shotChance(m, h) > before);
});

test('The Wall makes shots inside it worse', () => {
  const mt = createMatch({ roster, humanId: byName('Rudy Gobert').id, seed: 6 });
  const m = mt._m;
  const gobert = m.human;
  const shooter = m.teams.away[0];
  shooter.pos = { x: 150, y: 200 };
  gobert.pos = { x: 220, y: 300 };
  for (const d of m.teams.home) if (d !== gobert) d.pos = { x: 700, y: 50 };
  const before = shotChance(m, shooter);
  m.offense = 'away';
  assert.ok(cast(m, gobert, 'R'));
  gobert.pos = { x: 160, y: 240 };
  assert.ok(shotChance(m, shooter) < before);
});

test('a steal flips possession and resets the shot clock', () => {
  const mt = createMatch({ roster, humanId: byName('Alex Caruso').id, seed: 12 });
  const m = mt._m;
  const carrier = m.teams.away[0];
  m.offense = 'away';
  m.ball.holder = carrier.id;
  m.shotClock = 3;
  m.human.pos = { x: carrier.pos.x + 10, y: carrier.pos.y };
  let stole = false;
  for (let tries = 0; tries < 60 && !stole; tries++) {
    m.human.stealCd = 0;
    m.ball.state = 'held';
    m.ball.holder = carrier.id;
    m.offense = 'away';
    mt.command({ type: 'click', x: carrier.pos.x, y: carrier.pos.y });
    stole = m.ball.holder === m.human.id;
  }
  assert.ok(stole, 'a defender this close steals within 60 reaches');
  assert.equal(m.offense, 'home');
  assert.equal(m.shotClock, 14);
});

console.log(`\n${passed} passed`);
