import { clamp, dbfsFromLinear } from './utils.js';

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function catmullRom(p0, p1, p2, p3, t) {
  // Standard Catmull-Rom spline (centripetal parameterization not used).
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function absMaxStereoAt(left, right, i) {
  const l = left[i] ?? 0;
  const r = right[i] ?? 0;
  return Math.max(Math.abs(l), Math.abs(r));
}

function meanStdFromFrames(frames, field) {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const fr of frames) {
    const v = fr?.[field];
    if (!isFiniteNumber(v)) continue;
    n++;
    if (v < min) min = v;
    if (v > max) max = v;
    const delta = v - mean;
    mean += delta / n;
    const delta2 = v - mean;
    m2 += delta * delta2;
  }

  if (n === 0) return { mean: null, std: null, min: null, max: null, count: 0 };
  if (n === 1) return { mean, std: null, min, max, count: 1 };
  return { mean, std: Math.sqrt(m2 / n), min, max, count: n };
}

/**
 * Approximates true peak by evaluating Catmull-Rom interpolated samples at fractional positions.
 * This can capture inter-sample overs without a heavy FIR oversampler.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} sampleRate
 * @param {(p:any)=>void} [onProgress]
 */
export async function analyzeTruePeakAndClipping(left, right, sampleRate, onProgress) {
  const n = Math.min(left.length, right.length);

  const blockMs = 100;
  const block = Math.max(1, Math.round((blockMs / 1000) * sampleRate));

  /** @type {Array<{tSec:number, samplePeakDbfs:number, truePeakDbtp:number}>} */
  const frames = [];

  /** @type {Array<{tSec:number, correlation:number|null, width:number|null, midRmsDbfs:number|null, sideRmsDbfs:number|null, lrBalanceDb:number|null, monoDropDb:number|null, rumbleRmsDbfs:number|null, rumbleRatioToStereoRms:number|null}>} */
  const stereoFrames = [];

  let globalSamplePeak = 0;
  let globalTruePeak = 0;

  // DC offset
  let dcSumL = 0;
  let dcSumR = 0;

  // Global stereo sums
  let sumL2All = 0;
  let sumR2All = 0;
  let sumLRAll = 0;
  let sumM2All = 0;
  let sumS2All = 0;
  let sumMono2All = 0;

  // Rumble (below ~30 Hz) estimated via 1st-order lowpass on mid signal.
  const rumbleFc = 30;
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * rumbleFc);
  const alpha = dt / (rc + dt);
  let lpMid = 0;
  let sumRumble2All = 0;

  let clippedSamples = 0;
  let clipEvents = 0;
  let inClip = false;

  // For Catmull-Rom we need i-1..i+2; handle edges by clamping.
  const frac = [0.25, 0.5, 0.75];

  for (let end = block, frameIndex = 0; end <= n; end += block, frameIndex++) {
    if (frameIndex % 500 === 0) {
      onProgress?.({ stage: 'TruePeak', detail: `${frameIndex}` });
      await new Promise((r) => setTimeout(r, 0));
    }

    const start = end - block;
    let samplePeak = 0;
    let truePeak = 0;

    let clippedSamplesFrame = 0;
    let clipEventsFrame = 0;

    let sumL2 = 0;
    let sumR2 = 0;
    let sumLR = 0;
    let sumM2 = 0;
    let sumS2 = 0;
    let sumMono2 = 0;

    let dcL = 0;
    let dcR = 0;

    let sumRumble2 = 0;

    for (let i = start; i < end; i++) {
      const l = left[i] ?? 0;
      const r = right[i] ?? 0;
      const a = absMaxStereoAt(left, right, i);
      if (a > samplePeak) samplePeak = a;

      dcL += l;
      dcR += r;

      const lSq = l * l;
      const rSq = r * r;
      sumL2 += lSq;
      sumR2 += rSq;
      sumLR += l * r;

      const m = 0.5 * (l + r);
      const s = 0.5 * (l - r);
      sumM2 += m * m;
      sumS2 += s * s;
      sumMono2 += m * m;

      // Rumble estimate: lowpass mid
      lpMid = lpMid + alpha * (m - lpMid);
      sumRumble2 += lpMid * lpMid;

      if (a >= 1) {
        clippedSamples++;
        clippedSamplesFrame++;
        if (!inClip) {
          clipEvents++;
          clipEventsFrame++;
          inClip = true;
        }
      } else {
        inClip = false;
      }

      // Catmull-Rom fractional samples between i and i+1
      // Use per-channel interpolation and take max abs of L/R.
      const i0 = clamp(i - 1, 0, n - 1);
      const i1 = clamp(i, 0, n - 1);
      const i2 = clamp(i + 1, 0, n - 1);
      const i3 = clamp(i + 2, 0, n - 1);

      const l0 = left[i0];
      const l1 = left[i1];
      const l2 = left[i2];
      const l3 = left[i3];

      const r0 = right[i0];
      const r1 = right[i1];
      const r2 = right[i2];
      const r3 = right[i3];

      for (const t of frac) {
        const yl = catmullRom(l0, l1, l2, l3, t);
        const yr = catmullRom(r0, r1, r2, r3, t);
        const y = Math.max(Math.abs(yl), Math.abs(yr));
        if (y > truePeak) truePeak = y;
      }
    }

    if (samplePeak > globalSamplePeak) globalSamplePeak = samplePeak;
    if (truePeak > globalTruePeak) globalTruePeak = truePeak;

    dcSumL += dcL;
    dcSumR += dcR;

    sumL2All += sumL2;
    sumR2All += sumR2;
    sumLRAll += sumLR;
    sumM2All += sumM2;
    sumS2All += sumS2;
    sumMono2All += sumMono2;
    sumRumble2All += sumRumble2;

    const winLen = Math.max(1, end - start);
    const eps = 1e-24;

    const corr = (sumL2 > 0 && sumR2 > 0) ? (sumLR / (Math.sqrt(sumL2 * sumR2) + eps)) : null;
    const rmsM = Math.sqrt(sumM2 / winLen);
    const rmsS = Math.sqrt(sumS2 / winLen);
    const width = rmsM > 0 ? (rmsS / (rmsM + eps)) : null;

    const rmsL = Math.sqrt(sumL2 / winLen);
    const rmsR = Math.sqrt(sumR2 / winLen);
    const lrBalanceDb = (rmsL > 0 && rmsR > 0) ? (20 * Math.log10((rmsL + eps) / (rmsR + eps))) : null;

    const rmsStereo = Math.sqrt((sumL2 + sumR2) / (2 * winLen));
    const rmsMono = Math.sqrt(sumMono2 / winLen);
    const monoDropDb = (rmsStereo > 0 && rmsMono > 0) ? (20 * Math.log10((rmsMono + eps) / (rmsStereo + eps))) : null;

    const rumbleRmsFrame = Math.sqrt(sumRumble2 / winLen);
    const rumbleRatioFrame = (rmsStereo > 0) ? (rumbleRmsFrame / (rmsStereo + eps)) : null;

    frames.push({
      tSec: end / sampleRate,
      samplePeakDbfs: dbfsFromLinear(samplePeak),
      truePeakDbtp: dbfsFromLinear(truePeak),
      clippedSamples: clippedSamplesFrame,
      clipEvents: clipEventsFrame,
    });

    stereoFrames.push({
      tSec: end / sampleRate,
      correlation: corr != null ? Math.max(-1, Math.min(1, corr)) : null,
      width,
      midRmsDbfs: dbfsFromLinear(rmsM),
      sideRmsDbfs: dbfsFromLinear(rmsS),
      lrBalanceDb,
      monoDropDb,
      rumbleRmsDbfs: dbfsFromLinear(rumbleRmsFrame),
      rumbleRatioToStereoRms: rumbleRatioFrame,
    });
  }

  const hotspots = frames
    .filter((fr) => isFiniteNumber(fr?.tSec) && (fr?.clippedSamples ?? 0) > 0)
    .slice()
    .sort((a, b) => {
      const da = a.clippedSamples ?? 0;
      const db = b.clippedSamples ?? 0;
      if (db !== da) return db - da;
      const ea = a.clipEvents ?? 0;
      const eb = b.clipEvents ?? 0;
      if (eb !== ea) return eb - ea;
      return (a.tSec ?? 0) - (b.tSec ?? 0);
    })
    .slice(0, 10)
    .map((fr) => ({
      tSec: fr.tSec,
      clippedSamples: fr.clippedSamples,
      clipEvents: fr.clipEvents,
      truePeakDbtp: fr.truePeakDbtp,
      samplePeakDbfs: fr.samplePeakDbfs,
    }));

  const dcOffsetL = dcSumL / Math.max(1, n);
  const dcOffsetR = dcSumR / Math.max(1, n);

  const eps2 = 1e-24;
  const corrGlobal = (sumL2All > 0 && sumR2All > 0) ? (sumLRAll / (Math.sqrt(sumL2All * sumR2All) + eps2)) : null;
  const rmsMAll = Math.sqrt(sumM2All / Math.max(1, n));
  const rmsSAll = Math.sqrt(sumS2All / Math.max(1, n));
  const widthGlobal = rmsMAll > 0 ? (rmsSAll / (rmsMAll + eps2)) : null;

  const rmsStereoAll = Math.sqrt((sumL2All + sumR2All) / (2 * Math.max(1, n)));
  const rmsMonoAll = Math.sqrt(sumMono2All / Math.max(1, n));
  const monoDropDbGlobal = (rmsStereoAll > 0 && rmsMonoAll > 0) ? (20 * Math.log10((rmsMonoAll + eps2) / (rmsStereoAll + eps2))) : null;

  const rumbleRms = Math.sqrt(sumRumble2All / Math.max(1, n));
  const rumbleRmsDbfs = dbfsFromLinear(rumbleRms);
  const rumbleRatio = (rmsStereoAll > 0) ? (rumbleRms / (rmsStereoAll + eps2)) : null;

  const widest = stereoFrames
    .filter((fr) => isFiniteNumber(fr?.tSec) && isFiniteNumber(fr?.width))
    .slice()
    .sort((a, b) => (b.width - a.width) || ((a.tSec ?? 0) - (b.tSec ?? 0)))
    .slice(0, 10)
    .map((fr) => ({
      tSec: fr.tSec,
      width: fr.width,
      correlation: fr.correlation,
      monoDropDb: fr.monoDropDb,
      lrBalanceDb: fr.lrBalanceDb,
    }));

  const mostNegativeCorrelation = stereoFrames
    .filter((fr) => isFiniteNumber(fr?.tSec) && isFiniteNumber(fr?.correlation))
    .slice()
    .sort((a, b) => (a.correlation - b.correlation) || ((a.tSec ?? 0) - (b.tSec ?? 0)))
    .slice(0, 10)
    .map((fr) => ({
      tSec: fr.tSec,
      correlation: fr.correlation,
      width: fr.width,
      monoDropDb: fr.monoDropDb,
      lrBalanceDb: fr.lrBalanceDb,
    }));

  const worstMonoDrop = stereoFrames
    .filter((fr) => isFiniteNumber(fr?.tSec) && isFiniteNumber(fr?.monoDropDb))
    .slice()
    .sort((a, b) => (a.monoDropDb - b.monoDropDb) || ((a.tSec ?? 0) - (b.tSec ?? 0)))
    .slice(0, 10)
    .map((fr) => ({
      tSec: fr.tSec,
      monoDropDb: fr.monoDropDb,
      correlation: fr.correlation,
      width: fr.width,
      lrBalanceDb: fr.lrBalanceDb,
    }));

  const lrImbalance = stereoFrames
    .filter((fr) => isFiniteNumber(fr?.tSec) && isFiniteNumber(fr?.lrBalanceDb))
    .slice()
    .sort((a, b) => (Math.abs(b.lrBalanceDb) - Math.abs(a.lrBalanceDb)) || ((a.tSec ?? 0) - (b.tSec ?? 0)))
    .slice(0, 10)
    .map((fr) => ({
      tSec: fr.tSec,
      lrBalanceDb: fr.lrBalanceDb,
      correlation: fr.correlation,
      width: fr.width,
      monoDropDb: fr.monoDropDb,
    }));

  const rumbleHotspots = stereoFrames
    .filter((fr) => isFiniteNumber(fr?.tSec) && isFiniteNumber(fr?.rumbleRmsDbfs))
    .slice()
    .sort((a, b) => (b.rumbleRmsDbfs - a.rumbleRmsDbfs) || ((a.tSec ?? 0) - (b.tSec ?? 0)))
    .slice(0, 10)
    .map((fr) => ({
      tSec: fr.tSec,
      rumbleRmsDbfs: fr.rumbleRmsDbfs,
      rumbleRatioToStereoRms: fr.rumbleRatioToStereoRms,
      correlation: fr.correlation,
      lrBalanceDb: fr.lrBalanceDb,
    }));

  return {
    frames,
    stereoFrames,
    samplePeakDbfs: dbfsFromLinear(globalSamplePeak),
    truePeakDbtp: dbfsFromLinear(globalTruePeak),
    clipping: {
      clippedSamples,
      clipEvents,
      clipThresholdAbs: 1.0,
      hotspots,
    },
    stereo: {
      correlation: corrGlobal != null ? Math.max(-1, Math.min(1, corrGlobal)) : null,
      correlationStats: meanStdFromFrames(stereoFrames, 'correlation'),
      width: widthGlobal,
      widthStats: meanStdFromFrames(stereoFrames, 'width'),
      lrBalanceDbStats: meanStdFromFrames(stereoFrames, 'lrBalanceDb'),
      monoDropDbStats: meanStdFromFrames(stereoFrames, 'monoDropDb'),
      hotspots: {
        widest,
        mostNegativeCorrelation,
        worstMonoDrop,
        lrImbalance,
      },
    },
    dcOffset: {
      left: dcOffsetL,
      right: dcOffsetR,
    },
    rumble: {
      fcHz: rumbleFc,
      rmsDbfs: rumbleRmsDbfs,
      ratioToStereoRms: rumbleRatio,
      hotspots: rumbleHotspots,
    },
    meta: {
      approx: true,
      method: 'catmull-rom fractional (0.25/0.5/0.75)',
      blockMs,
    },
  };
}
