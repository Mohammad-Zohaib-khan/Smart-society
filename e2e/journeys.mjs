/**
 * End-to-end smoke journeys through the real UI, one per role.
 *
 * Prerequisites: API + web running with the DEMO seed freshly applied (`npm run seed -- --reset`),
 * API started with RATE_LIMIT_DISABLED=true (the journeys sign in ~20 times), web served at E2E_BASE
 * (default http://localhost:4173 via `npm run preview -w apps/web`).
 *   npm i --no-save puppeteer && node e2e/journeys.mjs
 * In the build sandbox this ran with puppeteer-core + @sparticuz/chromium (SwiftShader WebGL).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:4173';
const outDir = process.env.E2E_SHOTS ?? 'e2e/screenshots';
let browser;
try {
  const { default: puppeteer } = await import('puppeteer');
  browser = await puppeteer.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
} catch {
  const { default: chromium } = await import('@sparticuz/chromium');
  const { default: puppeteer } = await import('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--enable-unsafe-swiftshader'], headless: true });
}
const fs0 = await import('node:fs');
fs0.mkdirSync(outDir, { recursive: true });
const p = await browser.newPage();
await p.setViewport({ width: 1280, height: 860 });
const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(`console ${m.text()}`); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`); await p.screenshot({ path: `${outDir}/fail-${name.replace(/\W+/g, '_')}.png` }); } };
const clickText = async (text, sel = 'button, a') => {
  const ok = await p.evaluate((t, s) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t && !e.disabled); if (el) { el.click(); return true; } return false; }, text, sel);
  if (!ok) throw new Error(`no clickable "${text}"`);
  await wait(500);
};
const hasText = async (text, timeout = 6000) => { await p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text); };
const fill = async (label, value) => {
  const id = await p.evaluate((l) => { const lab = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(l)); return lab?.getAttribute('for'); }, label);
  if (!id) throw new Error(`no field "${label}"`);
  await p.click(`[id="${id}"]`, { clickCount: 3 }); await p.keyboard.press('Backspace');
  await p.type(`[id="${id}"]`, value);
};
const login = async (who) => {
  const c = await p.createCDPSession(); await c.send('Network.clearBrowserCookies');
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', `${who}@demo.smartsociety.invalid`);
  await p.type('input[type=password]', 'demo-pass-2026');
  await p.click('button[type=submit]');
  await p.waitForFunction(() => location.pathname.startsWith('/app'), { timeout: 8000 });
  await wait(800);
};
let code = '';
await step('wrong password shows an error', async () => {
  const c = await p.createCDPSession(); await c.send('Network.clearBrowserCookies');
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await p.type('input[type=email]', 'resident@demo.smartsociety.invalid'); await p.type('input[type=password]', 'nope');
  await p.click('button[type=submit]'); await hasText('Email or password is incorrect');
});
await step('resident creates a visitor pass', async () => {
  await login('resident');
  await p.goto(`${BASE}/app/visitors?new=1`, { waitUntil: 'networkidle2' }); await wait(600);
  await fill('Visitor name', 'E2E Visitor');
  await clickText('Create pass'); await hasText('Pass ready');
  code = await p.evaluate(() => document.querySelector('[role=dialog] [aria-label^="Pass code"]')?.textContent?.trim() ?? '');
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error(`bad code ${code}`);
  await p.screenshot({ path: `${outDir}/e2e-pass.png` });
});
await step('guard verifies and checks in the pass', async () => {
  await login('guard');
  if (!(await p.evaluate(() => location.pathname === '/app/gate'))) throw new Error('guard not routed to gate');
  await p.waitForSelector('#pass-code'); await wait(500); await p.type('#pass-code', code); await clickText('Check pass'); await hasText('Valid pass');
  await p.evaluate(() => { const card = document.querySelector('[aria-live=polite] button'); card?.click(); }); await hasText('E2E Visitor checked in');
});
await step('guard checks the visitor out', async () => {
  await p.reload({ waitUntil: 'networkidle2' }); await wait(800);
  const ok = await p.evaluate(() => { const li = [...document.querySelectorAll('li')].find((l) => l.innerText.includes('E2E Visitor')); const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.includes('Check out')); b?.click(); return Boolean(b); });
  if (!ok) throw new Error('no check-out button'); await hasText('E2E Visitor checked out');
});
await step('guard registers a walk-in, resident approves from the overview', async () => {
  await clickText('Register walk-in'); await wait(400);
  await fill('Visitor name', 'E2E Courier');
  await p.type('input[aria-label="Search homes"]', 'W-302'); await wait(900);
  await clickText('W-302', 'button[role=radio]');
  await clickText('Ask resident to approve'); await hasText('asked to approve');
  await login('resident');
  await hasText('Someone is at the gate for you');
  await clickText('Let them in'); await hasText('Approved');
});
await step('resident reports a complaint and sees its page', async () => {
  await p.goto(`${BASE}/app/complaints?new=1`, { waitUntil: 'networkidle2' }); await wait(600);
  await fill('What’s wrong?', 'E2E kitchen tap leaking');
  await fill('Details', 'The kitchen tap drips all night long.');
  const catId = await p.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Category')?.getAttribute('for'));
  await p.select(`[id="${catId}"]`, 'Plumbing');
  await clickText('Submit complaint');
  await p.waitForFunction(() => /\/app\/complaints\/[a-f0-9]{24}/.test(location.pathname), { timeout: 8000 });
  await hasText('E2E kitchen tap leaking');
});
await step('admin assigns the complaint to staff', async () => {
  const url = p.url();
  await login('admin'); await p.goto(url, { waitUntil: 'networkidle2' }); await wait(700);
  const id = await p.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Staff member')?.getAttribute('for'));
  const val = await p.evaluate((i) => document.getElementById(i).options[1].value, id);
  await p.select(`[id="${id}"]`, val);
  await clickText('Assign'); await hasText('Assigned to');
});
await step('resident books an amenity slot', async () => {
  await login('resident4');
  await p.goto(`${BASE}/app/amenities`, { waitUntil: 'networkidle2' }); await wait(800);
  await p.evaluate(() => [...document.querySelectorAll('button[role=radio]')].find((b) => b.innerText.startsWith('Clubhouse Hall'))?.click()); await wait(600);
  await p.evaluate(() => [...document.querySelectorAll('[role=radiogroup][aria-label=Day] button')][2].click()); await wait(1000);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('free') && !x.disabled); b?.click(); });
  await wait(400); await clickText('Confirm booking'); await hasText('booked for');
});
await step('admin publishes a notice', async () => {
  await login('admin');
  await p.goto(`${BASE}/app/announcements?new=1`, { waitUntil: 'networkidle2' }); await wait(700);
  await fill('Title', 'E2E lift maintenance');
  await fill('Message', 'Lift B is under maintenance on Sunday morning.');
  await clickText('Publish now'); await hasText('Published');
});

await step('staff starts and resolves the assigned work order with a photo', async () => {
  await login('staff2');
  await p.goto(`${BASE}/app/complaints?assignee=me`, { waitUntil: 'networkidle2' }); await wait(700);
  await p.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.innerText.includes('E2E kitchen tap leaking'))?.click());
  await hasText('History');
  await clickText('Start work'); await clickText('Start work', '[role=dialog] button'); await hasText('is now in progress');
  const input = await p.$('#evidence');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
  const fs = await import('node:fs'); fs.writeFileSync(`${outDir}/fixed.png`, png);
  await input.uploadFile(`${outDir}/fixed.png`); await hasText('Completion');
  await clickText('Mark resolved'); await p.type('[role=dialog] textarea', 'Replaced the washer.');
  await clickText('Mark resolved', '[role=dialog] button'); await hasText('is now resolved');
  await p.screenshot({ path: `${outDir}/e2e-complaint.png`, fullPage: true });
});
await step('admin invites a resident who accepts the link and lands in the app', async () => {
  await login('admin');
  await p.goto(`${BASE}/app/members`, { waitUntil: 'networkidle2' }); await wait(600);
  await clickText('Invite a member'); await fill('Name', 'E2E Newcomer'); await fill('Email', 'e2e.newcomer@example.com');
  await p.type('input[aria-label="Filter homes"]', 'C-10'); await wait(900);
  const sel = await p.$('select[aria-label="Home"]');
  const val = await p.evaluate((s) => s.options[1].value, sel); await p.select('select[aria-label="Home"]', val);
  await clickText('Create invitation'); await hasText('Invitation created');
  const link = await p.$eval('input[aria-label="Invitation link"]', (i) => i.value);
  const c = await p.createCDPSession(); await c.send('Network.clearBrowserCookies');
  await p.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle2' }); await hasText('Join Willow Grove');
  await fill('Choose a password', 'newcomer-pass-42');
  await clickText('Accept and continue');
  await p.waitForFunction(() => location.pathname === '/app', { timeout: 8000 }); await hasText('Good');
});
await step('mobile: admin overview and navigation drawer', async () => {
  await p.setViewport({ width: 390, height: 844 });
  await login('admin');
  await p.goto(`${BASE}/app`, { waitUntil: 'networkidle2' }); await wait(800);
  await p.screenshot({ path: `${outDir}/mobile-admin.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw new Error('horizontal overflow');
  await p.click('button[aria-label="Open navigation"]'); await wait(500);
  await p.screenshot({ path: `${outDir}/mobile-drawer.png` });
  await clickText('Complaints', 'a'); await hasText('Everything reported');
});
await step('mobile: gate desk', async () => {
  await login('guard'); await wait(500);
  await p.screenshot({ path: `${outDir}/mobile-gate.png`, fullPage: true });
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('horizontal overflow');
});
await step('dark theme app screen', async () => {
  await p.setViewport({ width: 1280, height: 860 });
  await login('admin');
  await p.click('button[aria-label="Switch to dark theme"]'); await wait(600);
  await p.goto(`${BASE}/app/complaints`, { waitUntil: 'networkidle2' }); await wait(700);
  await p.screenshot({ path: `${outDir}/dark-complaints.png` });
});
console.log(results.join('\n'));
console.log(errors.length ? 'Console errors:\n' + errors.join('\n') : 'No unexpected console errors');
await browser.close();
