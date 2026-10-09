import templates from './arrival-template.js';
import { brightMask, detect, defaultScales } from './detect.js';

// The search region is downscaled to this width, so the title block is always about 100-145px wide
// regardless of the capture resolution, and only a narrow band of template scales must be tried.
const MAX_WIDTH = 560;
const SCALES = defaultScales(0.45, 1.6, 0.05);
const ROI = { w: 0.42, h: 0.45 }; // top-left fraction of the frame that can hold the title text
const caches = new Map();
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
    const frame = brightMask(ctx.getImageData(0, 0, w, h).data, w, h);
    let best = { score: -1, name: null };
    for (const tpl of templates) {
      let cache = caches.get(tpl.name); if (!cache) caches.set(tpl.name, cache = new Map());
      const r = detect(frame, tpl, { cache, scales: SCALES });
      if (r.score > best.score) best = { ...r, name: tpl.name, boxW: tpl.width * r.scale, boxH: tpl.height * r.scale };
    }
    self.postMessage({ type: 'result', ts: data.ts, test: data.test, name: best.name, score: best.score, a: best.a, b: best.b, c: best.c, exact: best.exact,
      x: best.x / factor, y: best.y / factor, boxW: (best.boxW || 0) / factor, boxH: (best.boxH || 0) / factor,
      frameWidth: fullW, frameHeight: fullH, ms: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ type: 'error', ts: data.ts, test: data.test, message: String(error) });
  } finally {
    image.close?.();
  }
};
