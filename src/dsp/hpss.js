/**
 * Harmonic-Percussive Source Separation (HPSS).
 * Separates spectrogram into harmonic (sustained) and percussive (transient) components.
 */

import { fftReal, magSpectrum } from './fft.js';
import { applyHannWindow, nextPow2 } from './utils.js';

/**
 * Median filter 1D (for separating harmonic from percussive).
 * @param {Array<number>} data
 * @param {number} kernel_size (odd number)
 * @returns {Array<number>}
 */
function medianFilter1D(data, kernel_size = 5) {
  const pad = Math.floor(kernel_size / 2);
  const result = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const window = [];
    for (let j = -pad; j <= pad; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < data.length) {
        window.push(data[idx]);
      }
    }
    window.sort((a, b) => a - b);
    result[i] = window[Math.floor(window.length / 2)];
  }
  return result;
}

/**
 * Apply median filter to 2D spectrogram (async with yields).
 * @param {Array<Array<number>>} spectrogram [frame][freq_bin]
 * @param {string} axis 'time' or 'freq'
 * @param {number} kernel_size
 * @returns {Promise<Array<Array<number>>>}
 */
async function medianFilterSpectrogramAsync(spectrogram, axis = 'time', kernel_size = 5) {
  const result = spectrogram.map(frame => [...frame]);

  if (axis === 'time') {
    const nFreq = spectrogram[0].length;
    for (let freq = 0; freq < nFreq; freq++) {
      const timeSlice = spectrogram.map(frame => frame[freq]);
      const filtered = medianFilter1D(timeSlice, kernel_size);
      for (let t = 0; t < spectrogram.length; t++) {
        result[t][freq] = filtered[t];
      }
      if (freq % 50 === 0) await new Promise(r => setTimeout(r, 0));
    }
  } else if (axis === 'freq') {
    for (let t = 0; t < spectrogram.length; t++) {
      result[t] = medianFilter1D(spectrogram[t], kernel_size);
      if (t % 100 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }
  return result;
}

/**
 * HPSS: separate spectrogram into harmonic and percussive.
 * @param {Float32Array} buffer
 * @param {number} sampleRate
 * @param {{frameSize?: number, hopSize?: number, onProgress?: (p: any)=>void}} options
 * @returns {Promise<Object>}
 */
export async function analyzeHarmonicPercussive(buffer, sampleRate, options = {}) {
  const frameSize = options.frameSize || 2048;
  const hopSize = options.hopSize || frameSize / 2;
  const harmonicKernelSize = 5; // median kernel for time axis
  const percussiveKernelSize = 5; // median kernel for freq axis

  // Build spectrogram
  const fftSize = nextPow2(frameSize);
  const spectrogram = [];
  for (let i = 0; i + frameSize <= buffer.length; i += hopSize) {
    const frame = new Float32Array(fftSize);
    frame.set(buffer.subarray(i, i + frameSize), 0);
    applyHannWindow(frame.subarray(0, frameSize));
    const { re, im } = fftReal(frame);
    const mag = magSpectrum(re, im);
    spectrogram.push(Array.from(mag));
    if (i % (hopSize * 100) === 0) await new Promise(r => setTimeout(r, 0));
  }

  if (spectrogram.length === 0) {
    return { harmonic_ratio: 0, percussive_ratio: 0, harmonic_frames: [], percussive_frames: [] };
  }

  // Harmonic: median filter along time axis
  options.onProgress?.({ stage: 'HPSS', detail: 'harmonic medfilt' });
  const harmonicSpec = await medianFilterSpectrogramAsync(spectrogram, 'time', harmonicKernelSize);

  // Percussive: median filter along frequency axis
  options.onProgress?.({ stage: 'HPSS', detail: 'percussive medfilt' });
  const percussiveSpec = await medianFilterSpectrogramAsync(spectrogram, 'freq', percussiveKernelSize);
  options.onProgress?.({ stage: 'HPSS', detail: 'energy summing' });

  // Compute energy per frame
  let totalHarmonicEnergy = 0;
  let totalPercussiveEnergy = 0;

  const harmonicFrames = [];
  const percussiveFrames = [];

  for (let t = 0; t < spectrogram.length; t++) {
    let harmonicE = 0, percussiveE = 0;
    for (let f = 0; f < spectrogram[t].length; f++) {
      harmonicE += harmonicSpec[t][f] * harmonicSpec[t][f];
      percussiveE += percussiveSpec[t][f] * percussiveSpec[t][f];
    }
    totalHarmonicEnergy += harmonicE;
    totalPercussiveEnergy += percussiveE;

    harmonicFrames.push({
      tSec: t * (hopSize / sampleRate),
      energy: harmonicE,
    });
    percussiveFrames.push({
      tSec: t * (hopSize / sampleRate),
      energy: percussiveE,
    });
  }

  const totalEnergy = totalHarmonicEnergy + totalPercussiveEnergy;
  const harmonicRatio = totalEnergy > 0 ? totalHarmonicEnergy / totalEnergy : 0;
  const percussiveRatio = totalEnergy > 0 ? totalPercussiveEnergy / totalEnergy : 0;

  return {
    harmonic_ratio: harmonicRatio,
    percussive_ratio: percussiveRatio,
    harmonic_frames: harmonicFrames,
    percussive_frames: percussiveFrames,
  };
}
