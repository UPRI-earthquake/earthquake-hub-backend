// End-to-end check, frontend (Phase 4 - Part 1). Each test visits a page or drives a flow, then
// records what the page shows: its visible text (normalized) and a screenshot, plus console errors and
// failed requests. The two runs (MongoDB, PostgreSQL) are compared by scripts/e2e/compare-frontend.js.
//
// Every request that isn't to localhost is blocked (analytics, map tiles, outside services), so
// nothing reaches production, and the two runs see the same outside world (map tiles stay blank). Personal data shown on a
// page (usernames, emails) is blanked in the DOM before each screenshot.
const fs = require('fs');
const path = require('path');
const { test: base } = require('@playwright/test');

const OUTPUT = process.env.E2E_OUTPUT_DIR || path.join(__dirname, '..', '..', '..', '..', 'e2e-output');
const RUN = process.env.E2E_RUN || 'run';
const samples = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'sample-accounts.json'), 'utf8'));
const sample = (kind) => samples.accounts.find((s) => s.kind === kind && s.found);

const test = base.extend({ backendURL: ['', { option: true }] });

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//;
// Known failures that are the same on both backends: the removed endpoints, and the sensor feeds and
// outside services the test environment can't reach (blocked here)
const EXPECTED_FAILURES = [/\/significant-eqs/, /\/notifications\/subscribe/, /localhost:9\//];

let personal = new Set(Object.values(samples.accounts).map((s) => s.username).filter(Boolean));

test.beforeEach(async ({ context, page, backendURL }, testInfo) => {
  await context.route((url) => !LOCAL.test(url.href), (route) => route.abort());
  testInfo.consoleErrors = [];
  testInfo.failedRequests = [];
  page.on('console', (msg) => { if (msg.type() === 'error') testInfo.consoleErrors.push(msg.text().slice(0, 300)); });
  page.on('requestfailed', (req) => {
    if (LOCAL.test(req.url()) && !EXPECTED_FAILURES.some((re) => re.test(req.url()))) testInfo.failedRequests.push(`${req.method()} ${req.url()}`);
  });
  page.on('response', (res) => {
    if (LOCAL.test(res.url()) && res.status() >= 500) testInfo.failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  // Commenters' usernames are personal data too
  const list = await (await fetch(`${backendURL}/eq-events?startTime=1970-01-01T00:00:00.000Z&endTime=2100-01-01T00:00:00.000Z`)).json();
  testInfo.events = list.payload || [];
});

// --- Recording ---

// Times that depend on when the run happened: relative ones, and dates within 30 minutes of now
const RECENT_DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4},? \d{1,2}:\d{2}(:\d{2})? ?(AM|PM)\b/g;
const normalize = (text) => text
  .replace(/\b(\d+|an?|a few)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi, '<ago>')
  .replace(/\bjust now\b/gi, '<ago>')
  .replace(RECENT_DATE, (date) => (Math.abs(Date.parse(date.replace(',', '')) - Date.now()) < 30 * 60 * 1000 ? '<now>' : date))
  .replace(/[ \t]+/g, ' ')
  .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

async function blankPersonal(page) {
  await page.evaluate((strings) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const emails = /[\w.+-]+@[\w-]+\.[\w.]+/g;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue;
      strings.forEach((s) => { if (s && text.includes(s)) text = text.split(s).join('████'); });
      text = text.replace(emails, '████@████');
      if (text !== node.nodeValue) node.nodeValue = text;
    }
    document.querySelectorAll('input').forEach((input) => {
      if (input.type === 'email' || strings.includes(input.value)) input.value = '████';
    });
    // A reporter's avatar shows their username's initials
    document.querySelectorAll('.report-author-avatar').forEach((avatar) => {
      if (!avatar.classList.contains('report-author-avatar-anonymous')) avatar.textContent = '•';
    });
  }, [...personal]);
}

// The live feed (SSE) keeps a request open, so "network idle" never comes: wait for the page to load,
// then let its data requests settle
const settle = async (page, ms = 3000) => {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(ms);
};

