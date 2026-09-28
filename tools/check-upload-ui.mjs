// S2 UI flow: upload through the real settings page as `nacre-preview`, so the
// browser-side re-encode runs; then zh-TW screenshots of the settings page.
// Same secret handling as shoot.mjs.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const HOST = process.env.ROUTER_HOST ?? '192.168.123.1';
const BASE = `https://${HOST}/cgi-bin/luci`;
const KC = `${homedir()}/Library/Keychains/login.keychain-db`;
const password = execFileSync('/usr/bin/security',
	['find-generic-password', '-s', 'nacre-preview', '-w', KC], { encoding: 'utf8' }).trimEnd();
const ssh = (cmd) => execFileSync('ssh', ['-o', 'BatchMode=yes', `root@${HOST}`, cmd], { encoding: 'utf8' });

const r = {};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'zh-TW', viewport: { width: 1440, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	await page.fill('input[name="luci_username"]', 'nacre-preview');
	await page.fill('input[name="luci_password"]', password);
	await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.keyboard.press('Enter')]);
	await page.goto(`${BASE}/admin/system/nacre`, { waitUntil: 'networkidle' });
	await page.screenshot({ path: 'shots/settings-zh-tw.png', fullPage: true });

	await page.setInputFiles('#nacre-bg-file', process.argv[2] ?? 'shots/fixtures/wide.jpg');
	await page.click('text=/^(Upload|上傳)$/');
	await page.waitForSelector('.alert-message.info, .alert-message.error', { timeout: 20000 });
	r.notification = await page.$eval('.alert-message.info, .alert-message.error', e => e.className + ' | ' + e.textContent.trim());
	r.preview_visible = await page.$eval('#nacre-bg-preview', e => !e.hidden && !!e.getAttribute('src'));
	r.stored = ssh('ls -l /www/luci-static/nacre/background/; uci -q get nacre.global.background').trim();
	r.dimensions = await page.evaluate(() => new Promise(res => {
		const img = new Image();
		img.onload = () => res(`${img.naturalWidth}x${img.naturalHeight}`);
		img.onerror = () => res('LOAD ERROR');
		img.src = document.querySelector('#nacre-bg-preview').src;
	}));
	// what an anonymous visitor gets for the stored file
	r.anon_http = execFileSync('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code} %{content_type}',
		`https://${HOST}/luci-static/nacre/background/bg.jpg`], { encoding: 'utf8' });
	await page.screenshot({ path: 'shots/settings-after-upload.png', fullPage: true });

	// settings survive rpcd + uhttpd restarts
	ssh('/etc/init.d/rpcd restart; /etc/init.d/uhttpd restart');
	await page.waitForTimeout(3000);
	r.after_restart = ssh('uci -q get nacre.global.background; ls /www/luci-static/nacre/background/').trim();

	const anon = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })).newPage();
	await anon.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	await anon.screenshot({ path: 'shots/login-custom-bg.png' });
} finally {
	await browser.close();
}
console.log(JSON.stringify(r, null, 2));
