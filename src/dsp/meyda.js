import Meyda from 'meyda';
import { computeStats, applyHannWindow } from './utils.js';

/**
 * Round a number to the nearest power of 2.
 * @param {number} n
 * @returns {number}
 */
function nearestPowerOf2(n) {
  const log2 = Math.log2(n);
  const lower = Math.pow(2, Math.floor(log2));
  const upper = Math.pow(2, Math.ceil(log2));
  return upper - n < n - lower ? upper : lower;
}

/**
 * Compute a set of Meyda features over the file and return summary statistics.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} sampleRate
 * @param {{frameSize?:number,hopSize?:number,features?:string[],onProgress?:(p:any)=>void}} options
 * @returns {Promise<Object>} summary statistics
 */
export async function analyzeMeydaFeatures(left, right, sampleRate, options = {}) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
    throw new Error('left/right must be Float32Array');
  }
  const len = Math.min(left.length, right.length);
  // Meyda requires frameSize to be a power of 2
  let frameSize = options.frameSize || 4096;
  frameSize = nearestPowerOf2(frameSize);
  const hopSize = options.hopMs ? Math.round((options.hopMs / 1000) * sampleRate) : options.hopSize || Math.floor(frameSize / 2);

  const featsList = options.features || ['chroma', 'mfcc', 'zcr'];

  const timeSeries = {}; // feature -> array of values per frame
  for (const f of featsList) timeSeries[f] = [];
  let count = 0;

  for (let i = 0; i + frameSize <= len; i += hopSize) {
    const mono = new Float32Array(frameSize);
    for (let j = 0; j < frameSize; j++) {
      mono[j] = 0.5 * (left[i + j] + right[i + j]);
    }
    applyHannWindow(mono);
    // Use Meyda.extract with mono frame and feature list
    let feats = null;
    try {
      feats = Meyda.extract(featsList, mono, { sampleRate });
    } catch (err) {
      // Fallback
      try {
        if (typeof Meyda.createMeydaAnalyzer === 'function') {
          const analyzer = Meyda.createMeydaAnalyzer({ source: mono, bufferSize: frameSize, sampleRate, featureExtractors: featsList });
          feats = analyzer.get();
        }
      } catch (e) { /* ignore */ }
    }
    if (!feats) continue;
    count++;
    for (const f of featsList) {
      const val = feats[f];
      // Save to timeSeries
      if (Array.isArray(val)) timeSeries[f].push([...val]);
      else timeSeries[f].push(val);
    }

    if (count % 250 === 0) {
      if (options.onProgress) options.onProgress({ stage: 'Meyda', detail: `frame ${count}` });
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const result = { frames: count };
  if (count > 0) {
    for (const f of featsList) {
      result[f] = computeStats(timeSeries[f]);
    }
  }
  return result;
}

export default analyzeMeydaFeatures;
