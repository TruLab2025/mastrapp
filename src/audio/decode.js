let sharedAudioContext = null;

function getAudioContext() {
  // Safari wymaga user gesture przed startem — tu i tak uruchamiasz analizę kliknięciem.
  if (!sharedAudioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedAudioContext = new Ctx({ latencyHint: 'interactive' });
  }
  return sharedAudioContext;
}

/**
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeFileToAudioBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = getAudioContext();

  // Niektóre przeglądarki wymagają "copy" bufora.
  const copied = arrayBuffer.slice(0);

  return new Promise((resolve, reject) => {
    audioContext.decodeAudioData(
      copied,
      (audioBuffer) => resolve(audioBuffer),
      (err) => reject(err || new Error('decodeAudioData failed')),
    );
  });
}
