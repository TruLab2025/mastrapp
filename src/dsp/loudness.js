import { clamp, dbfsFromLinear } from './utils.js';

// Approximate LUFS: K-weighting implemented with RBJ biquads (not a bit-exact EBU R128 implementation).
// Good for relative comparisons between bounce exports.

function biquadCoeffsHighpass(fs, fc, q) {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);

  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;

  return normBiquad({ b0, b1, b2, a0, a1, a2 });
}

function biquadCoeffsHighShelf(fs, fc, gainDb, slope = 1) {
  // RBJ audio EQ cookbook
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const beta = 2 * Math.sqrt(A) * alpha;

  const b0 = A * ((A + 1) + (A - 1) * cos + beta);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cos);
  const b2 = A * ((A + 1) + (A - 1) * cos - beta);
  const a0 = (A + 1) - (A - 1) * cos + beta;
  const a1 = 2 * ((A - 1) - (A + 1) * cos);
  const a2 = (A + 1) - (A - 1) * cos - beta;

  return normBiquad({ b0, b1, b2, a0, a1, a2 });
}

function normBiquad(c) {
  return {
    b0: c.b0 / c.a0,
    b1: c.b1 / c.a0,
    b2: c.b2 / c.a0,
    a1: c.a1 / c.a0,
    a2: c.a2 / c.a0,
  };
}

function biquadProcess(x, state, c) {
  const y = c.b0 * x + c.b1 * state.x1 + c.b2 * state.x2 - c.a1 * state.y1 - c.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = x;
  state.y2 = state.y1;
  state.y1 = y;
  return y;
}

