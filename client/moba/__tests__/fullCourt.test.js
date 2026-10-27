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
import {
  createMatch, pickTeams, shotChance, boxScore, cast, shotBreakdown, shotReason, stealChance, lookForHuman,
  coachPrompt, rallying, RALLY_DEFICIT, CLUTCH_SECONDS, SHOT_CLOCK,
} from '../match.js';

const roster = JSON.parse(readFileSync(new URL('../../../public/engine_roster.json', import.meta.url)));
const byName = (n) => roster.find((p) => p.name === n);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

// Commands are queued and applied at the start of the next tick (match.js,
// "Command log"), so a test that checks a command's effect sends it and runs
// that one tick: act() is command() plus one 1/60 s step.
const act = (match, cmd) => {
  match.command(cmd);
  match.step(1 / 60);
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
  act(mt, { type: 'shoot' });
  assert.equal(m.ball.state, 'shot');
  assert.equal(m.human.line.fga, 1);
  mt.drainEvents();
  act(mt, { type: 'shoot' });
  assert.equal(mt.drainEvents()[0].type, 'denied');
});

test('left-click on a teammate passes, and the pass arrives', () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 4 });
  const m = mt._m;
  const mate = m.teams.home[1];
  act(mt, { type: 'click', x: mate.pos.x, y: mate.pos.y });
  assert.equal(m.ball.state, 'pass');
  for (let i = 0; i < 120 && m.ball.state === 'pass'; i++) mt.step(1 / 60);
  assert.equal(m.ball.state, 'held');
  assert.equal(m.offense, 'home', 'still our ball, or a pick-off flipped it');
});

test('abilities spend stamina, start cooldowns, and refuse when they should', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 8 });
  const m = mt._m;
  const h = m.human;
  act(mt, { type: 'cast', slot: 'Q', x: h.pos.x + 50, y: h.pos.y });
  assert.ok(h.cd.Q > 0, 'step-back on cooldown');
  // One tick of regen (6/s) has run since the cast.
  assert.ok(Math.abs(h.stamina - (100 - h.kit.Q.cost + 6 / 60)) < 1e-9, `stamina ${h.stamina}`);
  mt.drainEvents();
  act(mt, { type: 'cast', slot: 'Q', x: 0, y: 0 });
  assert.match(mt.drainEvents()[0].text, /cooldown/);
  act(mt, { type: 'cast', slot: 'E', x: 0, y: 0 });
  assert.match(mt.drainEvents()[0].text, /defense/, 'closeout is defense-only');
  h.stamina = 5;
  act(mt, { type: 'cast', slot: 'W', x: 0, y: 0 });
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
    act(mt, { type: 'click', x: carrier.pos.x, y: carrier.pos.y });
    stole = m.ball.holder === m.human.id;
  }
  assert.ok(stole, 'a defender this close steals within 60 reaches');
  assert.equal(m.offense, 'home');
  // Reset to 14 at the start of the tick, then that tick ran it down once.
  assert.ok(Math.abs(m.shotClock - (SHOT_CLOCK - 1 / 60)) < 1e-9, `shot clock ${m.shotClock}`);
});

// ---------------------------------------------------------------------------
// Play and legibility: every outcome explains itself, the human matters.

// Put the away team on offense with `carrier` holding the ball.
const giveAway = (m, carrier) => {
  m.offense = 'away';
  m.poss.team = 'away';
  m.ball.state = 'held';
  m.ball.holder = carrier.id;
  m.ball.pos = { ...carrier.pos };
};
// Park everyone far from the action so a scenario has only the players it names.
const clearCourt = (m, except = []) => {
  m.all.forEach((p, i) => { if (!except.includes(p)) p.pos = { x: 300 + (i % 5) * 20, y: i < 5 ? 20 : 380 }; });
};

