function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function median(values) {
  const a = values.slice().sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return null;
  if (n % 2 === 1) return a[(n - 1) / 2];
  return 0.5 * (a[n / 2 - 1] + a[n / 2]);
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
 * Simple rhythm analysis built on onset times.
 * - estimates tempo from IOI median
 * - returns IOI/BPM histogram and basic variability metrics
 *
 * @param {number[]} onsetTimesSec
 */
export function analyzeRhythmFromOnsets(onsetTimesSec, options = {}) {
  if (!Array.isArray(onsetTimesSec) || onsetTimesSec.length < 2) {
    return {
      tempoBpm: null,
      tempoStd: null,
      ibiMedian: null,
      ibiStd: null,
      ibiCount: 0,
      ibi: [],
      ibiHistogram: { bins: [], counts: [] },
      beatTimesSec: onsetTimesSec || [],
      meta: { note: 'Not enough onsets to estimate rhythm.' },
    };
  }

  const minIbi = typeof options.minIbi === 'number' ? options.minIbi : 0.15; // 150 ms
  const maxIbi = typeof options.maxIbi === 'number' ? options.maxIbi : 2.0; // 2 s

  const iois = [];
  for (let i = 1; i < onsetTimesSec.length; i++) {
    const dt = onsetTimesSec[i] - onsetTimesSec[i - 1];
    if (!isFiniteNumber(dt)) continue;
    if (dt >= minIbi && dt <= maxIbi) iois.push(dt);
  }

  const ibiStats = meanStd(iois);
  const ibiMedian = median(iois) ?? null;

  const bpms = iois.map((d) => 60 / d).filter(isFiniteNumber);
  const bpmStats = meanStd(bpms);

  // Histogram of BPM (40..240 bpm by 5 bpm bins)
  const binStep = 5;
  const minBpm = 40;
  const maxBpm = 240;
  const binCount = Math.ceil((maxBpm - minBpm) / binStep);
  const counts = new Array(binCount).fill(0);
  for (const b of bpms) {
    const idx = Math.floor((b - minBpm) / binStep);
    if (idx >= 0 && idx < binCount) counts[idx]++;
  }
  const bins = [];
  for (let i = 0; i < binCount; i++) bins.push(minBpm + i * binStep + binStep / 2);

  // Tempo confidence: relative weight of strongest bin
  const total = counts.reduce((s, x) => s + x, 0);
  const maxCount = Math.max(...counts, 0);
  const tempoConfidence = total > 0 ? maxCount / total : 0;

  const meanBpm = bpmStats.mean ?? (ibiMedian ? 60 / ibiMedian : null);
  // Robustness filter: if meanBpm is extreme (e.g. > 220), try halving it (double-time detection)
  let tempoBpm = meanBpm;
  if (tempoBpm > 220) tempoBpm /= 2;

  return {
    tempoBpm: tempoBpm,
    tempoStd: bpmStats.std,
    ibiMedian,
    ibiStd: ibiStats.std,
    ibiCount: iois.length,
    ibi: iois,
    ibiHistogram: { bins, counts },
    beatTimesSec: onsetTimesSec,
    tempoConfidence,
    meta: {
      minIbi,
      maxIbi,
      binStep,
      note: 'Estimate from IOI median and BPM histogram (simple proxy).',
    },
  };
}

export default analyzeRhythmFromOnsets;
