/**
 * Rhythmic stability: tightness of beat timing from onset intervals.
 */

/**
 * Compute inter-onset intervals (IOI) and their statistics.
 *
 * @param {Array<number>} onsetTimesSeconds - sorted array of onset times
 * @returns {{ioiMean: number, ioiStddev: number, ioiCv: number}}
 */
export function computeInterOnsetStats(onsetTimesSeconds) {
  if (!Array.isArray(onsetTimesSeconds) || onsetTimesSeconds.length < 2) {
    return { ioiMean: 0, ioiStddev: 0, ioiCv: 0 };
  }

  const iois = [];
  for (let i = 1; i < onsetTimesSeconds.length; i++) {
    const ioi = onsetTimesSeconds[i] - onsetTimesSeconds[i - 1];
    if (ioi > 0 && ioi < 2) { // reasonable IOI: between 0 and 2 seconds
      iois.push(ioi);
    }
  }

  if (iois.length === 0) {
    return { ioiMean: 0, ioiStddev: 0, ioiCv: 0 };
  }

  // Mean IOI
  const ioiMean = iois.reduce((sum, x) => sum + x, 0) / iois.length;

  // Std dev
  const ioiVar = iois.reduce((sum, x) => sum + (x - ioiMean) ** 2, 0) / iois.length;
  const ioiStddev = Math.sqrt(ioiVar);

  // Coefficient of variation (stddev / mean)
  const ioiCv = ioiMean > 0 ? ioiStddev / ioiMean : 0;

  return { ioiMean, ioiStddev, ioiCv };
}

/**
 * Compute rhythmic stability score.
 * 0 = highly unstable (free tempo, rubato)
 * 1 = perfectly stable (metronomic).
 *
 * @param {Array<number>} onsetTimesSeconds
 * @returns {number} stability in [0, 1]
 */
export function rhythmicStability(onsetTimesSeconds) {
  const { ioiCv } = computeInterOnsetStats(onsetTimesSeconds);

  // Map CV to stability: CV=0 -> 1.0, CV=1 -> 0.0, CV>1 -> ~0
  const stability = Math.max(0, 1 - ioiCv);
  return stability;
}

/**
 * Compute groove tightness (how well onsets align to a beat grid).
 *
 * @param {Array<number>} onsetTimesSeconds
 * @param {number} estimatedTempo - BPM (e.g., 120)
 * @returns {{tightness: number, tempo_deviation: number}}
 */
export function grooveTightness(onsetTimesSeconds, estimatedTempo = 120) {
  if (!Array.isArray(onsetTimesSeconds) || onsetTimesSeconds.length < 2) {
    return { tightness: 0, tempo_deviation: 0 };
  }

  // Expected beat interval (seconds)
  const beatIntervalSec = 60 / estimatedTempo;

  // Quantize each onset to nearest beat grid
  const quantizedTimings = [];
  for (const onset of onsetTimesSeconds) {
    const nearestBeat = Math.round(onset / beatIntervalSec) * beatIntervalSec;
    const deviation = Math.abs(onset - nearestBeat);
    quantizedTimings.push(deviation);
  }

  // Mean deviation
  const meanDeviation = quantizedTimings.reduce((s, x) => s + x, 0) / quantizedTimings.length;

  // Tightness: inverse of deviation (normalized to 0-1)
  // ~0.02s deviation = very tight, ~0.1s = loose
  const tightness = Math.max(0, 1 - meanDeviation / beatIntervalSec);

  // Tempo deviation (how much estimated tempo deviates from actual)
  const { ioiMean } = computeInterOnsetStats(onsetTimesSeconds);
  const actualTempo = ioiMean > 0 ? 60 / ioiMean : estimatedTempo;
  const tempoDeviation = Math.abs(actualTempo - estimatedTempo) / estimatedTempo;

  return { tightness, tempo_deviation: tempoDeviation };
}

/**
 * Full rhythmic analysis from onset times.
 *
 * @param {Array<number>} onsetTimesSeconds
 * @param {number} estimatedTempo - optional BPM
 * @returns {Object}
 */
export function analyzeRhythmicStability(onsetTimesSeconds, estimatedTempo = 120) {
  if (!Array.isArray(onsetTimesSeconds) || onsetTimesSeconds.length < 2) {
    return {
      stability: 0,
      tightness: 0,
      ioi_mean_ms: 0,
      ioi_cv: 0,
      onset_count: 0,
    };
  }

  const { ioiMean, ioiCv } = computeInterOnsetStats(onsetTimesSeconds);
  const stability = rhythmicStability(onsetTimesSeconds);
  const { tightness } = grooveTightness(onsetTimesSeconds, estimatedTempo);

  return {
    stability: Math.max(0, Math.min(1, stability)),
    tightness: Math.max(0, Math.min(1, tightness)),
    ioi_mean_ms: ioiMean * 1000,
    ioi_cv: ioiCv,
    onset_count: onsetTimesSeconds.length,
  };
}
