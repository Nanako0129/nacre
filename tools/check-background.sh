#!/bin/sh
# Run tools/check-background.uc on the build box with the SDK's target ucode
# (x86_64 musl, started through the toolchain's loader). Everything happens in
# a mktemp sandbox under /tmp on the build box, removed afterwards; nothing
# touches a router.
set -eu

BUILD_HOST="${BUILD_HOST:-root@192.168.123.249}"
SDK_DIR="${SDK_DIR:-/root/sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

BOX=$(ssh -o BatchMode=yes "$BUILD_HOST" 'mktemp -d /tmp/nacre-check.XXXXXX')
trap 'ssh -o BatchMode=yes "$BUILD_HOST" "rm -rf $BOX"' EXIT

scp -q "$ROOT/luci-app-nacre-config/root/usr/share/rpcd/ucode/luci.nacre.uc" \
	"$ROOT/luci-theme-nacre/ucode/template/themes/nacre/vars.ut" \
	"$ROOT/tools/check-background.uc" "$BUILD_HOST:$BOX/"

ssh -o BatchMode=yes "$BUILD_HOST" "
	R=$SDK_DIR/staging_dir/target-x86_64_musl/root-x86
	LD=\$(ls $SDK_DIR/staging_dir/toolchain-*/lib/ld-musl-x86_64.so.1)
	\$LD --library-path \$R/lib:\$R/usr/lib \$R/usr/bin/ucode \
		-L \"\$R/usr/lib/ucode/*.so\" -L \"\$R/usr/share/ucode/*.uc\" \
		-D SANDBOX='\"$BOX\"' $BOX/check-background.uc"
