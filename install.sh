#!/bin/sh
# nacre — install or remove the nacre LuCI theme on OpenWrt 25.12 (apk).
#
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)"
#   sh install.sh [-y] [--from <dir>]        install (ask before switching theme)
#   sh install.sh uninstall                   switch back to bootstrap and remove
#
# Installs from nacre's signed apk feed: adds its public key to /etc/apk/keys and
# the feed to customfeeds.list, then `apk add` by name — after that, updates
# show up in LuCI's Software page. Re-running replaces the key (key rotation).
#
# -y           switch LuCI to nacre without asking
# --from DIR   development: install the unsigned .apk files in DIR instead
set -eu

PKGS="luci-theme-nacre luci-app-nacre-config"
SITE="https://nanako0129.github.io/nacre"
FEED="$SITE/25.12/packages.adb"
KEY=/etc/apk/keys/nacre.pem
FEEDS=/etc/apk/repositories.d/customfeeds.list
# installed packages that belong to nacre, including translations (luci-i18n-nacre-*)
installed() { apk info 2>/dev/null | grep -E '^(luci-theme-nacre|luci-app-nacre-config|luci-i18n-nacre-.+)$' || true; }
YES=0
FROM=""
ACTION=install

die() { echo "nacre: $*" >&2; exit 1; }
say() { echo "nacre: $*"; }

while [ $# -gt 0 ]; do
	case "$1" in
		-y|--yes) YES=1 ;;
		--from) shift; [ -d "${1:-}" ] || die "--from needs an existing directory"; FROM="$1" ;;
		uninstall|remove) ACTION=uninstall ;;
		-h|--help) sed -n '2,12p' "$0" 2>/dev/null || true; exit 0 ;;
		*) die "unknown argument: $1" ;;
	esac
	shift
done

[ "$(id -u)" = 0 ] || die "run as root on the router"
command -v apk >/dev/null 2>&1 || {
	command -v opkg >/dev/null 2>&1 && die "this looks like OpenWrt 24.10 or older (opkg); nacre supports OpenWrt 25.12 (apk) only"
	die "apk not found; nacre supports OpenWrt 25.12 only"
}

switch_theme() {
	uci set luci.main.mediaurlbase="$1"
	uci commit luci
	rm -rf /tmp/luci-*
}

if [ "$ACTION" = uninstall ]; then
	[ "$(uci -q get luci.main.mediaurlbase)" = /luci-static/nacre ] && switch_theme /luci-static/bootstrap
	pkgs="$(installed)"
	# Remove translations with the app in one transaction: apk refuses to drop a
	# package that another installed package still depends on.
	[ -z "$pkgs" ] || apk del $pkgs || die "apk del failed; nothing else was removed"
	rm -rf /www/luci-static/nacre /lib/upgrade/keep.d/luci-app-nacre-config
	rm -f /etc/config/nacre /etc/config/nacre.apk-new /tmp/.uci/nacre
	# Stop trusting nacre's key and drop exactly our feed line, nothing else.
	rm -f "$KEY"
	if [ -f "$FEEDS" ] && grep -qxF "$FEED" "$FEEDS"; then
		grep -vxF "$FEED" "$FEEDS" > "$FEEDS.nacre-tmp" || true
		mv "$FEEDS.nacre-tmp" "$FEEDS"
	fi
	/etc/init.d/rpcd restart
	say "removed; LuCI theme is $(uci -q get luci.main.mediaurlbase)"
	exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # url dest
	if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$2" "$1"
	else uclient-fetch -q -O "$2" "$1"; fi
}

if [ -n "$FROM" ]; then
	for p in $PKGS; do
		f="$(ls "$FROM"/"$p"-[0-9]*.apk 2>/dev/null | head -1)"
		[ -n "$f" ] || die "no $p-*.apk in $FROM"
	done
	cp "$FROM"/luci-theme-nacre-[0-9]*.apk "$FROM"/luci-app-nacre-config-[0-9]*.apk "$TMP/"
	cp "$FROM"/luci-i18n-nacre-*.apk "$TMP/" 2>/dev/null || true
	say "installing (development, unsigned) $(cd "$TMP" && ls *.apk | tr '\n' ' ')"
	apk add --allow-untrusted "$TMP"/*.apk
else
	# Trust nacre's key: download aside, check it is a public key, then move it
	# into place, so a failed download never leaves a broken file in keys/.
	fetch "$SITE/nacre.pem" "$TMP/nacre.pem" || die "cannot download $SITE/nacre.pem"
	grep -q 'BEGIN PUBLIC KEY' "$TMP/nacre.pem" || die "$SITE/nacre.pem is not a public key"
	mv "$TMP/nacre.pem" "$KEY"
	grep -qxF "$FEED" "$FEEDS" 2>/dev/null || echo "$FEED" >> "$FEEDS"
	say "trusting $KEY (sha256 $(sha256sum "$KEY" | cut -d' ' -f1)) for $FEED"
	apk update >/dev/null 2>&1 || true
	apk search luci-theme-nacre 2>/dev/null | grep -q '^luci-theme-nacre-' \
		|| die "luci-theme-nacre not found in $FEED (apk update failed?)"
	i18n="$(apk search luci-i18n-nacre 2>/dev/null | sed 's/-[0-9].*//' | sort -u | tr '\n' ' ')"
	say "installing $PKGS $i18n"
	# add installs what is missing but never upgrades; add --upgrade would also
	# upgrade every dependency (luci-base, rpcd…). upgrade <names> touches only
	# the named packages (apk-tools 3.0.5, measured with -s).
	apk add $PKGS $i18n && apk upgrade $PKGS $i18n
fi

current="$(uci -q get luci.main.mediaurlbase || echo '?')"
if [ "$current" = /luci-static/nacre ]; then
	say "installed; nacre is already the active theme"
elif [ "$YES" = 1 ]; then
	switch_theme /luci-static/nacre
	say "installed and switched LuCI to nacre (was $current)"
else
	printf 'nacre: switch LuCI to nacre now? (was %s) [y/N] ' "$current"
	read -r ans </dev/tty 2>/dev/null || ans=n
	case "$ans" in
		y|Y|yes) switch_theme /luci-static/nacre; say "switched to nacre" ;;
		*) say "installed; pick nacre later under System > System > Language and Style" ;;
	esac
fi
