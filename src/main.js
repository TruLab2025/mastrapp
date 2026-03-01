import { decodeFileToAudioBuffer } from './audio/decode.js';
import { analyzeAudioBuffer } from './analyze.js';
import { renderResultView } from './view.js';
import { makeGptSummary } from './summary.js';
import { makeFullComparison, makeGptComparisonSummary } from './compare.js';

const dropzoneA = document.getElementById('dropzoneA');
const dropzoneB = document.getElementById('dropzoneB');
const fileInputA = document.getElementById('fileInputA');
const fileInputB = document.getElementById('fileInputB');
const fileNameA = document.getElementById('fileNameA');
const fileNameB = document.getElementById('fileNameB');
const analyzeBtn = document.getElementById('analyzeBtn');
const resetBtn = document.getElementById('resetBtn');
const copyBtn = document.getElementById('copyBtn');
const downloadRaw = document.getElementById('downloadRaw');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const viewEl = document.getElementById('view');

const frameMsEl = document.getElementById('frameMs');
const hopMsEl = document.getElementById('hopMs');
const rolloffEl = document.getElementById('rolloff');

/** @type {File | null} */
let fileA = null;
/** @type {File | null} */
let fileB = null;

/** @type {any | null} */
let fullA = null;
/** @type {any | null} */
let fullB = null;
/** @type {any | null} */
let fullCompare = null;
/** @type {any | null} */
let summaryOut = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function updateProgress(pct, text = '') {
  if (pct === null) {
    progressContainer.style.display = 'none';
    return;
  }
  progressContainer.style.display = 'block';
  const p = Math.max(0, Math.min(100, pct));
  progressFill.style.width = `${p}%`;
  progressText.textContent = `${Math.round(p)}% ${text ? `— ${text}` : ''}`;
}

function setOutput(obj) {
  outputEl.value = JSON.stringify(obj, null, 2);
  if (viewEl) renderResultView(viewEl, obj);
}

function downloadJson(obj, filename) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickEvery(arr, maxItems) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= maxItems) return arr;
  const step = Math.ceil(arr.length / maxItems);
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out;
}

function makeUploadFriendlySpectrumFrame(fr) {
  if (!fr || typeof fr !== 'object') return fr;
  const out = {
    tSec: fr.tSec,
    centroidHz: fr.centroidHz,
    rolloffHz: fr.rolloffHz,
    flatness: fr.flatness,
    spectralFlux: fr.spectralFlux,
    hfc: fr.hfc,
  };

  // Keep only the most compact band info (low/mid/high) if present.
  const bn = fr.bandNormalized;
  if (bn && typeof bn === 'object') {
    out.bandNormalized = {
      low: bn.low,
      mid: bn.mid,
      high: bn.high,
    };
  }

  return out;
}

function makeUploadFriendlyResult(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // Comparison object: keep compare + trimmed A/B.
  if (obj.compare && obj.a && obj.b) {
    return {
      meta: obj.meta,
      global: obj.global,
      compare: obj.compare,
      a: makeUploadFriendlyResult(obj.a),
      b: makeUploadFriendlyResult(obj.b),
      note: 'Summary comparison for GPT analysis.',
    };
  }

  const meta = obj.meta ?? {};
  const global = obj.global ?? {};
  const ts = obj.timeSeries ?? {};

  // Essential timelines per user request: loudness, stereo width, spectral centroid
  const loudnessFrames = Array.isArray(ts.loudnessFrames) ? ts.loudnessFrames : [];
  const stereoFrames = Array.isArray(ts.stereoFrames) ? ts.stereoFrames : [];
  const spectralCentroid = Array.isArray(ts.spectralCentroid) ? ts.spectralCentroid :
    (Array.isArray(ts.spectrumFrames) ? ts.spectrumFrames.map(f => ({ tSec: f.tSec, centroidHz: f.centroidHz })) : []);

  // Sample them to further reduce size
  const loudnessSample = pickEvery(loudnessFrames, 500);
  const stereoSample = pickEvery(stereoFrames, 500);
  const centroidSample = pickEvery(spectralCentroid, 500);

  return {
    meta,
    global,
    timeSeries: {
      loudnessFrames: loudnessSample,
      stereoFrames: stereoSample,
      spectralCentroid: centroidSample,
      onsetTimesSec: ts.onsetTimesSec, // Keep brief onset list
      note: 'Aggregated report: most time-series removed or sampled to save space for GPT analysis.'
    },
  };
}

