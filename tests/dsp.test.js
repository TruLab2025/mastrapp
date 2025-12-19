import test from 'node:test';
import assert from 'node:assert/strict';

import { nextPow2, dbfsFromLinear, rmsOfInterleavedStereo, stddevOfFrames } from '../src/dsp/utils.js';
import { fftReal, magSpectrum } from '../src/dsp/fft.js';
import { spectralFeatures } from '../src/dsp/spectrum.js';
import { computeOnsetStrengthFromSpectrumFrames } from '../src/dsp/onsets.js';
import { analyzeLoudnessOverTime, computeLraFromShortTermFrames } from '../src/dsp/loudness.js';
import { analyzeTruePeakAndClipping } from '../src/dsp/truepeak.js';
import { createPsychoContext } from '../src/dsp/psycho.js';

test('nextPow2', () => {
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(2), 2);
  assert.equal(nextPow2(3), 4);
  assert.equal(nextPow2(1025), 2048);
});

test('dbfsFromLinear', () => {
  assert.equal(dbfsFromLinear(1), 0);
  assert.ok(dbfsFromLinear(0.5) < 0);
  assert.equal(dbfsFromLinear(0), -200);
});

test('rmsOfInterleavedStereo on unity', () => {
  const n = 48000;
  const l = new Float32Array(n).fill(1);
  const r = new Float32Array(n).fill(1);
  const rms = rmsOfInterleavedStereo(l, r, 0, n);
  assert.ok(Math.abs(rms - 1) < 1e-6);
});

test('spectral centroid near tone frequency', () => {
  const fs = 48000;
  const f = 1000;
  const n = 4096;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / fs);

  const { re, im } = fftReal(x);
  const mag = magSpectrum(re, im);
  const { centroidHz } = spectralFeatures(mag, fs, 0.85);

  // centroid will be smeared due to windowing absence; keep it wide
  assert.ok(centroidHz > 200 && centroidHz < 5000);
});

test('stddevOfFrames computes population stddev', () => {
  const frames = [
    { x: 10 },
    { x: 12 },
    { x: 14 },
    { x: NaN },
    { x: null },
    {},
  ];

  const std = stddevOfFrames(frames, 'x');
  // For [10,12,14]: mean=12, variance(pop)=((4+0+4)/3)=8/3, std=sqrt(8/3)
  assert.ok(std != null);
  assert.ok(Math.abs(std - Math.sqrt(8 / 3)) < 1e-12);
});

test('computeOnsetStrengthFromSpectrumFrames uses flux/hfc window', () => {
  const frames = [
    { tSec: 0.00, spectralFlux: 0.1, hfc: 0.0 },
    { tSec: 0.01, spectralFlux: 0.2, hfc: 0.5 },
    { tSec: 0.02, spectralFlux: 0.3, hfc: 1.0 },
    { tSec: 0.03, spectralFlux: 0.4, hfc: 0.0 },
  ];

  const out = computeOnsetStrengthFromSpectrumFrames(frames, [0.02], { windowSec: 0.015 });
  // Window includes frames at 0.01, 0.02, 0.03
  // strength = mean( flux*(0.25+0.75*hfc) )
  const expected = (
    0.2 * (0.25 + 0.75 * 0.5)
    + 0.3 * (0.25 + 0.75 * 1.0)
    + 0.4 * (0.25 + 0.75 * 0.0)
  ) / 3;

  assert.equal(out.perOnset.length, 1);
  assert.ok(Math.abs(out.perOnset[0] - expected) < 1e-12);
});

test('computeLraFromShortTermFrames returns percentile range', () => {
  // Construct a stable short-term loudness distribution (all pass gates).
  const frames = [-40, -35, -30, -25, -20, -15, -10].map((v) => ({ lufsShortTerm: v }));
  const integrated = -10; // relGate = -30 (integrated - 20)

  const out = computeLraFromShortTermFrames(frames, integrated);
  assert.ok(out.lra != null);

  // With values [-30,-25,-20,-15,-10] after rel gate, P10 and P95 are interpolated.
  // We just sanity-check bounds and positivity.
  assert.ok(out.lra > 0);
  assert.ok(out.pHigh <= -10 + 1e-12);
  assert.ok(out.pLow >= -30 - 1e-12);
});

test('analyzeLoudnessOverTime computes crest factor and small LRA for steady sine', async () => {
  const fs = 8000;
  const f = 440;
  const durSec = 10;
  const n = fs * durSec;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = 0.5 * Math.sin((2 * Math.PI * f * i) / fs);
    left[i] = v;
    right[i] = v;
  }

  const out = await analyzeLoudnessOverTime(left, right, fs);
  assert.ok(Array.isArray(out.frames));
  assert.ok(out.frames.length > 0);

  // For a sine wave: crest factor = 20*log10(peak/rms) = 20*log10(sqrt(2)) ≈ 3.0103 dB
  const cf = out.frames[0].crestFactorDb;
  assert.ok(cf != null);
  assert.ok(Math.abs(cf - 3.0103) < 1e-3);

  // Steady-state sine should have a very small LRA.
  assert.ok(out.lra != null);
  assert.ok(out.lra >= 0);
  assert.ok(out.lra < 0.01);
});

