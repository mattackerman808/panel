#!/usr/bin/env node
// Draw the home-screen icons: a cypress with Wi-Fi arcs (network panel) and
// a cypress struck by a lightning bolt (energy kiosk). Writes
// web/static/icons/{panel,energy}.svg (browser-tab icons, rounded tiles) and
// {panel,energy}-{180,192,512}.png (full-bleed; iOS and Android mask them).
//
//   npm i --no-save puppeteer-core     # once; not a project dep
//   node docs/icons.mjs
//
// Needs a Chromium binary; set CHROMIUM if it isn't /usr/bin/chromium.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'static', 'icons');

// An Italian cypress: a tall, slim column — pointed tip, nearly straight
// sides, a slight taper at the base — whose outline is a stack of small
// scallops (foliage tufts), on a short trunk.
function profile(t) {
  // Half-width as a fraction of the maximum, tip (t=0) to base (t=1).
  if (t < 0.5) return Math.pow(t / 0.5, 0.75);
  if (t < 0.82) return 1;
  return 1 - 0.38 * Math.pow((t - 0.82) / 0.18, 1.6);
}
function cypress(tipY, baseY, halfW, tufts = 9) {
  const h = baseY - tipY;
  const pts = [];
  for (let i = 0; i <= tufts; i++) {
    const t = i / tufts;
    pts.push({ y: tipY + h * t, w: halfW * profile(t) });
  }
  const bump = halfW * 0.16;
  let d = `M256 ${tipY}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    d += ` Q${(256 + (a.w + b.w) / 2 + bump).toFixed(1)} ${((a.y + b.y) / 2).toFixed(1)} ${(256 + b.w).toFixed(1)} ${b.y.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` Q256 ${(last.y + 10).toFixed(1)} ${(256 - last.w).toFixed(1)} ${last.y.toFixed(1)}`;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i], b = pts[i - 1];
    d += ` Q${(256 - (a.w + b.w) / 2 - bump).toFixed(1)} ${((a.y + b.y) / 2).toFixed(1)} ${(256 - b.w).toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d + 'Z';
}

function tree(tipY, baseY, halfW) {
  const d = cypress(tipY, baseY, halfW);
  const h = baseY - tipY;
  // Foliage: staggered tuft strokes in a darker green, inside the outline.
  const marks = [];
  for (let i = 0; i < 7; i++) {
    const t = 0.2 + i * 0.1;
    const y = tipY + h * t;
    const dx = (i % 2 ? 0.38 : -0.3) * halfW * profile(t);
    const s = halfW * 0.3;
    marks.push(`<path d="M${(256 + dx - s).toFixed(1)} ${(y + s * 0.55).toFixed(1)} Q${(256 + dx).toFixed(1)} ${(y - s * 0.45).toFixed(1)} ${(256 + dx + s).toFixed(1)} ${(y + s * 0.55).toFixed(1)}"/>`);
  }
  return `
  <defs><linearGradient id="leaf" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3fbf86"/><stop offset="0.55" stop-color="#23935f"/><stop offset="1" stop-color="#18744b"/>
  </linearGradient></defs>
  <rect x="249" y="${baseY - 8}" width="14" height="30" rx="4" fill="#6b5038"/>
  <path d="${d}" fill="url(#leaf)"/>
  <g fill="none" stroke="#125c3c" stroke-width="${(halfW * 0.11).toFixed(1)}" stroke-linecap="round" opacity="0.55">${marks.join('')}</g>`;
}

const bg = (rounded) => `
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#16212d"/><stop offset="1" stop-color="#0a0e13"/>
  </linearGradient></defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#bg)"/>`;

// Panel: the cypress as a mast, Wi-Fi arcs radiating from its tip.
const arcs = [48, 88, 128]
  .map((r) => {
    const cx = 256, cy = 192, k = Math.SQRT1_2;
    return `<path d="M${cx - r * k} ${cy - r * k} A${r} ${r} 0 0 1 ${cx + r * k} ${cy - r * k}"/>`;
  })
  .join('');
const panel = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg(rounded)}
  ${tree(198, 446, 44)}
  <g fill="none" stroke="#5fb4ff" stroke-width="22" stroke-linecap="round">${arcs}</g>
</svg>`;

// Energy: a lightning bolt struck through the cypress.
const energy = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg(rounded)}
  ${tree(70, 452, 54)}
  <path d="M282 196 L214 314 L254 314 L234 404 L304 276 L262 276 Z"
    fill="#f5b82e" stroke="#0d131a" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>
</svg>`;

for (const [name, svg] of [['panel', panel], ['energy', energy]]) {
  writeFileSync(`${out}/${name}.svg`, svg(true)); // favicon: rounded tile
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const name of ['panel', 'energy']) {
  for (const size of [180, 192, 512]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:#0a0e13">${(name === 'panel' ? panel : energy)(false).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: `${out}/${name}-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  }
}
await browser.close();
console.log('wrote', out);
