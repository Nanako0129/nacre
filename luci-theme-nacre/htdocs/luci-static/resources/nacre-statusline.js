'use strict';
'require baseclass';
'require rpc';
'require fs';
'require uci';

// coralline-style status line and WAN traffic chart for the overview page.
// Uses only calls LuCI's own status pages already hold ACLs for (no new rpcd
// grants): system board/info and conntrack files (luci-mod-status-index),
// network.interface dump and luci-rpc getNetworkDevices (luci-base),
// luci getRealtimeStats (luci-mod-status-realtime).

const callBoard = rpc.declare({ object: 'system', method: 'board' });
const callInfo = rpc.declare({ object: 'system', method: 'info' });
const callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callRealtime = rpc.declare({ object: 'luci', method: 'getRealtimeStats', params: [ 'mode', 'device' ], expect: { result: [] } });

const POLL_MS = 1000;

// Traffic comes from luci-bwc (via getRealtimeStats): the router samples each
// device every second with its own clock and keeps the last 60 samples, so
// browser request jitter can't open gaps and a few missed polls are refilled.
// Longer history would need vnstat/collectd and a new ACL.
const WINDOW_S = 300;
const GAP_S = 3;            /* bins further apart than this are drawn as separate runs */
const CHART_W = 640, CHART_H = 180;
const MIN_TOP_MBPS = 10;    /* log axis spans at least 0–10 Mbps */
const GRID_MBPS = [ 1, 10, 100, 1000, 10000 ];

// gauge colour thresholds, as coralline's VL_WARN_PCT / VL_HOT_PCT
const WARN = 50, HOT = 75;

function level(pct) {
	return pct >= HOT ? 'hot' : pct >= WARN ? 'warn' : 'ok';
}

// WAN = interfaces named in uci nacre.global.wan, or else every interface that
// holds an IPv4 default route (what LuCI's own overview does).
function wanSet(ifaces, pinned) {
	if (pinned.length)
		return pinned.map(name => ifaces.find(i => i.interface == name) ?? { interface: name, up: false });

	return ifaces.filter(i => (i.route ?? []).some(r => r.target == '0.0.0.0' && r.mask == 0));
}

function toMbps(bytesPerSec) {
	return bytesPerSec * 8 / 1e6;
}

