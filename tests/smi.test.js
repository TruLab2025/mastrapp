import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSmiFromBandNormalized } from '../src/dsp/smi.js';

test('analyzeSmiFromBandNormalized detects masked band in middle of spectrum', () => {
  // Create frames with 5 bands; middle band suppressed
  const keys = ['b0', 'b1', 'b2', 'b3', 'b4'];
  const frames = [];
  for (let t = 0; t < 10; t++) {
    const base = keys.reduce((acc, k) => ({ ...acc, [k]: 1.0 }), {});
    // suppress band b2 on frames 4..6
    if (t >= 4 && t <= 6) base.b2 = 0.01;
    frames.push({ tSec: t * 0.01, bandNormalized: base });
  }

  const out = analyzeSmiFromBandNormalized(frames, { threshold: 0.4 });
  assert.ok(Array.isArray(out.perFrame));
  // Expect some frames to have non-zero masked fraction
  const anyMasked = out.perFrame.some((v) => v > 0);
  assert.ok(anyMasked, 'Expected at least one frame to be considered masked');
  assert.ok(out.stats.mean != null);
});

test('analyzeSmiFromBandNormalized handles empty input', () => {
  const out = analyzeSmiFromBandNormalized([]);
  assert.equal(out.perFrame.length, 0);
  assert.equal(out.stats.count, 0);
});
