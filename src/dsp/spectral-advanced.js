/**
 * Advanced spectral features: slope, entropy, crest factor per band.
 */

import { fftReal, magSpectrum } from './fft.js';
import { nextPow2 } from './utils.js';

/**
 * Compute spectral slope (linear regression of log magnitude vs log frequency).
 * Negative slope = dark, positive slope = bright.
 *
 * @param {Float32Array} magnitude
 * @param {number} sampleRate
 * @returns {number}
 */
export function spectralSlope(magnitude, sampleRate) {
  if (!magnitude || magnitude.length < 2) return 0;
  const n = Math.min(magnitude.length, Math.floor(sampleRate / 2 / 20)); // limit to ~20 Hz resolution
  if (n < 2) return 0;

  // Log-log regression: log(mag) vs log(freq)
  let sumLogFreq = 0, sumLogMag = 0, sumLogFreqMag = 0, sumLogFreq2 = 0;
  for (let i = 1; i < n; i++) {
    const freqBin = (i * sampleRate) / (magnitude.length * 2);
    const logFreq = Math.log(freqBin);
    const mag = Math.abs(magnitude[i]) || 1e-10;
    const logMag = Math.log(mag);

    sumLogFreq += logFreq;
    sumLogMag += logMag;
    sumLogFreqMag += logFreq * logMag;
    sumLogFreq2 += logFreq * logFreq;
  }

  const denom = n * sumLogFreq2 - sumLogFreq * sumLogFreq;
  if (Math.abs(denom) < 1e-12) return 0;
  const slope = (n * sumLogFreqMag - sumLogFreq * sumLogMag) / denom;
  return slope;
}

/**
 * Compute spectral entropy (Shannon entropy of normalized magnitude spectrum).
 * 0 = pure tone, 1 = white noise.
 *
 * @param {Float32Array} magnitude
 * @returns {number} entropy in [0, 1]
 */
export function spectralEntropy(magnitude) {
  if (!magnitude || magnitude.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < magnitude.length; i++) {
    const m = Math.abs(magnitude[i]) || 0;
    sum += m;
  }
  if (sum <= 0) return 0;

  let entropy = 0;
  const logN = Math.log(magnitude.length);
  for (let i = 0; i < magnitude.length; i++) {
    const m = Math.abs(magnitude[i]) || 1e-10;
    const p = m / sum;
    entropy -= p * Math.log(p);
  }
  return entropy / logN; // normalize to [0, 1]
}

/**
 * Compute crest factor (peak / RMS) per frequency band.
 * High crest = transient-rich (drums, crashes).
 * Low crest = sustained (pads, vocals).
 *
 * @param {Float32Array} magnitude
 * @param {number} sampleRate
 * @param {{bands?: Array}} options
 * @returns {Object} { band_name: crest_factor, ... }
 */
export function crestFactorPerBand(magnitude, sampleRate, options = {}) {
  if (!magnitude || magnitude.length < 2) return {};
  const bands = options.bands || [
    { name: 'low', lo: 20, hi: 250 },
    { name: 'mid', lo: 250, hi: 4000 },
    { name: 'high', lo: 4000, hi: 20000 },
  ];

  const result = {};
  for (const band of bands) {
    const loIdx = Math.max(0, Math.floor((band.lo * magnitude.length * 2) / sampleRate));
    const hiIdx = Math.min(magnitude.length - 1, Math.floor((band.hi * magnitude.length * 2) / sampleRate));

    let maxMag = 0;
    let sumSq = 0;
    let count = 0;
    for (let i = loIdx; i <= hiIdx; i++) {
      const m = Math.abs(magnitude[i]) || 0;
      maxMag = Math.max(maxMag, m);
      sumSq += m * m;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const crest = rms > 0 ? maxMag / rms : 0;
    result[band.name] = crest;
  }
  return result;
}

/**
 * Low-mid buildup: fraction of spectral energy in 150-350 Hz band.
 * @param {Float32Array} magnitude
 * @param {number} sampleRate
 * @returns {{bandEnergy:number,totalEnergy:number,fraction:number,percent:number}}
 */
export function lowMidBuildup(magnitude, sampleRate) {
  if (!magnitude || magnitude.length < 2) return { bandEnergy: 0, totalEnergy: 0, fraction: 0, percent: 0 };
  const lo = 150;
  const hi = 350;
  const n = magnitude.length;
  const nyq = sampleRate / 2;
  const binHz = nyq / (n - 1);
  const loIdx = Math.max(0, Math.floor(lo / binHz));
  const hiIdx = Math.min(n - 1, Math.ceil(hi / binHz));

  let bandEnergy = 0;
  let totalEnergy = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(magnitude[i]) || 0;
    const e = v * v;
    totalEnergy += e;
    if (i >= loIdx && i <= hiIdx) bandEnergy += e;
  }
  const fraction = totalEnergy > 0 ? bandEnergy / totalEnergy : 0;
  return { bandEnergy, totalEnergy, fraction, percent: fraction * 100 };
}

/**
 * Compute low-mid buildup over time (per frame).
 * @param {Float32Array} buffer - audio buffer (mono)
 * @param {number} sampleRate
 * @param {{frameSize?:number,hopSize?:number}} options
 * @returns {Array<{tSec:number,fraction:number,percent:number}>}
 */
export function lowMidOverTime(buffer, sampleRate, options = {}) {
  const frameSize = options.frameSize || 2048;
  const hopSize = options.hopSize || Math.floor(frameSize / 2);
  const fftSize = options.fftSize || nextPow2(frameSize);
  const out = [];
  for (let i = 0; i + frameSize <= buffer.length; i += hopSize) {
    const fftFrame = new Float32Array(fftSize);
    fftFrame.set(buffer.subarray(i, i + frameSize), 0);
    // Apply Hann window on frameSize only
    for (let j = 0; j < frameSize; j++) {
      fftFrame[j] *= (0.5 * (1 - Math.cos((2 * Math.PI * j) / (frameSize - 1))));
    }
    const { re, im } = fftReal(fftFrame);
    const mag = magSpectrum(re, im);
    const lm = lowMidBuildup(mag, sampleRate);
    out.push({ tSec: i / sampleRate, fraction: lm.fraction, percent: lm.percent });
  }
  return out;
}
