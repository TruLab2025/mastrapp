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
const downloadA = document.getElementById('downloadA');
const downloadB = document.getElementById('downloadB');
const downloadCompare = document.getElementById('downloadCompare');
const downloadAUpload = document.getElementById('downloadAUpload');
const downloadBUpload = document.getElementById('downloadBUpload');
const downloadCompareUpload = document.getElementById('downloadCompareUpload');
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
  if (obj.type === 'comparison' || (obj.compare && obj.a && obj.b)) {
    return {
      meta: obj.meta,
      compare: obj.compare,
      a: makeUploadFriendlyResult(obj.a),
      b: makeUploadFriendlyResult(obj.b),
      note: obj.note,
      uploadFriendly: true,
    };
  }

  const meta = obj.meta ?? {};
  const global = obj.global ?? {};
  const ts = obj.timeSeries ?? {};

  const spectrumFrames = Array.isArray(ts.spectrumFrames) ? ts.spectrumFrames : [];
  const psychoFrames = Array.isArray(ts.psychoFrames) ? ts.psychoFrames : [];
  const loudnessFrames = Array.isArray(ts.loudnessFrames) ? ts.loudnessFrames : [];
  const truePeakFrames = Array.isArray(ts.truePeakFrames) ? ts.truePeakFrames : [];
  const stereoFrames = Array.isArray(ts.stereoFrames) ? ts.stereoFrames : [];
  const onsets = Array.isArray(ts.onsetTimesSec) ? ts.onsetTimesSec : [];
  const onsetStrength = Array.isArray(ts.onsetStrength) ? ts.onsetStrength : [];

  const spectrumSample = pickEvery(spectrumFrames, 600).map(makeUploadFriendlySpectrumFrame);
  const psychoSample = pickEvery(psychoFrames, 900);
  const loudnessSample = pickEvery(loudnessFrames, 900);
  const truePeakSample = pickEvery(truePeakFrames, 900);
  const stereoSample = pickEvery(stereoFrames, 900);
  const onsetsSample = pickEvery(onsets, 800);

  return {
    meta,
    global,
    timeSeries: {
      spectrumFrames: spectrumSample,
      psychoFrames: psychoSample,
      loudnessFrames: loudnessSample,
      truePeakFrames: truePeakSample,
      stereoFrames: stereoSample,
      onsetTimesSec: onsetsSample,
      // keep onsetStrength aligned only if lengths match after sampling; otherwise drop it
      ...(onsetStrength.length === onsets.length
        ? { onsetStrength: pickEvery(onsetStrength, 800) }
        : null),
      onsetMeta: ts.onsetMeta,
      onsetStrengthMeta: ts.onsetStrengthMeta,
      timeSeriesMeta: {
        uploadFriendly: true,
        spectrumFrames: { total: spectrumFrames.length, kept: spectrumSample.length, keptFields: ['tSec', 'centroidHz', 'rolloffHz', 'flatness', 'spectralFlux', 'hfc', 'bandNormalized.low/mid/high'] },
        psychoFrames: { total: psychoFrames.length, kept: psychoSample.length, keptFields: ['tSec', 'sharpness', 'spectralContrastDb', 'boominessIndex', 'harshnessIndex', 'sibilanceIndex'] },
        loudnessFrames: { total: loudnessFrames.length, kept: loudnessSample.length },
        truePeakFrames: { total: truePeakFrames.length, kept: truePeakSample.length },
        stereoFrames: { total: stereoFrames.length, kept: stereoSample.length },
        onsetTimesSec: { total: onsets.length, kept: onsetsSample.length },
      },
    },
  };
}

