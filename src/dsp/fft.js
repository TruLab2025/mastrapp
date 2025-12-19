// Minimal radix-2 FFT (in-place). Returns {re, im} arrays.

/**
 * @param {Float32Array} real
 * @param {Float32Array} imag
 */
export function fftRadix2InPlace(real, imag) {
  const n = real.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be power of two');

  // Bit-reversal
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = real[i];
      const ti = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = tr;
      imag[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Cooley-Tukey
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (2 * Math.PI) / size;

    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const i = start + k;
        const l = i + half;

        const angle = -k * step;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);

        const tr = wr * real[l] - wi * imag[l];
        const ti = wr * imag[l] + wi * real[l];

        real[l] = real[i] - tr;
        imag[l] = imag[i] - ti;
        real[i] = real[i] + tr;
        imag[i] = imag[i] + ti;
      }
    }
  }
}

/**
 * @param {Float32Array} time
 * @returns {{re: Float32Array, im: Float32Array}}
 */
export function fftReal(time) {
  const re = new Float32Array(time);
  const im = new Float32Array(time.length);
  fftRadix2InPlace(re, im);
  return { re, im };
}

/**
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @returns {Float32Array} magnitude spectrum (N/2+1)
 */
export function magSpectrum(re, im) {
  const n = re.length;
  const bins = (n >> 1) + 1;
  const mag = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const a = re[i];
    const b = im[i];
    mag[i] = Math.sqrt(a * a + b * b);
  }
  return mag;
}
