'use strict';
'require baseclass';
'require rpc';
'require fs';

// coralline-style status line for the overview page. Uses only calls that
// LuCI's own status pages already hold ACLs for (no new rpcd grants):
// system board/info and conntrack files (luci-mod-status-index),
// network.interface dump and luci-rpc getNetworkDevices (luci-base),
// luci getRealtimeStats (luci-mod-status-realtime) to seed the traffic chart.

const callBoard = rpc.declare({ object: 'system', method: 'board' });
const callInfo = rpc.declare({ object: 'system', method: 'info' });
const callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callRealtime = rpc.declare({ object: 'luci', method: 'getRealtimeStats', params: [ 'mode', 'device' ], expect: { result: [] } });

const POLL_MS = 1000;

// Traffic chart: a rolling window of per-second WAN rates. Longer history would
// need vnstat/collectd data and a new ACL, so the window is what the page holds.
const WINDOW_S = 300;
const CHART_W = 640, CHART_H = 180;
const FLOOR_BPS = 1e6 / 8; /* keep the y axis at >= 1 Mbps so idle noise stays flat */
const GAP_S = 3; /* samples further apart than this are drawn as separate runs */

// gauge colour thresholds, as coralline's VL_WARN_PCT / VL_HOT_PCT
const WARN = 50, HOT = 75;

function level(pct) {
	return pct >= HOT ? 'hot' : pct >= WARN ? 'warn' : 'ok';
}