test('the shot breakdown names the contest, and its chance is shotChance', () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 21 });
  const m = mt._m;
  const h = m.human;
  clearCourt(m, [h]);
  h.pos = { x: 640, y: 200 };
  const open = shotBreakdown(m, h);
  assert.equal(open.label, 'open');
  assert.equal(open.contestBy, null);
  const def = m.teams.away[2];
  def.pos = { x: 655, y: 200 };
  const b = shotBreakdown(m, h);
  assert.equal(b.chance, shotChance(m, h));
  assert.equal(b.contestBy, def.name);
  assert.ok(b.label === 'contested' || b.label === 'smothered');
  assert.ok(b.chance < open.chance);
  assert.match(shotReason(b, false), new RegExp(`contested by ${def.name}`));
  assert.match(shotReason(b, false), /^\d+%/, 'a miss reason leads with the chance');
});

test('a miss carries its chance and the reason it missed', () => {
  const mt = createMatch({ roster, humanId: byName('Udonis Haslem').id, seed: 22 });
  const m = mt._m;
  let miss = null;
  for (let tries = 0; tries < 40 && !miss; tries++) {
    const h = m.human;
    m.offense = 'home';
    m.ball.state = 'held';
    m.ball.holder = h.id;
    h.pos = { x: 560, y: 120 };
    m.teams.away[0].pos = { x: 575, y: 125 };
    act(mt, { type: 'shoot' });
    for (let i = 0; i < 90 && m.ball.state === 'shot'; i++) mt.step(1 / 60);
    miss = mt.drainEvents().find((e) => e.type === 'miss');
  }
  assert.ok(miss, 'Haslem misses a contested long two within 40 tries');
  assert.ok(miss.chance > 0 && miss.chance < 1);
  assert.match(miss.reason, /contested by|closed out|Wall|heave|rimmed|missed/);
  assert.match(miss.text, /misses \(/);
});

test('step-back: the defender stumbles and the shot gets better, even from deep', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 23 });
  const m = mt._m;
  const h = m.human;
  clearCourt(m, [h]);
  h.pos = { x: 590, y: 200 };
  const def = m.teams.away[0];
  def.pos = { x: 615, y: 200 };
  def.target = { x: 640, y: 200 };
  mt.drainEvents();
  act(mt, { type: 'cast', slot: 'Q', x: def.pos.x, y: def.pos.y });
  assert.ok(def.stumbleUntil > m.time, 'the defender is off balance');
  const defX = def.pos.x;
  for (let i = 0; i < 15; i++) mt.step(1 / 60);
  assert.ok(Math.abs(def.pos.x - defX) < 1, 'a stumbling defender does not move');
  const ev = mt.drainEvents().find((e) => e.type === 'stepback');
  assert.ok(ev, 'the step-back reports its before and after');
  assert.ok(ev.after > ev.before, `${ev.before} -> ${ev.after}`);
  assert.match(ev.text, /stumbles: \d+% to \d+%/);
  // Out past the deep line, the step-back window waives the heave penalty.
  h.pos = { x: 520, y: 200 };
  const deep = shotBreakdown(m, h);
  assert.notEqual(deep.zone, 'deep');
  h.buffs.stepbackUntil = 0;
  assert.equal(shotBreakdown(m, h).zone, 'deep');
});

test('closeout onto a man without the ball denies him the pass', () => {
  const mt = createMatch({ roster, humanId: byName('Alex Caruso').id, seed: 24 });
  const m = mt._m;
  const h = m.human;
  clearCourt(m);
  const carrier = m.teams.away[1];
  const man = m.teams.away[h.idx];
  carrier.pos = { x: 300, y: 200 };
  man.pos = { x: 200, y: 120 };
  h.pos = { x: 260, y: 140 };
  giveAway(m, carrier);
  mt.drainEvents();
  assert.ok(cast(m, h, 'E', man.pos));
  for (let i = 0; i < 20; i++) mt.step(1 / 60);
  const ev = mt.drainEvents().find((e) => e.type === 'deny');
  assert.ok(ev, 'a deny event fires');
  assert.equal(ev.playerId, man.id);
  assert.ok(man.denyUntil > m.time);
  assert.ok(mt.view().overlay.denies.length >= 1, 'the overlay shows the deny');
});

