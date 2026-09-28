#!/bin/sh
# nacre — install or remove the nacre LuCI theme on OpenWrt 25.12 (apk).
#
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/Nanako0129/nacre/main/install.sh)"
#   sh install.sh [-y] [--from <dir>]        install (ask before switching theme)
#   sh install.sh uninstall                   switch back to bootstrap and remove
#
# -y           switch LuCI to nacre without asking
# --from DIR   install the .apk files in DIR instead of the latest GitHub release
set -eu

REPO="Nanako0129/nacre"
PKGS="luci-theme-nacre luci-app-nacre-config"
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
else
	api="https://api.github.com/repos/$REPO/releases/latest"
	fetch "$api" "$TMP/release.json" || die "cannot reach GitHub ($api)"
	urls="$(jsonfilter -i "$TMP/release.json" -e '@.assets[*].browser_download_url' | grep '\.apk$')" \
		|| die "no .apk assets in the latest release"
	for url in $urls; do
		fetch "$url" "$TMP/$(basename "$url")" || die "download failed: $url"
	done
fi

say "installing $(cd "$TMP" && ls *.apk | tr '\n' ' ')"
# The packages are not signed by an OpenWrt key; --allow-untrusted is required.
apk add --allow-untrusted "$TMP"/*.apk

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
