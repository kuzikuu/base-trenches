import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_IDS, skillPoints, learn, canLearn, validateSkills, skillEffects, normalizeSkills, spentPoints } from '../lib/skills.js';

test('five skills', () => {
  assert.deepEqual(SKILL_IDS.sort(), ['combat', 'digging', 'engineering', 'medic', 'scouting']);
});

test('points come from level and world level', () => {
  assert.equal(skillPoints(1, 1), 0);
  assert.equal(skillPoints(4, 1), 6);
  assert.equal(skillPoints(4, 3), 8);
});

test('learn spends points and respects prerequisites', () => {
  const ctx = { level: 4, maxLevel: 1 };
  assert.equal(canLearn({}, 'digging', { level: 1 }).reason, 'no_points');
  assert.equal(canLearn({}, 'engineering', ctx).reason, 'requires_digging');
  assert.equal(canLearn({}, 'medic', ctx).reason, 'requires_combat');
  let s = {};
  s = learn(s, 'digging', ctx).skills;
  s = learn(s, 'digging', ctx).skills;
  assert.equal(learn(s, 'engineering', ctx).ok, true);
  assert.equal(learn(s, 'nope', ctx).reason, 'unknown_skill');
});

test('ranks 4-5 need character level 6/8 and max rank is 5', () => {
  let s = { digging: 3 };
  assert.equal(canLearn(s, 'digging', { level: 5 }).reason, 'level_6');
  assert.equal(canLearn(s, 'digging', { level: 6 }).ok, true);
  s = { digging: 5 };
  assert.equal(canLearn(s, 'digging', { level: 20 }).reason, 'maxed');
});

test('cannot spend more points than earned', () => {
  const ctx = { level: 2, maxLevel: 1 }; // 2 points
  let s = learn({}, 'combat', ctx).skills;
  s = learn(s, 'scouting', ctx).skills;
  assert.equal(learn(s, 'combat', ctx).reason, 'no_points');
});

test('validateSkills trims an injected allocation', () => {
  const s = validateSkills({ digging: 5, combat: 5, scouting: 5, engineering: 5, medic: 5 }, { level: 3, maxLevel: 1 });
  assert.ok(spentPoints(s) <= 4);
  assert.ok(s.digging <= 3);
  assert.deepEqual(normalizeSkills({ digging: 99, combat: -4, x: 3 }), { digging: 5, combat: 0, scouting: 0, engineering: 0, medic: 0 });
});

test('skills have real effects', () => {
  const none = skillEffects({});
  assert.equal(none.digSpeed, 1);
  assert.equal(none.reveal, 0);
  assert.equal(none.regenEvery, 0);
  const e = skillEffects({ digging: 5, combat: 4, scouting: 3, engineering: 2, medic: 5 });
  assert.ok(e.digSpeed > 1.5 && e.softDouble && e.oneShot > 0);
  assert.equal(e.melee, 5);
  assert.ok(e.parry > 0);
  assert.equal(e.reveal, 8);
  assert.ok(e.fortifyCooldown > 0 && e.fortifyHp === 4);
  assert.equal(e.regenEvery, 30);
  assert.equal(e.secondWind, true);
});
