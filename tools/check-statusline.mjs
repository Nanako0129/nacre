// S3 acceptance for the overview status line, as the read-only preview user.
// 1) rendered values vs the router's own readings (ubus over SSH)
// 2) a fake WAN-down reply renders the WAN segment as "hot" (no real outage)
// 3) no status-line RPCs while document.hidden is true
// Same secret handling as shoot.mjs: Keychain -> memory, no traces/HAR/state.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const HOST = process.env.ROUTER_HOST ?? '192.168.123.1';
const BASE = `https://${HOST}/cgi-bin/luci`;
const KC = `${homedir()}/Library/Keychains/login.keychain-db`;
const password = execFileSync('/usr/bin/security',
	['find-generic-password', '-s', 'nacre-preview', '-w', KC], { encoding: 'utf8' }).trimEnd();
const ssh = (cmd) => execFileSync('ssh', ['-o', 'BatchMode=yes', `root@${HOST}`, cmd], { encoding: 'utf8' });

const result = {};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
	const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })).newPage();
	await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
	await page.fill('input[name="luci_username"]', 'nacre-preview');
	await page.fill('input[name="luci_password"]', password);
	await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.keyboard.press('Enter')]);
	await page.goto(`${BASE}/admin/status/overview`, { waitUntil: 'networkidle' });
	await page.waitForSelector('#nacre-statusline .nacre-seg');
	await page.waitForTimeout(6000); // second poll -> throughput segment appears

	// 1) values
	result.segments = await page.$$eval('#nacre-statusline .nacre-seg', els => els.map(e => `${e.className} | ${e.textContent}`));
	result.router = {
		hostname: ssh('uci get system.@system[0].hostname').trim(),
		wan_up: JSON.parse(ssh('ifstatus wan')).up,
		pd_mask: JSON.parse(ssh('ifstatus wan_6'))['ipv6-prefix']?.[0]?.mask,
		conntrack: ssh('cat /proc/sys/net/netfilter/nf_conntrack_count').trim(),
		load1: (JSON.parse(ssh('ubus call system info')).load[0] / 65536).toFixed(2),
	};

	// 2) injected WAN-down renders hot
	result.fake_wan_down = await page.evaluate(() => L.require('nacre-statusline').then(m => {
		const segs = m.segments({ hostname: 'x' }, { load: [0, 0, 0], memory: { total: 100, available: 50 }, localtime: 0 },
			[{ interface: 'wan', up: false }], {}, null, null);
		return segs.find(s => s.text.startsWith('WAN'));
	}));

	// 2b) WAN detection: by default route (auto) and by a pinned uci list
	result.wan_detection = await page.evaluate(() => L.require('nacre-statusline').then(m => {
		const info = { load: [0, 0, 0], memory: { total: 100, available: 50 }, localtime: 0 };
		const dflt = [{ target: '0.0.0.0', mask: 0 }];
		const texts = segs => segs.filter(s => /✓|✗/.test(s.text)).map(s => s.text);
		const saved = m.pinned;
		m.pinned = [];
		const auto_named_odd = texts(m.segments({ hostname: 'x' }, info, [{ interface: 'hinet', up: true, route: dflt }], {}, null, null));
		const auto_two = texts(m.segments({ hostname: 'x' }, info, [{ interface: 'wan', up: true, route: dflt }, { interface: 'wan2', up: true, route: dflt }], {}, null, null));
		const auto_none = texts(m.segments({ hostname: 'x' }, info, [{ interface: 'lan', up: true, route: [] }], {}, null, null));
		m.pinned = ['wan', 'wan2'];
		const pinned_one_down = texts(m.segments({ hostname: 'x' }, info, [{ interface: 'wan', up: true, route: dflt }, { interface: 'wan2', up: false }], {}, null, null));
		m.pinned = saved;
		return { auto_named_odd, auto_two, auto_none, pinned_one_down };
	}));

	// 3) hidden tab -> no polling. Count the module's own update() calls: LuCI's
	// overview includes poll the same ubus objects, so request counting can't tell.
	await page.evaluate(() => L.require('nacre-statusline').then(m => {
		window.__nacreUpdates = 0;
		const orig = m.update.bind(m);
		m.update = () => { window.__nacreUpdates++; return orig(); };
	}));
	await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
	await page.waitForTimeout(12000);
	result.updates_while_hidden = await page.evaluate(() => window.__nacreUpdates);
	await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
	await page.waitForTimeout(11000);
	result.updates_after_visible = await page.evaluate(() => window.__nacreUpdates) - result.updates_while_hidden;

	// traffic chart: seeded + live points, legend filled
	result.chart = await page.evaluate(() => ({
		rxPoints: (document.querySelector('#nacre-traffic path.rx')?.getAttribute('d') ?? '').split(/[ML]/).length - 1,
		txPoints: (document.querySelector('#nacre-traffic path.tx')?.getAttribute('d') ?? '').split(/[ML]/).length - 1,
		legend: document.querySelector('.nacre-traffic-legend')?.textContent,
		title: document.querySelector('#nacre-traffic h3')?.textContent,
	}));
	await page.screenshot({ path: 'shots/statusline.png', clip: { x: 248, y: 0, width: 1192, height: 60 } });
	await page.screenshot({ path: 'shots/overview-chart.png', clip: { x: 248, y: 0, width: 1192, height: 420 } });
	await page.goto(`${BASE}/admin/logout`);
} finally {
	await browser.close();
}
console.log(JSON.stringify(result, null, 2));
