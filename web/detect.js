// Arrival-screen detector: finds the "도시 / 입항 중입니다." text block in a frame.
// Works on binary "bright" masks so it is independent of the background art.
// Pure functions only, so the same code runs in the worker and in Node tests.

export function decodeRle(runs, width, height) {
  const out = new Uint8Array(width * height);
  let pos = 0, value = 0;
  for (const run of runs) {
    if (value) out.fill(1, pos, pos + run);
    pos += run; value ^= 1;
  }
  return out;
}

// Luma > 215 and low saturation = white UI text. `dil` marks bright pixels and their 4-neighbours
// (1px tolerance for scale rounding without rewarding dense noise).
export function brightMask(rgba, width, height, luma = 215, sat = 50) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const l = (r * 299 + g * 587 + b * 114) / 1000;
    const s = Math.max(r, g, b) - Math.min(r, g, b);
    if (l > luma && s < sat) mask[i] = 1;
  }
  return { mask, dil: dilate(mask, width, height), width, height };
}

export function dilate(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    out[y * width + x] = 1;
    if (x > 0) out[y * width + x - 1] = 1;
    if (x + 1 < width) out[y * width + x + 1] = 1;
    if (y > 0) out[(y - 1) * width + x] = 1;
    if (y + 1 < height) out[(y + 1) * width + x] = 1;
  }
  return out;
}

function integral(mask, width, height) {
  const W = width + 1, sum = new Uint32Array(W * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += mask[(y - 1) * width + (x - 1)];
      sum[y * W + x] = sum[(y - 1) * W + x] + row;
    }
  }
  return (x, y, w, h) => sum[(y + h) * W + x + w] - sum[y * W + x + w] - sum[(y + h) * W + x] + sum[y * W + x];
}

// Nearest-neighbour scaling of the template masks to pixel-offset lists.
export function scaleTemplate(tpl, scale) {
  const w = Math.max(1, Math.round(tpl.width * scale)), h = Math.max(1, Math.round(tpl.height * scale));
  const text = tpl.textMask || (tpl.textMask = decodeRle(tpl.text, tpl.width, tpl.height));
  const ring = tpl.ringMask || (tpl.ringMask = decodeRle(tpl.ring, tpl.width, tpl.height));
  const textPts = [], ringPts = [], otherPts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(tpl.width - 1, Math.floor((x + 0.5) / scale)), sy = Math.min(tpl.height - 1, Math.floor((y + 0.5) / scale));
    const i = sy * tpl.width + sx;
    if (text[i]) textPts.push(x, y); else if (ring[i]) ringPts.push(x, y); else otherPts.push(x, y);
  }
  const pick = (pts, count) => {
    const out = [], stride = Math.max(1, Math.floor(pts.length / 2 / count));
    for (let i = 0; i < pts.length; i += stride * 2) out.push(pts[i], pts[i + 1]);
    return out;
  };
  return { scale, w, h, textPts, ringPts, other: pick(otherPts, 1200), sample: pick(textPts, 96), ringSample: pick(ringPts, 96) };
}

// a: text pixels bright (1px tolerance), exact: text pixels bright with no tolerance,
// b: shadow ring bright, c: remaining box pixels bright. Big white glyphs that merely
// overlap the text leave extra strokes in the box, which c and exact penalise.
function scoreAt(frame, st, x, y) {
  const { dil, mask, width } = frame;
  let a = 0, exact = 0, b = 0, c = 0;
  for (let i = 0; i < st.textPts.length; i += 2) { const p = (y + st.textPts[i + 1]) * width + x + st.textPts[i]; a += dil[p]; exact += mask[p]; }
  for (let i = 0; i < st.ringPts.length; i += 2) b += mask[(y + st.ringPts[i + 1]) * width + x + st.ringPts[i]];
  for (let i = 0; i < st.other.length; i += 2) c += mask[(y + st.other[i + 1]) * width + x + st.other[i]];
  a /= st.textPts.length / 2; exact /= st.textPts.length / 2; b /= st.ringPts.length / 2; c /= st.other.length / 2;
  let score = a - b - c;
  if (exact < st.exactGate) score = Math.min(score, exact);
  return { score, a, b, c, exact };
}

export function defaultScales(min = 0.5, max = 2.2, step = 0.05) {
  const list = [];
  for (let s = min; s <= max + 1e-9; s += step) list.push(Math.round(s * 1000) / 1000);
  return list;
}

// frame: {mask, dil, width, height}. Returns the best match in the frame.
export function detect(frame, tpl, options = {}) {
  const { width, height } = frame;
  const scales = options.scales || defaultScales();
  const step = options.step || 2;
  const minA = options.minA ?? 0.7;
  const minScore = options.minScore ?? 0.5; // sampled (text - ring) estimate needed before a full evaluation
  const exactGate = options.exactGate ?? 0.5; // below this, exact-position coverage caps the score
  const cache = options.cache || (options.cache = new Map());
  const area = integral(frame.dil, width, height);
  let best = { score: -1, a: 0, b: 0, c: 0, exact: 0, x: 0, y: 0, scale: 1 };
  const consider = (st, x, y) => {
    const r = scoreAt(frame, st, x, y);
    if (r.score > best.score) best = { ...r, x, y, scale: st.scale };
  };
  for (const scale of scales) {
    let st = cache.get(scale); if (!st) cache.set(scale, st = scaleTemplate(tpl, scale));
    st.exactGate = exactGate;
    if (st.w > width || st.h > height) continue;
    const need = minA * st.textPts.length / 2, sampleNeed = minA * st.sample.length / 2;
    for (let y = 0; y + st.h <= height; y += step) for (let x = 0; x + st.w <= width; x += step) {
      if (area(x, y, st.w, st.h) < need) continue;
      let hit = 0;
      for (let i = 0; i < st.sample.length; i += 2) hit += frame.dil[(y + st.sample[i + 1]) * width + x + st.sample[i]];
      if (hit < sampleNeed) continue;
      let ringHit = 0;
      for (let i = 0; i < st.ringSample.length; i += 2) ringHit += frame.mask[(y + st.ringSample[i + 1]) * width + x + st.ringSample[i]];
      if (hit / (st.sample.length / 2) - ringHit / (st.ringSample.length / 2) < minScore) continue;
      consider(st, x, y);
    }
  }
  if (best.score < 0) return best;
  // Refine around the best candidate with 1px steps and finer scales.
  const coarse = best;
  for (const scale of [coarse.scale - 0.025, coarse.scale, coarse.scale + 0.025]) {
    const st = scaleTemplate(tpl, scale); st.exactGate = exactGate;
    if (st.w > width || st.h > height) continue;
    for (let y = Math.max(0, coarse.y - 2); y <= Math.min(height - st.h, coarse.y + 2); y++)
      for (let x = Math.max(0, coarse.x - 2); x <= Math.min(width - st.w, coarse.x + 2); x++) consider(st, x, y);
  }
  return best;
}
