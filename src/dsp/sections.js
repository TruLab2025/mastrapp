/**
 * Simple section detection based on loudness changes.
 * Input: loudnessFrames - array with objects {tSec, lufsMomentary, lufsShortTerm}
 * Output: sections: [{label, tStart, tEnd, meanLoudness}]
 */

export function detectSectionsFromLoudness(loudnessFrames, options = {}) {
  if (!Array.isArray(loudnessFrames) || loudnessFrames.length === 0) return [];
  const winSec = options.winSec || 1.0; // smoothing window
  const step = options.stepSec || 0.5;

  // Build time-indexed loudness (use lufsShortTerm if available else momentary)
  const times = loudnessFrames.map(f => f.tSec);
  const vals = loudnessFrames.map(f => (typeof f.lufsShortTerm === 'number' ? f.lufsShortTerm : (typeof f.lufsMomentary === 'number' ? f.lufsMomentary : 0)));

  // Smooth with moving average
  const smoothed = new Array(vals.length).fill(0);
  const halfSamples = Math.floor((winSec / Math.max(1e-6, (times[1] - times[0] || winSec))) / 2);
  for (let i = 0; i < vals.length; i++) {
    const lo = Math.max(0, i - halfSamples);
    const hi = Math.min(vals.length - 1, i + halfSamples);
    let sum = 0, n = 0;
    for (let j = lo; j <= hi; j++) { sum += vals[j]; n++; }
    smoothed[i] = n > 0 ? sum / n : vals[i];
  }

  // Detect boundaries where smoothed loudness changes by threshold
  const thresh = options.deltaLufs || 3.0; // LUFS
  const boundaries = [0];
  for (let i = 1; i < smoothed.length; i++) {
    if (Math.abs(smoothed[i] - smoothed[i - 1]) >= thresh) {
      boundaries.push(i);
    }
  }
  boundaries.push(smoothed.length - 1);

  // Build sections
  const sections = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    const i0 = boundaries[b];
    const i1 = boundaries[b + 1];
    const tStart = times[i0] ?? 0;
    const tEnd = times[i1] ?? (times[times.length - 1] ?? 0);
    const segmentVals = smoothed.slice(i0, i1 + 1);
    const mean = segmentVals.reduce((s, x) => s + x, 0) / Math.max(1, segmentVals.length);
    let label = 'section';
    // Heuristic: louder segments are chorus-like
    const overallMean = smoothed.reduce((s, x) => s + x, 0) / smoothed.length;
    if (mean >= overallMean + 2.0) label = 'chorus';
    else if (mean <= overallMean - 2.0) label = 'verse/quiet';
    sections.push({ label, tStart, tEnd, meanLoudness: mean });
  }

  // Fallback: if no clear boundaries found but overall range exceeds threshold,
  // split into two sections at midpoint crossing (useful for synthetic tests).
  if (sections.length < 2) {
    const mx = Math.max(...smoothed);
    const mn = Math.min(...smoothed);
    if ((mx - mn) >= thresh) {
      const mid = (mx + mn) / 2;
      const split = smoothed.findIndex(v => v > mid);
      const i0 = 0;
      const i1 = Math.max(0, split - 1);
      const j0 = split;
      const j1 = smoothed.length - 1;
      const meanA = smoothed.slice(i0, i1 + 1).reduce((s, x) => s + x, 0) / Math.max(1, i1 - i0 + 1);
      const meanB = smoothed.slice(j0, j1 + 1).reduce((s, x) => s + x, 0) / Math.max(1, j1 - j0 + 1);
      sections.length = 0;
      sections.push({ label: meanA >= meanB + 2 ? 'chorus' : 'section', tStart: times[i0] ?? 0, tEnd: times[i1] ?? 0, meanLoudness: meanA });
      sections.push({ label: meanB >= meanA + 2 ? 'chorus' : 'section', tStart: times[j0] ?? 0, tEnd: times[j1] ?? 0, meanLoudness: meanB });
    }
  }

  return sections;
}
