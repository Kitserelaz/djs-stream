import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureWebDav, webDavRequest } from "./webdav";
import { restoreArchive } from "./webdav-recovery";

const baseUrl = configureWebDav();
const staging = mkdtempSync(join(tmpdir(), "djs-stream-download-"));
try {
    if (!await restoreArchive(baseUrl, staging, webDavRequest)) throw new Error("No remote archive files found");
    rmSync("output", { recursive: true, force: true });
    rmSync("logs.json", { force: true });
    if (existsSync(join(staging, "output"))) cpSync(join(staging, "output"), "output", { recursive: true });
    if (existsSync(join(staging, "logs.json"))) cpSync(join(staging, "logs.json"), "logs.json");
} finally {
    rmSync(staging, { recursive: true, force: true });
}