test('a reach-in reports its chance; Burst protects the ball', () => {
  const mt = createMatch({ roster, humanId: byName('Alex Caruso').id, seed: 25 });
  const m = mt._m;
  const carrier = m.teams.away[0];
  const plain = stealChance(m, m.human, carrier);
  carrier.buffs.burstUntil = m.time + 1;
  assert.ok(stealChance(m, m.human, carrier) < plain);
  carrier.buffs.burstUntil = 0;
  m.human.buffs.burstUntil = m.time + 1;
  assert.ok(stealChance(m, m.human, carrier) > plain, "the thief's Burst helps");
  m.human.buffs.burstUntil = 0;
  giveAway(m, carrier);
  m.human.pos = { x: carrier.pos.x + 10, y: carrier.pos.y };
  mt.drainEvents();
  act(mt, { type: 'click', x: carrier.pos.x, y: carrier.pos.y });
  const ev = mt.drainEvents()[0];
  assert.ok(ev.type === 'reach' || ev.type === 'steal');
  assert.match(ev.text, /\d+%/, 'the reach result says the odds');
});

test('the rally rule: a team down by the deficit shoots a little better, and the HUD says so', () => {
  const mt = createMatch({ roster, humanId: byName('Derrick White').id, seed: 26 });
  const m = mt._m;
  const h = m.human;
  clearCourt(m, [h]);
  h.pos = { x: 640, y: 160 };
  const even = shotChance(m, h);
  m.score.away = RALLY_DEFICIT;
  assert.ok(rallying(m, 'home'));
  assert.ok(!rallying(m, 'away'));
  assert.ok(shotChance(m, h) > even);
  assert.ok(shotBreakdown(m, h).rally);
  assert.equal(mt.view().hud.rally.home, true);
  m.score.away = RALLY_DEFICIT - 1;
  assert.equal(shotChance(m, h), even, 'one point short of the deficit: no bonus');
});

test('a shot in the air at the buzzer still counts, then the period ends', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 27 });
  const m = mt._m;
  const h = m.human;
  clearCourt(m, [h]);
  h.pos = { x: 760, y: 200 };
  m.clock = 0.05;
  m.rng = () => 0; // the shot goes in
  mt.command({ type: 'shoot' });
  for (let i = 0; i < 60; i++) mt.step(1 / 60);
  const evs = mt.drainEvents();
  const make = evs.find((e) => e.type === 'make');
  assert.ok(make && make.buzzer, 'the make is a buzzer-beater');
  assert.match(make.text, /at the buzzer/);
  assert.equal(m.score.home, make.points);
  assert.equal(m.phase, 'break');
  assert.ok(evs.findIndex((e) => e.type === 'period') > evs.indexOf(make), 'the period ends after the shot lands');
});

test('clutch time is called once, and the AI lets it fly before the buzzer', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 28 });
  const m = mt._m;
  m.clock = CLUTCH_SECONDS + 0.05;
  for (let i = 0; i < 30; i++) mt.step(1 / 60);
  const calls = mt.drainEvents().filter((e) => e.type === 'clutch');
  assert.equal(calls.length, 1);
  assert.equal(mt.view().hud.clutch, true);
  assert.equal(mt.view().hud.shotClockOff, true, 'less game clock than shot clock: the shot clock is off');
  // An AI carrier in the back court with a second left shoots anyway.
  const carrier = m.teams.away[0];
  giveAway(m, carrier);
  carrier.pos = { x: 600, y: 200 };
  carrier.think = 0;
  m.clock = 1;
  mt.step(1 / 60);
  assert.equal(m.ball.state, 'shot');
});

