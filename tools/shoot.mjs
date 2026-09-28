// Screenshot LuCI pages on the real router as the read-only `nacre-preview` user.
//
// Security (see plan S0 gate): the password is read from the login Keychain
// straight into memory (never env/argv/files); no tracing, HAR, video or
// storageState; the filled login form is never screenshotted. Output goes to
// shots/ which is gitignored because it shows production router data.
//
// Usage: node tools/shoot.mjs [label]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const HOST = process.env.ROUTER_HOST ?? '192.168.123.1';
const BASE = `https://${HOST}/cgi-bin/luci`;
const KC = `${homedir()}/Library/Keychains/login.keychain-db`;
const label = process.argv[2] ?? 'run';

const PAGES = [
	['overview', 'admin/status/overview'],
	['firewall-status', 'admin/status/nftables'],
	['syslog', 'admin/status/logs'],
	['realtime', 'admin/status/realtime'],
	['interfaces', 'admin/network/network'],
	['dhcp', 'admin/network/dhcp'],
	['firewall', 'admin/network/firewall'],
	['system', 'admin/system/system'],
	['software', 'admin/system/package-manager'],
	['vnstat', 'admin/status/vnstat2'],
	['statistics', 'admin/statistics/graphs'],
	['nacre', 'admin/system/nacre'],
];

const MODES = [
	['light', { viewport: { width: 1440, height: 900 }, colorScheme: 'light' }],
	['dark', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }],
	['mobile', { viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true }],
];

const password = execFileSync('/usr/bin/security',
	['find-generic-password', '-s', 'nacre-preview', '-w', KC], { encoding: 'utf8' }).trimEnd();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { label, pages: {} };

try {
	for (const [mode, opts] of MODES) {
		const dir = `shots/${label}/${mode}`;
		mkdirSync(dir, { recursive: true });
		const ctx = await browser.newContext({ ...opts, ignoreHTTPSErrors: true, locale: 'zh-TW' });
		const page = await ctx.newPage();
		const errors = [];
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
		page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));

		await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
		await page.screenshot({ path: `${dir}/login.png`, fullPage: true });

		await page.fill('input[name="luci_username"]', 'nacre-preview');
		await page.fill('input[name="luci_password"]', password);
		// waitForLoadState resolves at once (the login page is already idle); wait for the POST navigation.
		await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.keyboard.press('Enter')]);
		if (await page.locator('input[name="luci_password"]').count())
			throw new Error(`${mode}: login failed`);

		for (const [name, path] of PAGES) {
			const resp = await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle' });
			await page.waitForTimeout(800);
			await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
			report.pages[`${mode}/${name}`] = resp?.status();
		}

		const toggle = page.locator('#nacre-menu-toggle');
		if (mode === 'mobile' && await toggle.isVisible()) {
			await toggle.click();
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${dir}/drawer.png` });
			report[`${mode}/drawer_expanded`] = await toggle.getAttribute('aria-expanded');
			await page.keyboard.press('Escape');
		}

		await page.goto(`${BASE}/admin/logout`, { waitUntil: 'networkidle' });
		report[`${mode}/logout_back_to_login`] = (await page.locator('input[name="luci_password"]').count()) > 0;
		report[`${mode}/console_errors`] = errors;
		await ctx.close();
	}
} finally {
	await browser.close();
}

writeFileSync(`shots/${label}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
