#!/bin/bash
# Run a command while the router's LuCI theme is temporarily switched to nacre.
# Always restores argon on exit (normal, error, Ctrl-C) and verifies the login
# page serves argon again. Hard time limit: WINDOW seconds (default 600).
#
# Usage: tools/with-nacre.sh <command...>
set -euo pipefail

ROUTER="${ROUTER:-root@192.168.123.1}"
WINDOW="${WINDOW:-600}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=5 "$ROUTER")

restore() {
	"${SSH[@]}" 'uci set luci.main.mediaurlbase=/luci-static/argon; uci commit luci; rm -rf /tmp/luci-*' || true
	# Capture first: `curl | grep -q` under pipefail reports SIGPIPE as failure.
	local html
	html="$(curl -sk "https://${ROUTER#*@}/cgi-bin/luci/" || true)"
	if [[ "$html" == *luci-static/argon* ]]; then
		echo "with-nacre: restored argon (verified)" >&2
	else
		echo "with-nacre: WARNING argon restore NOT verified" >&2
		return 1
	fi
}
trap restore EXIT

"${SSH[@]}" 'uci set luci.main.mediaurlbase=/luci-static/nacre; uci commit luci; rm -rf /tmp/luci-*'
echo "with-nacre: nacre active for at most ${WINDOW}s" >&2

perl -e 'alarm shift; exec @ARGV' "$WINDOW" "$@"
