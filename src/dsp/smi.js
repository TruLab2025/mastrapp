/**
 * Lightweight Spectral Masking Index (SMI) proxy using bandNormalized from spectrum frames.
 * This is a pragmatic proxy: it computes a smoothed envelope across the provided bands
 * and marks bands that fall well below that envelope as "masked". SMI is fraction masked.
 */

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function meanStd(values) {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (const v of values) {
    if (!isFiniteNumber(v)) continue;
    n++;
    const d = v - mean;
    mean += d / n;
    m2 += d * (v - mean);
  }
  if (n === 0) return { mean: null, std: null, count: 0 };
  if (n === 1) return { mean, std: null, count: 1 };
  return { mean, std: Math.sqrt(m2 / n), count: n };
}

/**
 * @param {Array<{tSec:number, bandNormalized: Record<string, number>}>} spectrumFrames
 * @param {{threshold?:number, smoothKernel?:number[]}} options
 */
export function analyzeSmiFromBandNormalized(spectrumFrames, options = {}) {
  if (!Array.isArray(spectrumFrames) || spectrumFrames.length === 0) {
    return { perFrame: [], stats: { mean: null, std: null, count: 0 }, meta: { note: 'No frames' } };
  }

  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.5; // fraction of envelope
  const kernel = Array.isArray(options.smoothKernel) ? options.smoothKernel : [0.25, 0.5, 0.25];

  const keys = Object.keys(spectrumFrames[0].bandNormalized || {});
  const nBands = keys.length;
  if (nBands === 0) return { perFrame: [], stats: { mean: null, std: null, count: 0 }, meta: { note: 'No bands' } };

  // helper: smooth array with kernel
  function smooth(arr) {
    const out = new Array(arr.length).fill(0);
    const klen = kernel.length;
    const half = Math.floor(klen / 2);
    for (let i = 0; i < arr.length; i++) {
      let s = 0;
      let wsum = 0;
      for (let k = 0; k < klen; k++) {
        const j = i + (k - half);
        if (j < 0 || j >= arr.length) continue;
        const w = kernel[k];
        s += arr[j] * w;
        wsum += w;
      }
      out[i] = wsum > 0 ? s / wsum : 0;
    }
    return out;
  }

  const perFrame = [];

  for (const fr of spectrumFrames) {
    const arr = keys.map((k) => {
      const v = fr.bandNormalized?.[k];
      return isFiniteNumber(v) ? v : 0;
    });

    const env = smooth(arr);

    let masked = 0;
    for (let i = 0; i < nBands; i++) {
      const val = arr[i];
      const e = env[i];
      // consider masked if band energy is substantially below local envelope
      if (e > 0 && val < e * threshold) masked++;
    }

    perFrame.push(masked / nBands);
  }

  const stats = meanStd(perFrame);

  return {
    perFrame,
    stats,
    meta: {
      method: 'proxy-SMI: bandNormalized envelope vs band energy',
      threshold,
      smoothKernel: kernel,
      note: 'This is a pragmatic proxy for Spectral Masking Index (not an ISO psychoacoustic model).',
    },
  };
}

export default analyzeSmiFromBandNormalized;
