import Meyda from 'meyda';

/**
 * Compute a set of Meyda features over the file and return summary statistics.
 * Features are calculated on a mono mix of the two channels, frame-by-frame.
 *
 * Default feature list: chroma (12-band vector), spectralContrast (6-band vector),
 * mfcc (13 coefficients), zeroCrossingRate.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} sampleRate
 * @param {{frameSize?:number,hopSize?:number,features?:string[]}} options
 * @returns {Object} summary with one property per feature (mean array or value)
 */
export function analyzeMeydaFeatures(left, right, sampleRate, options = {}) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
    throw new Error('left/right must be Float32Array');
  }
  const len = Math.min(left.length, right.length);
  const frameSize = options.frameSize || 4096;
  const hopSize = options.hopSize || Math.floor(frameSize / 2);
  // Use features available in the packaged Meyda build (zcr instead of zeroCrossingRate,
  // no spectralContrast export in this build), keep mfcc and chroma.
  const featsList = options.features || ['chroma', 'mfcc', 'zcr'];

  const accum = {}; // feature -> accumulator (array or number)
  let count = 0;

  for (let i = 0; i + frameSize <= len; i += hopSize) {
    const mono = new Float32Array(frameSize);
    for (let j = 0; j < frameSize; j++) {
      mono[j] = 0.5 * (left[i + j] + right[i + j]);
    }
    const feats = Meyda.extract(featsList, mono, { sampleRate });
    if (!feats) continue;
    count++;
    for (const f of featsList) {
      const val = feats[f];
      if (Array.isArray(val)) {
        if (!accum[f]) accum[f] = new Array(val.length).fill(0);
        for (let k = 0; k < val.length; k++) {
          const v = val[k];
          if (typeof v === 'number' && Number.isFinite(v)) accum[f][k] += v;
        }
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        accum[f] = (accum[f] || 0) + val;
      }
    }
  }

  const result = { frames: count };
  if (count > 0) {
    for (const f of featsList) {
      if (Array.isArray(accum[f])) {
        result[f + 'Mean'] = accum[f].map((v) => v / count);
      } else if (typeof accum[f] === 'number') {
        result[f + 'Mean'] = accum[f] / count;
      } else {
        result[f + 'Mean'] = null;
      }
    }
  }
  return result;
}

export default analyzeMeydaFeatures;
