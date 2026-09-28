// Behaviour check for the login-background path: runs the rpcd plugin
// (luci.nacre.uc) and the vars.ut template against a sandbox, with the
// target ucode from the SDK. Driven by tools/check-background.sh; SANDBOX is
// passed in with -D. Every case here is a disposition from the S2 review.

'use strict';

import { writefile, readfile, lstat, stat, symlink, mkdir, glob, chown, rmdir } from 'fs';
import { cursor } from 'uci';

const UP = `${SANDBOX}/upload.bin`;
const BG = `${SANDBOX}/www/background`;
const CONF = `${SANDBOX}/config`;

let failed = 0, passed = 0;

function check(name, ok, detail) {
	if (ok) passed++;
	else { failed++; warn(`FAIL ${name}: ${detail ?? ''}\n`); }
}

function plugin(margin) {
	let src = readfile(`${SANDBOX}/luci.nacre.uc`);
	const subs = [
		[ "'/tmp/nacre-upload.bin'", `'${UP}'` ],
		[ "'/www/luci-static/nacre'", `'${SANDBOX}/www'` ],
		[ 'cursor()', `cursor('${CONF}')` ]
	];

	if (margin)
		push(subs, [ 'const MARGIN = 1024 * 1024;', `const MARGIN = ${margin};` ]);

	for (let s in subs) {
		// A rewrite that silently misses would test the real paths instead.
		if (index(src, s[0]) < 0)
			die(`check-background: '${s[0]}' not found in plugin`);
		src = replace(src, s[0], s[1]);
	}

	writefile(`${SANDBOX}/plugin.uc`, src);
	return call(loadfile(`${SANDBOX}/plugin.uc`))['luci.nacre'];
}

const JPG = '\xff\xd8\xff\xe0' + 'jpegbody';
const PNG = '\x89PNG\r\n\x1a\n' + 'pngbody';
const LIMIT = 5 * 1024 * 1024;

function pad(head, n) {
	let s = head;
	while (length(s) * 2 <= n) s += s;
	return substr(s + s, 0, n);
}

function bgs() { return sort(map(glob(`${BG}/bg.*`) ?? [], f => substr(f, length(BG) + 1))); }
function bgopt() { return cursor(CONF).get('nacre', 'global', 'background'); }

mkdir(CONF);
writefile(`${CONF}/nacre`, "config global 'global'\n\toption mode 'auto'\n");

const p = plugin();
const set = () => p.set_background.call();

function reject(name, want, setup) {
	setup();
	const r = set();
	check(`${name} -> ${want}`, r?.error == want, sprintf('%J', r));
	check(`${name}: upload removed (M1)`, lstat(UP) == null);
	check(`${name}: no bg.new (L3)`, lstat(`${BG}/bg.new`) == null);
}

// ---- rejections ----------------------------------------------------------
reject('missing file', 'missing', () => null);

writefile(`${SANDBOX}/victim`, JPG);
reject('symlink', 'not_regular', () => symlink(`${SANDBOX}/victim`, UP));
check('symlink target untouched', readfile(`${SANDBOX}/victim`) == JPG);

reject('hard link (nlink 2)', 'not_regular', () => system([ 'ln', `${SANDBOX}/victim`, UP ]));
check('hard link other name untouched', readfile(`${SANDBOX}/victim`) == JPG);

reject('not owned by root', 'not_regular', () => { writefile(UP, JPG); chown(UP, 65534, 65534); });
// A directory is refused but left in place: cgi-io never creates one, and the
// plugin deliberately does no recursive delete as root.
mkdir(UP);
check('directory -> not_regular', set()?.error == 'not_regular');
rmdir(UP);