function mbps(bytesPerSec) {
	const v = bytesPerSec * 8 / 1e6;
	return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

return baseclass.extend({
	__init__() {
		const host = document.querySelector('#nacre-topbar');
		if (!host)
			return;

		this.el = E('div', { 'id': 'nacre-statusline', 'role': 'status', 'aria-label': _('Status line') });
		host.insertBefore(this.el, document.querySelector('#indicators'));
		this.prev = null;
		this.samples = [];
		this.seeded = false;
		this.board = callBoard();
		this.buildChart();

		const tick = () => { if (!document.hidden) this.update(); };
		tick();
		this.timer = window.setInterval(tick, POLL_MS);
		document.addEventListener('visibilitychange', tick);
	},

	update() {
		return Promise.all([
			this.board,
			callInfo(),
			L.resolveDefault(callIfaces(), []),
			L.resolveDefault(callDevices(), {}),
			L.resolveDefault(fs.read('/proc/sys/net/netfilter/nf_conntrack_count'), null),
			L.resolveDefault(fs.read('/proc/sys/net/netfilter/nf_conntrack_max'), null)
		]).then(([board, info, ifaces, devices, ctCount, ctMax]) => {
			this.render(this.segments(board, info, ifaces, devices, ctCount, ctMax));
			this.seed(ifaces);
			this.drawChart();
		}).catch(() => {});
	},

	segments(board, info, ifaces, devices, ctCount, ctMax) {
		const segs = [];
		const wan = ifaces.find(i => i.interface == 'wan');
		const wan6 = ifaces.find(i => i.interface == 'wan6' || i.interface == 'wan_6');

		segs.push({ cls: 'sky', text: board.hostname });

		if (wan) {
			const up = wan.up;
			segs.push({ cls: up ? 'sage' : 'hot', text: '%s %s'.format(_('WAN'), up ? '✓' : '✗'),
			            title: up ? (wan['ipv4-address']?.[0]?.address ?? '') : _('Not connected') });
		}

		const pd = wan6?.['ipv6-prefix']?.[0];
		if (pd)
			segs.push({ cls: 'lavender', text: 'IPv6 /%d'.format(pd.mask), title: '%s/%d'.format(pd.address, pd.mask) });

		// No gauge colour: the router's core count isn't readable without a new ACL,
		// and navigator.hardwareConcurrency is the browser's, not the router's.
		const load1 = info.load[0] / 65536;
		segs.push({ cls: 'data', text: '%s %.2f'.format(_('Load'), load1) });

		const mem = info.memory;
		const memPct = Math.round((1 - (mem.available ?? mem.free) / mem.total) * 100);
		segs.push({ cls: 'data ' + level(memPct), text: 'RAM %d%%'.format(memPct) });

		const n = parseInt(ctCount), max = parseInt(ctMax);
		if (!isNaN(n))
			segs.push({ cls: 'data ' + (isNaN(max) ? 'ok' : level(n / max * 100)), text: '%s %d'.format(_('Conn'), n) });

		const dev = wan?.l3_device && devices[wan.l3_device];
		if (dev?.stats) {
			const now = Date.now();
			if (this.prev && this.prev.dev == wan.l3_device) {
				const dt = (now - this.prev.t) / 1000;
				const rx = (dev.stats.rx_bytes - this.prev.rx) / dt, tx = (dev.stats.tx_bytes - this.prev.tx) / dt;
				segs.push({ cls: 'terracotta', text: '↓ %s ↑ %s Mbps'.format(mbps(rx), mbps(tx)) });
				if (dt > 0 && rx >= 0 && tx >= 0)
					this.samples.push({ t: now / 1000, rx, tx });
			}
			this.prev = { dev: wan.l3_device, t: now, rx: dev.stats.rx_bytes, tx: dev.stats.tx_bytes };
		}

		segs.push({ cls: 'sandstone', text: new Date(info.localtime * 1000).toISOString().substr(11, 8) });

		return segs;
	},

	buildChart() {
		const view = document.querySelector('#view');
		if (!view)
			return;

		this.chart = {
			rxFill: E('path', { 'class': 'rx-fill' }),
			rx: E('path', { 'class': 'rx' }),
			tx: E('path', { 'class': 'tx' }),
			legend: E('div', { 'class': 'nacre-traffic-legend' })
		};

		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 %d %d'.format(CHART_W, CHART_H));
		svg.setAttribute('preserveAspectRatio', 'none');
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', _('WAN download and upload rate'));
		svg.innerHTML = '<path class="grid" d="M0 %d H%d M0 %d H%d M0 %d H%d"/>'.format(
			CHART_H / 4, CHART_W, CHART_H / 2, CHART_W, CHART_H * 3 / 4, CHART_W);
		[ 'rxFill', 'rx', 'tx' ].forEach(k => {
			const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			p.setAttribute('class', this.chart[k].getAttribute('class'));
			svg.appendChild(p);
			this.chart[k] = p;
		});

		view.parentNode.insertBefore(E('section', { 'id': 'nacre-traffic', 'aria-label': _('WAN traffic') }, [
			E('div', { 'class': 'nacre-traffic-head' }, [
				E('h3', {}, [ _('WAN traffic'), this.chart.span = E('span') ]),
				this.chart.legend
			]),
			svg
		]), view);
	},

	// Fill the window at once from LuCI's own realtime collector. luci-bwc only
	// runs while polled, so its buffer can be stale: keep in-window samples only.
	seed(ifaces) {
		const wan = ifaces.find(i => i.interface == 'wan');

		if (this.seeded || !wan?.l3_device || !this.chart)
			return;

		this.seeded = true;

		// luci-bwc keeps a fixed 60-entry buffer and only samples while someone
		// polls it, so older entries are leftover fragments. Seed only the last
		// contiguous run, and only if it reaches the present.
		L.resolveDefault(callRealtime('interface', wan.l3_device), []).then(rows => {
			let run = [];

			for (let i = 1; i < rows.length; i++) {
				const [t0, rx0, , tx0] = rows[i - 1], [t1, rx1, , tx1] = rows[i];

				if (t1 - t0 > GAP_S || t1 <= t0 || rx1 < rx0 || tx1 < tx0) {
					run = [];
					continue;
				}

				run.push({ t: t1, rx: (rx1 - rx0) / (t1 - t0), tx: (tx1 - tx0) / (t1 - t0) });
			}

			const end = run[run.length - 1]?.t ?? 0;
			if (Date.now() / 1000 - end > GAP_S)
				return;

			const first = this.samples[0]?.t ?? Infinity;
			this.samples = run.filter(s => s.t < first).concat(this.samples);
			this.drawChart();
		});
	},

	drawChart() {
		if (!this.chart)
			return;

		const now = Date.now() / 1000, since = now - WINDOW_S;
		this.samples = this.samples.filter(s => s.t >= since);

		const pts = this.samples;
		const peakRx = Math.max(0, ...pts.map(s => s.rx)), peakTx = Math.max(0, ...pts.map(s => s.tx));
		const top = Math.max(FLOOR_BPS, peakRx, peakTx) * 1.15;
		const x = t => ((t - since) / WINDOW_S * CHART_W).toFixed(1);
		const y = v => (CHART_H - v / top * CHART_H).toFixed(1);
		// Split at gaps (hidden tab, stale seed): an unknown stretch must not be
		// drawn as a straight line that looks like steady traffic.
		const runs = [];
		pts.forEach((s, i) => {
			if (!i || s.t - pts[i - 1].t > GAP_S)
				runs.push([]);
			runs[runs.length - 1].push(s);
		});

		const path = (run, key) => run.map((s, i) => (i ? 'L' : 'M') + x(s.t) + ' ' + y(s[key])).join(' ');
		const line = key => runs.map(run => path(run, key)).join(' ');
		const fill = key => runs.filter(run => run.length > 1).map(run => '%s L%s %d L%s %d Z'.format(
			path(run, key), x(run[run.length - 1].t), CHART_H, x(run[0].t), CHART_H)).join(' ');

		this.chart.rx.setAttribute('d', line('rx'));
		this.chart.tx.setAttribute('d', line('tx'));
		this.chart.rxFill.setAttribute('d', fill('rx'));

		// Until the page has held a full window, say how much it has: an empty
		// left side means "not collected yet", not "no traffic".
		const covered = pts.length ? now - pts[0].t : 0;
		this.chart.span.textContent = ' · ' + (covered >= WINDOW_S - GAP_S
			? _('last %d minutes').format(WINDOW_S / 60)
			: _('collected %s of %d minutes').format('%d:%02d'.format(Math.floor(covered / 60), Math.floor(covered % 60)), WINDOW_S / 60));

		const last = pts[pts.length - 1];
		this.chart.legend.replaceChildren(
			E('span', { 'class': 'rx' }, [ '↓ %s Mbps'.format(last ? mbps(last.rx) : '–'),
				E('small', {}, [ ' %s %s'.format(_('peak'), mbps(peakRx)) ]) ]),
			E('span', { 'class': 'tx' }, [ '↑ %s Mbps'.format(last ? mbps(last.tx) : '–'),
				E('small', {}, [ ' %s %s'.format(_('peak'), mbps(peakTx)) ]) ]));
	},

	render(segs) {
		this.el.replaceChildren(...segs.map(s =>
			E('span', { 'class': 'nacre-seg ' + s.cls, 'title': s.title ?? '' }, [ s.text ])));
	}
});