function resetResults() {
  copyBtn.disabled = true;
  downloadA.disabled = true;
  downloadB.disabled = true;
  downloadCompare.disabled = true;
  if (downloadAUpload) downloadAUpload.disabled = true;
  if (downloadBUpload) downloadBUpload.disabled = true;
  if (downloadCompareUpload) downloadCompareUpload.disabled = true;
  outputEl.value = '';
  if (viewEl) viewEl.replaceChildren();
  fullA = null;
  fullB = null;
  fullCompare = null;
  summaryOut = null;
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
  if (downloadAUpload) downloadAUpload.disabled = true;
  if (downloadBUpload) downloadBUpload.disabled = true;
  if (downloadCompareUpload) downloadCompareUpload.disabled = true;
  setStatus('Dekoduję audio…');

  try {
    const settings = readSettings();

    const bufA = await decodeFileToAudioBuffer(fileA);
    setStatus('Analizuję ORG…');
    fullA = await analyzeAudioBuffer(bufA, {
      ...settings,
      onProgress: (p) => {
        if (p?.stage) setStatus(`ORG: ${p.stage}${p.detail ? ` — ${p.detail}` : ''}`);
      },
    });
    fullA.meta = { ...(fullA.meta ?? {}), fileHint: fileA.name };

    if (fileB) {
      const bufB = await decodeFileToAudioBuffer(fileB);
      setStatus('Analizuję REF…');
      fullB = await analyzeAudioBuffer(bufB, {
        ...settings,
        onProgress: (p) => {
          if (p?.stage) setStatus(`REF: ${p.stage}${p.detail ? ` — ${p.detail}` : ''}`);
        },
      });
      fullB.meta = { ...(fullB.meta ?? {}), fileHint: fileB.name };

      fullCompare = makeFullComparison(fullA, fullB);
      const sumA = makeGptSummary(fullA);
      const sumB = makeGptSummary(fullB);
      summaryOut = makeGptComparisonSummary(sumA, sumB, fullCompare);
      setOutput(summaryOut);

      downloadCompare.disabled = false;
      downloadB.disabled = false;
      if (downloadCompareUpload) downloadCompareUpload.disabled = false;
      if (downloadBUpload) downloadBUpload.disabled = false;
    } else {
      summaryOut = makeGptSummary(fullA);
      setOutput(summaryOut);
    }

    copyBtn.disabled = false;
    downloadA.disabled = false;
    if (downloadAUpload) downloadAUpload.disabled = false;
    setStatus('Gotowe.');
  } catch (err) {
    console.error(err);
    setStatus(`Błąd: ${err?.message ?? String(err)}`);
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
  setStatus('Pobrano ORG (kompakt).');
});

downloadB.addEventListener('click', () => {
  if (!fullB) return;
  const base = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'reference';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = makeUploadFriendlyResult(fullB);
  downloadJson(out, `${base}.upload-metrics.${ts}.json`);
  setStatus('Pobrano REF (kompakt).');
});

downloadCompare.addEventListener('click', () => {
  if (!fullCompare) return;
  const baseA = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'ORG';
  const baseB = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'REF';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = makeUploadFriendlyResult(fullCompare);
  downloadJson(out, `${baseA}_vs_${baseB}.comparison.upload.${ts}.json`);
  setStatus('Pobrano PORÓWNANIE (kompakt).');
});

downloadAUpload?.addEventListener('click', () => {
  if (!fullA) return;
  const base = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'trackA';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  downloadJson(fullA, `${base}.metrics.full.${ts}.json`);
  setStatus('Pobrano ORG (RAW FULL — duże).');
});

downloadBUpload?.addEventListener('click', () => {
  if (!fullB) return;
  const base = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'reference';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  downloadJson(fullB, `${base}.metrics.full.${ts}.json`);
  setStatus('Pobrano REF (RAW FULL — duże).');
});

downloadCompareUpload?.addEventListener('click', () => {
  if (!fullCompare) return;
  const baseA = fileA?.name ? fileA.name.replace(/\.[^.]+$/, '') : 'ORG';
  const baseB = fileB?.name ? fileB.name.replace(/\.[^.]+$/, '') : 'REF';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  downloadJson(fullCompare, `${baseA}_vs_${baseB}.comparison.full.${ts}.json`);
  setStatus('Pobrano PORÓWNANIE (RAW FULL — duże).');
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
