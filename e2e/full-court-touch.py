"""Full Court, played start to finish on a phone with touch only.

A headless Chromium phone (390x844, hasTouch, isMobile) opens the game, taps
Full Court, taps Tip off, and plays a whole game with nothing but taps on the
court and on the on-screen Q/W/E/R/Shoot buttons, until the final screen. No
mouse, no keyboard. It fails if the final screen never comes, if the touch
hint copy is missing, or if taps never reached the rules as moves, calls,
passes, reaches, casts and shots.

The player's decisions read the match state through window.__fullCourt (set
only by the Vite dev server) the way a person reads the screen; every action
is still a touch. No backend is needed: the roster is static, and any /api
call fails and falls back.

Run it against a dev server (any port; 5184 here):

    npx vite --port 5184 --strictPort &
    python e2e/full-court-touch.py --url http://localhost:5184/BballTactics/ --out /tmp/fc-touch

Needs Python Playwright (`pip install playwright && python -m playwright
install chromium`). Locally Brooks has one at
~/Documents/JobSearchTool/venv/bin/python -I. CI runs it in .github/workflows/ci.yml.
Exit code 0 on a finished game, 1 otherwise. Screenshots land in --out.
"""

import argparse
import json
import math
import os
import random
import sys
import time

from playwright.sync_api import sync_playwright

STATE_JS = """
() => {
  const mt = window.__fullCourt;
  if (!mt) return null;
  const m = mt._m, h = m.human, b = m.ball;
  const carrier = b.state === 'held' ? m.byId.get(b.holder) : null;
  const other = h.team === 'home' ? 'away' : 'home';
  const man = m.teams[other][h.idx];
  const P = (p) => ({ x: p.pos.x, y: p.pos.y, id: p.id });
  return {
    phase: m.phase, quarter: m.quarter, clock: m.clock, tick: m.tick,
    offense: m.offense, team: h.team, me: P(h),
    hasBall: carrier === h,
    carrier: carrier ? { ...P(carrier), team: carrier.team } : null,
    ball: { state: b.state, x: b.pos.x, y: b.pos.y },
    man: P(man), manHasBall: carrier === man,
    mates: m.teams[h.team].filter((q) => q !== h).map(P),
    defs: m.teams[other].map(P),
    ready: Object.fromEntries(['Q', 'W', 'E', 'R'].map((s) => [s, h.cd[s] <= 0 && h.stamina >= h.kit[s].cost])),
    score: { ...m.score },
    line: { ...h.line },
  };
}
"""

