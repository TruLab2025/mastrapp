/** @param {number} n */
export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function mean(arr) {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

export function median(arr) {
  if (arr.length === 0) return 0;
  const copy = Array.from(arr).sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

export function rmsOfInterleavedStereo(left, right, start, end) {
  let sum = 0;
  const n = Math.max(0, end - start);
  if (n === 0) return 0;
  for (let i = start; i < end; i++) {
    const l = left[i];
    const r = right[i];
    const v = (l * l + r * r) * 0.5;
    sum += v;
  }
  return Math.sqrt(sum / n);
}

export function dbfsFromLinear(x, floorDb = -200) {
  if (x <= 0) return floorDb;
  const db = 20 * Math.log10(x);
  return Number.isFinite(db) ? Math.max(floorDb, db) : floorDb;
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Population standard deviation (divide by N), computed with Welford's algorithm.
 * Returns null if there are fewer than 2 valid samples.
 * @param {Array<any>} frames
 * @param {string} field
 */
export function stddevOfFrames(frames, field) {
  if (!Array.isArray(frames) || frames.length === 0) return null;

  let n = 0;
  let mean = 0;
  let m2 = 0;

  for (const fr of frames) {
    const v = fr?.[field];
    if (!isFiniteNumber(v)) continue;
    n++;
    const delta = v - mean;
    mean += delta / n;
    const delta2 = v - mean;
    m2 += delta * delta2;
  }

  if (n < 2) return null;
  return Math.sqrt(m2 / n);
}

/** Hann window in-place */
export function applyHannWindow(buffer) {
  const n = buffer.length;
  if (n <= 1) return;
  const denom = n - 1;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    buffer[i] *= w;
  }
}

/**
 * Recursively clean an object for JSON serialization.
 * - Rounds numbers to 4 decimal places.
 * - Handles nested objects and arrays.
 * - Removes non-serializable fields (functions, etc).
 * @param {any} obj
 * @returns {any}
 */
export function cleanObjectForJson(obj) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) return null;
    // Round to 4 decimal places to save space
    return Math.round(obj * 10000) / 10000;
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanObjectForJson);
  }

  if (typeof obj === 'object') {
    // Handle TypedArrays (common in DSP)
    if (obj instanceof Float32Array || obj instanceof Float64Array) {
      const arr = new Array(obj.length);
      for (let i = 0; i < obj.length; i++) {
        const v = obj[i];
        arr[i] = Math.round(v * 10000) / 10000;
      }
      return arr;
    }

    const cleaned = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (typeof val === 'function' || typeof val === 'symbol') continue;
        cleaned[key] = cleanObjectForJson(val);
      }
    }
    return cleaned;
  }

  return obj;
}
