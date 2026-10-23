/**
 * The sound module fails silent — plain Node (no AudioContext here):
 *   node client/audio/__tests__/sfx.test.js
 */
import assert from 'node:assert/strict';
import { sfx, SOUND_NAMES, defaultMuted } from '../sfx.js';

assert.equal(defaultMuted('/hardwood/'), true, 'embedded on brooksroley.com: starts muted');
assert.equal(defaultMuted('/hardwood'), true);
assert.equal(defaultMuted('/'), false, 'standalone: sound on');
assert.equal(defaultMuted('/BballTactics/'), false);

assert.equal(sfx.unlock(), false, 'no AudioContext: unlock reports false');
for (const name of SOUND_NAMES) assert.equal(sfx.play(name), false, `${name} is a quiet no-op`);
assert.equal(sfx.play('not-a-sound'), false);
sfx.forEvent({ type: 'make', team: 'home' });
sfx.forEvent(null);
sfx.music.start();
assert.equal(sfx.music.playing, false);
sfx.setMuted(true);
assert.equal(sfx.muted, true);
sfx.setMusicVolume(2);
assert.equal(sfx.musicVolume, 1, 'volume clamps to 1');

for (const need of ['tap', 'buy', 'reroll', 'place', 'sell', 'star', 'whistle', 'swish', 'clank', 'squeak', 'crowd', 'horn', 'win', 'loss']) {
  assert.ok(SOUND_NAMES.includes(need), `${need} exists`);
}
console.log(`sfx: ${SOUND_NAMES.length} sounds, all silent without audio`);
