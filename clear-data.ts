import { rmSync } from "node:fs";

const { WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD } = process.env;
if (!WEBDAV_URL || !WEBDAV_USERNAME || !WEBDAV_PASSWORD) {
    throw new Error("Set WEBDAV_URL, WEBDAV_USERNAME, and WEBDAV_PASSWORD in .env");
}
const baseUrl = new URL(`${WEBDAV_URL.replace(/\/$/, "")}/`);
console.log("Deleting the WebDAV archive; this may take a while.");
const response = await fetch(new URL("djs-stream", baseUrl), {
    method: "DELETE",
    headers: { Authorization: `Basic ${Buffer.from(`${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}`).toString("base64")}` },
    proxy: false,
    redirect: "error",
    signal: AbortSignal.timeout(30 * 60_000),
});
if (response.status === 207) throw new Error(`WebDAV DELETE partially failed: ${await response.text()}`);
await response.body?.cancel();
if (!response.ok && response.status !== 404) throw new Error(`WebDAV DELETE: HTTP ${response.status}`);

rmSync("output", { recursive: true, force: true });
rmSync("logs.json", { force: true });
console.log("Cleared the WebDAV archive and local cache.");