function resetResults() {
  copyBtn.disabled = true;
  downloadA.disabled = true;
  downloadB.disabled = true;
  downloadCompare.disabled = true;
  downloadRaw.disabled = true;
  outputEl.value = '';
  if (viewEl) viewEl.replaceChildren();
  fullA = null;
  fullB = null;
  fullCompare = null;
  summaryOut = null;
  updateProgress(null);
}

function refreshUiState() {
  analyzeBtn.disabled = !fileA;
  if (fileNameA) fileNameA.textContent = fileA ? fileA.name : 'albo wybierz z dysku';
  if (fileNameB) fileNameB.textContent = fileB ? fileB.name : '(opcjonalnie) utwór referencyjny';
}

function setFile(which, file) {
  if (which === 'A') fileA = file;
  else fileB = file;

  resetResults();
  refreshUiState();

  if (fileA) setStatus(`ORG: ${fileA.name}${fileB ? ` | REF: ${fileB.name}` : ''}`);
  else setStatus('Gotowe — czekam na plik.');
}

function resetAll() {
  fileA = null;
  fileB = null;
  if (fileInputA) fileInputA.value = '';
  if (fileInputB) fileInputB.value = '';
  resetResults();
  refreshUiState();
  setStatus('Gotowe — czekam na plik.');
}

function readSettings() {
  const frameMs = Number(frameMsEl.value);
  const hopMs = Number(hopMsEl.value);
  const rolloffPercent = Number(rolloffEl.value);

  return {
    frameMs,
    hopMs,
    rolloffPercent: rolloffPercent / 100,
  };
}

async function runAnalysis() {
  if (!fileA) return;

  analyzeBtn.disabled = true;
  copyBtn.disabled = true;
  downloadA.disabled = true;
  downloadB.disabled = true;
  downloadCompare.disabled = true;
  downloadRaw.disabled = true;
  setStatus('Dekoduję audio…');
  updateProgress(5, 'Dekodowanie ORG...');

  try {
    const settings = readSettings();

    const bufA = await decodeFileToAudioBuffer(fileA);
    setStatus('Analizuję ORG…');

    // Weighting for ORG analysis (approx 45% of total if B exists, 90% if not)
    const basePct = fileB ? 45 : 90;
    const startPct = 10;

    fullA = await analyzeAudioBuffer(bufA, {
      ...settings,
      onProgress: (p) => {
        if (p?.stage) {
          setStatus(`${fileB ? 'ORG' : 'Analizuję'}: ${p.stage}${p.detail ? ` — ${p.detail}` : ''}`);
          // Refined weights for smoothness
          const stages = {
            'Loudness': 0.0,
            'Loudness (frames)': 0.1,
            'TruePeak': 0.2,
            'Meyda': 0.4,
            'HPSS': 0.7,
            'Sections': 0.95
          };
          const stageWeights = {
            'Loudness': 0.1,
            'Loudness (frames)': 0.1,
            'TruePeak': 0.2,
            'Meyda': 0.3,
            'HPSS': 0.25,
            'Sections': 0.05
          };

          const stageBase = stages[p.stage] ?? 0;
          const stageWeight = stageWeights[p.stage] ?? 0;
          let subPct = 0;

          // Try to extract numeric progress from detail
          if (p.detail) {
            if (p.detail.includes('%')) {
              subPct = parseInt(p.detail) / 100;
            } else if (/^\d+$/.test(p.detail)) {
              // For frames, we don't know the total here easily, but we can guess or just move a bit
              // Let's assume approx total based on duration if we had it, but let's just use it as a small increment for now
              subPct = Math.min(0.9, parseInt(p.detail) / 5000);
            }
          }

          const currentProgress = startPct + basePct * (stageBase + subPct * stageWeight);
          updateProgress(currentProgress, `${fileB ? 'ORG' : 'Analiza'}: ${p.stage}`);
        }
      },
    });
    fullA.meta = { ...(fullA.meta ?? {}), fileHint: fileA.name };

    if (fileB) {
      updateProgress(55, 'Dekodowanie REF...');
      const bufB = await decodeFileToAudioBuffer(fileB);
      setStatus('Analizuję REF…');

      const startPctB = 60;
      const basePctB = 35;

      fullB = await analyzeAudioBuffer(bufB, {
        ...settings,
        onProgress: (p) => {
          if (p?.stage) {
            setStatus(`REF: ${p.stage}${p.detail ? ` — ${p.detail}` : ''}`);
            const stages = {
              'Loudness': 0.0,
              'Loudness (frames)': 0.1,
              'TruePeak': 0.2,
              'Meyda': 0.4,
              'HPSS': 0.7,
              'Sections': 0.95
            };
            const stageWeights = {
              'Loudness': 0.1,
              'Loudness (frames)': 0.1,
              'TruePeak': 0.2,
              'Meyda': 0.3,
              'HPSS': 0.25,
              'Sections': 0.05
            };

            const stageBase = stages[p.stage] ?? 0;
            const stageWeight = stageWeights[p.stage] ?? 0;
            let subPct = 0;
            if (p.detail) {
              if (p.detail.includes('%')) {
                subPct = parseInt(p.detail) / 100;
              } else if (/^\d+$/.test(p.detail)) {
                subPct = Math.min(0.9, parseInt(p.detail) / 5000);
              }
            }

            const currentProgress = startPctB + basePctB * (stageBase + subPct * stageWeight);
            updateProgress(currentProgress, `REF: ${p.stage}`);
          }
        },
      });
      fullB.meta = { ...(fullB.meta ?? {}), fileHint: fileB.name };

      updateProgress(95, 'Finalizacja porównania...');
      fullCompare = makeFullComparison(fullA, fullB);
      const sumA = makeGptSummary(fullA);
      const sumB = makeGptSummary(fullB);
      summaryOut = makeGptComparisonSummary(sumA, sumB, fullCompare);
      setOutput(summaryOut);

      downloadCompare.disabled = false;
      downloadB.disabled = false;
    } else {
      updateProgress(95, 'Finalizacja...');
      summaryOut = makeGptSummary(fullA);
      setOutput(summaryOut);
    }

    updateProgress(100, 'Zakończono');
    setTimeout(() => updateProgress(null), 3000);

    copyBtn.disabled = false;
    downloadA.disabled = false;
    downloadRaw.disabled = false;
    setStatus('Gotowe.');
  } catch (err) {
    console.error(err);
    setStatus(`Błąd: ${err?.message ?? String(err)}`);
    updateProgress(null);
  } finally {
    refreshUiState();
  }
}

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(summaryOut ?? {}, null, 2));
    setStatus('Skopiowano JSON do schowka.');
  } catch {
    setStatus('Nie udało się skopiować (sprawdź uprawnienia przeglądarki).');
  }
});

