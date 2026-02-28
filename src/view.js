function fmt(n, digits = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtPct(x, digits = 1) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function safeGet(obj, path, fallback = undefined) {
  try {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return fallback;
      cur = cur[p];
    }
    return cur ?? fallback;
  } catch {
    return fallback;
  }
}

function summarizeSeries(frames, fields) {
  if (!Array.isArray(frames) || frames.length === 0) return null;

  const out = {
    count: frames.length,
    tStart: frames[0]?.tSec,
    tEnd: frames[frames.length - 1]?.tSec,
  };

  for (const f of fields) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;

    for (const fr of frames) {
      const v = fr?.[f];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }

    out[f] = n ? { mean: sum / n, min, max } : null;
  }

  return out;
}

function makeKV(pairs) {
  const wrap = document.createElement('div');
  wrap.className = 'kv';

  for (const [k, v] of pairs) {
    const kEl = document.createElement('div');
    kEl.className = 'k';
    kEl.textContent = k;

    const vEl = document.createElement('div');
    vEl.className = 'v';
    if (v instanceof Node) vEl.appendChild(v);
    else vEl.textContent = v;

    wrap.appendChild(kEl);
    wrap.appendChild(vEl);
  }

  return wrap;
}

function makePill(text) {
  const el = document.createElement('span');
  el.className = 'pill';
  el.textContent = text;
  return el;
}

function makeBar(value01) {
  const outer = document.createElement('div');
  outer.className = 'bar';
  const inner = document.createElement('div');
  const v = typeof value01 === 'number' && Number.isFinite(value01) ? Math.max(0, Math.min(1, value01)) : 0;
  inner.style.width = `${v * 100}%`;
  outer.appendChild(inner);
  return outer;
}

function makeLowMidEl(fraction) {
  const el = document.createElement('div');
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    el.textContent = '—';
    return el;
  }
  const pct = fraction * 100;
  el.textContent = `${pct.toFixed(1)}%`;
  if (pct < 15) el.style.color = 'green';
  else if (pct < 30) el.style.color = 'orange';
  else el.style.color = 'red';
  return el;
}

function makeSparkline(values, width = 120, height = 24) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'transparent';
  ctx.clearRect(0, 0, width, height);
  if (!Array.isArray(values) || values.length === 0) return canvas;
  const arr = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = Math.max(1e-6, max - min);
  ctx.strokeStyle = '#2b7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < arr.length; i++) {
    const x = (i / (arr.length - 1)) * (width - 2) + 1;
    const y = height - 1 - ((arr[i] - min) / range) * (height - 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  return canvas;
}

function makeHotspotList(items, formatItem, maxItems = 5) {
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '4px';

  if (!Array.isArray(items) || items.length === 0) {
    wrap.textContent = '—';
    return wrap;
  }

  const slice = items.slice(0, maxItems);
  for (let i = 0; i < slice.length; i++) {
    const line = document.createElement('div');
    line.textContent = formatItem(slice[i], i);
    wrap.appendChild(line);
  }

  return wrap;
}

function isObj(x) {
  return x != null && typeof x === 'object';
}

