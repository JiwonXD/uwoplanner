import templates from './arrival-template.js';
import { brightMasks, detect, defaultScales } from './detect.js';

// The search region is downscaled to this width, so the title block is always about 100-145px wide
// regardless of the capture resolution, and only a narrow band of template scales must be tried.
const MAX_WIDTH = 560;
const ALL_SCALES = defaultScales(0.45, 1.6, 0.05);
const ROI = { w: 0.35, h: 0.3 }; // top-left fraction of the frame that can hold the title text
const LOCK_SCORE = 0.7; // a match at least this strong pins the scale band for later frames
const FULL_SEARCH_EVERY = 20; // frames; keeps the lock honest if the UI scale setting changes
const caches = new Map();
const lock = { scale: null, frameKey: '', frames: 0 };
let canvas, ctx;

self.onmessage = ({ data }) => {
  if (data.type !== 'frame') return;
  const started = performance.now();
  const image = data.image;
  try {
    const fullW = image.displayWidth || image.width, fullH = image.displayHeight || image.height;
    const roiW = Math.max(1, Math.round(fullW * ROI.w)), roiH = Math.max(1, Math.round(fullH * ROI.h));
    const factor = Math.min(1, MAX_WIDTH / roiW);
    const w = Math.max(1, Math.round(roiW * factor)), h = Math.max(1, Math.round(roiH * factor));
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new OffscreenCanvas(w, h);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    ctx.drawImage(image, 0, 0, roiW, roiH, 0, 0, w, h);
    const opts = data.options || {};
    const thresholds = templates.map(tpl => ({ luma: opts.luma ?? tpl.luma ?? 215, sat: opts.sat ?? tpl.sat ?? 50 }));
    const frames = brightMasks(ctx.getImageData(0, 0, w, h).data, w, h, thresholds);
    // Live frames reuse the scale found earlier; a window resize or every Nth frame triggers a full search.
    const frameKey = `${fullW}x${fullH}`;
    if (lock.frameKey !== frameKey) { lock.scale = null; lock.frameKey = frameKey; lock.frames = 0; }
    const live = !data.test || opts.live; // test frames can opt in to the live lock-on path
    const useLock = live && lock.scale !== null && (lock.frames++ % FULL_SEARCH_EVERY) !== 0;
    const scales = useLock ? ALL_SCALES.filter(s => Math.abs(s - lock.scale) <= 0.1 + 1e-9) : ALL_SCALES;
    let best = { score: -1, name: null };
    templates.forEach((tpl, i) => {
      let cache = caches.get(tpl.name); if (!cache) caches.set(tpl.name, cache = new Map());
      const r = detect(frames[i], tpl, { cache, scales, exactGate: opts.exactGate ?? tpl.exactGate, minScore: opts.minScore });
      if (r.score > best.score) best = { ...r, name: tpl.label || tpl.name, boxW: tpl.width * r.scale, boxH: tpl.height * r.scale };
    });
    if (live && best.score >= LOCK_SCORE) lock.scale = best.scale;
    self.postMessage({ type: 'result', ts: data.ts, test: data.test, name: best.name, score: best.score, a: best.a, b: best.b, c: best.c, exact: best.exact,
      x: best.x / factor, y: best.y / factor, boxW: (best.boxW || 0) / factor, boxH: (best.boxH || 0) / factor,
      frameWidth: fullW, frameHeight: fullH, locked: useLock, ms: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ type: 'error', ts: data.ts, test: data.test, message: String(error) });
  } finally {
    image.close?.();
  }
};
