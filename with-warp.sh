#!/usr/bin/env bash
set -euo pipefail

if (( $# == 0 )); then
    echo "Usage: bash with-warp.sh bun run account-username.ts" >&2
    exit 1
fi

for dependency in usque curl; do
    if ! command -v "$dependency" >/dev/null; then
        echo "Missing $dependency. Use the project's Docker image, which installs Usque and curl." >&2
        exit 1
    fi
done

umask 077
mkdir -p /var/lib/usque
if [[ ! -f /var/lib/usque/config.json ]]; then
    usque --config /var/lib/usque/config.json register --accept-tos
fi

app_pid=""
usque --config /var/lib/usque/config.json l4-http-proxy -b 127.0.0.1 -p 40000 &
proxy_pid=$!

cleanup() {
    if [[ -n "$app_pid" ]]; then
        kill -TERM "$app_pid" 2>/dev/null || true
        wait "$app_pid" 2>/dev/null || true
    fi
    kill -TERM "$proxy_pid" 2>/dev/null || true
    wait "$proxy_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Verifying traffic through WARP…"
connected=false
for (( attempt = 0; attempt < 12; attempt++ )); do
    if ! kill -0 "$proxy_pid" 2>/dev/null; then
        echo "Usque exited before the WARP connection could be verified." >&2
        exit 1
    fi
    if trace=$(curl --silent --show-error --fail --max-time 5 --noproxy "" \
        --proxy http://127.0.0.1:40000 https://www.cloudflare.com/cdn-cgi/trace); then
        if [[ "$trace" == *$'warp=on'* || "$trace" == *$'warp=plus'* ]]; then
            connected=true
            break
        fi
    fi
    sleep 1
done
if [[ "$connected" != true ]]; then
    echo "WARP proxy verification failed; the command will not start." >&2
    exit 1
fi

export HTTP_PROXY=http://127.0.0.1:40000
export HTTPS_PROXY=http://127.0.0.1:40000
export ALL_PROXY=http://127.0.0.1:40000
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" all_proxy="$ALL_PROXY"
export NO_PROXY=localhost,127.0.0.1,::1
export no_proxy="$NO_PROXY"

echo "WARP connected. Starting command."
"$@" &
app_pid=$!
wait "$app_pid"
app_pid=""
