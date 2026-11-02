import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { logProgress } from "./logging";

type DavRequest = (path: string, method: string, body?: string, headers?: Record<string, string>) => Promise<Response>;

const parser = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: name => name === "response" || name === "propstat",
});

export const restoreArchive = async (baseUrl: URL, staging: string, request: DavRequest, onProgress?: (phase: string, path: string, files: number, bytes: number, total: number | null) => void) => {
    const root = decodeURIComponent(new URL("djs-stream/", baseUrl).pathname);
    let restored = 0;
    let bytes = 0;
    const files: string[] = [];

    const restoreDirectory = async (directory: string) => {
        onProgress?.("Discovering", `djs-stream/${directory}`, restored, bytes, null);
        logProgress("Recovery", `Listing djs-stream/${directory}`);
        const response = await request(`djs-stream/${directory}${directory ? "/" : ""}`, "PROPFIND",
            '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
            { Depth: "1", "Content-Type": "application/xml" });
        if (!directory && response.status === 404) {
            logProgress("Recovery", "No remote archive exists; initializing from local files.");
            await response.body?.cancel();
            return;
        }
        if (response.status !== 207) {
            await response.body?.cancel();
            throw new Error(`WebDAV recovery listing ${directory}: HTTP ${response.status}`);
        }
        const xml = await response.text();
        if (/<!DOCTYPE/i.test(xml)) throw new Error("Unexpected DOCTYPE in WebDAV listing");
        const entries = parser.parse(xml, true).multistatus?.response;
        if (!Array.isArray(entries) || !entries.length) throw new Error("Invalid WebDAV directory listing");

        for (const entry of entries) {
            if (typeof entry.href !== "string") throw new Error("Missing WebDAV resource URL");
            const url = new URL(entry.href, baseUrl);
            const decoded = decodeURIComponent(url.pathname);
            const path = decoded.replace(/\/$/, "");
            if (url.origin !== baseUrl.origin || (path !== root.slice(0, -1) && !decoded.startsWith(root))) {
                throw new Error("WebDAV resource is outside the archive directory");
            }
            const relative = path === root.slice(0, -1) ? "" : path.slice(root.length);
            const properties = entry.propstat?.find((value: { status?: string }) => /\s200\s/.test(value.status ?? ""))?.prop;
            if (!properties || !Object.hasOwn(properties, "resourcetype")) {
                throw new Error(`Unable to read WebDAV resource ${relative}`);
            }
            if (relative === directory) continue;
            if (relative.split("/").some(part => !part || part === "." || part === ".." || /[\\\0]/.test(part))) {
                throw new Error("Invalid WebDAV archive path");
            }
            if (dirname(relative) !== (directory || ".")) throw new Error("Unexpected WebDAV directory depth");
            const isDirectory = Object.hasOwn(Object(properties.resourcetype), "collection");
            if (isDirectory) {
                if (relative === "output" || relative.startsWith("output/")) await restoreDirectory(relative);
                continue;
            }
            if (relative !== "logs.json" && !(relative.startsWith("output/") && relative.endsWith(".json"))) continue;
            files.push(relative);
        }
    };

    await restoreDirectory("");
    onProgress?.("Downloading", "", restored, bytes, files.length);
    for (let index = 0; index < files.length; index += 8) {
        const results = await Promise.allSettled(files.slice(index, index + 8).map(async relative => {
            onProgress?.("Downloading", relative, restored, bytes, files.length);
            const file = await request(`djs-stream/${relative}`, "GET");
            if (!file.ok) {
                await file.body?.cancel();
                throw new Error(`WebDAV recovery download ${relative}: HTTP ${file.status}`);
            }
            const content = await file.text();
            JSON.parse(content);
            const destination = join(staging, relative);
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, content);
            restored++;
            bytes += Buffer.byteLength(content);
            onProgress?.("Downloading", relative, restored, bytes, files.length);
            logProgress("Recovery", `Restored ${relative} (${Buffer.byteLength(content)} bytes; ${restored} files downloaded).`);
        }));
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
    }
    logProgress("Recovery", `Download finished: ${restored} files validated.`);
    return restored > 0;
};
