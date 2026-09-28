'use strict';
'require view';
'require form';
'require request';
'require rpc';
'require uci';
'require ui';

// The only path the ACL lets cgi-io write; luci.nacre reads it from there.
var UPLOAD_PATH = '/tmp/nacre-upload.bin';
var BG_URL = '/luci-static/nacre/background/bg.';

// Re-encoding caps: 2560 px covers a 1440p screen at cover size and keeps a
// JPEG well under the plugin's 5 MiB limit.
var MAX_SIDE = 2560;
var JPEG_QUALITY = 0.88;

var callSetBackground = rpc.declare({
	object: 'luci.nacre',
	method: 'set_background'
});

var callClearBackground = rpc.declare({
	object: 'luci.nacre',
	method: 'clear_background'
});

var errorText = {
	missing: _('The upload did not arrive.'),
	not_regular: _('The uploaded file is not a regular file.'),
	too_large: _('The image is larger than 5 MiB.'),
	bad_type: _('Only JPEG and PNG images are accepted.'),
	no_space: _('Not enough free space on the router.'),
	write_failed: _('Could not write the background file.'),
	uci_failed: _('Could not save the setting.'),
	failed: _('The router could not apply the background.')
};

// Decode in the browser and draw onto a canvas, so the upload is a fresh JPEG:
// no EXIF (GPS), orientation already applied, long side capped.
function reencode(file) {
	return createImageBitmap(file).then(function(bmp) {
		var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)),
		    canvas = document.createElement('canvas'),
		    ctx;

		canvas.width = Math.max(1, Math.round(bmp.width * scale));
		canvas.height = Math.max(1, Math.round(bmp.height * scale));

		ctx = canvas.getContext('2d');
		ctx.fillStyle = '#FFFFFF'; /* JPEG has no alpha: flatten onto white */
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
		bmp.close();

		return new Promise(function(resolve, reject) {
			canvas.toBlob(function(blob) {
				if (blob)
					resolve(blob);
				else
					reject(new Error(_('The browser could not encode the image.')));
			}, 'image/jpeg', JPEG_QUALITY);
		});
	}, function() {
		throw new Error(_('The browser could not read this image.'));
	});
}

function upload(blob) {
	var data = new FormData();

	data.append('sessionid', L.env.sessionid);
	data.append('filename', UPLOAD_PATH);
	data.append('filedata', blob);

	return request.post(L.env.cgi_base + '/cgi-upload', data, { timeout: 0 }).then(function(res) {
		var reply = null;

		try { reply = res.json(); } catch (e) {}

		if (!res.ok || !L.isObject(reply) || reply.failure)
			throw new Error(_('Upload request failed: %s').format(
				(L.isObject(reply) && reply.message) || res.statusText || res.status));
	});
}

return view.extend({
	load: function() {
		return uci.load('nacre');
	},

	updatePreview: function(ext) {
		var preview = document.getElementById('nacre-bg-preview');

		if (ext == 'jpg' || ext == 'png') {
			preview.src = BG_URL + ext + '?v=' + Date.now();
			preview.hidden = false;
		}
		else {
			preview.removeAttribute('src');
			preview.hidden = true;
		}

		document.getElementById('nacre-bg-remove').disabled = !preview.src;
	},

	handleUpload: function(ev) {
		var self = this,
		    input = document.getElementById('nacre-bg-file'),
		    file = input.files[0];

		if (!file) {
			ui.addNotification(null, E('p', _('Choose an image first.')), 'warning');
			return Promise.resolve();
		}

		return reencode(file).then(upload).then(function() {
			return callSetBackground();
		}).then(function(reply) {
			if (!L.isObject(reply) || reply.result != 'ok')
				throw new Error(_('Background rejected: %s (%s)').format(
					errorText[reply?.error] || _('unknown error'), reply?.error ?? '?'));

			input.value = '';
			self.updatePreview(reply.ext);
			ui.addNotification(null, E('p', _('Background updated. It shows on the login page.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', err.message), 'error');
		});
	},

	handleRemove: function(ev) {
		var self = this;

		return callClearBackground().then(function() {
			self.updatePreview(null);
			ui.addNotification(null, E('p', _('Background removed.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', err.message), 'error');
		});
	},

	renderBackground: function() {
		var ext = uci.get('nacre', 'global', 'background'),
		    has = (ext == 'jpg' || ext == 'png');

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', _('Login background')),
			E('div', { 'class': 'alert-message warning' }, [
				E('p', _('The background image is public: anyone on your LAN can load it without logging in, and so can anyone on the internet if LuCI is reachable from there. Do not upload private photos.')),
				E('p', _('Original photos may carry location (GPS) metadata. The image is re-encoded to JPEG in your browser before upload, which removes it.'))
			]),
			E('p', {}, E('img', {
				'id': 'nacre-bg-preview',
				'alt': _('Current background'),
				'style': 'max-width:240px;max-height:150px;border-radius:10px;border:1px solid var(--nacre-line, #ccc)',
				'src': has ? BG_URL + ext + '?v=' + Date.now() : null,
				'hidden': has ? null : true
			})),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'nacre-bg-file' }, _('Image')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', { 'type': 'file', 'id': 'nacre-bg-file', 'accept': 'image/*' }),
					E('div', { 'class': 'cbi-value-description' },
						_('JPEG or PNG, any size: it is scaled to at most %d px on the long side.').format(MAX_SIDE))
				])
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleUpload')
				}, _('Upload')),
				' ',
				E('button', {
					'id': 'nacre-bg-remove',
					'class': 'btn cbi-button-negative',
					'disabled': has ? null : true,
					'click': ui.createHandlerFn(this, 'handleRemove')
				}, _('Remove'))
			])
		]);
	},

	render: function() {
		var m, s, o;

		m = new form.Map('nacre', _('nacre'), _('Appearance settings for the nacre theme.'));

		s = m.section(form.NamedSection, 'global', 'global');

		o = s.option(form.ListValue, 'mode', _('Color mode'));
		o.value('auto', _('Follow system'));
		o.value('light', _('Light'));
		o.value('dark', _('Dark'));
		o.default = 'auto';

		o = s.option(form.Value, 'accent', _('Accent color'),
			_('Used for the active menu item, primary buttons and the login page host name. Hex, like #A1B5D8.'));
		o.value('#A1B5D8', _('Sky'));
		o.value('#C4B7DC', _('Lavender'));
		o.value('#C2D8B9', _('Sage'));
		o.value('#9EC3C0', _('Teal'));
		o.value('#EEB99F', _('Terracotta'));
		o.value('#DCC0D2', _('Rose'));
		o.default = '#A1B5D8';
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return /^#[0-9a-fA-F]{6}$/.test(value) ? true : _('Expecting a hex color like #A1B5D8');
		};

		o = s.option(form.Value, 'blur', _('Login card blur'), _('Background blur behind the login card, in pixels (0–30).'));
		o.datatype = 'and(uinteger,range(0,30))';
		o.default = '14';
		o.rmempty = false;

		o = s.option(form.Value, 'alpha', _('Login card opacity'), _('Opacity of the login card, in percent (40–100).'));
		o.datatype = 'and(uinteger,range(40,100))';
		o.default = '80';
		o.rmempty = false;

		return m.render().then(L.bind(function(node) {
			node.appendChild(this.renderBackground());
			return node;
		}, this));
	}
});
