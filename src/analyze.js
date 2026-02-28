import { analyzeSpectrumOverTime } from './dsp/spectrum.js';
import { analyzeLoudnessOverTime } from './dsp/loudness.js';
import { detectOnsetsFromBandFlux, computeOnsetStrengthFromSpectrumFrames } from './dsp/onsets.js';
import { dbfsFromLinear, rmsOfInterleavedStereo, stddevOfFrames } from './dsp/utils.js';
import { analyzeTruePeakAndClipping } from './dsp/truepeak.js';
import { loadEssentia } from './essentia/loader.js';
import { analyzeWithEssentia } from './essentia/analyze-essentia.js';
import { analyzeRhythmFromOnsets } from './dsp/rhythm.js';
import { analyzeSmiFromBandNormalized } from './dsp/smi.js';

function meanOfFrames(frames, field) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const fr of frames) {
    const v = fr?.[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  return n ? sum / n : null;
}

function percentileOfFrames(frames, field, p) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const vals = [];
  for (const fr of frames) {
    const v = fr?.[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    vals.push(v);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const pp = Math.max(0, Math.min(100, p));
  const idx = (pp / 100) * (vals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const t = idx - lo;
  return vals[lo] + t * (vals[hi] - vals[lo]);
}

function fractionOfFramesBelow(frames, field, threshold) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  let n = 0;
  let below = 0;
  for (const fr of frames) {
    const v = fr?.[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    n++;
    if (v < threshold) below++;
  }
  return n ? (below / n) : null;
}

function closestFrameByTime(frames, tSec) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  if (typeof tSec !== 'number' || !Number.isFinite(tSec)) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = frames[mid]?.tSec;
    if (typeof t !== 'number') return null;
    if (t < tSec) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const a = frames[i];
  const b = frames[i - 1];
  if (!b) return a;
  const da = Math.abs((a?.tSec ?? 0) - tSec);
  const db = Math.abs((b?.tSec ?? 0) - tSec);
  return da <= db ? a : b;
}

function defaultBands() {
  return [
    { name: 'sub_20_60', lo: 20, hi: 60 },
    { name: 'bass_60_120', lo: 60, hi: 120 },
    { name: 'lowmid_120_250', lo: 120, hi: 250 },
    { name: 'mid_250_500', lo: 250, hi: 500 },
    { name: 'uppermid_500_2000', lo: 500, hi: 2000 },
    { name: 'presence_2000_4000', lo: 2000, hi: 4000 },
    { name: 'brilliance_4000_8000', lo: 4000, hi: 8000 },
    { name: 'air_8000_20000', lo: 8000, hi: 20000 },
  ];
}

function lowMidHighBands() {
  return [
    { name: 'low', lo: 20, hi: 250 },
    { name: 'mid', lo: 250, hi: 4000 },
    { name: 'high', lo: 4000, hi: 20000 },
  ];
}

/**
 * @param {AudioBuffer} audioBuffer
 * @param {{frameMs:number, hopMs:number, rolloffPercent:number, onProgress?:(p:any)=>void}} options
 */
export async function analyzeAudioBuffer(audioBuffer, options) {
  // Optional Essentia backend (no bundler). If not installed, we transparently fall back.
  options.onProgress?.({ stage: 'Backend', detail: 'sprawdzam Essentia…' });
  const essentiaBundle = await loadEssentia();
  if (essentiaBundle) {
    options.onProgress?.({ stage: 'Backend', detail: 'Essentia' });
    return analyzeWithEssentia(essentiaBundle, audioBuffer, options);
  }

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const durationSec = audioBuffer.duration;

  if (channels < 2) throw new Error('Plik musi mieć co najmniej 2 kanały (stereo).');

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);

  const frameSize = Math.max(128, Math.round((options.frameMs / 1000) * sampleRate));
  const hopSize = Math.max(64, Math.round((options.hopMs / 1000) * sampleRate));

  options.onProgress?.({ stage: 'Start', detail: `${channels}ch @ ${sampleRate} Hz` });

  // Full-file RMS (stereo energy)
  const rmsAll = rmsOfInterleavedStereo(left, right, 0, Math.min(left.length, right.length));
  const rmsAllDbfs = dbfsFromLinear(rmsAll);

  // Spectrum metrics + band energy
  const bands = defaultBands();
  const lmh = lowMidHighBands();

  const spectrum = await analyzeSpectrumOverTime(
    left,
    right,
    sampleRate,
    frameSize,
    hopSize,
    options.rolloffPercent,
    [...bands, ...lmh],
    options.onProgress,
  );

  const centroidHzStd = stddevOfFrames(spectrum.frames, 'centroidHz');
  const spectralFluxStd = stddevOfFrames(spectrum.frames, 'spectralFlux');
  const hfcStd = stddevOfFrames(spectrum.frames, 'hfc');

  // Onsets (transients)
  options.onProgress?.({ stage: 'Onsets' });
  const onsets = detectOnsetsFromBandFlux(spectrum.frames);

  const onsetStrength = computeOnsetStrengthFromSpectrumFrames(
    spectrum.frames,
    onsets.onsetsSec,
    { windowSec: 0.05 },
  );

  // Rhythm / tempo estimation (lightweight, based on detected onsets)
  options.onProgress?.({ stage: 'Rhythm' });
  let rhythm = null;
  try {
    rhythm = analyzeRhythmFromOnsets(onsets.onsetsSec || []);
  } catch (e) {
    rhythm = { error: String(e) };
  }

  // Spectral Masking Index (proxy) using bandNormalized per-frame bands
  options.onProgress?.({ stage: 'SMI' });
  let smi = null;
  try {
    smi = analyzeSmiFromBandNormalized(spectrum.frames, { threshold: 0.5 });
  } catch (e) {
    smi = { error: String(e) };
  }

  // Loudness curve
  const loudness = await analyzeLoudnessOverTime(left, right, sampleRate, options.onProgress);
  const shortTermLufsStd = stddevOfFrames(loudness.frames, 'lufsShortTerm');
  const crestFactorDbMean = meanOfFrames(loudness.frames, 'crestFactorDb');
  const crestFactorDbStd = stddevOfFrames(loudness.frames, 'crestFactorDb');

  const silenceBelow60Pct = fractionOfFramesBelow(loudness.frames, 'rmsDbfs', -60);
  const rmsDbfsP10 = percentileOfFrames(loudness.frames, 'rmsDbfs', 10);
  const rmsDbfsP50 = percentileOfFrames(loudness.frames, 'rmsDbfs', 50);
  const rmsDbfsP90 = percentileOfFrames(loudness.frames, 'rmsDbfs', 90);

  // True peak + clipping (lightweight approximation)
  const truePeak = await analyzeTruePeakAndClipping(left, right, sampleRate, options.onProgress);
  const plr = (typeof truePeak.truePeakDbtp === 'number' && Number.isFinite(truePeak.truePeakDbtp) && typeof loudness.integratedLufs === 'number' && Number.isFinite(loudness.integratedLufs))
    ? (truePeak.truePeakDbtp - loudness.integratedLufs)
    : null;

  // Provide convenient low/mid/high distribution aggregated (from spectrum summary)
  const dist = spectrum.summary.bandEnergyNormalized;
  const low = dist.low ?? 0;
  const mid = dist.mid ?? 0;
  const high = dist.high ?? 0;

  const tonalBandDefs = defaultBands();
    
  const tonalBalance = tonalBandDefs
    .filter((b) => !['low', 'mid', 'high'].includes(b.name))
    .map((b) => ({
      name: b.name,
      loHz: b.lo,
      hiHz: b.hi,
      centerHz: Math.sqrt(b.lo * b.hi),
      energyNorm: dist[b.name] ?? 0,
    }));

  const onsetBandShares = (() => {
    const shares = { low: [], mid: [], high: [] };
    for (const t of onsets.onsetsSec ?? []) {
      const fr = closestFrameByTime(spectrum.frames, t);
      const bn = fr?.bandNormalized;
      if (!bn || typeof bn !== 'object') continue;
      for (const k of ['low', 'mid', 'high']) {
        const v = bn[k];
        if (typeof v === 'number' && Number.isFinite(v)) shares[k].push(v);
      }
    }

    function meanStd(arr) {
      if (!Array.isArray(arr) || arr.length === 0) return { mean: null, std: null, count: 0 };
      let n = 0;
      let mean = 0;
      let m2 = 0;
      for (const v of arr) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        n++;
        const d = v - mean;
        mean += d / n;
        const d2 = v - mean;
        m2 += d * d2;
      }
      if (n < 2) return { mean, std: null, count: n };
      return { mean, std: Math.sqrt(m2 / n), count: n };
    }

    return {
      low: meanStd(shares.low),
      mid: meanStd(shares.mid),
      high: meanStd(shares.high),
      note: 'Mean/std of low/mid/high bandNormalized at detected onsets (proxy transient spectral focus).',
    };
  })();

  return {
    meta: {
      analyzedAt: new Date().toISOString(),
      sampleRate,
      durationSec,
      channels: 2,
      frameSize,
      hopSize,
      rolloffPercent: options.rolloffPercent,
    },
    global: {
      rms: rmsAll,
      rmsDbfs: rmsAllDbfs,
      integratedLufs: loudness.integratedLufs,
      integratedLufsMeta: loudness.integratedLufsMeta,
      samplePeakDbfs: truePeak.samplePeakDbfs,
      truePeakDbtp: truePeak.truePeakDbtp,
      truePeakMeta: truePeak.meta,
      clipping: truePeak.clipping,
      plr,
      stereo: truePeak.stereo,
      dcOffset: truePeak.dcOffset,
      rumble: truePeak.rumble,
      silence: {
        belowRmsDbfs: -60,
        fractionBelow: silenceBelow60Pct,
        rmsDbfsP10,
        rmsDbfsP50,
        rmsDbfsP90,
      },
      shortTermLufsStd,
      lra: loudness.lra,
      lraMeta: loudness.lraMeta,
      crestFactorDbMean,
      crestFactorDbStd,
      tonalBalance,
      spectral: {
        centroidHzMean: spectrum.summary.centroidHzMean,
        centroidHzStd,
        rolloffHzMean: spectrum.summary.rolloffHzMean,
        flatnessMean: spectrum.summary.flatnessMean,
        spectralFluxMean: spectrum.summary.spectralFluxMean,
        spectralFluxStd,
        hfcMean: spectrum.summary.hfcMean,
        hfcStd,
      },
      psycho: spectrum.summary.psycho,
      energyDistribution: {
        low,
        mid,
        high,
      },
      transients: {
        onsetStrengthMean: onsetStrength.stats.mean,
        onsetStrengthStd: onsetStrength.stats.std,
        onsetBandShares,
      },
      rhythm: rhythm?.tempoBpm ? { tempoBpm: rhythm.tempoBpm, tempoStd: rhythm.tempoStd, tempoConfidence: rhythm.tempoConfidence } : (rhythm || null),
      smi: smi?.stats ? { mean: smi.stats.mean, std: smi.stats.std } : (smi || null),
    },
    timeSeries: {
      spectrumFrames: spectrum.frames,
      psychoFrames: spectrum.psychoFrames,
      loudnessFrames: loudness.frames,
      truePeakFrames: truePeak.frames,
      stereoFrames: truePeak.stereoFrames,
      onsetTimesSec: onsets.onsetsSec,
      onsetStrength: onsetStrength.perOnset,
      onsetMeta: {
        method: 'band-flux peak-picking',
        threshold: onsets.threshold,
      },
      onsetStrengthMeta: onsetStrength.meta,
      rhythm: rhythm,
      smi,
    },
  };
}
