function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function diff(a, b) {
  if (!isNum(a) || !isNum(b)) return null;
  return a - b;
}

function ratio(a, b) {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

function pick(obj, path) {
  try {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function onsetStats(times, durationSec) {
  if (!Array.isArray(times) || times.length === 0 || !isNum(durationSec) || durationSec <= 0) {
    return { count: Array.isArray(times) ? times.length : 0, perMin: null };
  }
  return {
    count: times.length,
    perMin: (times.length / durationSec) * 60,
  };
}

function perMin(count, durationSec) {
  if (!isNum(count) || !isNum(durationSec) || durationSec <= 0) return null;
  return (count / durationSec) * 60;
}

function barkCompare(psyA, psyB, topK = 5) {
  const aBands = psyA?.barkBands;
  const bBands = psyB?.barkBands;
  if (!Array.isArray(aBands) || !Array.isArray(bBands) || aBands.length === 0 || bBands.length === 0) {
    return { l1Distance: null, topDeltaBands: [] };
  }

  const n = Math.min(aBands.length, bBands.length);
  let l1 = 0;
  const diffs = [];

  for (let i = 0; i < n; i++) {
    const a = aBands[i];
    const b = bBands[i];
    const ea = a?.energyNorm;
    const eb = b?.energyNorm;
    if (!isNum(ea) || !isNum(eb)) continue;
    const d = ea - eb;
    l1 += Math.abs(d);
    diffs.push({
      band: a?.band ?? i,
      zLo: a?.zLo,
      zHi: a?.zHi,
      loHz: a?.loHz,
      hiHz: a?.hiHz,
      deltaEnergyNorm: d,
    });
  }

  diffs.sort((x, y) => Math.abs(y.deltaEnergyNorm ?? 0) - Math.abs(x.deltaEnergyNorm ?? 0));
  return {
    l1Distance: isNum(l1) ? l1 : null,
    topDeltaBands: diffs.slice(0, topK),
  };
}

function psychoCompare(globalA, globalB) {
  const psyA = globalA?.psycho;
  const psyB = globalB?.psycho;
  if (!psyA && !psyB) return null;

  const sharpA = pick(psyA, 'sharpness.mean');
  const sharpB = pick(psyB, 'sharpness.mean');
  const contA = pick(psyA, 'spectralContrastDb.mean');
  const contB = pick(psyB, 'spectralContrastDb.mean');

  const boomA = pick(psyA, 'indices.boominess.mean');
  const boomB = pick(psyB, 'indices.boominess.mean');
  const harshA = pick(psyA, 'indices.harshness.mean');
  const harshB = pick(psyB, 'indices.harshness.mean');
  const sibilA = pick(psyA, 'indices.sibilance.mean');
  const sibilB = pick(psyB, 'indices.sibilance.mean');

  const bark = barkCompare(psyA, psyB, 5);

  return {
    sharpnessMean: { a: sharpA, b: sharpB, delta: diff(sharpA, sharpB) },
    spectralContrastDbMean: { a: contA, b: contB, delta: diff(contA, contB) },
    indicesMean: {
      boominess: { a: boomA, b: boomB, delta: diff(boomA, boomB) },
      harshness: { a: harshA, b: harshB, delta: diff(harshA, harshB) },
      sibilance: { a: sibilA, b: sibilB, delta: diff(sibilA, sibilB) },
    },
    bark,
  };
}

/**
 * Full comparison JSON (do pobrania jako plik).
 * @param {any} fullA
 * @param {any} fullB
 */
export function makeFullComparison(fullA, fullB) {
  const metaA = fullA?.meta ?? {};
  const metaB = fullB?.meta ?? {};

  const durationA = metaA.durationSec;
  const durationB = metaB.durationSec;

  const globalA = fullA?.global ?? {};
  const globalB = fullB?.global ?? {};

  const distA = globalA.energyDistribution ?? {};
  const distB = globalB.energyDistribution ?? {};

  const onsetA = fullA?.timeSeries?.onsetTimesSec ?? [];
  const onsetB = fullB?.timeSeries?.onsetTimesSec ?? [];

  const onsetStrengthMeanA = pick(globalA, 'transients.onsetStrengthMean');
  const onsetStrengthMeanB = pick(globalB, 'transients.onsetStrengthMean');
  const onsetStrengthStdA = pick(globalA, 'transients.onsetStrengthStd');
  const onsetStrengthStdB = pick(globalB, 'transients.onsetStrengthStd');

  const clipEventsA = pick(globalA, 'clipping.clipEvents');
  const clipEventsB = pick(globalB, 'clipping.clipEvents');
  const clippedSamplesA = pick(globalA, 'clipping.clippedSamples');
  const clippedSamplesB = pick(globalB, 'clipping.clippedSamples');

  const corrMeanA = pick(globalA, 'stereo.correlationStats.mean');
  const corrMeanB = pick(globalB, 'stereo.correlationStats.mean');
  const widthMeanA = pick(globalA, 'stereo.widthStats.mean');
  const widthMeanB = pick(globalB, 'stereo.widthStats.mean');
  const monoDropMeanA = pick(globalA, 'stereo.monoDropDbStats.mean');
  const monoDropMeanB = pick(globalB, 'stereo.monoDropDbStats.mean');

  const dcLA = pick(globalA, 'dcOffset.left');
  const dcLB = pick(globalB, 'dcOffset.left');
  const dcRA = pick(globalA, 'dcOffset.right');
  const dcRB = pick(globalB, 'dcOffset.right');

  const rumbleA = pick(globalA, 'rumble.rmsDbfs');
  const rumbleB = pick(globalB, 'rumble.rmsDbfs');

  const silenceA = pick(globalA, 'silence.fractionBelow');
  const silenceB = pick(globalB, 'silence.fractionBelow');

  return {
    meta: {
      analyzedAt: new Date().toISOString(),
      type: 'comparison',
      a: {
        backend: metaA.backend,
        sampleRate: metaA.sampleRate,
        durationSec: durationA,
        fileHint: metaA.fileHint,
      },
      b: {
        backend: metaB.backend,
        sampleRate: metaB.sampleRate,
        durationSec: durationB,
        fileHint: metaB.fileHint,
      },
    },
    a: fullA,
    b: fullB,
    compare: {
      loudness: {
        integratedLufs: {
          a: globalA.integratedLufs,
          b: globalB.integratedLufs,
          delta: diff(globalA.integratedLufs, globalB.integratedLufs),
        },
        lra: {
          a: globalA.lra,
          b: globalB.lra,
          delta: diff(globalA.lra, globalB.lra),
        },
        truePeakDbtp: {
          a: globalA.truePeakDbtp,
          b: globalB.truePeakDbtp,
          delta: diff(globalA.truePeakDbtp, globalB.truePeakDbtp),
        },
        plr: {
          a: globalA.plr,
          b: globalB.plr,
          delta: diff(globalA.plr, globalB.plr),
        },
        rmsDbfs: {
          a: globalA.rmsDbfs,
          b: globalB.rmsDbfs,
          delta: diff(globalA.rmsDbfs, globalB.rmsDbfs),
        },
        crestFactorDbMean: {
          a: globalA.crestFactorDbMean,
          b: globalB.crestFactorDbMean,
          delta: diff(globalA.crestFactorDbMean, globalB.crestFactorDbMean),
        },
        crestFactorDbStd: {
          a: globalA.crestFactorDbStd,
          b: globalB.crestFactorDbStd,
          delta: diff(globalA.crestFactorDbStd, globalB.crestFactorDbStd),
        },
      },
      spectralMeans: {
        centroidHz: {
          a: pick(globalA, 'spectral.centroidHzMean'),
          b: pick(globalB, 'spectral.centroidHzMean'),
          delta: diff(pick(globalA, 'spectral.centroidHzMean'), pick(globalB, 'spectral.centroidHzMean')),
          ratio: ratio(pick(globalA, 'spectral.centroidHzMean'), pick(globalB, 'spectral.centroidHzMean')),
        },
        rolloffHz: {
          a: pick(globalA, 'spectral.rolloffHzMean'),
          b: pick(globalB, 'spectral.rolloffHzMean'),
          delta: diff(pick(globalA, 'spectral.rolloffHzMean'), pick(globalB, 'spectral.rolloffHzMean')),
          ratio: ratio(pick(globalA, 'spectral.rolloffHzMean'), pick(globalB, 'spectral.rolloffHzMean')),
        },
        flatness: {
          a: pick(globalA, 'spectral.flatnessMean'),
          b: pick(globalB, 'spectral.flatnessMean'),
          delta: diff(pick(globalA, 'spectral.flatnessMean'), pick(globalB, 'spectral.flatnessMean')),
        },
      },
      energyDistribution: {
        low: { a: distA.low, b: distB.low, delta: diff(distA.low, distB.low) },
        mid: { a: distA.mid, b: distB.mid, delta: diff(distA.mid, distB.mid) },
        high: { a: distA.high, b: distB.high, delta: diff(distA.high, distB.high) },
      },
      onsets: {
        a: onsetStats(onsetA, durationA),
        b: onsetStats(onsetB, durationB),
        deltaPerMin: diff(onsetStats(onsetA, durationA).perMin, onsetStats(onsetB, durationB).perMin),
      },
      transients: {
        onsetStrengthMean: {
          a: onsetStrengthMeanA,
          b: onsetStrengthMeanB,
          delta: diff(onsetStrengthMeanA, onsetStrengthMeanB),
          ratio: ratio(onsetStrengthMeanA, onsetStrengthMeanB),
        },
        onsetStrengthStd: {
          a: onsetStrengthStdA,
          b: onsetStrengthStdB,
          delta: diff(onsetStrengthStdA, onsetStrengthStdB),
          ratio: ratio(onsetStrengthStdA, onsetStrengthStdB),
        },
      },
      technical: {
        clippingEvents: {
          a: clipEventsA,
          b: clipEventsB,
          delta: diff(clipEventsA, clipEventsB),
          aPerMin: perMin(clipEventsA, durationA),
          bPerMin: perMin(clipEventsB, durationB),
        },
        clippedSamples: {
          a: clippedSamplesA,
          b: clippedSamplesB,
          delta: diff(clippedSamplesA, clippedSamplesB),
        },
        stereoCorrelationMean: {
          a: corrMeanA,
          b: corrMeanB,
          delta: diff(corrMeanA, corrMeanB),
        },
        stereoWidthMean: {
          a: widthMeanA,
          b: widthMeanB,
          delta: diff(widthMeanA, widthMeanB),
        },
        monoDropDbMean: {
          a: monoDropMeanA,
          b: monoDropMeanB,
          delta: diff(monoDropMeanA, monoDropMeanB),
        },
        dcOffsetLeft: {
          a: dcLA,
          b: dcLB,
          delta: diff(dcLA, dcLB),
        },
        dcOffsetRight: {
          a: dcRA,
          b: dcRB,
          delta: diff(dcRA, dcRB),
        },
        rumbleRmsDbfs: {
          a: rumbleA,
          b: rumbleB,
          delta: diff(rumbleA, rumbleB),
        },
        silenceFractionBelow: {
          a: silenceA,
          b: silenceB,
          delta: diff(silenceA, silenceB),
        },
      },
      psycho: psychoCompare(globalA, globalB),
    },
  };
}

/**
 * Small comparison JSON “do GPT”.
 * @param {any} summaryA
 * @param {any} summaryB
 * @param {any} fullCompare
 */
export function makeGptComparisonSummary(summaryA, summaryB, fullCompare) {
  return {
    meta: fullCompare?.meta,
    a: summaryA,
    b: summaryB,
    compare: fullCompare?.compare,
    note: 'A = analizowany, B = referencja. delta = A - B.',
  };
}
