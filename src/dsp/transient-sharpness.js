/**
 * Transient sharpness: estimate how "sharp" transients are by measuring
 * high-frequency energy ratio around onsets.
 */
import { fftReal, magSpectrum } from './fft.js';
import { nextPow2 } from './utils.js';

export function transientSharpnessFromOnsets(buffer, sampleRate, onsetsSec = [], options = {}) {
  const frameSize = options.frameSize || 2048;
  const preMs = options.preMs || 10; // window before onset
  const postMs = options.postMs || 50; // window after onset
  const out = [];
  for (const t of onsetsSec) {
    const center = Math.floor(t * sampleRate);
    const start = Math.max(0, Math.floor(center - (preMs / 1000) * sampleRate));
    const end = Math.min(buffer.length, Math.floor(center + (postMs / 1000) * sampleRate));
    if (end - start < 32) {
      out.push({ tSec: t, sharpness: 0 });
      continue;
    }
    const frame = buffer.subarray(start, end);

    // Compute magnitude spectrum for frame (zero-pad to fftSize)
    const fftSize = options.fftSize || nextPow2(frameSize);
    const win = new Float32Array(fftSize);
    for (let i = 0; i < Math.min(frame.length, frameSize); i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
      win[i] = frame[i] * w;
    }
    const { re, im } = fftReal(win);
    const mag = magSpectrum(re, im);

    // Compute HF energy (above 2000 Hz) vs total
    const nyq = sampleRate / 2;
    const n = mag.length;
    const hfLoHz = 2000;
    const hfLoIdx = Math.max(0, Math.floor((hfLoHz / nyq) * n));
    let hfE = 0;
    let totalE = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(mag[i]) || 0;
      const e = v * v;
      totalE += e;
      if (i >= hfLoIdx) hfE += e;
    }
    const ratio = totalE > 0 ? hfE / totalE : 0;
    // Map ratio to a 0..1 sharpness (simple)
    const sharpness = Math.max(0, Math.min(1, (ratio - 0.05) / 0.5));
    out.push({ tSec: t, sharpness });
  }
  // return array and mean
  const mean = out.length > 0 ? out.reduce((s, x) => s + x.sharpness, 0) / out.length : 0;
  return { frames: out, meanSharpness: mean };
}
