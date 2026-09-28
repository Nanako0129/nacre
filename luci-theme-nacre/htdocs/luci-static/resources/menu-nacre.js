'use strict';
'require baseclass';
'require ui';

// nacre sidebar menu. Tab and mode menus are unchanged from bootstrap; the main
// menu renders into the sidebar as collapsible groups instead of a dropdown bar.
return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));
		this.bindDrawer();
	},

	render(tree) {
		let node = tree;
		let url = '';

		this.renderModeMenu(tree);

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			const activeClass = isActive ? ' active' : '';
			const className = 'tabmenu-item-%s %s'.format(child.name, activeClass);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ] )]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return E([]);

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	},

	renderMainMenu(tree, url) {
		const ul = document.querySelector('#topmenu');

		ui.menu.getChildren(tree).forEach(group => {
			const items = ui.menu.getChildren(group);
			const groupUrl = url + '/' + group.name;
			const inGroup = L.env.dispatchpath[1] == group.name;

			if (!items.length) {
				ul.appendChild(E('li', { 'class': 'nacre-leaf' + (inGroup ? ' active' : '') }, [
					E('a', { 'href': L.url(groupUrl) }, [ _(group.title) ])
				]));
				return;
			}

			const list = E('ul', { 'class': 'nacre-group-items' }, items.map(item => {
				const active = inGroup && L.env.dispatchpath[2] == item.name;
				return E('li', { 'class': active ? 'active' : '' }, [
					E('a', active ? { 'href': L.url(groupUrl, item.name), 'aria-current': 'page' }
					              : { 'href': L.url(groupUrl, item.name) }, [ _(item.title) ])
				]);
			}));

			const title = E('button', {
				'type': 'button',
				'class': 'nacre-group-title',
				'aria-expanded': inGroup ? 'true' : 'false',
				'click': (ev) => {
					const li = ev.currentTarget.parentNode;
					const open = li.classList.toggle('open');
					ev.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
				}
			}, [ E('span', {}, [ _(group.title) ]) ]);

			ul.appendChild(E('li', { 'class': 'nacre-group' + (inGroup ? ' open' : '') }, [ title, list ]));
		});

		ul.style.display = '';
		return ul;
	},

	renderModeMenu(tree) {
		const ul = document.querySelector('#modemenu');
		const children = ui.menu.getChildren(tree);

		children.forEach((child, index) => {
			const isActive = L.env.requestpath.length
				? child.name === L.env.requestpath[0]
				: index === 0;

			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				this.renderMainMenu(child, child.name);
		});

		if (ul.children.length > 1)
			ul.style.display = '';
	},

	// Narrow screens: the sidebar is an off-canvas drawer.
	bindDrawer() {
		const toggle = document.querySelector('#nacre-menu-toggle');
		const scrim = document.querySelector('#nacre-scrim');

		if (!toggle || !scrim)
			return;

		const setOpen = (open) => {
			document.body.classList.toggle('nacre-nav-open', open);
			toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
			scrim.hidden = !open;
		};

		toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('nacre-nav-open')));
		scrim.addEventListener('click', () => setOpen(false));
		document.addEventListener('keydown', (ev) => {
			if (ev.key === 'Escape' && document.body.classList.contains('nacre-nav-open'))
				setOpen(false);
		});
	}
});