reject('LIMIT+1 bytes', 'too_large', () => writefile(UP, pad(JPG, LIMIT + 1)));
reject('svg', 'bad_type', () => writefile(UP, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
reject('html named .jpg-ish', 'bad_type', () => writefile(UP, '<html><script>alert(1)</script>'));
reject('webp', 'bad_type', () => writefile(UP, 'RIFF\x10\x00\x00\x00WEBPVP8 '));
reject('truncated jpeg magic', 'bad_type', () => writefile(UP, '\xff\xd8'));
reject('empty', 'bad_type', () => writefile(UP, ''));
check('no background installed by rejections', length(bgs()) == 0, sprintf('%J', bgs()));

// ---- success -------------------------------------------------------------
writefile(UP, pad(JPG, LIMIT));
let r = set();
check('exactly LIMIT bytes jpeg -> ok', r?.result == 'ok' && r?.ext == 'jpg', sprintf('%J', r));
check('jpeg installed as bg.jpg only', join(',', bgs()) == 'bg.jpg', sprintf('%J', bgs()));
check('jpeg content intact', length(readfile(`${BG}/bg.jpg`)) == LIMIT);
check('uci background=jpg', bgopt() == 'jpg', bgopt());
check('upload removed after success (M1)', lstat(UP) == null);

writefile(UP, PNG);
r = set();
check('png -> ok', r?.result == 'ok' && r?.ext == 'png', sprintf('%J', r));
check('png replaces jpg', join(',', bgs()) == 'bg.png', sprintf('%J', bgs()));
check('uci background=png', bgopt() == 'png', bgopt());

// ---- L3: rename failure cleans up and keeps the old background ------------
mkdir(`${BG}/bg.jpg`);
reject('rename onto a directory', 'write_failed', () => writefile(UP, JPG));
check('previous png kept after failed write', readfile(`${BG}/bg.png`) == PNG);
rmdir(`${BG}/bg.jpg`);

// ---- L2: free-space margin -------------------------------------------------
const pbig = plugin('1024 * 1024 * 1024 * 1024 * 1024');
writefile(UP, JPG);
r = pbig.set_background.call();
check('huge margin -> no_space (L2)', r?.error == 'no_space', sprintf('%J', r));
check('no_space: upload removed (M1)', lstat(UP) == null);

// ---- clear ----------------------------------------------------------------
r = p.clear_background.call();
check('clear -> ok', r?.result == 'ok', sprintf('%J', r));
check('clear removes files', length(bgs()) == 0, sprintf('%J', bgs()));
check('clear removes uci option', bgopt() == null, bgopt());

// ---- vars.ut (H1) -----------------------------------------------------------
let tsrc = readfile(`${SANDBOX}/vars.ut`);
for (let s in [ [ 'cursor()', `cursor('${CONF}')` ],
                [ '`/www/luci-static/nacre/background/', '`' + BG + '/' ] ]) {
	if (index(tsrc, s[0]) < 0)
		die(`check-background: '${s[0]}' not found in vars.ut`);
	tsrc = replace(tsrc, s[0], s[1]);
}
writefile(`${SANDBOX}/vars-test.ut`, tsrc);
const tmpl = loadfile(`${SANDBOX}/vars-test.ut`, { raw_mode: false });

function vars(opts) {
	const c = cursor(CONF);
	for (let k in [ 'accent', 'blur', 'alpha', 'background' ]) {
		if (k in opts) c.set('nacre', 'global', k, opts[k]);
		else c.delete('nacre', 'global', k);
	}
	c.commit('nacre');
	return render(call, tmpl, null, proto({ media: '/luci-static/nacre' }, global));
}

function has(out, s) { return index(out, s) >= 0; }

let out = vars({});
check('defaults', has(out, '--nacre-accent: #A1B5D8;') && has(out, '--nacre-login-blur: 14px;') &&
	has(out, '--nacre-login-alpha: 80%;') && !has(out, '--nacre-login-bg'), out);

out = vars({ accent: '#A1B5D8\n}</style><script>alert(1)</script><style>', blur: '14\n}', alpha: '80;}body{x' });
check('newline injection -> defaults, nothing echoed', !has(out, 'script') && !has(out, 'body{') &&
	has(out, '--nacre-accent: #A1B5D8;') && has(out, '--nacre-login-blur: 14px;') && has(out, '--nacre-login-alpha: 80%;'), out);

out = vars({ accent: 'x\n#123456' });
check('accent on second line rejected', has(out, '--nacre-accent: #A1B5D8;'), out);

out = vars({ accent: '#c0ffee', blur: '0', alpha: '100' });
check('valid values emitted', has(out, '--nacre-accent: #c0ffee;') && has(out, '--nacre-login-blur: 0px;') && has(out, '--nacre-login-alpha: 100%;'), out);

out = vars({ accent: 'red', blur: '31', alpha: '39' });
check('out of range -> defaults', has(out, '--nacre-accent: #A1B5D8;') && has(out, '--nacre-login-blur: 14px;') && has(out, '--nacre-login-alpha: 80%;'), out);

out = vars({ blur: '14.5', alpha: '1e2' });
check('non-integers -> defaults', has(out, '--nacre-login-blur: 14px;') && has(out, '--nacre-login-alpha: 80%;'), out);

out = vars({ blur: [ '1', '2' ] });
check('uci list -> default', has(out, '--nacre-login-blur: 14px;'), out);

out = vars({ background: 'jpg' });
check('background set but file missing -> no url', !has(out, '--nacre-login-bg'), out);

mkdir(BG);
writefile(`${BG}/bg.jpg`, JPG);
writefile(`${BG}/bg.svg`, '<svg/>');
out = vars({ background: 'jpg' });
const mt = stat(`${BG}/bg.jpg`).mtime;
check('background url with mtime', has(out, `--nacre-login-bg: url("/luci-static/nacre/background/bg.jpg?v=${mt}");`), out);

for (let bad in [ 'svg', 'jpg\n', 'JPG', '../bg.jpg', 'jpg"){}' ]) {
	out = vars({ background: bad });
	check(`background ${sprintf('%J', bad)} rejected`, !has(out, '--nacre-login-bg'), out);
}

print(`check-background: ${passed} passed, ${failed} failed\n`);
exit(failed ? 1 : 0);