function mbps(bytesPerSec) {
	const v = toMbps(bytesPerSec);
	return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

// Log axis: a single spike must not flatten everyday traffic to the baseline.
function logY(m, topM) {
	return Math.log10(1 + Math.max(0, m)) / Math.log10(1 + topM);
}

return baseclass.extend({
	__init__() {
		const host = document.querySelector('#nacre-topbar');
		if (!host)
			return;

		this.el = E('div', { 'id': 'nacre-statusline', 'role': 'status', 'aria-label': _('Status line') });
		host.insertBefore(this.el, document.querySelector('#indicators'));

		this.series = {};        /* device -> Map(t -> { rx, tx }) in bytes/s, from luci-bwc */
		this.since = {};         /* device -> earliest luci-bwc timestamp this page accepts */
		this.fallback = [];      /* browser-side deltas, only when luci-bwc is unavailable */
		this.prev = null;
		this.busy = false;
		this.board = callBoard();
		this.pinned = [];
		L.resolveDefault(uci.load('nacre'), null).then(() => {
			this.pinned = L.toArray(uci.get('nacre', 'global', 'wan'));
		});
		this.buildChart();

		const tick = () => { if (!document.hidden) this.update(); };
		tick();
		this.timer = window.setInterval(tick, POLL_MS);
		document.addEventListener('visibilitychange', tick);
	},

	update() {
		// One request set at a time: overlapping replies used to arrive out of
		// order and drop samples.
		if (this.busy)
			return Promise.resolve();

		this.busy = true;

		return Promise.all([
			this.board,
			callInfo(),
			L.resolveDefault(callIfaces(), []),
			L.resolveDefault(callDevices(), {}),
			L.resolveDefault(fs.read('/proc/sys/net/netfilter/nf_conntrack_count'), null),
			L.resolveDefault(fs.read('/proc/sys/net/netfilter/nf_conntrack_max'), null)
		]).then(([board, info, ifaces, devices, ctCount, ctMax]) => {
			const devs = this.uplinkDevices(ifaces);

			return Promise.all(devs.map(d => L.resolveDefault(callRealtime('interface', d), null))).then(replies => {
				this.merge(devs, replies, devices);
				this.render(this.segments(board, info, ifaces, devices, ctCount, ctMax));
				this.drawChart();
			});
		}).catch(() => {}).finally(() => { this.busy = false; });
	},

	uplinkDevices(ifaces) {
		return [...new Set(wanSet(ifaces, this.pinned ?? []).map(w => w.l3_device).filter(d => d))];
	},

	// Fold luci-bwc rows ([t, rx_bytes, rx_pkts, tx_bytes, tx_pkts], cumulative)
	// into per-second rates keyed by the router's timestamp.
	merge(devs, replies, devices) {
		const since = Date.now() / 1000 - WINDOW_S - 60;
		let any = false;

		devs.forEach((dev, n) => {
			const rows = replies[n];

			if (!Array.isArray(rows) || rows.length < 2)
				return;

			any = true;
			const first = !this.series[dev];
			const map = this.series[dev] ?? (this.series[dev] = new Map());

			for (let i = 1; i < rows.length; i++) {
				const [t0, rx0, , tx0] = rows[i - 1], [t1, rx1, , tx1] = rows[i];

				if (t1 > t0 && t1 - t0 <= GAP_S && rx1 >= rx0 && tx1 >= tx0 && t1 >= (this.since[dev] ?? 0))
					map.set(t1, { rx: (rx1 - rx0) / (t1 - t0), tx: (tx1 - tx0) / (t1 - t0) });
			}

			// On the page's first read, luci-bwc's buffer can hold fragments left
			// by earlier visitors (it samples only while polled). Keep just the
			// run that reaches the present; from here on polling keeps it whole.
			if (first) {
				const t = [...map.keys()].sort((a, b) => a - b);
				let start = t[0];
				for (let i = 1; i < t.length; i++)
					if (t[i] - t[i - 1] > GAP_S)
						start = t[i];
				// ...and only if that run is current: luci-bwc exits ~10 s after
				// its last poll, so its buffer can be entirely stale.
				const stale = !t.length || Date.now() / 1000 - t[t.length - 1] > GAP_S * 2;
				for (const k of t)
					if (stale || k < start)
						map.delete(k);

				// Every later read returns the whole 60-entry buffer again; without
				// this floor the trimmed fragments would be merged straight back.
				this.since[dev] = stale ? Date.now() / 1000 - GAP_S : start;
			}

			for (const t of map.keys())
				if (t < since)
					map.delete(t);
		});

		Object.keys(this.series).forEach(d => { if (!devs.includes(d)) { delete this.series[d]; delete this.since[d]; } });
		this.useFallback = !any;

		if (!any)
			this.sampleFallback(devs, devices);
	},

	// Only if getRealtimeStats is not permitted: deltas of the counters.
	sampleFallback(devs, devices) {
		const live = devs.filter(d => devices[d]?.stats);
		if (!live.length)
			return;

		const now = Date.now(), key = live.join(' ');
		const rxb = live.reduce((n, d) => n + devices[d].stats.rx_bytes, 0);
		const txb = live.reduce((n, d) => n + devices[d].stats.tx_bytes, 0);

		if (this.prev?.dev == key) {
			const dt = (now - this.prev.t) / 1000;
			const rx = (rxb - this.prev.rx) / dt, tx = (txb - this.prev.tx) / dt;
			if (dt > 0 && rx >= 0 && tx >= 0)
				this.fallback.push({ t: now / 1000, rx, tx });
		}

		this.prev = { dev: key, t: now, rx: rxb, tx: txb };
		this.fallback = this.fallback.filter(s => s.t >= now / 1000 - WINDOW_S);
	},

	// Summed uplink rates, oldest first.
	points() {
		if (this.useFallback)
			return this.fallback;

		const sum = new Map();
		Object.values(this.series).forEach(map => map.forEach((v, t) => {
			const s = sum.get(t) ?? { t, rx: 0, tx: 0 };
			s.rx += v.rx;
			s.tx += v.tx;
			sum.set(t, s);
		}));

		return [...sum.values()].sort((a, b) => a.t - b.t);
	},

	segments(board, info, ifaces, devices, ctCount, ctMax) {
		const segs = [];
		const wans = wanSet(ifaces, this.pinned ?? []);

		segs.push({ cls: 'sky', text: board.hostname });

		if (!wans.length) {
			segs.push({ cls: 'hot', text: '%s ✗'.format(_('WAN')), title: _('No default route') });
		}
		else if (wans.length == 1) {
			const w = wans[0];
			segs.push({ cls: w.up ? 'sage' : 'hot', text: '%s %s'.format(_('WAN'), w.up ? '✓' : '✗'),
			            title: w.up ? '%s · %s'.format(w.interface, w['ipv4-address']?.[0]?.address ?? '') : '%s · %s'.format(w.interface, _('Not connected')) });
		}
		else {
			wans.forEach(w => segs.push({ cls: w.up ? 'sage' : 'hot', text: '%s %s'.format(w.interface, w.up ? '✓' : '✗'),
				title: w.up ? (w['ipv4-address']?.[0]?.address ?? '') : _('Not connected') }));
		}

		const pd = ifaces.map(i => i['ipv6-prefix']?.[0]).find(p => p);
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

		const pts = this.points ? this.points() : [];
		const last = pts[pts.length - 1];
		if (last && Date.now() / 1000 - last.t <= GAP_S * 2)
			segs.push({ cls: 'terracotta', text: '↓ %s ↑ %s Mbps'.format(mbps(last.rx), mbps(last.tx)) });

		segs.push({ cls: 'sandstone', text: new Date(info.localtime * 1000).toISOString().substr(11, 8) });

		return segs;
	},

	buildChart() {
		const view = document.querySelector('#view');
		if (!view)
			return;

		const NS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 %d %d'.format(CHART_W, CHART_H));
		svg.setAttribute('preserveAspectRatio', 'none');
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', _('WAN download and upload rate'));

		this.chart = { span: E('span'), legend: E('div', { 'class': 'nacre-traffic-legend' }),
		               labels: E('div', { 'class': 'nacre-traffic-axis', 'aria-hidden': 'true' }) };

		[ 'grid', 'rx-fill', 'rx', 'tx' ].forEach(cls => {
			const p = document.createElementNS(NS, 'path');
			p.setAttribute('class', cls);
			svg.appendChild(p);
			this.chart[cls] = p;
		});

		view.parentNode.insertBefore(E('section', { 'id': 'nacre-traffic', 'aria-label': _('WAN traffic') }, [
			E('div', { 'class': 'nacre-traffic-head' }, [
				E('h3', {}, [ _('WAN traffic'), this.chart.span ]),
				this.chart.legend
			]),
			E('div', { 'class': 'nacre-traffic-plot' }, [ svg, this.chart.labels ])
		]), view);
	},

	drawChart() {
		if (!this.chart)
			return;

		const now = Date.now() / 1000, since = now - WINDOW_S;
		const pts = this.points().filter(s => s.t >= since);
		const peakRx = Math.max(0, ...pts.map(s => s.rx)), peakTx = Math.max(0, ...pts.map(s => s.tx));
		const topM = Math.max(MIN_TOP_MBPS, toMbps(Math.max(peakRx, peakTx)) * 1.25);

		const x = t => ((t - since) / WINDOW_S * CHART_W).toFixed(1);
		const yPx = m => CHART_H - logY(m, topM) * CHART_H;
		const y = v => yPx(toMbps(v)).toFixed(1);

		// Split at gaps (page hidden longer than luci-bwc's 60 s buffer): an
		// unknown stretch must not be drawn as a straight line.
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
		this.chart['rx-fill'].setAttribute('d', fill('rx'));

		const grid = GRID_MBPS.filter(g => g < topM);
		this.chart.grid.setAttribute('d', grid.map(g => 'M0 %.1f H%d'.format(yPx(g), CHART_W)).join(' '));
		this.chart.labels.replaceChildren(...grid.map(g => E('span', {
			'style': 'top:%.2f%%'.format(yPx(g) / CHART_H * 100)
		}, [ g >= 1000 ? '%d Gbps'.format(g / 1000) : '%d Mbps'.format(g) ])));

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
