import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { queueUpload } from "./webdav";
import { throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";
export const readJson = <T>(path: string, initial: T): T => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : initial;
export const writeJson = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2));
    renameSync(temporary, path);
    queueUpload(path);
};
export const recordFailure = (context: string, error: unknown) => {
    const failure = { time: new Date().toISOString(), context, error: String(error) };
    const failures = readJson<object[]>("output/failures.json", []);
    failures.push(failure);
    writeJson("output/failures.json", failures);
    console.error(context, error);
};
export const safeJson = (context: string, value: {
    toJSON(): unknown;
}) => {
    try {
        return JSON.parse(JSON.stringify(value.toJSON()));
    }
    catch (error) {
        recordFailure(context, error);
        return null;
    }
};
const pendingCheckpoints = new Map<string, Promise<unknown>>();
export const checkpoint = async <T>(path: string, operation: () => Promise<T>): Promise<T> => {
    throwIfStopping();
    if (existsSync(path)) {
        logProgress("Checkpoint", `Using saved ${path}.`);
        return readJson<T>(path, undefined as T);
    }
    const pending = pendingCheckpoints.get(path);
    if (pending)
        return await pending as T;
    const task = (async () => {
        logProgress("Checkpoint", `Collecting ${path}.`);
        const value = await operation();
        throwIfStopping();
        writeJson(path, value);
        logProgress("Checkpoint", `Saved ${path}.`);
        return value;
    })();
    pendingCheckpoints.set(path, task);
    try {
        return await task;
    }
    finally {
        pendingCheckpoints.delete(path);
    }
};
export const saveRecord = (path: string, id: string, value: unknown) => {
    const records = readJson<Record<string, unknown>>(path, {});
    records[id] = value;
    writeJson(path, records);
};
export const archiveDirectory = (guildId: string | null) => `output/${guildId ?? "dms"}`;
export const initializeArchive = (directory: string) => {
    for (const name of ["authors", "all_users", "external_invites"]) {
        const path = `${directory}/${name}.json`;
        if (!existsSync(path))
            writeJson(path, {});
    }
    const mentions = `${directory}/mentioned_users.json`;
    if (!existsSync(mentions))
        writeJson(mentions, []);
};
