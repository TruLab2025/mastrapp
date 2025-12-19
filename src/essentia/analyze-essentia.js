import { dbfsFromLinear, rmsOfInterleavedStereo, applyHannWindow, nextPow2, stddevOfFrames } from '../dsp/utils.js';
import { fftReal, magSpectrum } from '../dsp/fft.js';
import { spectralFeatures, bandEnergies } from '../dsp/spectrum.js';
import { createPsychoContext } from '../dsp/psycho.js';
import { analyzeLoudnessOverTime } from '../dsp/loudness.js';
import { detectOnsetsFromBandFlux, computeOnsetStrengthFromSpectrumFrames } from '../dsp/onsets.js';
import { analyzeTruePeakAndClipping } from '../dsp/truepeak.js';

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
    { name: 'low', lo: 20, hi: 250 },
    { name: 'mid', lo: 250, hi: 4000 },
    { name: 'high', lo: 4000, hi: 20000 },
  ];
}

function listCapabilities(essentia) {
  // Heurystyka: funkcje z wielkiej litery zwykle są algorytmami.
  return Object.keys(essentia)
    .filter((k) => typeof essentia[k] === 'function' && /^[A-Z]/.test(k))
    .sort();
}

function tryCall(fn, argsList) {
  for (const args of argsList) {
    try {
      const r = fn(...args);
      if (r != null) return r;
    } catch {
      // keep trying
    }
  }
  return null;
}

function stereoMixFrame(left, right, start, frameSize, out) {
  for (let i = 0; i < frameSize; i++) {
    const idx = start + i;
    out[i] = 0.5 * (left[idx] + right[idx]);
  }
}

function monoMixWhole(left, right) {
  const n = Math.min(left.length, right.length);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (left[i] + right[i]);
  return mono;
}

function coerceOnsetTimes(output, sampleRate) {
  const arr = output?.onsets ?? output?.onsetTimes ?? output?.times ?? output;
  if (!arr || !Array.isArray(arr)) return null;

  // Heurystyka: jeśli wartości wyglądają na sample indexy, przelicz na sekundy.
  const max = Math.max(...arr.map((x) => (typeof x === 'number' ? x : 0)));
  if (max > 1e3 && sampleRate && max > sampleRate) {
    return arr.map((x) => (typeof x === 'number' ? x / sampleRate : null)).filter((x) => x != null);
  }

  return arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
}

function tryEssentiaOnsets(essentia, mono, sampleRate) {
  // Najczęściej: Onsets({signal, sampleRate}) lub Onsets({audio, sampleRate})
  if (typeof essentia.Onsets !== 'function') return null;

  const r = tryCall(essentia.Onsets, [
    [{ signal: mono, sampleRate }],
    [{ audio: mono, sampleRate }],
    [{ signal: mono }],
    [mono, sampleRate],
    [mono],
  ]);
  const times = coerceOnsetTimes(r, sampleRate);
  return times && times.length ? times : null;
}

