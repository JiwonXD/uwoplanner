import test from 'node:test';
import assert from 'node:assert/strict';
import templates from '../web/arrival-template.js';
const template = templates.find(t => t.name === '도시');
import { decodeRle, detect, scaleTemplate, dilate, brightMask } from '../web/detect.js';

function frameWithTemplate({ width, height, scale, x, y, noise = 0, seed = 1 }) {
  const mask = new Uint8Array(width * height);
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < noise; i++) mask[Math.floor(rand() * mask.length)] = 1;
  const st = scaleTemplate(template, scale);
  for (let i = 0; i < st.textPts.length; i += 2) mask[(y + st.textPts[i + 1]) * width + x + st.textPts[i]] = 1;
  for (let i = 0; i < st.ringPts.length; i += 2) mask[(y + st.ringPts[i + 1]) * width + x + st.ringPts[i]] = 0;
  return { mask, dil: dilate(mask, width, height), width, height };
}

test('template decodes to the recorded pixel counts', () => {
  assert.ok(template, 'city template present');
  const text = decodeRle(template.text, template.width, template.height);
  const ring = decodeRle(template.ring, template.width, template.height);
  assert.equal(text.reduce((a, b) => a + b, 0), template.textCount);
  assert.equal(ring.reduce((a, b) => a + b, 0), template.ringCount);
  assert.ok(template.textCount > 500 && template.ringCount > template.textCount);
});

test('finds the text block at its true scale and position despite noise', () => {
  for (const [scale, x, y] of [[1, 26, 56], [0.75, 20, 42], [1.5, 40, 86]]) {
    const frame = frameWithTemplate({ width: 520, height: 350, scale, x, y, noise: 6000 });
    const r = detect(frame, template);
    assert.ok(r.score > 0.85, `scale ${scale}: score ${r.score}`);
    assert.ok(Math.abs(r.scale - scale) <= 0.051, `scale ${scale}: found ${r.scale}`);
    assert.ok(Math.abs(r.x - x) <= 2 && Math.abs(r.y - y) <= 2, `scale ${scale}: found at ${r.x},${r.y}`);
  }
});

test('noise, solid white and empty frames stay well below the alert threshold', () => {
  const width = 400, height = 260;
  const empty = { mask: new Uint8Array(width * height), dil: new Uint8Array(width * height), width, height };
  assert.ok(detect(empty, template).score < 0.75);
  const solid = { mask: new Uint8Array(width * height).fill(1), width, height };
  solid.dil = solid.mask;
  assert.ok(detect(solid, template).score < 0.3);
  for (const noise of [8000, 20000, 35000]) {
    const noisy = frameWithTemplate({ width, height, scale: 1, x: 0, y: 0, noise, seed: noise });
    noisy.mask.fill(0, 0, 100 * width); noisy.dil = dilate(noisy.mask, width, height);
    const r = detect(noisy, template);
    assert.ok(r.score < 0.72, `noise ${noise}: score ${r.score}`);
  }
});

test('brightMask keeps white text and drops coloured or dark pixels', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 250, 240, 200, 255, 60, 60, 60, 255, 230, 230, 230, 255]);
  const { mask } = brightMask(rgba, 4, 1);
  assert.deepEqual([...mask], [1, 0, 0, 1]);
});