test('teammates look for an open human, and a call gets an answer', () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 29 });
  const m = mt._m;
  const h = m.human;
  const mate = m.teams.home[1];
  clearCourt(m, [h, mate]);
  mate.pos = { x: 600, y: 200 };
  h.pos = { x: 660, y: 90 };
  m.offense = 'home';
  m.ball.state = 'held';
  m.ball.holder = mate.id;
  m.poss = { ...m.poss, team: 'home', touched: false };
  const openLook = lookForHuman(m, mate, h);
  m.teams.away[0].pos = { x: 668, y: 95 };
  const covered = lookForHuman(m, mate, h);
  assert.ok(openLook > covered, 'open counts');
  m.poss.touched = true;
  assert.ok(lookForHuman(m, mate, h) < covered, 'having touched it already lowers the pull');
  // Call with a defender sitting in the lane: the carrier says why not.
  m.teams.away[0].pos = { x: 630, y: 145 };
  mt.drainEvents();
  mt.command({ type: 'click', x: mate.pos.x, y: mate.pos.y });
  mate.think = 0;
  mt.step(1 / 60);
  const answer = mt.drainEvents().find((e) => e.type === 'call' && e.playerId === mate.id);
  assert.ok(answer, 'a blocked call gets a reason');
  assert.match(answer.text, new RegExp(`${m.teams.away[0].name} is in the lane`));
  // Clear the lane and call again: the pass comes.
  m.teams.away[0].pos = { x: 300, y: 380 };
  m.rng = () => 0.5; // the carrier's 85% "sees you" roll comes up yes
  m.offense = 'home';
  m.ball.state = 'held'; // whatever the carrier did after saying no, give it back
  m.ball.holder = mate.id;
  mate.pos = { x: 600, y: 200 };
  mt.command({ type: 'click', x: mate.pos.x, y: mate.pos.y });
  mate.think = 0;
  let got = false;
  for (let i = 0; i < 60 && !got; i++) { mt.step(1 / 60); got = m.ball.holder === h.id; }
  assert.ok(got, 'an open, clear call is answered with the ball');
  assert.equal(m.poss.touched, true);
});

test('the tutorial opener hands the ball to a teammate who waits for you', () => {
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 30, tutorial: true });
  const m = mt._m;
  assert.notEqual(m.ball.holder, m.human.id, 'a teammate has the opening ball');
  assert.equal(m.byId.get(m.ball.holder).team, 'home');
  assert.ok(m.shotClock > SHOT_CLOCK, 'a long shot clock for the lesson');
  for (let i = 0; i < 60 * 4; i++) mt.step(1 / 60);
  assert.equal(m.teams.home.reduce((a, p) => a + p.line.fga, 0), 0, 'your team does not shoot while waiting for you');
  assert.ok(mt.view().hud.tutorial.hold);
  const off = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 30 })._m;
  assert.equal(off.ball.holder, off.human.id, 'without the tutorial the human brings it up');
});

test('the coach prompt tells you what to do right now', () => {
  const mt = createMatch({ roster, humanId: byName('Derrick White').id, seed: 31 });
  const m = mt._m;
  const h = m.human;
  clearCourt(m, [h]);
  h.pos = { x: 640, y: 200 };
  assert.match(coachPrompt(m).text, /Open: Space shoots \d+%/);
  m.shotClock = 3.2;
  assert.equal(coachPrompt(m).tone, 'urgent');
  assert.match(coachPrompt(m).text, /Shot clock 4/);
  // Defense, your man has the ball and you're far away.
  const man = m.teams.away[h.idx];
  man.pos = { x: 200, y: 200 };
  h.pos = { x: 300, y: 200 };
  giveAway(m, man);
  m.shotClock = SHOT_CLOCK;
  assert.match(coachPrompt(m).text, /Your man has the ball: E to close out/);
  h.pos = { x: 220, y: 200 };
  assert.match(coachPrompt(m).text, /left-click him to reach \(\d+%\)/);
  assert.deepEqual(mt.view().hud.prompt, coachPrompt(m), 'the view carries the prompt');
});

