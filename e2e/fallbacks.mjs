/**
 * Checks reduced-motion behaviour, the skip link and the no-WebGL fallback on the homepage.
 *   npm i --no-save puppeteer && node e2e/fallbacks.mjs   (web served at E2E_BASE)
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:4173';
let puppeteer;
let exe;
let baseArgs = [];
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  const chromium = (await import('@sparticuz/chromium')).default;
  puppeteer = (await import('puppeteer-core')).default;
  exe = await chromium.executablePath();
  baseArgs = chromium.args;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 1) Reduced motion
let b = await puppeteer.launch({ executablePath: exe, args: [...baseArgs, '--enable-unsafe-swiftshader'], headless: true });
let p = await b.newPage(); await p.setViewport({ width: 1280, height: 860 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await p.goto(BASE + '/', { waitUntil: 'load' }); await wait(2500);
const rm = await p.evaluate(() => ({
  lenis: document.documentElement.classList.contains('lenis'),
  hiddenHeadings: [...document.querySelectorAll('h2')].filter((h) => getComputedStyle(h.closest('[style]') ?? h).opacity === '0').length,
  h2: document.querySelectorAll('h2').length,
}));
console.log('reduced motion:', JSON.stringify(rm));
// keyboard: tab to skip link and first links
await p.keyboard.press('Tab');
console.log('first tab focus:', await p.evaluate(() => document.activeElement?.textContent?.trim()));
const normal = await b.newPage(); await normal.goto(BASE + '/', { waitUntil: 'load' }); await wait(1500);
console.log('lenis active normally:', await normal.evaluate(() => document.documentElement.classList.contains('lenis')));
await b.close();
// 2) No WebGL
b = await puppeteer.launch({ executablePath: exe, args: [...baseArgs, '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'], headless: true });
p = await b.newPage(); await p.setViewport({ width: 1280, height: 860 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '/', { waitUntil: 'load' }); await wait(2500);
console.log('no-webgl: cloud fallback shown:', await p.evaluate(() => Boolean(document.querySelector('[data-testid=cloud-fallback]'))), 'canvases:', await p.evaluate(() => document.querySelectorAll('canvas').length), 'page errors:', errs.length);
await b.close();
