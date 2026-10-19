import { parseSavedQuality, defaultQuality, resolveQuality, dprCap, stepDpr, shouldRenderWhileHidden, labelOpacityCss } from './render-quality.js';
import { strict as assert } from 'node:assert';

assert.equal(parseSavedQuality('high'), 'high');
assert.equal(parseSavedQuality('medium'), 'medium');
assert.equal(parseSavedQuality('ultra'), null);
assert.equal(parseSavedQuality('4k'), null);
assert.equal(parseSavedQuality(null), null);
assert.equal(parseSavedQuality(''), null);

assert.equal(defaultQuality({ isMobile: true, weakGpu: false, maxTex: 16384, cores: 16 }), 'medium');
assert.equal(defaultQuality({ isMobile: false, weakGpu: true, maxTex: 16384, cores: 16 }), 'high');
assert.equal(defaultQuality({ isMobile: false, weakGpu: false, maxTex: 4096, cores: 16 }), 'medium');
assert.equal(defaultQuality({ isMobile: false, weakGpu: false, maxTex: 16384, cores: 4 }), 'high');
assert.equal(defaultQuality({ isMobile: false, weakGpu: false, maxTex: 16384, cores: 8 }), 'high');

assert.equal(resolveQuality('garbage', { isMobile: false, weakGpu: false, maxTex: 16384, cores: 8 }), 'high');
assert.equal(resolveQuality('medium', { isMobile: false, weakGpu: false, maxTex: 16384, cores: 8 }), 'medium');

assert.equal(dprCap(3, 'high'), 2);
assert.equal(dprCap(1.25, 'high'), 1.25);
assert.equal(dprCap(2, 'medium'), 1);
assert.equal(dprCap(0, 'high'), 1);

let s = stepDpr(1.5, 30, { dprMax: 2, slowStreak: 1, fastStreak: 0 });
assert.equal(s.changed, true);
assert.equal(s.dpr, 1.25);
s = stepDpr(1.5, 60, { dprMax: 2, slowStreak: 0, fastStreak: 3 });
assert.equal(s.changed, true);
assert.equal(s.dpr, 1.75);
s = stepDpr(2, 60, { dprMax: 2, slowStreak: 0, fastStreak: 4 });
assert.equal(s.changed, false);
assert.equal(s.dpr, 2);

assert.equal(shouldRenderWhileHidden(true), false);
assert.equal(shouldRenderWhileHidden(false), true);
assert.equal(labelOpacityCss(0.4), '0.40');

console.log('render-quality.test.js ok');

assert.equal(dprCap(2, 'high', { width: 1920, height: 1080 }), 2);
assert.equal(dprCap(2, 'high', { width: 3840, height: 2160 }), 1);
assert.equal(dprCap(2, 'high', { width: 7680, height: 4320 }), 0.5);
assert.equal(dprCap(2, 'high', { width: 3840, height: 2160, maxDimension: 2048 }), 2048/3840);
assert.equal(stepDpr(1, 12, { dprMax: 1, dprMin: 0.5, slowStreak: 1, fastStreak: 0 }).dpr, 0.75);