downloadA.addEventListener('click', () => {
  if (!fullA) return;
  const base = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'trackA';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = makeUploadFriendlyResult(fullA);
  downloadJson(out, `${base}.upload-metrics.${ts}.json`);
  setStatus('Pobrano Oryginał (kompakt).');
});

downloadB.addEventListener('click', () => {
  if (!fullB) return;
  const base = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'reference';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = makeUploadFriendlyResult(fullB);
  downloadJson(out, `${base}.upload-metrics.${ts}.json`);
  setStatus('Pobrano Referencję (kompakt).');
});

downloadCompare.addEventListener('click', () => {
  if (!fullCompare) return;
  const baseA = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'ORG';
  const baseB = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'REF';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = makeUploadFriendlyResult(fullCompare);
  downloadJson(out, `${baseA}_vs_${baseB}.comparison.upload.${ts}.json`);
  setStatus('Pobrano Porównanie (kompakt).');
});

downloadRaw.addEventListener('click', () => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (fullCompare) {
    const baseA = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'ORG';
    const baseB = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'REF';
    downloadJson(fullCompare, `${baseA}_vs_${baseB}.raw-full.${ts}.json`);
    setStatus('Pobrano Porównanie (RAW FULL).');
  } else if (fullA) {
    const base = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'trackA';
    downloadJson(fullA, `${base}.raw-full.${ts}.json`);
    setStatus('Pobrano Oryginał (RAW FULL).');
  }
});

resetBtn?.addEventListener('click', resetAll);

analyzeBtn.addEventListener('click', runAnalysis);

fileInputA.addEventListener('change', () => {
  const file = fileInputA.files?.[0] ?? null;
  setFile('A', file);
});
fileInputB.addEventListener('change', () => {
  const file = fileInputB.files?.[0] ?? null;
  setFile('B', file);
});

function wireDropzone(dropzone, which, input) {
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0] ?? null;
    if (!file) return;
    input.value = '';
    setFile(which, file);
  });

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') input.click();
  });
}

wireDropzone(dropzoneA, 'A', fileInputA);
wireDropzone(dropzoneB, 'B', fileInputB);

setStatus('Gotowe — czekam na plik.');
refreshUiState();