function makeState() {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

function kWeightSample(x, fs, st) {
  // Approx parameters: HPF 40 Hz (Q=0.707), shelf +4 dB at 1500 Hz
  const hp = st.hp;
  const sh = st.sh;
  const y1 = biquadProcess(x, hp.state, hp.c);
  return biquadProcess(y1, sh.state, sh.c);
}

function makeKWeighting(fs) {
  return {
    hp: { c: biquadCoeffsHighpass(fs, 40, 0.707), state: makeState() },
    sh: { c: biquadCoeffsHighShelf(fs, 1500, 4.0, 1), state: makeState() },
  };
}

function loudnessFromMeanSquare(ms) {
  // LUFS uses -0.691 dB offset for the K-weighted mean square sum.
  // Here we keep the same offset to align roughly.
  const eps = 1e-24;
  return -0.691 + 10 * Math.log10(ms + eps);
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function percentileSorted(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (!isFiniteNumber(p)) return null;
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const pp = Math.max(0, Math.min(100, p));
  const idx = (pp / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const t = idx - lo;
  const a = sorted[lo];
  const b = sorted[hi];
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
  return a + t * (b - a);
}

/**
 * Approx Loudness Range (LRA) from short-term loudness distribution.
 * Based on EBU Tech 3342 idea: apply absolute gate and relative gate, then LRA = P95 - P10.
 * This is not a bit-exact EBU implementation but is stable for comparisons.
 *
 * @param {Array<any>} frames
 * @param {number} integratedLufs
 * @param {{absGateLufs?:number, relGateOffsetLu?:number, pLow?:number, pHigh?:number}} [opts]
 */
export function computeLraFromShortTermFrames(frames, integratedLufs, opts = {}) {
  const absGateLufs = isFiniteNumber(opts.absGateLufs) ? opts.absGateLufs : -70;
  const relGateOffsetLu = isFiniteNumber(opts.relGateOffsetLu) ? opts.relGateOffsetLu : -20;
  const pLow = isFiniteNumber(opts.pLow) ? opts.pLow : 10;
  const pHigh = isFiniteNumber(opts.pHigh) ? opts.pHigh : 95;

  if (!Array.isArray(frames) || frames.length === 0 || !isFiniteNumber(integratedLufs)) {
    return {
      lra: null,
      pLow: null,
      pHigh: null,
      meta: { approx: true, absGateLufs, relGateOffsetLu, pLow, pHigh, used: 0, total: Array.isArray(frames) ? frames.length : 0 },
    };
  }

  const relGate = integratedLufs + relGateOffsetLu;
  const values = [];
  for (const fr of frames) {
    const v = fr?.lufsShortTerm;
    if (!isFiniteNumber(v)) continue;
    if (v <= absGateLufs) continue;
    if (v < relGate) continue;
    values.push(v);
  }

  values.sort((a, b) => a - b);
  const pLo = percentileSorted(values, pLow);
  const pHi = percentileSorted(values, pHigh);
  const lra = isFiniteNumber(pLo) && isFiniteNumber(pHi) ? (pHi - pLo) : null;

  return {
    lra,
    pLow: pLo,
    pHigh: pHi,
    meta: {
      approx: true,
      method: 'short-term LUFS percentiles (gated)',
      absGateLufs,
      relGateLufs: relGate,
      relGateOffsetLu,
      pLow,
      pHigh,
      used: values.length,
      total: frames.length,
    },
  };
}

/**
 * Computes RMS and LUFS-like loudness over time.
 * @param {Float32Array} left
 * @param {Float32Array} right
 */
export async function analyzeLoudnessOverTime(left, right, sampleRate, onProgress) {
  const n = Math.min(left.length, right.length);
  const blockMs = 100; // analysis hop for loudness curve
  const momentaryMs = 400;
  const shortTermMs = 3000;

  const hop = Math.max(1, Math.round((blockMs / 1000) * sampleRate));
  const winM = Math.max(1, Math.round((momentaryMs / 1000) * sampleRate));
  const winS = Math.max(1, Math.round((shortTermMs / 1000) * sampleRate));

  const kL = makeKWeighting(sampleRate);
  const kR = makeKWeighting(sampleRate);

  // Pre-filtered squared signal for efficient windowed energy
  const sq = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    if (i % 500000 === 0) {
      onProgress?.({ stage: 'Loudness', detail: `${Math.round((i / n) * 100)}%` });
      await new Promise((r) => setTimeout(r, 0));
    }

    const yl = kWeightSample(left[i], sampleRate, kL);
    const yr = kWeightSample(right[i], sampleRate, kR);
    // channel weights 1.0 / 1.0
    sq[i] = 0.5 * (yl * yl + yr * yr);
  }

  // Prefix sum for window mean square
  const pref = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + sq[i];

  const frames = [];

  function windowMsAt(center, win) {
    const end = clamp(center, 0, n);
    const start = clamp(end - win, 0, n);
    const sum = pref[end] - pref[start];
    const len = Math.max(1, end - start);
    return sum / len;
  }

  // RMS curve (unweighted) on same hop
  const prefRms = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = 0.5 * (left[i] * left[i] + right[i] * right[i]);
    prefRms[i + 1] = prefRms[i] + v;
  }

  function windowRmsAt(center, win) {
    const end = clamp(center, 0, n);
    const start = clamp(end - win, 0, n);
    const sum = prefRms[end] - prefRms[start];
    const len = Math.max(1, end - start);
    return Math.sqrt(sum / len);
  }

  // Sliding peak detector for the same momentary window used for RMS.
  // We track peak over stereo samples using max(|L|,|R|).
  /** @type {Array<{i:number, v:number}>} */
  const peakDeque = [];
  let peakScan = 0;
  const eps = 1e-24;

  function peakPush(i) {
    const v = Math.max(Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
    while (peakDeque.length && peakDeque[peakDeque.length - 1].v <= v) peakDeque.pop();
    peakDeque.push({ i, v });
  }

  function peakExpire(minIndex) {
    while (peakDeque.length && peakDeque[0].i < minIndex) peakDeque.shift();
  }

  for (let idx = 0, center = winM; center <= n; idx++, center += hop) {
    if (idx % 250 === 0) {
      onProgress?.({ stage: 'Loudness (frames)', detail: `${idx}` });
      await new Promise((r) => setTimeout(r, 0));
    }

    const msM = windowMsAt(center, winM);
    const msS = windowMsAt(center, winS);

    const lufsM = loudnessFromMeanSquare(msM);
    const lufsS = loudnessFromMeanSquare(msS);

    const rms = windowRmsAt(center, winM);

    // advance peak scan up to the window end
    while (peakScan < center) {
      peakPush(peakScan);
      peakScan++;
    }
    peakExpire(center - winM);
    const peak = peakDeque.length ? peakDeque[0].v : 0;
    const crestFactorDb = peak > 0 && rms > 0 ? 20 * Math.log10((peak + eps) / (rms + eps)) : null;

    frames.push({
      tSec: center / sampleRate,
      rms: rms,
      rmsDbfs: dbfsFromLinear(rms),
      peakDbfs: dbfsFromLinear(peak),
      crestFactorDb,
      lufsMomentary: lufsM,
      lufsShortTerm: lufsS,
    });
  }

  // Integrated loudness (approx): EBU-style gating on 400ms blocks
  // Absolute gate at -70 LUFS, then relative gate at (ungated - 10).
  const block = winM;
  const blocks = [];
  for (let end = block; end <= n; end += block) {
    const ms = windowMsAt(end, block);
    const l = loudnessFromMeanSquare(ms);
    blocks.push({ ms, l });
  }

  const ungated = blocks.filter((b) => b.l > -70);
  const ungatedMsMean = ungated.length ? ungated.reduce((s, b) => s + b.ms, 0) / ungated.length : 0;
  const ungatedL = loudnessFromMeanSquare(ungatedMsMean);

  const relGate = ungatedL - 10;
  const gated = ungated.filter((b) => b.l >= relGate);
  const gatedMsMean = gated.length ? gated.reduce((s, b) => s + b.ms, 0) / gated.length : 0;
  const integrated = loudnessFromMeanSquare(gatedMsMean);

  const lraOut = computeLraFromShortTermFrames(frames, integrated);

  return {
    frames,
    integratedLufs: integrated,
    integratedLufsMeta: {
      approx: true,
      absoluteGateLufs: -70,
      relativeGateLufs: relGate,
      blockMs: momentaryMs,
    },
    lra: lraOut.lra,
    lraMeta: lraOut.meta,
  };
}