test('the view lists pass lanes when you have the ball, and tracks the possession', () => {
  const mt = createMatch({ roster, humanId: byName('Jalen Brunson').id, seed: 32 });
  const m = mt._m;
  const v = mt.view();
  assert.equal(v.hud.passLanes.length, 4);
  assert.ok(v.hud.passLanes.every((l) => typeof l.laneClear === 'boolean' && typeof l.open === 'boolean'));
  assert.equal(v.hud.possession.touched, true, 'the human brought it up');
  assert.ok(v.hud.human.shot && v.hud.human.shot.chance === v.hud.human.shotChance);
  const n = v.hud.possession.n;
  // A steal is a new possession for the other side. Home's third man guards
  // away's third man; hand him the ball and let the AI defender reach.
  const carrier = m.teams.away[2];
  const thief = m.teams.home[2];
  giveAway(m, carrier);
  carrier.pos = { x: 300, y: 200 };
  thief.pos = { x: 290, y: 200 };
  m.rng = () => 0; // every roll succeeds
  thief.stealCd = 0;
  thief.think = 0;
  const before = m.poss.n;
  mt.drainEvents();
  mt.step(1 / 60);
  const steal = mt.drainEvents().find((e) => e.type === 'steal');
  assert.ok(steal, 'the AI defender strips him');
  assert.match(steal.reason, /\d+%/);
  assert.equal(m.offense, 'home');
  assert.ok(m.poss.n > before && m.poss.n > n);
});

test('regression: no shot gets off after the horn (found by fuzz.test.js)', () => {
  // The tick the clock crossed zero used to finish running first, so an AI
  // carrier's last-second heave could leave his hands at -0.01 s, fly, and
  // count as a buzzer-beater. Now the period ends the tick the clock hits 0.
  const mt = createMatch({ roster, humanId: byName('Steph Curry').id, seed: 33 });
  const m = mt._m;
  const carrier = m.teams.away[0];
  giveAway(m, carrier);
  carrier.pos = { x: 200, y: 200 };
  carrier.think = 0;
  m.clock = 0.01; // less than one tick left
  const fga = carrier.line.fga;
  mt.step(1 / 60);
  assert.equal(carrier.line.fga, fga, 'no shot after the horn');
  assert.equal(m.phase, 'break');
  assert.equal(m.clock, m.quarterLength, 'the next quarter is set up');
  // A shot already in the air at zero still counts (the buzzer-beater test above).
});

test('regression: malformed commands cannot put NaN into the state (found by fuzz.test.js)', () => {
  // Before the command log, a move to x=NaN or a closeout aimed at y=NaN
  // passed through clamp() as NaN and took the player (and the ball) with it.
  const mt = createMatch({ roster, humanId: byName('Rudy Gobert').id, seed: 3 });
  const m = mt._m;
  m.offense = 'away';
  mt.command({ type: 'cast', slot: 'E', x: 300, y: NaN });
  mt.command({ type: 'move', x: NaN, y: 100 });
  mt.command({ type: 'click', x: 200, y: Infinity });
  for (let i = 0; i < 30; i++) mt.step(1 / 60);
  for (const p of m.all) assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y), `${p.name} at ${p.pos.x},${p.pos.y}`);
  assert.ok(Number.isFinite(m.ball.pos.x) && Number.isFinite(m.ball.pos.y));
  assert.ok(m.log.every((e) => Number.isFinite(e.command.x ?? 0) && Number.isFinite(e.command.y ?? 0)), 'nothing non-finite is logged');
  // Called directly (the AI's path), a half-finite aim falls back to the default.
  m.human.cd.E = 0;
  m.human.stamina = 100;
  assert.ok(cast(m, m.human, 'E', { x: 300, y: NaN }));
  assert.ok(Number.isFinite(m.human.dash.vx) && Number.isFinite(m.human.dash.vy));
});

console.log(`\n${passed} passed`);
