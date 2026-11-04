const response = await fetch("https://www.google.com", {
    proxy: "http://127.0.0.1:40000",
    signal: AbortSignal.timeout(30_000),
});
await response.body?.cancel();
if (!response.ok) throw new Error(`Google request through WARP failed: HTTP ${response.status}`);
console.log(`Google reached through the WARP proxy: HTTP ${response.status}`);
