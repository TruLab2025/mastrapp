import { mean, median, clamp } from './utils.js';

/**
 * Simple onset detection via spectral flux (uses already computed per-frame normalized band distribution or spectra magnitudes).
 * Here we expect an array of per-frame bandNormalized objects; we convert to a flux-like curve.
 * @param {Array<{tSec:number, bandNormalized: Record<string, number>}>} spectrumFrames
 */
export function detectOnsetsFromBandFlux(spectrumFrames) {
  if (spectrumFrames.length < 3) return { onsetsSec: [], flux: [] };

  /** @type {number[]} */
  const flux = new Array(spectrumFrames.length).fill(0);

  const keys = Object.keys(spectrumFrames[0].bandNormalized);
  for (let i = 1; i < spectrumFrames.length; i++) {
    let s = 0;
    for (const k of keys) {
      const cur = spectrumFrames[i].bandNormalized[k] ?? 0;
      const prev = spectrumFrames[i - 1].bandNormalized[k] ?? 0;
      const d = cur - prev;
      if (d > 0) s += d;
    }
    flux[i] = s;
  }

  const med = median(flux);
  const avg = mean(flux);
  // Threshold: above median + (avg-median) * 1.5, clamped
  const thr = clamp(med + (avg - med) * 1.2, med, med + 10);

  /** @type {number[]} */
  const onsetsSec = [];
  for (let i = 2; i < flux.length - 2; i++) {
    const a = flux[i - 1];
    const b = flux[i];
    const c = flux[i + 1];
    if (b > thr && b > a && b >= c) {
      onsetsSec.push(spectrumFrames[i].tSec);
      // Small cooldown: skip a couple frames to avoid double-triggers
      i += 2;
    }
  }

  return { onsetsSec, flux, threshold: thr };
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function meanStd(values) {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const v of values) {
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
 * Proxy transient strength: average over a small time window around each onset.
 * Uses spectralFlux modulated by HFC to capture "spark" in highs.
 *
 * strength(t) = mean_{frames in |t_frame - t|<=windowSec}( spectralFlux * (0.25 + 0.75*hfc) )
 *
 * @param {Array<{tSec:number, spectralFlux?:number, hfc?:number}>} spectrumFrames
 * @param {number[]} onsetTimesSec
 * @param {{windowSec?:number}} [options]
 */
export function computeOnsetStrengthFromSpectrumFrames(spectrumFrames, onsetTimesSec, options = {}) {
  const windowSec = typeof options.windowSec === 'number' ? options.windowSec : 0.05;
  const meta = {
    windowSec,
    formula: 'mean_{|t_frame-t|<=windowSec}( spectralFlux * (0.25 + 0.75*hfc) )',
    notes: 'Proxy transient strength from frame-wise spectral flux and high-frequency content (HFC).',
  };

  if (!Array.isArray(spectrumFrames) || spectrumFrames.length === 0) return { perOnset: [], stats: meanStd([]), meta };
  if (!Array.isArray(onsetTimesSec) || onsetTimesSec.length === 0) return { perOnset: [], stats: meanStd([]), meta };

  const perOnset = [];
  let j = 0;

  for (const t of onsetTimesSec) {
    if (!isFiniteNumber(t)) continue;
    const lo = t - windowSec;
    const hi = t + windowSec;

    while (j < spectrumFrames.length && isFiniteNumber(spectrumFrames[j]?.tSec) && spectrumFrames[j].tSec < lo) j++;

    let k = j;
    let n = 0;
    let sum = 0;
    while (k < spectrumFrames.length) {
      const fr = spectrumFrames[k];
      const tf = fr?.tSec;
      if (!isFiniteNumber(tf) || tf > hi) break;

      const flux = fr?.spectralFlux;
      const hfc = fr?.hfc;
      if (isFiniteNumber(flux)) {
        const mod = isFiniteNumber(hfc) ? (0.25 + 0.75 * hfc) : 1;
        sum += flux * mod;
        n++;
      }
      k++;
    }

    perOnset.push(n ? sum / n : 0);
  }

  return { perOnset, stats: meanStd(perOnset), meta };
}
