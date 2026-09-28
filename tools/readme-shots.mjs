// README screenshots from the real router, at a MacBook Air 13" screen
// (1470x956 @2x), as the read-only `nacre-preview` user (see shoot.mjs for the
// credential rules). Public addresses are rewritten to documentation ranges
// and DHCP lease tables are removed in the page before each shot; every image
// still gets a human look before it is committed.
//
// Usage: node tools/readme-shots.mjs   -> assets/screenshots/*.png
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const HOST = process.env.ROUTER_HOST ?? '192.168.123.1';
const BASE = `https://${HOST}/cgi-bin/luci`;
const KC = `${homedir()}/Library/Keychains/login.keychain-db`;
const OUT = 'assets/screenshots';
const SCREEN = { viewport: { width: 1470, height: 956 }, deviceScaleFactor: 2 };
// The traffic chart needs some samples before it is worth showing.
const CHART_WAIT_MS = 45000;

const password = execFileSync('/usr/bin/security',
	['find-generic-password', '-s', 'nacre-preview', '-w', KC], { encoding: 'utf8' }).trimEnd();

// Runs in the page; re-applied on every DOM change because LuCI polls.
function redact() {
	const priv = /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
	const fix = (s) => s
		.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, (ip) => priv.test(ip) ? ip : `203.0.113.${ip.split('.')[3]}`)
		.replace(/\b[23][0-9a-f]{3}(:[0-9a-f]{1,4}){2}(?=:)/gi, '2001:db8:1')
		.replace(/\bfe80::[0-9a-f:]+/gi, 'fe80::1')
		.replace(/\b([0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, '00:00:5e:00:53:01');
	const walk = () => {
		for (const h of document.querySelectorAll('h3, h4'))
			if (/DHCP/.test(h.textContent)) (h.closest('.cbi-section, [data-tab]') ?? h.parentElement).style.display = 'none';
		const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let n; (n = it.nextNode());) { const t = fix(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
	};
	walk();
	new MutationObserver(walk).observe(document.body, { subtree: true, childList: true, characterData: true });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
	for (const scheme of ['light', 'dark']) {
		const ctx = await browser.newContext({ ...SCREEN, colorScheme: scheme, ignoreHTTPSErrors: true, locale: 'zh-TW' });
		await ctx.addInitScript(`addEventListener('DOMContentLoaded', ${redact})`);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
		await page.screenshot({ path: `${OUT}/login-${scheme}.png` });

		await page.fill('input[name="luci_username"]', 'nacre-preview');
		await page.fill('input[name="luci_password"]', password);
		await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.keyboard.press('Enter')]);
		if (await page.locator('input[name="luci_password"]').count()) throw new Error('login failed');

		await page.goto(`${BASE}/admin/status/overview`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(CHART_WAIT_MS);
		await page.screenshot({ path: `${OUT}/overview-${scheme}.png` });

		if (scheme === 'light') {
			await page.goto(`${BASE}/admin/system/nacre`, { waitUntil: 'networkidle' });
			await page.waitForTimeout(800);
			await page.screenshot({ path: `${OUT}/settings.png` });
			await page.goto(`${BASE}/admin/network/firewall`, { waitUntil: 'networkidle' });
			await page.waitForTimeout(800);
			await page.screenshot({ path: `${OUT}/firewall.png` });
		}
		await page.goto(`${BASE}/admin/logout`, { waitUntil: 'networkidle' });
		await ctx.close();
	}
} finally {
	await browser.close();
}
