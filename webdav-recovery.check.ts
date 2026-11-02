import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreArchive } from "./webdav-recovery";

const baseUrl = new URL("https://dav.example/dav/Koofr/");
const prefix = "/dav/Koofr/";
const checkpoint = "djs-stream/output/checkpoints/events/1.json";
const files: Record<string, string> = {
    "djs-stream/logs.json": '[{"id":"saved"}]',
    [checkpoint]: '{"id":"pending"}',
};

const listing = (directory: string) => {
    const children = new Map<string, boolean>([[directory, true]]);
    for (const path of Object.keys(files)) {
        if (!path.startsWith(directory)) continue;
        const name = path.slice(directory.length).split("/")[0]!;
        const child = `${directory}${name}`;
        children.set(child, child !== path);
    }
    const entries = [...children].map(([path, collection]) => `
        <d:response><d:href>${prefix}${path}</d:href><d:propstat>
        <d:prop><d:resourcetype>${collection ? "<d:collection/>" : ""}</d:resourcetype></d:prop>
        <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
    return `<d:multistatus xmlns:d="DAV:">${entries}</d:multistatus>`;
};

const request = async (path: string, method: string) => {
    if (method === "PROPFIND") return new Response(listing(`${path.replace(/\/$/, "")}/`), { status: 207 });
    assert.equal(method, "GET");
    assert.ok(Object.hasOwn(files, path));
    return new Response(files[path]);
};

const staging = mkdtempSync(join(tmpdir(), "webdav-recovery-check-"));
try {
    assert.equal(await restoreArchive(baseUrl, staging, request), true);
    assert.deepEqual(JSON.parse(readFileSync(join(staging, "logs.json"), "utf8")), [{ id: "saved" }]);
    assert.deepEqual(JSON.parse(readFileSync(join(staging, "output/checkpoints/events/1.json"), "utf8")), { id: "pending" });

    files[checkpoint] = "invalid JSON";
    await assert.rejects(() => restoreArchive(baseUrl, staging, request), SyntaxError);
    await assert.rejects(() => restoreArchive(baseUrl, staging, async () => new Response(null, { status: 401 })), /HTTP 401/);
    await assert.rejects(() => restoreArchive(baseUrl, staging, async () => new Response(null, { status: 500 })), /HTTP 500/);
    await assert.rejects(() => restoreArchive(baseUrl, staging, async () => new Response("<broken>", { status: 207 })));
    await assert.rejects(() => restoreArchive(baseUrl, staging, async () => new Response(
        listing("djs-stream/").replace("/dav/Koofr/djs-stream/", "/outside/"), { status: 207 }
    )), /outside the archive/);
    await assert.rejects(() => restoreArchive(baseUrl, staging, async () => new Response(
        listing("djs-stream/").replaceAll("200 OK", "403 Forbidden"), { status: 207 }
    )), /Unable to read/);

    const empty = join(staging, "empty");
    assert.equal(await restoreArchive(baseUrl, empty, async () => new Response(null, { status: 404 })), false);
    assert.equal(existsSync(empty), false);
    console.log("Recovery checks passed: archive and checkpoint restoration, corrupt JSON, denied access, server errors, invalid XML, unsafe paths, and a new archive.");
} finally {
    rmSync(staging, { recursive: true, force: true });
}
