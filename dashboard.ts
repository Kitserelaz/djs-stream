import { readdir, stat } from "node:fs/promises";
import type { Client } from "discord.js-selfbot-v13";
import { recentActivity } from "./log-event";
import { pendingUploadCount } from "./webdav";

export const dashboard = async (client: Client) => {
    const entries = await readdir("output", { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    let logsExist = false;
    try {
        await stat("logs.json");
        logsExist = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const servers = entries.filter(entry => entry.parentPath === "output" && entry.isDirectory() && /^\d+$/.test(entry.name)).length;
    const channels = entries.filter(entry => entry.isFile() && entry.parentPath.endsWith("/messages") && entry.name.endsWith(".json")).length;
    const files = entries.filter(entry => entry.isFile()).length + Number(logsExist);
    const uptime = Math.floor(process.uptime());

    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Collector status</title></head>
<body>
    <h1>Collector status</h1>
    <p>Discord: ${client.isReady() ? "Connected" : "Disconnected"}</p>
    <p>Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor(uptime % 3600 / 60)}m ${uptime % 60}s</p>
    <p>Pending WebDAV uploads: ${pendingUploadCount()}</p>
    <p>Latest captured event this session: ${recentActivity ? `${recentActivity.event} at ${recentActivity.time}` : "None"}</p>
    <h2>Local archive</h2>
    <p>Servers: ${servers}</p>
    <p>Channels with message files: ${channels}</p>
    <p>Files: ${files}</p>
</body>
</html>`;
};
