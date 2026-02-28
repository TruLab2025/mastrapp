import { nextPow2, applyHannWindow, clamp } from './utils.js';
import { fftReal, magSpectrum } from './fft.js';
import { createPsychoContext } from './psycho.js';

/**
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} start
 * @param {number} frameSize
 * @param {Float32Array} tmpFrame
 */
function makeStereoMixFrame(left, right, start, frameSize, tmpFrame) {
  for (let i = 0; i < frameSize; i++) {
    const idx = start + i;
    tmpFrame[i] = 0.5 * (left[idx] + right[idx]);
  }
}

/**
 * @param {Float32Array} mag
 * @param {number} sampleRate
 * @returns {{centroidHz:number, rolloffHz:number, flatness:number}}
 */
export function spectralFeatures(mag, sampleRate, rolloffPercent = 0.85) {
  const nBins = mag.length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / (nBins - 1);

  let sumMag = 0;
  let sumFMag = 0;
  let sumLog = 0;
  let sum = 0;

  const eps = 1e-20;
  for (let i = 0; i < nBins; i++) {
    const m = mag[i] + eps;
    const f = i * binHz;
    sumMag += m;
    sumFMag += f * m;
    sumLog += Math.log(m);
    sum += m;
  }

  const centroidHz = sumMag > 0 ? sumFMag / sumMag : 0;

  // Rolloff
  const target = sum * clamp(rolloffPercent, 0.5, 0.99);
  let cumulative = 0;
  let rolloffBin = 0;
  for (let i = 0; i < nBins; i++) {
    cumulative += mag[i];
    if (cumulative >= target) {
      rolloffBin = i;
      break;
    }
  }
  const rolloffHz = rolloffBin * binHz;

  // Flatness = geometric mean / arithmetic mean
  const geo = Math.exp(sumLog / nBins);
  const arith = sum / nBins;
  const flatness = arith > 0 ? geo / arith : 0;

  return { centroidHz, rolloffHz, flatness };
}

/**
 * Bands in Hz.
 * @param {Float32Array} mag
 * @param {number} sampleRate
 * @param {Array<{name:string, lo:number, hi:number}>} bands
 */
export function bandEnergies(mag, sampleRate, bands) {
  const nBins = mag.length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / (nBins - 1);

  /** @type {Record<string, {energy: number, energyDb: number}>} */
  const out = {};

  const eps = 1e-24;
  for (const b of bands) {
    const loBin = clamp(Math.floor(b.lo / binHz), 0, nBins - 1);
    const hiBin = clamp(Math.ceil(b.hi / binHz), 0, nBins - 1);

    let e = 0;
    for (let i = loBin; i <= hiBin; i++) {
      const m = mag[i];
      e += m * m;
    }

    // Convert to dB-ish (relative). This is spectral energy, not dBFS.
    const energyDb = 10 * Math.log10(e + eps);
    out[b.name] = { energy: e, energyDb };
  }

  // Also provide normalized distribution across these bands
  let total = 0;
  for (const k of Object.keys(out)) total += out[k].energy;

  /** @type {Record<string, number>} */
  const normalized = {};
  if (total > 0) {
    for (const k of Object.keys(out)) normalized[k] = out[k].energy / total;
  } else {
    for (const k of Object.keys(out)) normalized[k] = 0;
  }

  return { bands: out, normalized };
}

/**
 * Computes frame-wise spectrum metrics over full signal.
 * @returns {Promise<{frames: Array<any>, summary: any}>}
 */
export async function analyzeSpectrumOverTime(left, right, sampleRate, frameSize, hopSize, rolloffPercent, bands, onProgress) {
  const n = Math.min(left.length, right.length);
  const fftSize = nextPow2(frameSize);

  const tmp = new Float32Array(fftSize);
  const frame = new Float32Array(fftSize);

  /** @type {Array<any>} */
  const frames = [];

  /** @type {Array<{tSec:number, sharpness:number, spectralContrastDb:number, boominessIndex:number, harshnessIndex:number, sibilanceIndex:number}>} */
  const psychoFrames = [];

  let centroidSum = 0;
  let rolloffSum = 0;
  let flatnessSum = 0;
  let spectralFluxSum = 0;
  let hfcSum = 0;

  /** @type {Float32Array | null} */
  let prevPower = null;
  let prevPowerSum = 0;

  // Aggregate band energy across time
  /** @type {Record<string, number>} */
  const bandAgg = {};
  for (const b of bands) bandAgg[b.name] = 0;

  const psychoCtx = createPsychoContext(sampleRate, ((fftSize >> 1) + 1));

  const totalFrames = Math.max(0, Math.floor((n - frameSize) / hopSize) + 1);

  for (let frameIndex = 0, start = 0; start + frameSize <= n; frameIndex++, start += hopSize) {
    if (frameIndex % 100 === 0) {
      onProgress?.({ stage: 'Spektrum', detail: `${frameIndex}/${totalFrames}` });
      // Let UI breathe
      await new Promise((r) => setTimeout(r, 0));
    }

    makeStereoMixFrame(left, right, start, frameSize, tmp);
    frame.fill(0);
    frame.set(tmp.subarray(0, frameSize), 0);
    applyHannWindow(frame.subarray(0, frameSize));

    const { re, im } = fftReal(frame);
    const mag = magSpectrum(re, im);

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

    const s = spectralFeatures(mag, sampleRate, rolloffPercent);
    const b = bandEnergies(mag, sampleRate, bands);

    centroidSum += s.centroidHz;
    rolloffSum += s.rolloffHz;
    flatnessSum += s.flatness;

    for (const name of Object.keys(b.bands)) bandAgg[name] += b.bands[name].energy;

    spectralFluxSum += spectralFlux;
    hfcSum += hfc;

    frames.push({
      tSec: start / sampleRate,
      centroidHz: s.centroidHz,
      rolloffHz: s.rolloffHz,
      flatness: s.flatness,
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

  const count = frames.length || 1;

  let totalBand = 0;
  for (const k of Object.keys(bandAgg)) totalBand += bandAgg[k];
  /** @type {Record<string, number>} */
  const bandAggNormalized = {};
  if (totalBand > 0) {
    for (const k of Object.keys(bandAgg)) bandAggNormalized[k] = bandAgg[k] / totalBand;
  } else {
    for (const k of Object.keys(bandAgg)) bandAggNormalized[k] = 0;
  }

  const summary = {
    centroidHzMean: centroidSum / count,
    rolloffHzMean: rolloffSum / count,
    flatnessMean: flatnessSum / count,
    spectralFluxMean: spectralFluxSum / count,
    hfcMean: hfcSum / count,
    bandEnergyNormalized: bandAggNormalized,
    psycho: psychoCtx.finalize(),
  };

  return { frames, psychoFrames, summary };
}
