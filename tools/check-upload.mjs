// S2 acceptance for background upload, as `nacre-preview` (read-only everywhere
// except nacre's own ACL group). Run inside tools/with-nacre.sh.
// Each rejection must come from the layer the plan names: plugin error codes
// for content checks, ACL messages for path traversal / unauthenticated calls.
// Same secret handling as shoot.mjs: Keychain -> memory only.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const HOST = process.env.ROUTER_HOST ?? '192.168.123.1';
const BASE = `https://${HOST}/cgi-bin/luci`;
const KC = `${homedir()}/Library/Keychains/login.keychain-db`;
const FIX = process.argv[2] ?? 'shots/fixtures';
const password = execFileSync('/usr/bin/security',
	['find-generic-password', '-s', 'nacre-preview', '-w', KC], { encoding: 'utf8' }).trimEnd();
const ssh = (cmd) => execFileSync('ssh', ['-o', 'BatchMode=yes', `root@${HOST}`, cmd], { encoding: 'utf8' });
const b64 = (f) => readFileSync(`${FIX}/${f}`).toString('base64');

const r = {};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
	const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	await page.fill('input[name="luci_username"]', 'nacre-preview');
	await page.fill('input[name="luci_password"]', password);
	await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.keyboard.press('Enter')]);
	await page.goto(`${BASE}/admin/system/nacre`, { waitUntil: 'networkidle' });

	// upload bytes to `dest` via cgi-upload, then (optionally) call set_background
	const attempt = (data, dest, apply) => page.evaluate(async ({ data, dest, apply }) => {
		const bin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
		const fd = new FormData();
		fd.append('sessionid', L.env.sessionid);
		fd.append('filename', dest);
		fd.append('filedata', new Blob([bin]));
		const up = await fetch(L.env.cgi_base + '/cgi-upload', { method: 'POST', body: fd });
		const upText = await up.text();
		if (!apply) return { upload: up.status, body: upText.slice(0, 120) };
		const rpc = await L.require('rpc');
		const call = rpc.declare({ object: 'luci.nacre', method: 'set_background' });
		return { upload: up.status, set: await call().catch(e => ({ thrown: String(e) })) };
	}, { data, dest, apply });

	const T = '/tmp/nacre-upload.bin';
	r.png_ok = await attempt(b64('ok.png'), T, true);
	r.jpg_ok = await attempt(b64('ok.jpg'), T, true);
	r.too_large = await attempt(b64('big.jpg'), T, true);
	r.fake_ext = await attempt(b64('fake.jpg'), T, true);
	r.svg = await attempt(b64('x.svg'), T, true);
	r.traversal = await attempt(b64('ok.jpg'), '/tmp/../etc/nacre-evil', false);
	r.other_path = await attempt(b64('ok.jpg'), '/tmp/other.bin', false);
	r.tmp_left_after_rejects = ssh('ls /tmp/nacre-upload.bin 2>/dev/null || echo absent').trim();
	r.bg_files = ssh('ls -l /www/luci-static/nacre/background/ 2>/dev/null').trim().split('\n');
	r.anon_http = execFileSync('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code} %{content_type}',
		`https://${HOST}/luci-static/nacre/background/bg.jpg`], { encoding: 'utf8' });
	r.uci_bg = ssh('uci -q get nacre.global.background || echo unset').trim();

	// H1: a newline-smuggled accent must not reach the page. The preview account
	// has no luci-base write (ubus uci set is denied), so write it as root over
	// SSH: the template validation is what is under test, not the write path.
	execFileSync('ssh', ['-o', 'BatchMode=yes', `root@${HOST}`, 'sh -s'], { input:
		"uci set nacre.global.accent='#aabbcc\n</style><script>window.__pwned=1</script>' && uci commit nacre\n" });
	r.accent_stored = JSON.stringify(ssh('uci -q get nacre.global.accent || true'));

	// unauthenticated rpc call to the plugin
	const anon = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
	await anon.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	r.unauth_call = await anon.evaluate(async (url) => (await fetch(url, { method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call',
			params: ['00000000000000000000000000000000', 'luci.nacre', 'set_background', {}] }) })).json(),
		`https://${HOST}/ubus`).catch(e => String(e));

	// login page as an anonymous visitor: background shown, accent defaulted, no script ran
	await anon.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	r.login = await anon.evaluate(() => ({
		pwned: window.__pwned === 1,
		accent: getComputedStyle(document.documentElement).getPropertyValue('--nacre-accent').trim(),
		bg: getComputedStyle(document.documentElement).getPropertyValue('--nacre-login-bg').trim(),
		scriptsInStyle: [...document.querySelectorAll('style')].some(s => s.textContent.includes('<script')),
	}));
	await anon.screenshot({ path: 'shots/login-with-bg.png' });

	r.sysupgrade_keep = ssh('sysupgrade -l | grep -E "nacre" || true').trim().split('\n');

	// clear -> strata again
	r.clear = await page.evaluate(async () => {
		const rpc = await L.require('rpc');
		return rpc.declare({ object: 'luci.nacre', method: 'clear_background' })();
	});
	r.bg_after_clear = ssh('ls /www/luci-static/nacre/background/ 2>/dev/null | wc -l').trim();
	// never leave the injected accent on the router
	ssh("uci set nacre.global.accent='#A1B5D8' && uci commit nacre");
	r.accent_restored = ssh('uci get nacre.global.accent').trim();

	await page.goto(`${BASE}/admin/logout`);
} finally {
	await browser.close();
}
console.log(JSON.stringify(r, null, 2));