function tryEssentiaIntegratedLufs(essentia, mono, sampleRate) {
  // Essentia ma kilka wariantów nazw; próbujemy bezpiecznie.
  const fn = essentia.LoudnessEBUR128 ?? essentia.LoudnessEBU ?? essentia.Loudness;
  if (typeof fn !== 'function') return null;

  const r = tryCall(fn, [
    [{ signal: mono, sampleRate }],
    [{ audio: mono, sampleRate }],
    [mono, sampleRate],
    [mono],
  ]);

  const v = r?.integratedLoudness ?? r?.integrated ?? r?.loudnessIntegrated ?? r?.value ?? r;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Minimal Essentia-backed analysis stub.
 *
 * This is intentionally conservative because Essentia.js APIs vary by build.
 * Once you drop the exact release files into /vendor/essentia, we can map
 * the exact algorithms that are exposed (Centroid, RollOff, Flatness,
 * LoudnessEBUR128, OnsetDetection, etc.).
 */

/**
 * @param {import('./loader.js').EssentiaBundle} bundle
 * @param {AudioBuffer} audioBuffer
 * @param {{rolloffPercent:number}} options
 */
export async function analyzeWithEssentia(bundle, audioBuffer, options) {
  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const durationSec = audioBuffer.duration;

  if (channels < 2) throw new Error('Plik musi mieć co najmniej 2 kanały (stereo).');

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);

  const rmsAll = rmsOfInterleavedStereo(left, right, 0, Math.min(left.length, right.length));

  const essentia = bundle.Essentia;
  const capabilities = listCapabilities(essentia);

  const frameSize = Math.max(128, Math.round((options.frameMs / 1000) * sampleRate));
  const hopSize = Math.max(64, Math.round((options.hopMs / 1000) * sampleRate));
  const fftSize = nextPow2(frameSize);

  const bands = defaultBands();

  /** @type {Array<any>} */
  const spectrumFrames = [];

  /** @type {Array<{tSec:number, sharpness:number, spectralContrastDb:number, boominessIndex:number, harshnessIndex:number, sibilanceIndex:number}>} */
  const psychoFrames = [];
  /** @type {Float32Array | null} */
  let prevPower = null;
  let prevPowerSum = 0;
  let spectralFluxSum = 0;
  let hfcSum = 0;

  const n = Math.min(left.length, right.length);
  const totalFrames = Math.max(0, Math.floor((n - frameSize) / hopSize) + 1);

  const tmp = new Float32Array(fftSize);
  const frame = new Float32Array(fftSize);

  let centroidSum = 0;
  let rolloffSum = 0;
  let flatnessSum = 0;

  const psychoCtx = createPsychoContext(sampleRate, ((fftSize >> 1) + 1));

  /** @type {Record<string, number>} */
  const bandAgg = {};
  for (const b of bands) bandAgg[b.name] = 0;

  const used = {
    spectrum: false,
    centroid: false,
    rolloff: false,
    flatness: false,
  };

  const canSpectrum = typeof essentia.Spectrum === 'function';
  const canCentroid = typeof essentia.SpectralCentroid === 'function' || typeof essentia.Centroid === 'function';
  const canRolloff = typeof essentia.SpectralRolloff === 'function' || typeof essentia.RollOff === 'function';
  const canFlatness = typeof essentia.SpectralFlatness === 'function' || typeof essentia.Flatness === 'function';

  const mono = monoMixWhole(left, right);

  for (let frameIndex = 0, start = 0; start + frameSize <= n; frameIndex++, start += hopSize) {
    if (frameIndex % 100 === 0) {
      options.onProgress?.({ stage: 'Essentia', detail: `spektrum ${frameIndex}/${totalFrames}` });
      await new Promise((r) => setTimeout(r, 0));
    }

    stereoMixFrame(left, right, start, frameSize, tmp);
    frame.fill(0);
    frame.set(tmp.subarray(0, frameSize), 0);
    applyHannWindow(frame);

    // Spectrum magnitude
    let mag = null;
    if (canSpectrum) {
      const res = tryCall(essentia.Spectrum, [
        [frame],
        [{ frame }],
        [{ signal: frame }],
      ]);
      mag = res?.spectrum ?? res?.magnitude ?? res?.mag ?? null;
      if (mag && Array.isArray(mag)) mag = Float32Array.from(mag);
      if (mag && mag.length) used.spectrum = true;
    }

    if (!mag) {
      const { re, im } = fftReal(frame);
      mag = magSpectrum(re, im);
    }

    const psycho = psychoCtx.analyzeMag(mag);

    // Spectral flux (positive power differences) + HFC (normalized power-weighted bin index)
    const nBins = mag.length;
    if (!prevPower || prevPower.length !== nBins) {
      prevPower = new Float32Array(nBins);
      prevPowerSum = 0;
    }

    let powerSum = 0;
    let weighted = 0;
    let fluxPos = 0;
    for (let i = 0; i < nBins; i++) {
      const p = mag[i] * mag[i];
      powerSum += p;
      weighted += i * p;
      const diff = p - prevPower[i];
      if (diff > 0) fluxPos += diff;
      prevPower[i] = p;
    }
    const eps = 1e-24;
    const spectralFlux = prevPowerSum > 0 ? fluxPos / (prevPowerSum + eps) : 0;
    const hfc = powerSum > 0 ? (weighted / (powerSum * Math.max(1, nBins - 1))) : 0;
    prevPowerSum = powerSum;

    // Features: try Essentia algorithms, fall back to our implementation.
    let centroidHz = null;
    if (canCentroid) {
      const fn = essentia.SpectralCentroid ?? essentia.Centroid;
      const r = tryCall(fn, [
        [mag, sampleRate],
        [{ spectrum: mag, sampleRate }],
        [{ array: mag, sampleRate }],
        [{ spectrum: mag }],
      ]);
      centroidHz = r?.centroid ?? r?.spectralCentroid ?? r?.value ?? r ?? null;
      if (typeof centroidHz === 'number' && Number.isFinite(centroidHz)) used.centroid = true;
    }

    let rolloffHz = null;
    if (canRolloff) {
      const fn = essentia.SpectralRolloff ?? essentia.RollOff;
      const r = tryCall(fn, [
        [mag, sampleRate, options.rolloffPercent],
        [{ spectrum: mag, sampleRate, rollOff: options.rolloffPercent }],
        [{ spectrum: mag, sampleRate, rollOff: options.rolloffPercent * 100 }],
        [{ spectrum: mag, rollOff: options.rolloffPercent }],
      ]);
      rolloffHz = r?.rolloff ?? r?.rollOff ?? r?.spectralRolloff ?? r?.value ?? r ?? null;
      if (typeof rolloffHz === 'number' && Number.isFinite(rolloffHz)) used.rolloff = true;
    }

    let flatness = null;
    if (canFlatness) {
      const fn = essentia.SpectralFlatness ?? essentia.Flatness;
      const r = tryCall(fn, [
        [mag],
        [{ spectrum: mag }],
        [{ array: mag }],
      ]);
      flatness = r?.flatness ?? r?.spectralFlatness ?? r?.value ?? r ?? null;
      if (typeof flatness === 'number' && Number.isFinite(flatness)) used.flatness = true;
    }

    if (centroidHz == null || rolloffHz == null || flatness == null) {
      const ours = spectralFeatures(mag, sampleRate, options.rolloffPercent);
      if (centroidHz == null) centroidHz = ours.centroidHz;
      if (rolloffHz == null) rolloffHz = ours.rolloffHz;
      if (flatness == null) flatness = ours.flatness;
    }

    const b = bandEnergies(mag, sampleRate, bands);
    centroidSum += centroidHz;
    rolloffSum += rolloffHz;
    flatnessSum += flatness;
    for (const name of Object.keys(b.bands)) bandAgg[name] += b.bands[name].energy;

    spectralFluxSum += spectralFlux;
    hfcSum += hfc;

    spectrumFrames.push({
      tSec: start / sampleRate,
      centroidHz,
      rolloffHz,
      flatness,
      spectralFlux,
      hfc,
      bandNormalized: b.normalized,
    });

    psychoFrames.push({
      tSec: start / sampleRate,
      sharpness: psycho.sharpness,
      spectralContrastDb: psycho.spectralContrastDb,
      boominessIndex: psycho.boominessIndex,
      harshnessIndex: psycho.harshnessIndex,
      sibilanceIndex: psycho.sibilanceIndex,
    });
  }

  const count = spectrumFrames.length || 1;
  let totalBand = 0;
  for (const k of Object.keys(bandAgg)) totalBand += bandAgg[k];
  /** @type {Record<string, number>} */
  const bandAggNormalized = {};
  for (const k of Object.keys(bandAgg)) bandAggNormalized[k] = totalBand > 0 ? bandAgg[k] / totalBand : 0;

  const spectrumSummary = {
    centroidHzMean: centroidSum / count,
    centroidHzStd: stddevOfFrames(spectrumFrames, 'centroidHz'),
    rolloffHzMean: rolloffSum / count,
    flatnessMean: flatnessSum / count,
    spectralFluxMean: spectralFluxSum / count,
    spectralFluxStd: stddevOfFrames(spectrumFrames, 'spectralFlux'),
    hfcMean: hfcSum / count,
    hfcStd: stddevOfFrames(spectrumFrames, 'hfc'),
    bandEnergyNormalized: bandAggNormalized,
    psycho: psychoCtx.finalize(),
  };

  // Onsets: prefer Essentia if available, else fallback
  options.onProgress?.({ stage: 'Essentia', detail: 'onsets' });
  const onsetTimesSecEss = tryEssentiaOnsets(essentia, mono, sampleRate);
  const onsets = onsetTimesSecEss ? { onsetsSec: onsetTimesSecEss, threshold: null } : detectOnsetsFromBandFlux(spectrumFrames);

  const onsetStrength = computeOnsetStrengthFromSpectrumFrames(
    spectrumFrames,
    onsets.onsetsSec,
    { windowSec: 0.05 },
  );

  // Loudness curve: keep our curve (time-series), but try to take integrated from Essentia if available
  const loudness = await analyzeLoudnessOverTime(left, right, sampleRate, options.onProgress);
  const shortTermLufsStd = stddevOfFrames(loudness.frames, 'lufsShortTerm');
  const crestFactorDbMean = meanOfFrames(loudness.frames, 'crestFactorDb');
  const crestFactorDbStd = stddevOfFrames(loudness.frames, 'crestFactorDb');
  const silenceBelow60Pct = fractionOfFramesBelow(loudness.frames, 'rmsDbfs', -60);
  const rmsDbfsP10 = percentileOfFrames(loudness.frames, 'rmsDbfs', 10);
  const rmsDbfsP50 = percentileOfFrames(loudness.frames, 'rmsDbfs', 50);
  const rmsDbfsP90 = percentileOfFrames(loudness.frames, 'rmsDbfs', 90);
  const integratedFromEssentia = tryEssentiaIntegratedLufs(essentia, mono, sampleRate);

  const truePeak = await analyzeTruePeakAndClipping(left, right, sampleRate, options.onProgress);
  const integratedFinal = integratedFromEssentia ?? loudness.integratedLufs;
  const plr = (typeof truePeak.truePeakDbtp === 'number' && Number.isFinite(truePeak.truePeakDbtp) && typeof integratedFinal === 'number' && Number.isFinite(integratedFinal))
    ? (truePeak.truePeakDbtp - integratedFinal)
    : null;

  const dist = spectrumSummary.bandEnergyNormalized;

  const tonalBalance = defaultBands()
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
      const fr = closestFrameByTime(spectrumFrames, t);
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
      backend: 'essentia',
      sampleRate,
      durationSec,
      channels: 2,
      frameSize,
      hopSize,
      rolloffPercent: options.rolloffPercent,
      essentia: {
        used,
        algorithmsDetected: capabilities,
      },
    },
    global: {
      rms: rmsAll,
      rmsDbfs: dbfsFromLinear(rmsAll),
      integratedLufs: integratedFinal,
      integratedLufsMeta: integratedFromEssentia != null
        ? { approx: false, source: 'essentia', note: 'Integrated loudness from Essentia (if exposed by this build).' }
        : loudness.integratedLufsMeta,
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
        centroidHzMean: spectrumSummary.centroidHzMean,
        centroidHzStd: spectrumSummary.centroidHzStd,
        rolloffHzMean: spectrumSummary.rolloffHzMean,
        flatnessMean: spectrumSummary.flatnessMean,
        spectralFluxMean: spectrumSummary.spectralFluxMean,
        spectralFluxStd: spectrumSummary.spectralFluxStd,
        hfcMean: spectrumSummary.hfcMean,
        hfcStd: spectrumSummary.hfcStd,
      },
      psycho: spectrumSummary.psycho,
      energyDistribution: {
        low: dist.low ?? 0,
        mid: dist.mid ?? 0,
        high: dist.high ?? 0,
      },
      transients: {
        onsetStrengthMean: onsetStrength.stats.mean,
        onsetStrengthStd: onsetStrength.stats.std,
        onsetBandShares,
      },
    },
    timeSeries: {
      spectrumFrames,
      psychoFrames,
      loudnessFrames: loudness.frames,
      truePeakFrames: truePeak.frames,
      stereoFrames: truePeak.stereoFrames,
      onsetTimesSec: onsets.onsetsSec,
      onsetStrength: onsetStrength.perOnset,
      onsetMeta: {
        method: onsetTimesSecEss ? 'essentia.Onsets' : 'band-flux peak-picking',
        threshold: onsets.threshold,
      },
      onsetStrengthMeta: onsetStrength.meta,
    },
  };
}