function renderSummaryLike(root, summary) {
  const backend = safeGet(summary, 'meta.backend', 'dsp');
  const sr = safeGet(summary, 'meta.sampleRate');
  const dur = safeGet(summary, 'meta.durationSec');

  const head = document.createElement('div');
  head.appendChild(makePill(`backend: ${backend}`));
  root.appendChild(head);

  const global = summary.global ?? {};
  const dist = safeGet(summary, 'global.energyDistribution', null);

  const pairs = [
    ['Sample rate', sr ? `${sr} Hz` : '—'],
    ['Duration', typeof dur === 'number' ? `${fmt(dur, 2)} s` : '—'],
    ['RMS (global)', typeof global.rmsDbfs === 'number' ? `${fmt(global.rmsDbfs, 2)} dBFS` : '—'],
    ['Integrated LUFS', typeof global.integratedLufs === 'number' ? `${fmt(global.integratedLufs, 2)} LUFS` : '—'],
    ['True Peak (approx)', typeof global.truePeakDbtp === 'number' ? `${fmt(global.truePeakDbtp, 2)} dBTP` : '—'],
    ['PLR (TP - LUFS-I)', typeof global.plr === 'number' ? `${fmt(global.plr, 2)} LU` : '—'],
    ['Clipping events', safeGet(global, 'clipping.clipEvents') != null ? `${safeGet(global, 'clipping.clipEvents')}` : '—'],
    ['Clipped samples', safeGet(global, 'clipping.clippedSamples') != null ? `${safeGet(global, 'clipping.clippedSamples')}` : '—'],
    ['Clip hotspots (top 5)', makeHotspotList(safeGet(global, 'clipping.hotspots'), (h, idx) => {
      const t = h?.tSec;
      const cs = h?.clippedSamples;
      const ce = h?.clipEvents;
      const tp = h?.truePeakDbtp;
      return `#${idx + 1}  t=${fmt(t, 2)}s | clipped=${cs ?? '—'} | events=${ce ?? '—'} | TP=${tp != null ? fmt(tp, 2) : '—'} dBTP`;
    })],
    ['Short-term LUFS STD', typeof global.shortTermLufsStd === 'number' ? `${fmt(global.shortTermLufsStd, 2)} LU` : '—'],
    ['LRA (approx)', typeof global.lra === 'number' ? `${fmt(global.lra, 2)} LU` : '—'],
    ['Crest factor (mean)', typeof global.crestFactorDbMean === 'number' ? `${fmt(global.crestFactorDbMean, 2)} dB` : '—'],
    ['Crest factor (STD)', typeof global.crestFactorDbStd === 'number' ? `${fmt(global.crestFactorDbStd, 2)} dB` : '—'],
    ['Stereo corr (mean)', safeGet(global, 'stereo.correlationStats.mean') != null ? fmt(safeGet(global, 'stereo.correlationStats.mean'), 3) : '—'],
    ['Stereo corr (min)', safeGet(global, 'stereo.correlationStats.min') != null ? fmt(safeGet(global, 'stereo.correlationStats.min'), 3) : '—'],
    ['Width (mean)', safeGet(global, 'stereo.widthStats.mean') != null ? fmt(safeGet(global, 'stereo.widthStats.mean'), 3) : '—'],
    ['Mono drop (mean)', safeGet(global, 'stereo.monoDropDbStats.mean') != null ? `${fmt(safeGet(global, 'stereo.monoDropDbStats.mean'), 2)} dB` : '—'],
    ['Width hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.widest'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | width=${fmt(h?.width, 3)} | corr=${fmt(h?.correlation, 3)} | monoDrop=${fmt(h?.monoDropDb, 2)} dB`;
    })],
    ['Mono-drop hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.worstMonoDrop'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | monoDrop=${fmt(h?.monoDropDb, 2)} dB | corr=${fmt(h?.correlation, 3)} | width=${fmt(h?.width, 3)}`;
    })],
    ['Neg-corr hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.mostNegativeCorrelation'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | corr=${fmt(h?.correlation, 3)} | width=${fmt(h?.width, 3)} | monoDrop=${fmt(h?.monoDropDb, 2)} dB`;
    })],
    ['DC offset L/R', safeGet(global, 'dcOffset.left') != null ? `${fmt(safeGet(global, 'dcOffset.left'), 6)} / ${fmt(safeGet(global, 'dcOffset.right'), 6)}` : '—'],
    ['Rumble <30Hz (RMS)', safeGet(global, 'rumble.rmsDbfs') != null ? `${fmt(safeGet(global, 'rumble.rmsDbfs'), 2)} dBFS` : '—'],
    ['Rumble hotspots (top 5)', makeHotspotList(safeGet(global, 'rumble.hotspots'), (h, idx) => {
      const ratio = h?.rumbleRatioToStereoRms;
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | rumble=${fmt(h?.rumbleRmsDbfs, 2)} dBFS | ratio=${ratio != null ? fmt(ratio, 3) : '—'}`;
    })],
    ['Silence < -60 dBFS', safeGet(global, 'silence.fractionBelow') != null ? fmtPct(safeGet(global, 'silence.fractionBelow'), 1) : '—'],
    ['LR imbalance hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.lrImbalance'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | LR=${fmt(h?.lrBalanceDb, 2)} dB | corr=${fmt(h?.correlation, 3)} | width=${fmt(h?.width, 3)}`;
    })],
    ['Spectral centroid (mean)', safeGet(global, 'spectral.centroidHzMean') != null ? `${fmt(global.spectral.centroidHzMean, 1)} Hz` : '—'],
    ['Spectral centroid (STD)', safeGet(global, 'spectral.centroidHzStd') != null ? `${fmt(global.spectral.centroidHzStd, 1)} Hz` : '—'],
    ['Spectral flux (mean)', safeGet(global, 'spectral.spectralFluxMean') != null ? `${fmt(global.spectral.spectralFluxMean, 4)}` : '—'],
    ['Spectral flux (STD)', safeGet(global, 'spectral.spectralFluxStd') != null ? `${fmt(global.spectral.spectralFluxStd, 4)}` : '—'],
    ['HFC (mean)', safeGet(global, 'spectral.hfcMean') != null ? `${fmt(global.spectral.hfcMean, 4)}` : '—'],
    ['HFC (STD)', safeGet(global, 'spectral.hfcStd') != null ? `${fmt(global.spectral.hfcStd, 4)}` : '—'],
    ['Spectral rolloff (mean)', safeGet(global, 'spectral.rolloffHzMean') != null ? `${fmt(global.spectral.rolloffHzMean, 1)} Hz` : '—'],
    ['Spectral flatness (mean)', safeGet(global, 'spectral.flatnessMean') != null ? `${fmt(global.spectral.flatnessMean, 4)}` : '—'],
    ['Low‑mid buildup (150–350 Hz)', (() => {
      const v = safeGet(global, 'spectralAdvanced.lowMid.fraction');
      const series = safeGet(summary, 'timeSeries.spectralAdvanced') || safeGet(summary, 'timeSeries.lowMidSeries') || null;
      // allow both series formats: array of {tSec,fraction} or fraction array
      let arr = null;
      if (Array.isArray(series) && series.length > 0) {
        if (typeof series[0] === 'number') arr = series;
        else if (typeof series[0] === 'object' && series[0] != null) arr = series.map((s) => s.fraction ?? 0);
      }
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';
      wrap.appendChild(makeLowMidEl(v));
      if (arr) wrap.appendChild(makeSparkline(arr, 120, 24));
      return wrap;
    })()],
    ['Low‑mid buildup (150–350 Hz)', (() => {
      const v = safeGet(global, 'spectralAdvanced.lowMid.fraction');
      return makeLowMidEl(v);
    })()],
    ['Chroma (mean)', safeGet(global, 'meyda.chromaMean') != null ? safeGet(global, 'meyda.chromaMean').map((v) => fmt(v, 2)).join(', ') : '—'],
    ['Meyda MFCC (mean)', safeGet(global, 'meyda.mfccMean') != null ? safeGet(global, 'meyda.mfccMean').slice(0, 5).map((v) => fmt(v, 2)).join(', ') + (safeGet(global, 'meyda.mfccMean').length > 5 ? ' ...' : '') : '—'],
    ['Meyda ZCR (mean)', safeGet(global, 'meyda.zcrMean') != null ? fmt(safeGet(global, 'meyda.zcrMean'), 4) : '—'],
    ['Chroma (mean)', safeGet(global, 'meyda.chromaMean') != null ? safeGet(global, 'meyda.chromaMean').map((v) => fmt(v, 2)).join(', ') : '—'],
    ['Meyda spectral contrast (mean)', safeGet(global, 'meyda.spectralContrastMean') != null ? safeGet(global, 'meyda.spectralContrastMean').map((v) => fmt(v, 2)).join(', ') : '—'],
    ['Meyda MFCC (mean)', safeGet(global, 'meyda.mfccMean') != null ? safeGet(global, 'meyda.mfccMean').slice(0, 5).map((v) => fmt(v, 2)).join(', ') + (safeGet(global, 'meyda.mfccMean').length > 5 ? ' ...' : '') : '—'],
    ['Meyda ZCR (mean)', safeGet(global, 'meyda.zeroCrossingRateMean') != null ? fmt(safeGet(global, 'meyda.zeroCrossingRateMean'), 4) : '—'],
    ['Sharpness (mean)', safeGet(global, 'psycho.sharpness.mean') != null ? fmt(safeGet(global, 'psycho.sharpness.mean'), 3) : '—'],
    ['Sharpness (STD)', safeGet(global, 'psycho.sharpness.std') != null ? fmt(safeGet(global, 'psycho.sharpness.std'), 3) : '—'],
    ['Spectral contrast (mean)', safeGet(global, 'psycho.spectralContrastDb.mean') != null ? `${fmt(safeGet(global, 'psycho.spectralContrastDb.mean'), 2)} dB` : '—'],
    ['Spectral contrast (STD)', safeGet(global, 'psycho.spectralContrastDb.std') != null ? `${fmt(safeGet(global, 'psycho.spectralContrastDb.std'), 2)} dB` : '—'],
    ['Sibilance index (mean)', safeGet(global, 'psycho.indices.sibilance.mean') != null ? fmt(safeGet(global, 'psycho.indices.sibilance.mean'), 4) : '—'],
    ['Harshness index (mean)', safeGet(global, 'psycho.indices.harshness.mean') != null ? fmt(safeGet(global, 'psycho.indices.harshness.mean'), 4) : '—'],
    ['Boominess index (mean)', safeGet(global, 'psycho.indices.boominess.mean') != null ? fmt(safeGet(global, 'psycho.indices.boominess.mean'), 4) : '—'],
  ];

  if (dist && typeof dist === 'object') {
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gap = '8px';

    for (const k of ['low', 'mid', 'high']) {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '60px 1fr 60px';
      row.style.gap = '8px';
      row.style.alignItems = 'center';

      const name = document.createElement('div');
      name.className = 'k';
      name.textContent = k;

      const bar = makeBar(dist[k]);
      const pct = document.createElement('div');
      pct.className = 'v';
      pct.textContent = fmtPct(dist[k]);

      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(pct);
      container.appendChild(row);
    }

    pairs.push(['Energy dist (low/mid/high)', container]);
  }

  const sums = summary.summaries ?? {};
  const on = sums.onsets ?? {};
  if (isObj(on) && typeof on.count === 'number') {
    const first = Array.isArray(on.first) ? on.first.slice(0, 5).map((t) => fmt(t, 3)).join(', ') : '';
    pairs.push(['Onsets', `${on.count} (pierwsze: ${first}${on.count > 5 ? ', …' : ''})`]);
  }

  if (isObj(on?.onsetStrength) && typeof on.onsetStrength.mean === 'number') {
    pairs.push(['Onset strength (mean)', fmt(on.onsetStrength.mean, 4)]);
    pairs.push(['Onset strength (max)', fmt(on.onsetStrength.max, 4)]);
  }

  const onsetBandLow = safeGet(summary, 'global.transients.onsetBandShares.low.mean');
  const onsetBandMid = safeGet(summary, 'global.transients.onsetBandShares.mid.mean');
  const onsetBandHigh = safeGet(summary, 'global.transients.onsetBandShares.high.mean');
  if (onsetBandLow != null || onsetBandMid != null || onsetBandHigh != null) {
    pairs.push(['Onset band share (low/mid/high)', `${fmt(onsetBandLow, 3)} / ${fmt(onsetBandMid, 3)} / ${fmt(onsetBandHigh, 3)}`]);
  }

  const loud = sums.loudness ?? {};
  if (isObj(loud) && typeof loud.frames === 'number') {
    pairs.push([
      'Loudness frames',
      `${loud.frames}, LUFS M mean ${fmt(loud.lufsMomentary?.mean, 2)}, max ${fmt(loud.lufsMomentary?.max, 2)}`,
    ]);
  }

  const spec = sums.spectrum ?? {};
  if (isObj(spec) && typeof spec.frames === 'number') {
    pairs.push(['Spectrum frames', `${spec.frames}, centroid mean ${fmt(spec.centroidHz?.mean, 1)} Hz`]);
  }

  root.appendChild(makeKV(pairs));
}

function renderFullLike(root, result) {
  const backend = safeGet(result, 'meta.backend', 'dsp');
  const sr = safeGet(result, 'meta.sampleRate');
  const dur = safeGet(result, 'meta.durationSec');

  const head = document.createElement('div');
  head.appendChild(makePill(`backend: ${backend}`));
  root.appendChild(head);

  const global = result.global ?? {};
  const dist = safeGet(result, 'global.energyDistribution', null);

  const loudSeries = safeGet(result, 'timeSeries.loudnessFrames', []);
  const specSeries = safeGet(result, 'timeSeries.spectrumFrames', []);
  const onsets = safeGet(result, 'timeSeries.onsetTimesSec', []);

  const loudSum = summarizeSeries(loudSeries, ['rmsDbfs', 'lufsMomentary', 'lufsShortTerm']);
  const specSum = summarizeSeries(specSeries, ['centroidHz', 'rolloffHz', 'flatness']);

  const pairs = [
    ['Sample rate', sr ? `${sr} Hz` : '—'],
    ['Duration', typeof dur === 'number' ? `${fmt(dur, 2)} s` : '—'],
    ['RMS (global)', typeof global.rms === 'number' ? `${fmt(global.rms, 6)} (${fmt(global.rmsDbfs, 2)} dBFS)` : (typeof global.rmsDbfs === 'number' ? `${fmt(global.rmsDbfs, 2)} dBFS` : '—')],
    ['Integrated LUFS', typeof global.integratedLufs === 'number' ? `${fmt(global.integratedLufs, 2)} LUFS` : '—'],
    ['True Peak (approx)', typeof global.truePeakDbtp === 'number' ? `${fmt(global.truePeakDbtp, 2)} dBTP` : '—'],
    ['PLR (TP - LUFS-I)', typeof global.plr === 'number' ? `${fmt(global.plr, 2)} LU` : '—'],
    ['Clipping events', safeGet(global, 'clipping.clipEvents') != null ? `${safeGet(global, 'clipping.clipEvents')}` : '—'],
    ['Clipped samples', safeGet(global, 'clipping.clippedSamples') != null ? `${safeGet(global, 'clipping.clippedSamples')}` : '—'],
    ['Clip hotspots (top 5)', makeHotspotList(safeGet(global, 'clipping.hotspots'), (h, idx) => {
      const t = h?.tSec;
      const cs = h?.clippedSamples;
      const ce = h?.clipEvents;
      const tp = h?.truePeakDbtp;
      return `#${idx + 1}  t=${fmt(t, 2)}s | clipped=${cs ?? '—'} | events=${ce ?? '—'} | TP=${tp != null ? fmt(tp, 2) : '—'} dBTP`;
    })],
    ['Short-term LUFS STD', typeof global.shortTermLufsStd === 'number' ? `${fmt(global.shortTermLufsStd, 2)} LU` : '—'],
    ['LRA (approx)', typeof global.lra === 'number' ? `${fmt(global.lra, 2)} LU` : '—'],
    ['Crest factor (mean)', typeof global.crestFactorDbMean === 'number' ? `${fmt(global.crestFactorDbMean, 2)} dB` : '—'],
    ['Crest factor (STD)', typeof global.crestFactorDbStd === 'number' ? `${fmt(global.crestFactorDbStd, 2)} dB` : '—'],
    ['Stereo corr (mean)', safeGet(global, 'stereo.correlationStats.mean') != null ? fmt(safeGet(global, 'stereo.correlationStats.mean'), 3) : '—'],
    ['Stereo corr (min)', safeGet(global, 'stereo.correlationStats.min') != null ? fmt(safeGet(global, 'stereo.correlationStats.min'), 3) : '—'],
    ['Width (mean)', safeGet(global, 'stereo.widthStats.mean') != null ? fmt(safeGet(global, 'stereo.widthStats.mean'), 3) : '—'],
    ['Mono drop (mean)', safeGet(global, 'stereo.monoDropDbStats.mean') != null ? `${fmt(safeGet(global, 'stereo.monoDropDbStats.mean'), 2)} dB` : '—'],
    ['Width hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.widest'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | width=${fmt(h?.width, 3)} | corr=${fmt(h?.correlation, 3)} | monoDrop=${fmt(h?.monoDropDb, 2)} dB`;
    })],
    ['Mono-drop hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.worstMonoDrop'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | monoDrop=${fmt(h?.monoDropDb, 2)} dB | corr=${fmt(h?.correlation, 3)} | width=${fmt(h?.width, 3)}`;
    })],
    ['Neg-corr hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.mostNegativeCorrelation'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | corr=${fmt(h?.correlation, 3)} | width=${fmt(h?.width, 3)} | monoDrop=${fmt(h?.monoDropDb, 2)} dB`;
    })],
    ['DC offset L/R', safeGet(global, 'dcOffset.left') != null ? `${fmt(safeGet(global, 'dcOffset.left'), 6)} / ${fmt(safeGet(global, 'dcOffset.right'), 6)}` : '—'],
    ['Rumble <30Hz (RMS)', safeGet(global, 'rumble.rmsDbfs') != null ? `${fmt(safeGet(global, 'rumble.rmsDbfs'), 2)} dBFS` : '—'],
    ['Rumble hotspots (top 5)', makeHotspotList(safeGet(global, 'rumble.hotspots'), (h, idx) => {
      const ratio = h?.rumbleRatioToStereoRms;
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | rumble=${fmt(h?.rumbleRmsDbfs, 2)} dBFS | ratio=${ratio != null ? fmt(ratio, 3) : '—'}`;
    })],
    ['Silence < -60 dBFS', safeGet(global, 'silence.fractionBelow') != null ? fmtPct(safeGet(global, 'silence.fractionBelow'), 1) : '—'],
    ['LR imbalance hotspots (top 5)', makeHotspotList(safeGet(global, 'stereo.hotspots.lrImbalance'), (h, idx) => {
      return `#${idx + 1}  t=${fmt(h?.tSec, 2)}s | LR=${fmt(h?.lrBalanceDb, 2)} dB | corr=${fmt(h?.correlation, 3)} | width=${fmt(h?.width, 3)}`;
    })],
    ['Spectral centroid (mean)', safeGet(global, 'spectral.centroidHzMean') != null ? `${fmt(global.spectral.centroidHzMean, 1)} Hz` : '—'],
    ['Spectral centroid (STD)', safeGet(global, 'spectral.centroidHzStd') != null ? `${fmt(global.spectral.centroidHzStd, 1)} Hz` : '—'],
    ['Spectral flux (mean)', safeGet(global, 'spectral.spectralFluxMean') != null ? `${fmt(global.spectral.spectralFluxMean, 4)}` : '—'],
    ['Spectral flux (STD)', safeGet(global, 'spectral.spectralFluxStd') != null ? `${fmt(global.spectral.spectralFluxStd, 4)}` : '—'],
    ['HFC (mean)', safeGet(global, 'spectral.hfcMean') != null ? `${fmt(global.spectral.hfcMean, 4)}` : '—'],
    ['HFC (STD)', safeGet(global, 'spectral.hfcStd') != null ? `${fmt(global.spectral.hfcStd, 4)}` : '—'],
    ['Spectral rolloff (mean)', safeGet(global, 'spectral.rolloffHzMean') != null ? `${fmt(global.spectral.rolloffHzMean, 1)} Hz` : '—'],
    ['Spectral flatness (mean)', safeGet(global, 'spectral.flatnessMean') != null ? `${fmt(global.spectral.flatnessMean, 4)}` : '—'],
    ['Sharpness (mean)', safeGet(global, 'psycho.sharpness.mean') != null ? fmt(safeGet(global, 'psycho.sharpness.mean'), 3) : '—'],
    ['Sharpness (STD)', safeGet(global, 'psycho.sharpness.std') != null ? fmt(safeGet(global, 'psycho.sharpness.std'), 3) : '—'],
    ['Spectral contrast (mean)', safeGet(global, 'psycho.spectralContrastDb.mean') != null ? `${fmt(safeGet(global, 'psycho.spectralContrastDb.mean'), 2)} dB` : '—'],
    ['Spectral contrast (STD)', safeGet(global, 'psycho.spectralContrastDb.std') != null ? `${fmt(safeGet(global, 'psycho.spectralContrastDb.std'), 2)} dB` : '—'],
    ['Sibilance index (mean)', safeGet(global, 'psycho.indices.sibilance.mean') != null ? fmt(safeGet(global, 'psycho.indices.sibilance.mean'), 4) : '—'],
    ['Harshness index (mean)', safeGet(global, 'psycho.indices.harshness.mean') != null ? fmt(safeGet(global, 'psycho.indices.harshness.mean'), 4) : '—'],
    ['Boominess index (mean)', safeGet(global, 'psycho.indices.boominess.mean') != null ? fmt(safeGet(global, 'psycho.indices.boominess.mean'), 4) : '—'],
  ];

  const onsetStrengthMean = safeGet(result, 'global.transients.onsetStrengthMean');
  const onsetStrengthStd = safeGet(result, 'global.transients.onsetStrengthStd');
  if (typeof onsetStrengthMean === 'number') pairs.push(['Onset strength (mean)', fmt(onsetStrengthMean, 4)]);
  if (typeof onsetStrengthStd === 'number') pairs.push(['Onset strength (STD)', fmt(onsetStrengthStd, 4)]);

  const onsetBandLow = safeGet(result, 'global.transients.onsetBandShares.low.mean');
  const onsetBandMid = safeGet(result, 'global.transients.onsetBandShares.mid.mean');
  const onsetBandHigh = safeGet(result, 'global.transients.onsetBandShares.high.mean');
  if (onsetBandLow != null || onsetBandMid != null || onsetBandHigh != null) {
    pairs.push(['Onset band share (low/mid/high)', `${fmt(onsetBandLow, 3)} / ${fmt(onsetBandMid, 3)} / ${fmt(onsetBandHigh, 3)}`]);
  }

  if (dist && typeof dist === 'object') {
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gap = '8px';

    for (const k of ['low', 'mid', 'high']) {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '60px 1fr 60px';
      row.style.gap = '8px';
      row.style.alignItems = 'center';

      const name = document.createElement('div');
      name.className = 'k';
      name.textContent = k;

      const bar = makeBar(dist[k]);
      const pct = document.createElement('div');
      pct.className = 'v';
      pct.textContent = fmtPct(dist[k]);

      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(pct);
      container.appendChild(row);
    }

    pairs.push(['Energy dist (low/mid/high)', container]);
  }

  if (loudSum) {
    pairs.push([
      'Loudness frames',
      `${loudSum.count} (t ${fmt(loudSum.tStart, 2)} → ${fmt(loudSum.tEnd, 2)} s), LUFS M mean ${fmt(loudSum.lufsMomentary?.mean, 2)}, max ${fmt(loudSum.lufsMomentary?.max, 2)}`,
    ]);
  }
  if (specSum) {
    pairs.push([
      'Spectrum frames',
      `${specSum.count} (t ${fmt(specSum.tStart, 2)} → ${fmt(specSum.tEnd, 2)} s), centroid mean ${fmt(specSum.centroidHz?.mean, 1)} Hz`,
    ]);
  }

  if (Array.isArray(onsets)) {
    pairs.push(['Onsets', `${onsets.length} (pierwsze: ${onsets.slice(0, 5).map((t) => fmt(t, 3)).join(', ')}${onsets.length > 5 ? ', …' : ''})`]);
  }

  root.appendChild(makeKV(pairs));
}

