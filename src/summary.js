function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function summarizeNumericSeries(frames, field) {
  if (!Array.isArray(frames) || frames.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;

  for (const fr of frames) {
    const v = fr?.[field];
    if (!isFiniteNumber(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }

  if (!n) return null;
  return { mean: sum / n, min, max };
}

function summarizeNumericArray(values) {
  if (!Array.isArray(values) || values.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;

  for (const v of values) {
    if (!isFiniteNumber(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }

  if (!n) return null;
  return { mean: sum / n, min, max };
}

function truncateArray(arr, limit) {
  if (!Array.isArray(arr)) return { items: [], truncated: false, total: 0 };
  const total = arr.length;
  if (total <= limit) return { items: arr, truncated: false, total };
  return { items: arr.slice(0, limit), truncated: true, total };
}

/**
 * Produkuje mały JSON “do GPT”: bez ogromnych tablic ramek.
 * @param {any} full
 */
export function makeGptSummary(full) {
  if (!full || typeof full !== 'object') return full;

  const meta = full.meta ?? {};
  const global = full.global ?? {};
  const ts = full.timeSeries ?? {};

  const loudnessFrames = ts.loudnessFrames ?? [];
  const spectrumFrames = ts.spectrumFrames ?? [];
  const onsetTimes = ts.onsetTimesSec ?? [];
  const onsetStrength = ts.onsetStrength ?? [];
  const stereoFrames = ts.stereoFrames ?? [];
  const psychoFrames = ts.psychoFrames ?? [];

  const onsetTrunc = truncateArray(onsetTimes, 200);

  return {
    meta: {
      analyzedAt: meta.analyzedAt,
      backend: meta.backend,
      sampleRate: meta.sampleRate,
      durationSec: meta.durationSec,
      channels: meta.channels,
      frameSize: meta.frameSize,
      hopSize: meta.hopSize,
      rolloffPercent: meta.rolloffPercent,
      essentia: meta.essentia,
    },
    global: {
      rmsDbfs: global.rmsDbfs,
      integratedLufs: global.integratedLufs,
      shortTermLufsStd: global.shortTermLufsStd,
      lra: global.lra,
      crestFactorDbMean: global.crestFactorDbMean,
      crestFactorDbStd: global.crestFactorDbStd,
      samplePeakDbfs: global.samplePeakDbfs,
      truePeakDbtp: global.truePeakDbtp,
      plr: global.plr,
      clipping: global.clipping,
      stereo: global.stereo,
      dcOffset: global.dcOffset,
      rumble: global.rumble,
      silence: global.silence,
      tonalBalance: global.tonalBalance,
      spectral: global.spectral,
      psycho: global.psycho,
      energyDistribution: global.energyDistribution,
    },
    summaries: {
      loudness: {
        frames: Array.isArray(loudnessFrames) ? loudnessFrames.length : 0,
        rmsDbfs: summarizeNumericSeries(loudnessFrames, 'rmsDbfs'),
        peakDbfs: summarizeNumericSeries(loudnessFrames, 'peakDbfs'),
        crestFactorDb: summarizeNumericSeries(loudnessFrames, 'crestFactorDb'),
        lufsMomentary: summarizeNumericSeries(loudnessFrames, 'lufsMomentary'),
        lufsShortTerm: summarizeNumericSeries(loudnessFrames, 'lufsShortTerm'),
      },
      truePeak: {
        frames: Array.isArray(ts.truePeakFrames) ? ts.truePeakFrames.length : 0,
        samplePeakDbfs: summarizeNumericSeries(ts.truePeakFrames ?? [], 'samplePeakDbfs'),
        truePeakDbtp: summarizeNumericSeries(ts.truePeakFrames ?? [], 'truePeakDbtp'),
        clippedSamples: summarizeNumericSeries(ts.truePeakFrames ?? [], 'clippedSamples'),
        clipEvents: summarizeNumericSeries(ts.truePeakFrames ?? [], 'clipEvents'),
        clipHotspots: Array.isArray(global?.clipping?.hotspots) ? global.clipping.hotspots.slice(0, 5) : [],
      },
      stereo: {
        frames: Array.isArray(stereoFrames) ? stereoFrames.length : 0,
        hotspots: {
          widest: Array.isArray(global?.stereo?.hotspots?.widest) ? global.stereo.hotspots.widest.slice(0, 5) : [],
          mostNegativeCorrelation: Array.isArray(global?.stereo?.hotspots?.mostNegativeCorrelation) ? global.stereo.hotspots.mostNegativeCorrelation.slice(0, 5) : [],
          worstMonoDrop: Array.isArray(global?.stereo?.hotspots?.worstMonoDrop) ? global.stereo.hotspots.worstMonoDrop.slice(0, 5) : [],
          lrImbalance: Array.isArray(global?.stereo?.hotspots?.lrImbalance) ? global.stereo.hotspots.lrImbalance.slice(0, 5) : [],
        },
      },
      rumble: {
        hotspots: Array.isArray(global?.rumble?.hotspots) ? global.rumble.hotspots.slice(0, 5) : [],
      },
      spectrum: {
        frames: Array.isArray(spectrumFrames) ? spectrumFrames.length : 0,
        centroidHz: summarizeNumericSeries(spectrumFrames, 'centroidHz'),
        rolloffHz: summarizeNumericSeries(spectrumFrames, 'rolloffHz'),
        flatness: summarizeNumericSeries(spectrumFrames, 'flatness'),
      },
      psycho: {
        frames: Array.isArray(psychoFrames) ? psychoFrames.length : 0,
        sharpness: summarizeNumericSeries(psychoFrames, 'sharpness'),
        spectralContrastDb: summarizeNumericSeries(psychoFrames, 'spectralContrastDb'),
        boominessIndex: summarizeNumericSeries(psychoFrames, 'boominessIndex'),
        harshnessIndex: summarizeNumericSeries(psychoFrames, 'harshnessIndex'),
        sibilanceIndex: summarizeNumericSeries(psychoFrames, 'sibilanceIndex'),
      },
      onsets: {
        count: onsetTrunc.total,
        first: onsetTrunc.items,
        truncated: onsetTrunc.truncated,
        onsetStrength: summarizeNumericArray(onsetStrength),
      },
    },
  };
}
