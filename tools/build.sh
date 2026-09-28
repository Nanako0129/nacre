#!/bin/sh
# Build luci-theme-nacre and luci-app-nacre-config with the OpenWrt 25.12.5 SDK
# on a native x86_64 build box (the SDK is x86-only; emulating it on Apple
# Silicon took ~15 min per build). The box keeps build_dir/staging_dir, so only
# the nacre packages are rebuilt each time.
# Output: dist/*.apk
set -eu

BUILD_HOST="${BUILD_HOST:-root@192.168.123.249}"
SDK_DIR="${SDK_DIR:-/root/sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKGS="luci-theme-nacre luci-app-nacre-config"

mkdir -p "$ROOT/dist"
rm -f "$ROOT"/dist/*.apk

for p in $PKGS; do
	rsync -a --delete "$ROOT/$p/" "$BUILD_HOST:$SDK_DIR/package/$p/"
done

ssh -o BatchMode=yes "$BUILD_HOST" "cd $SDK_DIR && \
	make defconfig >/dev/null && \
	rm -f bin/packages/*/base/luci-*nacre*.apk && \
	for p in $PKGS; do \
		make package/\$p/clean >/dev/null 2>&1; \
		make package/\$p/compile -j\$(nproc) >/tmp/build-\$p.log 2>&1 || { tail -40 /tmp/build-\$p.log; exit 1; }; \
	done"

rsync -a "$BUILD_HOST:$SDK_DIR/bin/packages/*/base/luci-*nacre*.apk" "$ROOT/dist/"
ls -la "$ROOT"/dist/*.apk
