import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFullComparison } from '../src/compare.js';

test('makeFullComparison computes loudness deltas', () => {
  const a = { meta: { durationSec: 60, backend: 'dsp' }, global: { integratedLufs: -10, lra: 6, crestFactorDbMean: 8, crestFactorDbStd: 1.5, clipping: { clipEvents: 4, clippedSamples: 200 }, rmsDbfs: -6, spectral: { centroidHzMean: 1000, rolloffHzMean: 6000, flatnessMean: 0.2 }, energyDistribution: { low: 0.2, mid: 0.5, high: 0.3 }, transients: { onsetStrengthMean: 0.2, onsetStrengthStd: 0.05 } }, timeSeries: { onsetTimesSec: [0.1, 0.2, 0.3] } };
  const b = { meta: { durationSec: 60, backend: 'dsp' }, global: { integratedLufs: -12, lra: 4, crestFactorDbMean: 7.5, crestFactorDbStd: 1.0, clipping: { clipEvents: 1, clippedSamples: 50 }, rmsDbfs: -7, spectral: { centroidHzMean: 800, rolloffHzMean: 5000, flatnessMean: 0.25 }, energyDistribution: { low: 0.25, mid: 0.5, high: 0.25 }, transients: { onsetStrengthMean: 0.1, onsetStrengthStd: 0.02 } }, timeSeries: { onsetTimesSec: [0.1] } };

  const c = makeFullComparison(a, b);
  assert.equal(c.compare.loudness.integratedLufs.delta, 2);
  assert.equal(c.compare.loudness.lra.delta, 2);
  assert.equal(c.compare.loudness.rmsDbfs.delta, 1);
  assert.ok(Math.abs(c.compare.loudness.crestFactorDbMean.delta - 0.5) < 1e-12);
  assert.ok(Math.abs(c.compare.loudness.crestFactorDbStd.delta - 0.5) < 1e-12);
  assert.ok(Math.abs(c.compare.energyDistribution.low.delta - (-0.05)) < 1e-9);
  assert.ok(Math.abs(c.compare.transients.onsetStrengthMean.delta - 0.1) < 1e-12);
  assert.ok(Math.abs(c.compare.transients.onsetStrengthStd.delta - 0.03) < 1e-12);
  assert.equal(c.compare.technical.clippingEvents.delta, 3);
  assert.equal(c.compare.technical.clippedSamples.delta, 150);
});
