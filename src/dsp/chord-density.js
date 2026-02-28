/**
 * Chord density and harmonic complexity from chroma features.
 */

/**
 * Detect chord changes from chroma vectors.
 * A chord change occurs when chroma distribution shifts significantly.
 *
 * @param {Array<Array<number>>} chromaFrames - array of 12-bin chroma vectors
 * @param {number} threshold - sensitivity (0.3 typical)
 * @returns {Array<number>} indices where chord changes detected
 */
export function detectChordChanges(chromaFrames, threshold = 0.3) {
  if (!Array.isArray(chromaFrames) || chromaFrames.length < 2) return [];

  const changes = [];
  for (let i = 1; i < chromaFrames.length; i++) {
    const prev = chromaFrames[i - 1];
    const curr = chromaFrames[i];
    if (!Array.isArray(prev) || !Array.isArray(curr)) continue;

    // Cosine distance between chroma vectors
    let dot = 0, normPrev = 0, normCurr = 0;
    for (let j = 0; j < Math.min(12, prev.length, curr.length); j++) {
      const p = prev[j] || 0;
      const c = curr[j] || 0;
      dot += p * c;
      normPrev += p * p;
      normCurr += c * c;
    }

    const normDenom = Math.sqrt(normPrev * normCurr);
    const cosineSim = normDenom > 0 ? dot / normDenom : 0;
    const distance = 1 - cosineSim;

    if (distance > threshold) {
      changes.push(i);
    }
  }
  return changes;
}

/**
 * Compute harmonic complexity from chroma distribution.
 * Measures "peakiness" of chroma: high = simple chord, low = noise/dissonance.
 *
 * @param {Array<number>} chroma - 12-bin chroma vector
 * @returns {number} complexity in [0, 1]
 */
export function chromaComplexity(chroma) {
  if (!Array.isArray(chroma) || chroma.length === 0) return 0.5;

  // Find max chroma value
  let maxVal = 0;
  let sumVal = 0;
  for (const c of chroma) {
    const v = Math.abs(c) || 0;
    maxVal = Math.max(maxVal, v);
    sumVal += v;
  }

  if (sumVal <= 0 || maxVal <= 0) return 0.5;

  // Peakiness: how concentrated is energy in top bins
  // High peakiness (max >> mean) = simple, Low peakiness = complex
  const meanVal = sumVal / chroma.length;
  const peakiness = maxVal / (meanVal + 1e-10);

  // Map to [0, 1]: normalize by expected range
  // Simple triad: peakiness ~3-4
  // Noise: peakiness ~1-2
  const complexity = Math.max(0, Math.min(1, (1 - (peakiness - 1) / 5)));
  return complexity;
}

/**
 * Analyze chord density and harmonic activity over time.
 *
 * @param {Object} chromaFrames - from Meyda or DSP: {frames: number, chroma_mean?, timeSeries?: {chroma?}}
 * @param {number} hopTime - time per frame (in seconds)
 * @returns {{chord_changes_per_minute: number, mean_complexity: number, chord_changes: Array}}
 */
export function analyzeChordDensity(chromaFrames, hopTime = 0.02) {
  // Handle both Meyda output format and direct frame array
  let frames = [];

  if (Array.isArray(chromaFrames)) {
    frames = chromaFrames;
  } else if (chromaFrames.timeSeries && Array.isArray(chromaFrames.timeSeries.chroma)) {
    frames = chromaFrames.timeSeries.chroma;
  } else if (chromaFrames.chroma && Array.isArray(chromaFrames.chroma)) {
    frames = chromaFrames.chroma;
  }

  if (!Array.isArray(frames) || frames.length === 0) {
    return {
      chord_changes_per_minute: 0,
      mean_complexity: 0,
      chord_changes: [],
    };
  }

  const changes = detectChordChanges(frames, 0.15);
  const complexities = frames.map((f, idx) => ({
    idx,
    tSec: idx * hopTime,
    complexity: chromaComplexity(f),
  }));

  const meanComplexity = complexities.length > 0
    ? complexities.reduce((sum, c) => sum + c.complexity, 0) / complexities.length
    : 0;

  const totalTimeSec = frames.length * hopTime;
  const changePerMin = totalTimeSec > 0 ? (changes.length / totalTimeSec) * 60 : 0;

  return {
    chord_changes_per_minute: changePerMin,
    mean_complexity: meanComplexity,
    chord_changes: changes.map(idx => ({
      frameIdx: idx,
      tSec: idx * hopTime,
    })),
  };
}