test('analyzeTruePeakAndClipping reports peaks and clipping', async () => {
  const fs = 8000;
  const n = fs * 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  // First second: safe sine; second second: clipped constant
  for (let i = 0; i < fs; i++) {
    const v = 0.5 * Math.sin((2 * Math.PI * 440 * i) / fs);
    left[i] = v;
    right[i] = v;
  }
  for (let i = fs; i < n; i++) {
    left[i] = 1.2;
    right[i] = 1.2;
  }

  const out = await analyzeTruePeakAndClipping(left, right, fs);
  assert.ok(Array.isArray(out.frames));
  assert.ok(out.frames.length > 0);
  assert.ok(Array.isArray(out.stereoFrames));
  assert.ok(out.stereoFrames.length > 0);
  assert.ok(out.stereo != null);
  assert.ok(out.stereo.hotspots != null);
  assert.ok(Array.isArray(out.stereo.hotspots.widest));
  assert.ok(Array.isArray(out.stereo.hotspots.mostNegativeCorrelation));
  assert.ok(Array.isArray(out.stereo.hotspots.worstMonoDrop));
  assert.ok(out.stereo.hotspots.widest.length > 0);
  assert.ok(out.stereo.hotspots.widest.length <= 10);
  assert.ok(out.stereo.hotspots.mostNegativeCorrelation.length > 0);
  assert.ok(out.stereo.hotspots.mostNegativeCorrelation.length <= 10);
  assert.ok(out.stereo.hotspots.worstMonoDrop.length > 0);
  assert.ok(out.stereo.hotspots.worstMonoDrop.length <= 10);
  assert.ok(Array.isArray(out.stereo.hotspots.lrImbalance));
  assert.ok(out.stereo.hotspots.lrImbalance.length > 0);
  assert.ok(out.stereo.hotspots.lrImbalance.length <= 10);
  assert.ok(typeof out.samplePeakDbfs === 'number');
  assert.ok(typeof out.truePeakDbtp === 'number');
  assert.ok(out.clipping.clippedSamples > 0);
  assert.ok(out.clipping.clipEvents > 0);
  assert.ok(out.frames.some((fr) => (fr.clipEvents ?? 0) > 0));
  assert.ok(out.frames.some((fr) => (fr.clippedSamples ?? 0) > 0));
  assert.ok(Array.isArray(out.clipping.hotspots));
  assert.ok(out.clipping.hotspots.length > 0);
  assert.ok(out.clipping.hotspots.length <= 10);
  // Hotspots should be sorted by clippedSamples descending.
  for (let i = 1; i < out.clipping.hotspots.length; i++) {
    assert.ok((out.clipping.hotspots[i - 1].clippedSamples ?? 0) >= (out.clipping.hotspots[i].clippedSamples ?? 0));
  }
  // True peak should not be lower than sample peak.
  assert.ok(out.truePeakDbtp >= out.samplePeakDbfs - 1e-9);

  // For the first second (mono sine), correlation should be close to 1 and width close to 0.
  const firstStereo = out.stereoFrames[0];
  assert.ok(firstStereo.correlation != null);
  assert.ok(firstStereo.correlation > 0.9);
  assert.ok(firstStereo.width != null);
  assert.ok(firstStereo.width < 0.05);

  // Sorting sanity: widest should be non-increasing.
  for (let i = 1; i < out.stereo.hotspots.widest.length; i++) {
    assert.ok((out.stereo.hotspots.widest[i - 1].width ?? 0) >= (out.stereo.hotspots.widest[i].width ?? 0));
  }

  // Sorting sanity: lrImbalance should be non-increasing by abs(lrBalanceDb).
  for (let i = 1; i < out.stereo.hotspots.lrImbalance.length; i++) {
    assert.ok(Math.abs(out.stereo.hotspots.lrImbalance[i - 1].lrBalanceDb ?? 0) >= Math.abs(out.stereo.hotspots.lrImbalance[i].lrBalanceDb ?? 0));
  }

  assert.ok(out.rumble != null);
  assert.ok(Array.isArray(out.rumble.hotspots));
  assert.ok(out.rumble.hotspots.length > 0);
  assert.ok(out.rumble.hotspots.length <= 10);
  // Sorting sanity: rumble hotspots should be non-increasing by rumbleRmsDbfs.
  for (let i = 1; i < out.rumble.hotspots.length; i++) {
    assert.ok((out.rumble.hotspots[i - 1].rumbleRmsDbfs ?? -Infinity) >= (out.rumble.hotspots[i].rumbleRmsDbfs ?? -Infinity));
  }
});

test('psycho pack: high-frequency energy increases sharpness and sibilance', () => {
  const fs = 48000;
  const nBins = 1025; // typical for FFT size 2048
  const ctx = createPsychoContext(fs, nBins);

  const magLow = new Float32Array(nBins);
  const magHigh = new Float32Array(nBins);

  // Put energy in a narrow low band (~150 Hz) and a narrow high band (~8 kHz).
  const nyq = fs / 2;
  const binHz = nyq / (nBins - 1);
  const binLow = Math.round(150 / binHz);
  const binHigh = Math.round(8000 / binHz);
  magLow[binLow] = 1;
  magHigh[binHigh] = 1;

  const a = ctx.analyzeMag(magLow);
  const b = ctx.analyzeMag(magHigh);

  assert.ok(b.sharpness > a.sharpness);
  assert.ok(b.sibilanceIndex > a.sibilanceIndex);
});
