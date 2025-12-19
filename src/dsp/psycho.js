function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function barkFromHz(f) {
  // Zwicker Bark scale approximation.
  const a = 13 * Math.atan(0.00076 * f);
  const b = 3.5 * Math.atan((f / 7500) * (f / 7500));
  return a + b;
}

function hzFromBark(z) {
  // Invert barkFromHz via binary search (monotonic in [0..~24] for f in [0..~20k]).
  const zz = Math.max(0, Math.min(24, z));
  let lo = 0;
  let hi = 24000;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const b = barkFromHz(mid);
    if (b < zz) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

class Stats {
  constructor() {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  push(x) {
    if (!isFiniteNumber(x)) return;
    this.count++;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
    const delta = x - this.mean;
    this.mean += delta / this.count;
    const delta2 = x - this.mean;
    this.m2 += delta * delta2;
  }

  finalize() {
    if (this.count === 0) return { mean: null, std: null, min: null, max: null, count: 0 };
    if (this.count === 1) return { mean: this.mean, std: null, min: this.min, max: this.max, count: 1 };
    return { mean: this.mean, std: Math.sqrt(this.m2 / this.count), min: this.min, max: this.max, count: this.count };
  }
}

function clampInt(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x | 0));
}

function makeLogBandsHz(nyquistHz) {
  // A small set of broad log-spaced bands for a fast contrast proxy.
  // Keep the low edge above DC to avoid DC/very-low bins dominating.
  const edges = [
    80,
    200,
    400,
    800,
    1600,
    3200,
    6400,
    nyquistHz,
  ];

  // Ensure strictly increasing and clamped.
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = Math.max(0, Math.min(nyquistHz, edges[i]));
    const hi = Math.max(0, Math.min(nyquistHz, edges[i + 1]));
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

function sharpnessWeight(zCenter) {
  // Zwicker-like weighting.
  return zCenter <= 15 ? 1 : (0.066 * Math.exp(0.171 * zCenter));
}

export function createPsychoContext(sampleRate, nBins, options = {}) {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / Math.max(1, (nBins - 1));

  const barkBands = clampInt(options.barkBands ?? 24, 8, 30);

  // Compute Bark band edges in Hz.
  const edgesHz = [];
  for (let i = 0; i <= barkBands; i++) {
    const z = (24 * i) / barkBands;
    edgesHz.push(Math.min(nyquist, hzFromBark(z)));
  }
  // Make edges strictly increasing.
  for (let i = 1; i < edgesHz.length; i++) {
    if (edgesHz[i] <= edgesHz[i - 1]) edgesHz[i] = Math.min(nyquist, edgesHz[i - 1] + binHz);
  }

  // Precompute bin -> barkBand index.
  const barkIndexByBin = new Int16Array(nBins);
  barkIndexByBin.fill(-1);
  let band = 0;
  for (let i = 0; i < nBins; i++) {
    const f = i * binHz;
    while (band < barkBands && f >= edgesHz[band + 1]) band++;
    barkIndexByBin[i] = band < barkBands ? band : (barkBands - 1);
  }

  const logBands = makeLogBandsHz(nyquist);
  const logBandBins = logBands.map(([loHz, hiHz]) => {
    const lo = clampInt(Math.floor(loHz / binHz), 0, nBins - 1);
    const hi = clampInt(Math.ceil(hiHz / binHz), 0, nBins - 1);
    return [lo, hi];
  });

  // Frequency ranges for heuristic indices.
  const bandRanges = {
    boom: [80, 200],
    harsh: [2000, 5000],
    sibil: [5000, 10000],
  };
  const rangeBins = Object.fromEntries(Object.entries(bandRanges).map(([k, [loHz, hiHz]]) => {
    const lo = clampInt(Math.floor(loHz / binHz), 0, nBins - 1);
    const hi = clampInt(Math.ceil(Math.min(hiHz, nyquist) / binHz), 0, nBins - 1);
    return [k, [lo, hi]];
  }));

  const barkAgg = new Float64Array(barkBands);
  const sharpnessStats = new Stats();
  const contrastStats = new Stats();
  const sibilanceStats = new Stats();
  const harshnessStats = new Stats();
  const boominessStats = new Stats();

  function analyzeMag(mag) {
    const eps = 1e-24;

    // Total power.
    let totalP = 0;
    for (let i = 0; i < nBins; i++) {
      const p = mag[i] * mag[i];
      totalP += p;
    }

    // Bark aggregation and sharpness.
    const barkFrame = new Float64Array(barkBands);
    for (let i = 0; i < nBins; i++) {
      const p = mag[i] * mag[i];
      const bi = barkIndexByBin[i];
      barkFrame[bi] += p;
    }
    for (let bi = 0; bi < barkBands; bi++) barkAgg[bi] += barkFrame[bi];

    let sharpNum = 0;
    let sharpDen = 0;
    for (let bi = 0; bi < barkBands; bi++) {
      const e = barkFrame[bi];
      if (e <= 0) continue;
      const zLo = (24 * bi) / barkBands;
      const zHi = (24 * (bi + 1)) / barkBands;
      const zCenter = 0.5 * (zLo + zHi);
      const w = sharpnessWeight(zCenter);
      sharpNum += e * w * zCenter;
      sharpDen += e;
    }
    const sharpness = sharpDen > 0 ? (sharpNum / (sharpDen + eps)) : 0;

    // Fast spectral contrast proxy: average of max/mean per log-band (in dB).
    let contrastSum = 0;
    let contrastCount = 0;
    for (const [lo, hi] of logBandBins) {
      if (hi <= lo) continue;
      let sum = 0;
      let max = 0;
      let n = 0;
      for (let i = lo; i <= hi; i++) {
        const p = mag[i] * mag[i];
        sum += p;
        if (p > max) max = p;
        n++;
      }
      if (n > 0 && sum > 0) {
        const mean = sum / n;
        const cDb = 10 * Math.log10((max + eps) / (mean + eps));
        contrastSum += cDb;
        contrastCount++;
      }
    }
    const spectralContrastDb = contrastCount ? (contrastSum / contrastCount) : 0;

    // Heuristic indices as fraction of total power.
    function rangeFrac(key) {
      const [lo, hi] = rangeBins[key];
      if (hi <= lo) return 0;
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += mag[i] * mag[i];
      return totalP > 0 ? (sum / (totalP + eps)) : 0;
    }

    const boominessIndex = rangeFrac('boom');
    const harshnessIndex = rangeFrac('harsh');
    const sibilanceIndex = rangeFrac('sibil');

    sharpnessStats.push(sharpness);
    contrastStats.push(spectralContrastDb);
    boominessStats.push(boominessIndex);
    harshnessStats.push(harshnessIndex);
    sibilanceStats.push(sibilanceIndex);

    return {
      sharpness,
      spectralContrastDb,
      boominessIndex,
      harshnessIndex,
      sibilanceIndex,
    };
  }

  function finalize() {
    let total = 0;
    for (let i = 0; i < barkBands; i++) total += barkAgg[i];

    const bark = [];
    for (let i = 0; i < barkBands; i++) {
      const loHz = edgesHz[i];
      const hiHz = edgesHz[i + 1];
      const energyNorm = total > 0 ? (barkAgg[i] / total) : 0;
      bark.push({
        band: i,
        zLo: (24 * i) / barkBands,
        zHi: (24 * (i + 1)) / barkBands,
        loHz,
        hiHz,
        energyNorm,
      });
    }

    return {
      barkBands: bark,
      sharpness: sharpnessStats.finalize(),
      spectralContrastDb: contrastStats.finalize(),
      indices: {
        boominess: boominessStats.finalize(),
        harshness: harshnessStats.finalize(),
        sibilance: sibilanceStats.finalize(),
      },
      meta: {
        barkBands,
        barkScale: 'Zwicker (approx)',
        contrastMethod: 'log-band max/mean (dB)',
        indexBandsHz: bandRanges,
        interpretation: {
          sharpness: 'Wyżej = relatywnie więcej energii w wysokich pasmach (proxy, nie absolutna jednostka).',
          spectralContrastDb: 'Wyżej = bardziej „peaky/kontrastowe” widmo w szerokich pasmach (proxy).',
          indices: 'boom/harsh/sibil to udziały energii w pasmach (0..1) – używaj porównawczo między plikami.',
          barkBands: 'energyNorm to rozkład energii po Bark (suma≈1). Porównuj kształt, nie pojedynczy bin.',
        },
      },
    };
  }

  return {
    analyzeMag,
    finalize,
  };
}