function renderComparisonLike(root, result) {
  const head = document.createElement('div');
  head.appendChild(makePill('comparison: A vs REF'));
  root.appendChild(head);

  const a = result.a;
  const b = result.b;
  const c = result.compare ?? {};

  const pairs = [
    ['A backend', safeGet(a, 'meta.backend', '—')],
    ['REF backend', safeGet(b, 'meta.backend', '—')],
    ['A duration', safeGet(a, 'meta.durationSec') != null ? `${fmt(safeGet(a, 'meta.durationSec'), 2)} s` : '—'],
    ['REF duration', safeGet(b, 'meta.durationSec') != null ? `${fmt(safeGet(b, 'meta.durationSec'), 2)} s` : '—'],
    ['Integrated LUFS Δ (A-B)', c?.loudness?.integratedLufs?.delta != null ? `${fmt(c.loudness.integratedLufs.delta, 2)} LUFS` : '—'],
    ['LRA Δ (A-B)', c?.loudness?.lra?.delta != null ? `${fmt(c.loudness.lra.delta, 2)} LU` : '—'],
    ['True Peak Δ (A-B)', c?.loudness?.truePeakDbtp?.delta != null ? `${fmt(c.loudness.truePeakDbtp.delta, 2)} dB` : '—'],
    ['PLR Δ (A-B)', c?.loudness?.plr?.delta != null ? `${fmt(c.loudness.plr.delta, 2)} LU` : '—'],
    ['RMS dBFS Δ (A-B)', c?.loudness?.rmsDbfs?.delta != null ? `${fmt(c.loudness.rmsDbfs.delta, 2)} dB` : '—'],
    ['Crest mean Δ (A-B)', c?.loudness?.crestFactorDbMean?.delta != null ? `${fmt(c.loudness.crestFactorDbMean.delta, 2)} dB` : '—'],
    ['Crest STD Δ (A-B)', c?.loudness?.crestFactorDbStd?.delta != null ? `${fmt(c.loudness.crestFactorDbStd.delta, 2)} dB` : '—'],
    ['Clip events Δ (A-B)', c?.technical?.clippingEvents?.delta != null ? `${c.technical.clippingEvents.delta}` : '—'],
    ['Centroid mean Δ', c?.spectralMeans?.centroidHz?.delta != null ? `${fmt(c.spectralMeans.centroidHz.delta, 1)} Hz` : '—'],
    ['Rolloff mean Δ', c?.spectralMeans?.rolloffHz?.delta != null ? `${fmt(c.spectralMeans.rolloffHz.delta, 1)} Hz` : '—'],
    ['Flatness mean Δ', c?.spectralMeans?.flatness?.delta != null ? `${fmt(c.spectralMeans.flatness.delta, 4)}` : '—'],
    ['Energy low Δ', c?.energyDistribution?.low?.delta != null ? fmtPct(c.energyDistribution.low.delta, 2) : '—'],
    ['Energy mid Δ', c?.energyDistribution?.mid?.delta != null ? fmtPct(c.energyDistribution.mid.delta, 2) : '—'],
    ['Energy high Δ', c?.energyDistribution?.high?.delta != null ? fmtPct(c.energyDistribution.high.delta, 2) : '—'],
    ['Onsets / min Δ', c?.onsets?.deltaPerMin != null ? fmt(c.onsets.deltaPerMin, 2) : '—'],
    ['Onset strength mean Δ', c?.transients?.onsetStrengthMean?.delta != null ? fmt(c.transients.onsetStrengthMean.delta, 4) : '—'],
    ['Onset strength STD Δ', c?.transients?.onsetStrengthStd?.delta != null ? fmt(c.transients.onsetStrengthStd.delta, 4) : '—'],
    ['Sharpness mean Δ', c?.psycho?.sharpnessMean?.delta != null ? fmt(c.psycho.sharpnessMean.delta, 3) : '—'],
    ['Spectral contrast mean Δ', c?.psycho?.spectralContrastDbMean?.delta != null ? `${fmt(c.psycho.spectralContrastDbMean.delta, 2)} dB` : '—'],
    ['Sibilance index mean Δ', c?.psycho?.indicesMean?.sibilance?.delta != null ? fmt(c.psycho.indicesMean.sibilance.delta, 4) : '—'],
    ['Harshness index mean Δ', c?.psycho?.indicesMean?.harshness?.delta != null ? fmt(c.psycho.indicesMean.harshness.delta, 4) : '—'],
    ['Boominess index mean Δ', c?.psycho?.indicesMean?.boominess?.delta != null ? fmt(c.psycho.indicesMean.boominess.delta, 4) : '—'],
    ['Bark dist L1 (A vs REF)', c?.psycho?.bark?.l1Distance != null ? fmt(c.psycho.bark.l1Distance, 3) : '—'],
  ];

  root.appendChild(makeKV(pairs));
}

/**
 * @param {HTMLElement} root
 * @param {any} result
 */
export function renderResultView(root, result) {
  root.replaceChildren();
  if (!result) return;

  // Comparison summary shape: { meta, a, b, compare, ... }
  if (isObj(result) && isObj(result.compare) && isObj(result.a) && isObj(result.b)) {
    renderComparisonLike(root, result);
    return;
  }

  // GPT summary shape: { meta, global, summaries }
  if (isObj(result) && isObj(result.summaries)) {
    renderSummaryLike(root, result);
    return;
  }

  // Full analysis shape
  renderFullLike(root, result);
}
