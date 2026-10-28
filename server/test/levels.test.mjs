import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_DEPTH_M, THEMES, levelForDepth, levelTopDepth, themeFor, difficulty, tileHp,
  levelChapter, parseLevelChapterId, levelGear
} from '../lib/levels.js';
import { normalizeProgress, noteStat, completeMission, campaignPublic, getChapter, chapterUnlocked, CHAPTERS } from '../lib/campaign.js';

test('levels locked = endless level 1 (prod default)', () => {
  assert.equal(levelForDepth(0, false), 1);
  assert.equal(levelForDepth(5000, false), 1);
});

test('levels unlocked: each level is LEVEL_DEPTH_M deep', () => {
  assert.equal(LEVEL_DEPTH_M, 589);
  assert.equal(levelForDepth(0, true), 1);
  assert.equal(levelForDepth(588, true), 1);
  assert.equal(levelForDepth(589, true), 2);
  assert.equal(levelForDepth(589 * 7 + 3, true), 8);
  assert.equal(levelTopDepth(3), 1178);
});

test('level 1 difficulty equals the original game', () => {
  const d = difficulty(1);
  assert.equal(d.hardness, 1);
  assert.equal(d.hazard, 1);
  assert.equal(d.fire, 1);
  assert.equal(d.bulletSpeed, 1);
  assert.equal(d.extraBullets, 0);
  assert.equal(d.blastDamage, 2);
  assert.equal(d.blastRadius, 2.3);
  assert.equal(d.enemyCount, 0);
  assert.equal(tileHp(3, 1), 3);
});

test('difficulty grows without a cap', () => {
  let prev = difficulty(1);
  for (const L of [2, 3, 5, 10, 25, 100, 1000]) {
    const d = difficulty(L);
    assert.ok(d.hardness > prev.hardness, 'hardness ' + L);
    assert.ok(d.fire > prev.fire, 'fire ' + L);
    assert.ok(d.enemyHp >= prev.enemyHp && d.blastDamage >= prev.blastDamage);
    prev = d;
  }
  assert.ok(difficulty(1000).enemyHp > 1000);
  assert.ok(tileHp(2, 50) > tileHp(2, 10));
  assert.ok(difficulty(9999).blastRadius <= 3.5, 'radius has a sane ceiling');
});

test('themes cycle with variations', () => {
  assert.equal(themeFor(1).id, 'trenches');
  assert.equal(themeFor(2).id, 'sands');
  assert.equal(themeFor(3).id, 'mines');
  assert.equal(themeFor(1 + THEMES.length).id, 'trenches');
  assert.notEqual(themeFor(1 + THEMES.length).displayName, themeFor(1).displayName);
  assert.equal(themeFor(1 + THEMES.length).cycle, 1);
  const ids = new Set(Array.from({ length: THEMES.length }, (_, i) => themeFor(i + 1).id));
  assert.equal(ids.size, THEMES.length);
});

test('every level 2+ has its own campaign chapter and gear', () => {
  assert.equal(levelChapter(1), null);
  const c2 = levelChapter(2), c3 = levelChapter(3);
  assert.equal(c2.id, 'lvl-2');
  assert.notEqual(c2.name, c3.name);
  assert.ok(c2.missions.find(m => m.boss));
  assert.equal(parseLevelChapterId('lvl-12'), 12);
  assert.equal(parseLevelChapterId('lvl-1'), null);
  assert.equal(parseLevelChapterId('lvl-x'), null);
  assert.equal(getChapter('lvl-4').level, 4);
  const g = levelGear(7);
  assert.ok(['pickaxe', 'helmet', 'boots', 'charm'].includes(g.type));
  assert.ok(g.rarity >= 1 && g.rarity <= 4);
});

test('level campaigns unlock on reaching the level and use per-level stats', () => {
  let p = normalizeProgress({});
  assert.equal(chapterUnlocked(p, getChapter('lvl-2')), false);
  p = noteStat(p, 'survive', 1, 2);
  assert.equal(p.maxLevel, 2);
  assert.equal(chapterUnlocked(p, getChapter('lvl-2')), true);
  assert.equal(chapterUnlocked(p, getChapter('lvl-3')), false);
  // depth mission uses absolute depth
  p = noteStat(p, 'depth', 589 + 60, 2);
  let r = completeMission(p, 'lvl-2', 'l2-in');
  assert.equal(r.ok, true);
  p = r.progress;
  // survive counts only on level 2
  r = completeMission(p, 'lvl-2', 'l2-survive');
  assert.equal(r.reason, 'stats');
  for (let i = 0; i < 6; i++) p = noteStat(p, 'survive', 1, 2);
  p = noteStat(p, 'survive', 50, 1); // level 1 survives don't count for level 2
  assert.equal(p.levelStats[2].survive, 7);
  r = completeMission(p, 'lvl-2', 'l2-survive');
  assert.equal(r.ok, true);
});

test('campaignPublic lists level campaigns only when unlocked', () => {
  const p = noteStat(normalizeProgress({}), 'dodge', 1, 3);
  assert.equal(campaignPublic(p).chapters.length, CHAPTERS.length);
  const pub = campaignPublic(p, { levelsUnlocked: true });
  const ids = pub.chapters.map(c => c.id);
  assert.ok(ids.includes('lvl-2') && ids.includes('lvl-3') && ids.includes('lvl-4'));
  assert.equal(pub.chapters.find(c => c.id === 'lvl-4').unlocked, false);
  assert.equal(pub.maxLevel, 3);
});

test('old saved progress still normalizes (no maxLevel field)', () => {
  const p = normalizeProgress({ completed: { 'bt-dig-25': 1 }, stats: { depth: 30 } });
  assert.equal(p.maxLevel, 1);
  assert.deepEqual(p.levelStats, {});
});