async function record(page, testInfo, name) {
  await settle(page);
  await blankPersonal(page);
  const text = normalize(await page.locator('body').innerText());
  const dir = path.join(OUTPUT, 'frontend', testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  // From the top, nothing focused: a full-page screenshot draws the fixed header where the page was
  // scrolled to, and a focused element can show the "Skip to content" link
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
    // No mask: map tiles are blocked (so the map is blank on both runs), and personal text is blanked
    animations: 'disabled',
  });
  // A smaller copy for docs/e2e/E2E_RESULTS.md
  await page.screenshot({ path: path.join(dir, `${name}.jpg`), fullPage: true, type: 'jpeg', quality: 60, animations: 'disabled' });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify({
    url: page.url().replace(/localhost:310\d/, 'localhost:<port>'),
    text,
    consoleErrors: testInfo.consoleErrors.map((e) => e.replace(/localhost:310\d/g, 'localhost:<port>')),
    failedRequests: testInfo.failedRequests.map((r) => r.replace(/localhost:5?10\d/g, 'localhost:<port>')),
  }, null, 2)}\n`);
}

// --- Picking the same events on both runs (the lists are identical) ---

// Production's events only: not the one scripts/e2e/compare-writes.js adds (publicID e2e...)
const pick = (all) => {
  const events = all.filter((e) => !/^e2e/.test(e.publicID));
  return {
    withMatches: events.find((e) => ['phivolcs', 'usgs'].every((s) => (e.additionalInformation || []).some((m) => m.source === s))),
    withSummary: events.find((e) => e.summaryOverride && e.summaryOverride.text),
    legacy: events.find((e) => e.isLegacyRecord),
    // No usable place name: the page falls back to other fields for its title
    noPlace: events.find((e) => !e.place || ['', 'Unavailable', 'Unable to geocode'].includes(e.place)),
  };
};

async function eventWithReports(backendURL, events) {
  for (const event of events) {
    const res = await (await fetch(`${backendURL}/comments?eventId=${event._id}&limit=20`)).json();
    if ((res.payload || []).length > 0) {
      res.payload.forEach((c) => { if (c.username && c.username !== 'Anonymous') personal.add(c.username); });
      return event;
    }
  }
  return null;
}

async function signIn(page, kind) {
  const account = sample(kind);
  await page.getByRole('button', { name: 'Contributor account' }).first().click();
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.locator('input[name="identifier"]').fill(account.username);
  await page.locator('input[name="password"]').first().fill(samples.password);
  await page.locator('select[name="role"]').first().selectOption(kind === 'brgy' ? 'brgy' : 'citizen');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await settle(page, 2000);
}

// Signing in opens the dashboard over the page: close it to use the page underneath
async function closeDashboard(page) {
  const close = page.getByRole('button', { name: 'Close dashboard' });
  if (await close.count()) {
    await close.first().click();
    await page.waitForTimeout(500);
  }
}

// --- Pages ---

test('home: map and events panel', async ({ page }, testInfo) => {
  await page.goto('/');
  // The map's controls and legend render after its data: wait for them
  await page.getByText('Legend').first().waitFor({ timeout: 30_000 }).catch(() => {});
  await record(page, testInfo, 'home');
});

for (const kind of ['withMatches', 'withSummary', 'legacy', 'noPlace']) {
  test(`earthquake detail: ${kind}`, async ({ page }, testInfo) => {
    const event = pick(testInfo.events)[kind];
    test.skip(!event, `no ${kind} event in the data`);
    await page.goto(`/earthquake-detail?id=${encodeURIComponent(event.publicID)}`);
    await record(page, testInfo, `detail-${kind}`);
  });
}

test('earthquake detail: an event with reports', async ({ page, backendURL }, testInfo) => {
  const event = await eventWithReports(backendURL, testInfo.events);
  test.skip(!event, 'no event with reports in the data');
  await page.goto(`/earthquake-detail?id=${encodeURIComponent(event.publicID)}`);
  await record(page, testInfo, 'detail-withReports');
});

test('removed feature: the significant earthquakes page', async ({ page }, testInfo) => {
  await page.goto('/significant-eqs');
  await record(page, testInfo, 'significant-eqs');
});

test('reset password page (an invalid link)', async ({ page }, testInfo) => {
  await page.goto('/reset-password?token=e2e-invalid-token');
  await record(page, testInfo, 'reset-password');
});

// --- Accounts and dashboards ---

for (const kind of ['citizen', 'sensorOwner', 'brgy']) {
  test(`signed in as a ${kind}: dashboard`, async ({ page }, testInfo) => {
    test.skip(!sample(kind), `no ${kind} sample account`);
    await page.goto('/');
    // Signing in opens the dashboard (devices, or the brgy's forwarded sensors)
    await signIn(page, kind);
    await record(page, testInfo, `dashboard-${kind}`);
    // Then the profile and alert preferences
    const settings = page.getByText('Account settings', { exact: true });
    if (await settings.count()) {
      await settings.first().click();
      await record(page, testInfo, `account-settings-${kind}`);
    }
  });
}

test('register a new account, then sign out', async ({ page }, testInfo) => {
  const username = `e2e_ui_${RUN}`;
  personal.add(username);
  await page.goto('/');
  await page.getByRole('button', { name: 'Contributor account' }).first().click();
  await page.getByRole('tab', { name: 'Register' }).click();
  await page.locator('input[name="email"]').fill(`e2e.ui.${RUN}@example.org`);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').last().fill('E2e-Ui-Password-2026!');
  await page.locator('input[name="confirmPassword"]').fill('E2e-Ui-Password-2026!');
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await page.waitForTimeout(1500);
  await record(page, testInfo, 'register');
  const signOut = page.getByText('Sign out', { exact: true });
  if (await signOut.count()) {
    await signOut.first().click();
    await record(page, testInfo, 'sign-out');
  }
});

// --- Reports ---

test('post a report as a citizen, then mark it helpful as another account', async ({ page, backendURL }, testInfo) => {
  const event = pick(testInfo.events).withMatches;
  await page.goto(`/earthquake-detail?id=${encodeURIComponent(event.publicID)}`);
  await signIn(page, 'citizen');
  await closeDashboard(page);
  await page.getByText('Post a Report', { exact: true }).first().click();
  await page.locator('textarea').first().fill(`E2E UI report ${RUN}`);
  await page.locator('form').filter({ has: page.locator('textarea') }).locator('button[type="submit"]').click();
  await page.waitForTimeout(2000);
  await record(page, testInfo, 'report-posted');

  await page.context().clearCookies();
  await page.goto(`/earthquake-detail?id=${encodeURIComponent(event.publicID)}`);
  await signIn(page, 'sensorOwner');
  await closeDashboard(page);
  const helpful = page.locator('.report-helpful-button').first();
  if (await helpful.count()) {
    await helpful.click();
    await page.waitForTimeout(1500);
  }
  await record(page, testInfo, 'report-marked-helpful');
});
