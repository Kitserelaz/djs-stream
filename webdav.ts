import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { restoreArchive } from "./webdav-recovery";
import { shutdownSignal, throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";
import { dashboardState } from "./dashboard-state";

const pending = new Set<string>();
const queuedAt = new Map<string, number>();
let uploadingSince: number | undefined;
let uploadingPath: string | undefined;
export const pendingUploadCount = () => pending.size + (uploadingPath ? 1 : 0);
export const oldestUploadTime = () => Math.min(...queuedAt.values(), uploadingSince ?? Infinity);
const collections = new Set<string>();
let uploadTask: Promise<void> | undefined;
let enabled = false;
let baseUrl: URL;
let authorization: string;
let reportFailure: (context: string, error: unknown) => void;

const isArchiveFile = (path: string) => path === "logs.json"
    || (path.startsWith("output/") && path.endsWith(".json"));

export const webDavRequest = async (path: string, method: string, body?: string | Buffer, headers?: Record<string, string>, timeout = 45_000) => {
    const uploading = method === "PUT" || method === "MKCOL";
    if (!uploading) throwIfStopping();
    const url = new URL(path.split("/").map(encodeURIComponent).join("/"), baseUrl);
    return await fetch(url, {
        method,
        headers: { Authorization: authorization, ...headers },
        body,
        signal: uploading ? AbortSignal.timeout(timeout)
            : AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeout)]),
        redirect: "error",
    });
};

const send = async (path: string, method: "MKCOL" | "PUT" | "DELETE", body?: Buffer) => {
    const response = await webDavRequest(path, method, body, { "Content-Type": "application/json" });
    await response.body?.cancel();
    const alreadyExists = method === "MKCOL" && response.status === 405;
    const alreadyDeleted = method === "DELETE" && response.status === 404;
    if (!response.ok && !alreadyExists && !alreadyDeleted) {
        throw new Error(`WebDAV ${method} ${path}: HTTP ${response.status}`);
    }
};

const ensureCollections = async (path: string) => {
    const parts = dirname(path).split("/").filter(part => part !== ".");
    let directory = "djs-stream";
    for (const part of ["", ...parts]) {
        if (part) directory += `/${part}`;
        if (collections.has(directory)) continue;
        await send(directory, "MKCOL");
        collections.add(directory);
    }
};

const uploadPending = async () => {
    if (!enabled || !pending.size) return;
    if (uploadTask) return await uploadTask;
    uploadTask = (async () => {
        while (pending.size) {
            const path = pending.values().next().value!;
            pending.delete(path);
            uploadingPath = path;
            uploadingSince = queuedAt.get(path);
            queuedAt.delete(path);
            try {
                // A missing cache file must never silently count as a saved write.
                await ensureCollections(path);
                const body = readFileSync(path);
                logProgress("WebDAV", `Uploading ${path} (${body.length} bytes; ${pending.size} other files queued).`);
                await send(`djs-stream/${path}`, "PUT", body);
                uploadingPath = undefined;
                uploadingSince = undefined;
                dashboardState.webdav = "Connected";
                logProgress("WebDAV", `Uploaded ${path}.`);
            } catch (error) {
                uploadingPath = undefined;
                queuedAt.set(path, Math.min(queuedAt.get(path) ?? Infinity, uploadingSince ?? Date.now()));
                uploadingSince = undefined;
                pending.add(path);
                dashboardState.webdav = "Retrying upload";
                logProgress("WebDAV", `Upload failed for ${path}; retrying after 30 seconds.`);
                try {
                    reportFailure(`Uploading ${path} to WebDAV`, error);
                } catch (reportError) {
                    console.error("Recording WebDAV failure", reportError);
                }
                await delay(30_000);
            }
        }
    })();
    try {
        await uploadTask;
    } finally {
        uploadTask = undefined;
    }
};

export const queueUpload = (path: string) => {
    if (!isArchiveFile(path)) return;
    if (!pending.has(path)) logProgress("WebDAV", `Queued ${path}.`);
    if (!pending.has(path)) queuedAt.set(path, Date.now());
    pending.add(path);
    void uploadPending();
};

export const flushUploads = async () => {
    if (!enabled) throw new Error("WebDAV recovery has not completed");
    if (uploadTask) await uploadTask;
    await uploadPending();
};

export const deleteRemoteCheckpoint = async (path: string) => {
    await send(`djs-stream/${path}`, "DELETE");
    logProgress("WebDAV", `Removed completed checkpoint ${path}.`);
};

export const waitForUploads = async () => {
    logProgress("WebDAV", `Waiting for uploads (${pending.size} queued${uploadTask ? "; upload in progress" : ""}).`);
    if (enabled) await flushUploads();
};

const queueDirectory = (directory: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) queueDirectory(path);
        else if (entry.isFile()) queueUpload(path);
    }
};

export const configureWebDav = () => {
    const { WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD } = process.env;
    if (!WEBDAV_URL || !WEBDAV_USERNAME || !WEBDAV_PASSWORD) {
        throw new Error("Set WEBDAV_URL, WEBDAV_USERNAME, and WEBDAV_PASSWORD in .env");
    }
    baseUrl = new URL(`${WEBDAV_URL.replace(/\/$/, "")}/`);
    authorization = `Basic ${Buffer.from(`${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}`).toString("base64")}`;
    return baseUrl;
};

export const startWebDav = async (onFailure: typeof reportFailure) => {
    configureWebDav();
    reportFailure = onFailure;

    const staging = mkdtempSync(join(tmpdir(), "djs-stream-recovery-"));
    let restored = false;
    try {
        restored = await restoreArchive(baseUrl, staging, webDavRequest, (phase, path, files, bytes, total) => {
            Object.assign(dashboardState.recovery, { phase, path, files, bytes, total });
        });
        throwIfStopping();
        if (restored) {
            dashboardState.recovery.phase = "Installing";
            dashboardState.recovery.path = "";
            logProgress("Recovery", "Installing validated archive as the local cache.");
            // Install the remote cache only after every download has succeeded.
            rmSync("output", { recursive: true, force: true });
            rmSync("logs.json", { force: true });
            if (existsSync(join(staging, "output"))) cpSync(join(staging, "output"), "output", { recursive: true });
            if (existsSync(join(staging, "logs.json"))) cpSync(join(staging, "logs.json"), "logs.json");
        }
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }

    enabled = true;
    dashboardState.recovery.phase = "Syncing local files";
    dashboardState.recovery.path = "";
    dashboardState.webdav = "Connected";
    if (!restored) {
        if (existsSync("logs.json")) queueUpload("logs.json");
        queueDirectory("output");
    }
    await flushUploads();
    dashboardState.recovery.phase = "Complete";
};
