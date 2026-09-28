// Copyright 2026 Nanako0129
// Licensed to the public under the Apache License 2.0.
//
// Login background for the nacre theme. The browser uploads through cgi-io to
// the one path its ACL allows (UPLOAD); set_background takes no arguments,
// validates that file and installs it under a fixed name chosen by its magic
// bytes. Nothing the caller sends becomes part of a path.

'use strict';

import { lstat, readfile, writefile, chmod, rename, unlink, mkdir, glob } from 'fs';
import { statvfs } from 'luci.core';
import { cursor } from 'uci';

const UPLOAD = '/tmp/nacre-upload.bin';
const MEDIA = '/www/luci-static/nacre';
const BGDIR = `${MEDIA}/background`;
const TMP = `${BGDIR}/bg.new`;
const LIMIT = 5 * 1024 * 1024;
const MARGIN = 1024 * 1024;

// JPEG and PNG only: uhttpd maps .jpg/.png to the right Content-Type, and the
// extension below comes from these bytes, never from the upload's name.
const MAGIC = [
	[ 'jpg', [ 0xff, 0xd8, 0xff ] ],
	[ 'png', [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] ]
];

function sniff(data) {
	for (let m in MAGIC) {
		let ok = length(data) >= length(m[1]);

		for (let i = 0; ok && i < length(m[1]); i++)
			ok = (ord(data, i) == m[1][i]);

		if (ok)
			return m[0];
	}

	return null;
}

function remove_backgrounds(keep) {
	for (let f in (glob(`${BGDIR}/bg.*`) ?? []))
		if (f != keep)
			unlink(f);
}

function install() {
	// M2: only a plain file cgi-io (root) wrote, not a link to something else.
	const st = lstat(UPLOAD);

	if (!st)
		return { error: 'missing' };

	if (st.type != 'file' || st.uid != 0 || st.nlink != 1)
		return { error: 'not_regular' };

	// M2: size is what was actually read, not what stat claimed.
	const data = readfile(UPLOAD, LIMIT + 1);

	if (data == null)
		return { error: 'missing' };

	if (length(data) > LIMIT)
		return { error: 'too_large' };

	const ext = sniff(data);

	if (!ext)
		return { error: 'bad_type' };

	mkdir(MEDIA, 0755);
	mkdir(BGDIR, 0755);

	// L2: keep a margin on the overlay for everything else that writes there.
	const vfs = statvfs(BGDIR);

	if (!vfs || vfs.bavail * vfs.frsize < length(data) + MARGIN)
		return { error: 'no_space' };

	// L3: write aside, then rename over the final name.
	const dst = `${BGDIR}/bg.${ext}`;

	// 0644: rpcd's umask leaves new files 0600, and uhttpd only serves
	// world-readable static files, so the login page would get a 403.
	if (writefile(TMP, data) != length(data) || !chmod(TMP, 0644) || !rename(TMP, dst))
		return { error: 'write_failed' };

	remove_backgrounds(dst);

	const uci = cursor();

	if (!uci.set('nacre', 'global', 'background', ext) || !uci.commit('nacre'))
		return { error: 'uci_failed' };

	return { result: 'ok', ext };
}

const methods = {
	set_background: {
		call: function() {
			let rv;

			try {
				rv = install();
			}
			catch (e) {
				rv = { error: 'failed' };
			}

			// L3: never leave a half-written file behind.
			if (rv.error)
				unlink(TMP);

			// M1: cgi-io has no size cap, so the upload goes on every path.
			unlink(UPLOAD);

			return rv;
		}
	},

	clear_background: {
		call: function() {
			remove_backgrounds(null);

			const uci = cursor();

			uci.delete('nacre', 'global', 'background');
			uci.commit('nacre');

			return { result: 'ok' };
		}
	}
};

return { 'luci.nacre': methods };
