'use strict';
'require baseclass';
'require rpc';
'require fs';

// coralline-style status line for the overview page. Uses only calls that
// LuCI's own status pages already hold ACLs for (no new rpcd grants):
// system board/info and conntrack files (luci-mod-status-index),
// network.interface dump and luci-rpc getNetworkDevices (luci-base).

const callBoard = rpc.declare({ object: 'system', method: 'board' });
const callInfo = rpc.declare({ object: 'system', method: 'info' });
const callIfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });

const POLL_MS = 5000;

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

		const tick = () => { if (!document.hidden) this.update(); };
		tick();
		this.timer = window.setInterval(tick, POLL_MS);
		document.addEventListener('visibilitychange', tick);
	},

	update() {
		return Promise.all([
			callBoard(),
			callInfo(),
			L.resolveDefault(callIfaces(), []),
			L.resolveDefault(callDevices(), {}),
			L.resolveDefault(fs.read('/proc/sys/net/netfilter/nf_conntrack_count'), null),
			L.resolveDefault(fs.read('/proc/sys/net/netfilter/nf_conntrack_max'), null)
		]).then(([board, info, ifaces, devices, ctCount, ctMax]) => {
			this.render(this.segments(board, info, ifaces, devices, ctCount, ctMax));
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
				segs.push({ cls: 'terracotta', text: '↓ %s ↑ %s Mbps'.format(
					mbps((dev.stats.rx_bytes - this.prev.rx) / dt), mbps((dev.stats.tx_bytes - this.prev.tx) / dt)) });
			}
			this.prev = { dev: wan.l3_device, t: now, rx: dev.stats.rx_bytes, tx: dev.stats.tx_bytes };
		}

		segs.push({ cls: 'sandstone', text: new Date(info.localtime * 1000).toISOString().substr(11, 8) });

		return segs;
	},

	render(segs) {
		this.el.replaceChildren(...segs.map(s =>
			E('span', { 'class': 'nacre-seg ' + s.cls, 'title': s.title ?? '' }, [ s.text ])));
	}
});
