import { readFile, readdir } from "node:fs/promises";
import type { Client } from "discord.js-selfbot-v13";
import { dashboardState } from "./dashboard-state";
import { oldestUploadTime, pendingUploadCount } from "./webdav";

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

const age = (time: number) => {
    if (!Number.isFinite(time)) return "None waiting";
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
};

export const dashboard = async (client: Client) => {
    const entries = await readdir("output", { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    let logsExist = false;
    let messageEvents: { id: string; event: string; message?: { content?: string | null; authorId?: string; channelId?: string }; newMessage?: { content?: string | null; authorId?: string; channelId?: string } }[] = [];
    try {
        messageEvents = JSON.parse(await readFile("logs.json", "utf8"));
        logsExist = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let failures: { time: string; context: string; error: string }[] = [];
    try {
        failures = JSON.parse(await readFile("output/failures.json", "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const servers = entries.filter(entry => entry.parentPath === "output" && entry.isDirectory() && /^\d+$/.test(entry.name)).length;
    const channels = entries.filter(entry => entry.isFile() && entry.parentPath.endsWith("/messages") && entry.name.endsWith(".json")).length;
    const files = entries.filter(entry => entry.isFile()).length + Number(logsExist);
    const pendingEvents = entries.filter(entry => entry.isFile() && entry.parentPath === "output/checkpoints/events" && entry.name.endsWith(".json"));
    const oldestEvent = Math.min(...pendingEvents.map(entry => Number(entry.name.split("-")[0]) || Infinity));
    const uptime = Math.floor(process.uptime());
    const progress = dashboardState.catchUp;
    const recovery = dashboardState.recovery;
    const connected = client.isReady();
    const webdavHealthy = dashboardState.webdav === "Connected";
    const activity = dashboardState.activity.map(item => `<li><span>${escapeHtml(item.event)}</span><time>${escapeHtml(item.time)}</time></li>`).join("");
    const errors = failures.slice(-5).reverse().map(item => `<li class="failure"><div><strong>${escapeHtml(item.context)}</strong><time>${escapeHtml(item.time)}</time></div><p>${escapeHtml(item.error)}</p></li>`).join("");
    const messages = messageEvents.filter(item => ["messageCreate", "messageUpdate", "messageDelete"].includes(item.event)).slice(-10).reverse().map(item => {
        const message = item.event === "messageUpdate" ? item.newMessage : item.message;
        const timestamp = Number(item.id.split("-")[0]);
        const time = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : "Unknown time";
        return `<li><div class="message-meta"><strong>${escapeHtml(item.event)}</strong><time>${escapeHtml(time)}</time></div><p class="message-details">Author: ${escapeHtml(message?.authorId ?? "Unknown")} · Channel: ${escapeHtml(message?.channelId ?? "Unknown")}</p><p class="message-content">${message?.content ? escapeHtml(message.content) : "No text content available"}</p></li>`;
    }).join("");

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="15">
    <title>Collector dashboard</title>
    <link rel="stylesheet" href="/dashboard.css">
</head>
<body>
<main>
    <header class="header"><div><span class="eyebrow">DJS STREAM</span><h1>Collector dashboard</h1><p>Monitor collection, archive health, and recent activity.</p></div><div class="updated">Updates every 15 seconds<br>Uptime ${Math.floor(uptime / 3600)}h ${Math.floor(uptime % 3600 / 60)}m<form action="/logout" method="post"><button type="submit">Sign out</button></form></div></header>
    <section class="status-grid" aria-label="Service status">
        <article class="card status"><span class="label">DISCORD</span><strong><span class="dot ${connected ? "good" : "warn"}"></span>${connected ? "Connected" : "Disconnected"}</strong><small>Gateway connection</small></article>
        <article class="card status"><span class="label">WEBDAV</span><strong><span class="dot ${webdavHealthy ? "good" : "warn"}"></span>${escapeHtml(dashboardState.webdav)}</strong><small>Archive storage</small></article>
        <article class="card status"><span class="label">STARTUP</span><strong>${escapeHtml(dashboardState.startup)}</strong><small>Initial collection</small></article>
    </section>
    ${dashboardState.startup === "Recovering archive" || dashboardState.startup === "Recovery failed" ? `<section class="card panel recovery"><div class="section-heading"><div><span class="eyebrow">WEBDAV</span><h2>Archive recovery</h2></div><span class="badge">${escapeHtml(recovery.phase)}</span></div><p class="summary">${recovery.total === null ? "Discovering archive files…" : `<strong>${recovery.files.toLocaleString()} / ${recovery.total.toLocaleString()}</strong> files downloaded and validated${recovery.total > 0 ? ` · <strong>${Math.floor(recovery.files / recovery.total * 100)}%</strong>` : ""} · <strong>${(recovery.bytes / 1024 / 1024).toFixed(1)} MB</strong>`}</p>${recovery.path ? `<p class="muted">${escapeHtml(recovery.phase)}: ${escapeHtml(recovery.path)}</p>` : ""}</section>` : ""}
    <div class="columns">
        <section class="card panel"><div class="section-heading"><div><span class="eyebrow">PIPELINE</span><h2>Queues</h2></div></div><div class="metrics"><div><strong>${pendingUploadCount()}</strong><span>Pending uploads</span><small>Oldest: ${age(oldestUploadTime())}</small></div><div><strong>${pendingEvents.length}</strong><span>Unfinished events</span><small>Oldest: ${age(oldestEvent)}</small></div></div></section>
        <section class="card panel"><div class="section-heading"><div><span class="eyebrow">HISTORY</span><h2>Message catch-up</h2></div><span class="badge">${escapeHtml(progress.status)}</span></div><p class="summary"><strong>${progress.completed} / ${progress.total}</strong> channels checked &nbsp; · &nbsp; <strong>${progress.recovered}</strong> messages recovered</p><p class="muted">${progress.channel ? `Checking channel ${escapeHtml(progress.channel)}` : "No channel currently being checked"}${progress.failed ? ` · ${progress.failed} failed` : ""}</p></section>
    </div>
    <section class="card panel messages"><div class="section-heading"><div><span class="eyebrow">EVENT LOG</span><h2>Recent messages</h2></div><span class="badge">Latest 10</span></div>${messages ? `<ul class="message-list">${messages}</ul>` : '<p class="empty">No message events saved yet.</p>'}</section>
    <div class="columns">
        <section class="card panel"><div class="section-heading"><div><span class="eyebrow">THIS SESSION</span><h2>Recent activity</h2></div></div>${activity ? `<ul class="list">${activity}</ul>` : '<p class="empty">No events captured yet.</p>'}</section>
        <section class="card panel"><div class="section-heading"><div><span class="eyebrow">NEEDS ATTENTION</span><h2>Recent failures</h2></div><span class="badge">Latest 5</span></div>${errors ? `<ul class="list">${errors}</ul>` : '<p class="empty">No recorded failures.</p>'}</section>
    </div>
    <section class="card panel archive"><div><span class="eyebrow">LOCAL CACHE</span><h2>Archive</h2></div><div><strong>${servers}</strong><span>Servers</span></div><div><strong>${channels}</strong><span>Channels with messages</span></div><div><strong>${files}</strong><span>Files</span></div></section>
</main>
</body>
</html>`;
};
