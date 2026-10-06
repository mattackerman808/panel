#!/usr/bin/env node
// Recapture the README screenshots: every page at 1920×1080 from a running
// panel (default: the local mock-mode dev server).
//
//   npm run dev                                  # in another terminal
//   npm i --no-save puppeteer-core               # once; not a project dep
//   node docs/screenshots.mjs [baseUrl] [outDir]
//
// Needs a Chromium binary; set CHROMIUM if it isn't /usr/bin/chromium.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const out = process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
const PAGES = ['overview', 'internet', 'wired', 'wireless', 'clients', 'topology', 'power'];
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));

for (const id of PAGES) {
  // `?start=` begins the normal rotation on that page, so the page bar shows
  // every tab (unlike `?page=`, which pins and pauses).
  await page.goto(`${base}/?start=${id}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  // Let the WebSocket snapshot land, the charts draw a few frames and (for
  // the topology) elk finish its layout.
  await new Promise((r) => setTimeout(r, id === 'topology' ? 9_000 : 6_500));
  await page.screenshot({ path: join(out, `${id}.png`), type: 'png' });
  console.log('saved', join(out, `${id}.png`));
}
await browser.close();
