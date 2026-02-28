import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeRhythmFromOnsets } from '../src/dsp/rhythm.js';

test('analyzeRhythmFromOnsets detects 120 BPM from regular onsets', () => {
  // 120 BPM -> 0.5s between beats
  const onsets = [];
  for (let i = 0; i < 16; i++) onsets.push(i * 0.5);

  const out = analyzeRhythmFromOnsets(onsets);
  assert.ok(out.tempoBpm != null);
  assert.ok(Math.abs(out.tempoBpm - 120) < 1e-6);
  assert.ok(out.tempoConfidence > 0.5);
});

test('analyzeRhythmFromOnsets handles too few onsets', () => {
  const out = analyzeRhythmFromOnsets([0]);
  assert.equal(out.ibiCount, 0);
  assert.equal(out.tempoBpm, null);
});
