#!/usr/bin/env bash
set -euo pipefail

if (( $# == 0 )); then
    echo "Usage: bash with-warp.sh bun run account-username.ts" >&2
    exit 1
fi

for dependency in warp-svc warp-cli curl; do
    if ! command -v "$dependency" >/dev/null; then
        echo "Missing $dependency. Install cloudflare-warp and curl in the container image." >&2
        exit 1
    fi
done

app_pid=""
warp-svc &
warp_pid=$!

cleanup() {
    if [[ -n "$app_pid" ]]; then
        kill -TERM "$app_pid" 2>/dev/null || true
        wait "$app_pid" 2>/dev/null || true
    fi
    kill -TERM "$warp_pid" 2>/dev/null || true
    wait "$warp_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Waiting for the WARP daemon…"
daemon_ready=false
for (( attempt = 0; attempt < 30; attempt++ )); do
    kill -0 "$warp_pid"
    if warp-cli --accept-tos status >/dev/null 2>&1; then
        daemon_ready=true
        break
    fi
    sleep 1
done
if [[ "$daemon_ready" != true ]]; then
    echo "WARP daemon did not become ready." >&2
    exit 1
fi

if ! warp-cli --accept-tos registration show >/dev/null 2>&1; then
    warp-cli --accept-tos registration new
fi
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect

echo "Verifying traffic through WARP…"
connected=false
for (( attempt = 0; attempt < 12; attempt++ )); do
    kill -0 "$warp_pid"
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