LOG_JS = """
() => {
  const m = window.__fullCourt._m;
  const by = {};
  for (const e of m.log) by[e.command.type] = (by[e.command.type] || 0) + 1;
  return { commands: m.log.length, byType: by, ticks: m.tick, line: { ...m.human.line }, score: { ...m.score } };
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5184/BballTactics/')
    ap.add_argument('--out', default='e2e-shots')
    ap.add_argument('--timeout', type=float, default=480, help='seconds to reach the final screen')
    ap.add_argument('--headed', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    rnd = random.Random(2026)
    taps = {'floor': 0, 'player': 0, 'Q': 0, 'W': 0, 'E': 0, 'R': 0, 'shoot': 0}
    errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844}, device_scale_factor=2,
            is_mobile=True, has_touch=True,
        )
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url, wait_until='networkidle')

        shot = lambda name: page.screenshot(path=os.path.join(args.out, name))

        # Open Gym -> Full Court -> pick (the default pick is fine) -> Tip off.
        page.get_by_role('button', name='Full Court').first.tap()
        page.get_by_role('button', name='Tip off').wait_for(timeout=15000)
        controls = page.locator('.fc-controls').inner_text()
        assert controls.startswith('Tap to move'), f'pick screen shows touch controls, got: {controls!r}'
        shot('1-pick.png')
        page.get_by_role('button', name='Tip off').tap()
        page.locator('.fc-pixi').wait_for(state='visible', timeout=15000)
        page.wait_for_function('() => window.__fullCourt && window.__fullCourt._m.tick > 5', timeout=15000)

        hint = page.locator('.fc-hint p')
        hint_text = hint.inner_text() if hint.count() else ''
        assert 'Tap the court' in hint_text, f'first hint is touch copy, got: {hint_text!r}'
        shot('2-tipoff-hint.png')

        pixi = page.locator('.fc-pixi')

        def to_screen(x, y):
            r = pixi.bounding_box()
            return r['x'] + x / 800 * r['width'], r['y'] + y / 400 * r['height']

        def tap_court(x, y, kind):
            x = min(788, max(12, x))
            y = min(388, max(12, y))
            sx, sy = to_screen(x, y)
            page.touchscreen.tap(sx, sy)
            taps[kind] += 1

        def tap_button(slot):
            sel = '.fc-ab.shoot' if slot == 'shoot' else f'.fc-ab:has(kbd:text-is("{slot}"))'
            btn = page.locator(sel).first
            if btn.is_enabled():
                btn.tap(timeout=2000)
                taps[slot] += 1

        dist = lambda a, b: math.hypot(a['x'] - b['x'], a['y'] - b['y'])
        start = time.time()
        held_since = None
        first_move_checked = False
        mid_shot = False
        final_seen = False

        while time.time() - start < args.timeout:
            if page.locator('.fc-final').count():
                final_seen = True
                break
            s = page.evaluate(STATE_JS)
            if not s or s['phase'] != 'live':
                page.wait_for_timeout(250)
                continue
            if not mid_shot and s['quarter'] >= 2:
                shot('3-midgame.png')
                mid_shot = True
            own_rim = {'x': 780, 'y': 200} if s['team'] == 'home' else {'x': 20, 'y': 200}
            sign = 1 if s['team'] == 'home' else -1
            if s['ball']['state'] == 'loose':
                tap_court(s['ball']['x'], s['ball']['y'], 'floor')
            elif s['hasBall']:
                held_since = held_since or time.time()
                held = time.time() - held_since
                to_rim = dist(s['me'], own_rim)
                crowded = min(dist(d, s['me']) for d in s['defs']) < 40
                if crowded and s['ready']['Q'] and rnd.random() < 0.5:
                    tap_button('Q')
                elif s['me']['x'] * sign < 420 * sign and s['team'] == 'home' and held < 3:
                    tap_court(620, 200, 'floor')  # bring it up
                elif to_rim < 230 or held > 2.5:
                    if s['ready']['R'] and rnd.random() < 0.2:
                        tap_button('R')
                    tap_button('shoot')
                    held_since = None
                elif rnd.random() < 0.2:
                    mate = rnd.choice(s['mates'])
                    tap_court(mate['x'], mate['y'], 'player')  # pass by tapping him
                    held_since = None
                else:
                    tap_court(own_rim['x'] - sign * 70, 200 + rnd.uniform(-60, 60), 'floor')
            else:
                held_since = None
                if s['offense'] == s['team']:
                    c = s['carrier']
                    if c and rnd.random() < 0.35:
                        tap_court(c['x'], c['y'], 'player')  # call for it
                    else:
                        if s['ready']['W'] and rnd.random() < 0.05:
                            tap_button('W')
                        tap_court(own_rim['x'] - sign * rnd.uniform(90, 230), rnd.uniform(60, 340), 'floor')
                else:
                    man, d = s['man'], dist(s['me'], s['man'])
                    if s['manHasBall'] and d < 34:
                        tap_court(man['x'], man['y'], 'player')  # reach
                    elif s['manHasBall'] and d > 50 and s['ready']['E']:
                        tap_court(man['x'], man['y'], 'player')  # aim at him, then close out
                        tap_button('E')
                    else:
                        before = s['me']
                        tx = man['x'] + (20 - man['x']) * 0.25 if s['team'] == 'home' else man['x'] + (780 - man['x']) * 0.25
                        # Tap just off the man so it lands on the floor, not on him.
                        tap_court(tx, man['y'] + (40 if man['y'] < 200 else -40), 'floor')
                        if not first_move_checked:
                            page.wait_for_timeout(400)
                            after = page.evaluate(STATE_JS)
                            # A floor tap moves the player (retried on the next
                            # tap if this one landed near someone and snapped).
                            if after and after['phase'] == 'live' and dist(before, after['me']) > 2:
                                first_move_checked = True
            page.wait_for_timeout(180 + rnd.randint(0, 120))

        if not final_seen:
            shot('x-timeout.png')
        summary = page.evaluate(LOG_JS) if page.evaluate('() => !!window.__fullCourt') else {}
        if final_seen:
            page.wait_for_timeout(600)
            shot('4-final.png')
            page.locator('.fc-final-card').screenshot(path=os.path.join(args.out, '5-final-card.png'))
        title = page.locator('#fc-final-title').inner_text() if final_seen else None
        browser.close()

    by = summary.get('byType', {})
    report = {'final': final_seen, 'title': title, 'seconds': round(time.time() - start), 'taps': taps,
              'rules_saw': summary, 'page_errors': errors}
    print(json.dumps(report, indent=2))
    problems = []
    if not final_seen:
        problems.append('never reached the final screen')
    if errors:
        problems.append(f'page errors: {errors[:3]}')
    for t in ('move', 'click', 'cast', 'shoot'):
        if not by.get(t):
            problems.append(f'no "{t}" command reached the rules by touch')
    if not first_move_checked:
        problems.append('never checked that a floor tap moves the player')
    if problems:
        print('FAIL: ' + '; '.join(problems))
        return 1
    print(f'PASS: a whole game by touch, {title}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
