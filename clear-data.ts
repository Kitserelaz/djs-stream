import { rmSync } from "node:fs";
import { configureWebDav, webDavRequest } from "./webdav";

configureWebDav();
console.log("Deleting the WebDAV archive; this may take a while.");
const response = await webDavRequest("djs-stream", "DELETE", undefined, undefined, 30 * 60_000);
if (response.status === 207) throw new Error(`WebDAV DELETE partially failed: ${await response.text()}`);
await response.body?.cancel();
if (!response.ok && response.status !== 404) throw new Error(`WebDAV DELETE: HTTP ${response.status}`);

rmSync("output", { recursive: true, force: true });
rmSync("logs.json", { force: true });
console.log("Cleared the WebDAV archive and local cache.");
