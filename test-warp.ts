const response = await fetch("https://api.ipify.org?format=json", {
    proxy: "http://127.0.0.1:40000",
    signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`IP lookup through WARP failed: HTTP ${response.status}`);
const result = await response.json() as { ip: string };
console.log(result.ip);
