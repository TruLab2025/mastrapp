/**
 * Essentia.js loader.
 *
 * Preferred path (with Vite/bundler): loads from npm package `essentia.js`.
 * Fallback path (no-bundler legacy): can still load files from /vendor/essentia.
 */

// Vite: copy WASM into build output and give us a URL.
// This avoids manual file copying and fixes locateFile resolution.
// eslint-disable-next-line import/no-unresolved
import wasmUrl from 'essentia.js/dist/essentia-wasm.web.wasm?url';

/**
 * @typedef {{ EssentiaWASM: any, Essentia: any }} EssentiaBundle
 */

function guessCandidatesVendor() {
  // Różne releasy Essentia.js mają różne nazwy. Trzymamy kilka typowych.
  return {
    js: [
      '/vendor/essentia/essentia-wasm.web.js',
      '/vendor/essentia/essentia-wasm.es.js',
      '/vendor/essentia/essentia-wasm.js',
      '/vendor/essentia/essentia.js',
    ],
    wasm: [
      '/vendor/essentia/essentia-wasm.web.wasm',
      '/vendor/essentia/essentia-wasm.wasm',
      '/vendor/essentia/essentia.wasm',
    ],
  };
}

async function importScriptAsModule(url) {
  // Dynamic import requires a real URL
  return import(/* @vite-ignore */ url);
}

async function firstExisting(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'GET' });
      if (r.ok) return u;
    } catch {
      // ignore
    }
  }
  return null;
}

function loadUmdScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(s);
  });
}

/**
 * @returns {Promise<EssentiaBundle | null>}
 */
export async function loadEssentia() {
  // 1) Bundler path: npm package (explicit ESM build + explicit WASM URL)
  try {
    const mod = await import('essentia.js/dist/essentia-wasm.es.js');
    const EssentiaWASM = mod?.EssentiaWASM ?? mod?.default ?? null;
    const EssentiaCtor = mod?.Essentia ?? null;

    if (EssentiaWASM && EssentiaCtor) {
      const wasmInstance = typeof EssentiaWASM === 'function'
        ? await EssentiaWASM({ locateFile: (p) => (p.endsWith('.wasm') ? wasmUrl : p) })
        : EssentiaWASM;
      const essentia = new EssentiaCtor(wasmInstance);
      return { EssentiaWASM: wasmInstance, Essentia: essentia };
    }

    console.warn('essentia-wasm.es.js loaded but exports not recognized', mod);
  } catch (e) {
    console.info('Essentia npm load failed, falling back to vendor if present.', e);
  }

  // 2) No-bundler fallback: vendor files
  const candidates = guessCandidatesVendor();
  const js = await firstExisting(candidates.js);
  const wasm = await firstExisting(candidates.wasm);
  if (!js || !wasm) return null;

  try {
    // Provide a hook for Emscripten to locate the WASM.
    // Many Essentia builds honor locateFile.
    // We attach it to window so it is visible during module init.
    window.ESSENTIA_WASM_LOCATE_FILE = (path) => {
      if (path.endsWith('.wasm')) return wasm;
      return path;
    };

    let mod = null;
    try {
      mod = await importScriptAsModule(js);
    } catch (e) {
      // Jeśli to UMD (nie ESM), import() się wywali — spróbuj przez <script>.
      await loadUmdScript(js);
      mod = null;
    }

    // Different builds expose different shapes.
    // Common patterns:
    // - mod.EssentiaWASM + mod.Essentia
    // - mod.default (factory)
    const EssentiaWASM = mod?.EssentiaWASM ?? mod?.default ?? window.EssentiaWASM ?? null;
    const EssentiaCtor = mod?.Essentia ?? window.Essentia ?? null;

    if (!EssentiaWASM || !EssentiaCtor) {
      console.warn('Essentia module loaded but exports not recognized.', mod);
      return null;
    }

    // Some builds require async init (factory returning a promise)
    const wasmInstance = typeof EssentiaWASM === 'function' ? await EssentiaWASM({
      locateFile: (p) => (p.endsWith('.wasm') ? wasm : p),
    }) : EssentiaWASM;

    const essentia = new EssentiaCtor(wasmInstance);

    return { EssentiaWASM: wasmInstance, Essentia: essentia };
  } catch (e) {
    console.info('Essentia not available (expected if not installed yet).', e);
    return null;
  } finally {
    delete window.ESSENTIA_WASM_LOCATE_FILE;
  }
}
