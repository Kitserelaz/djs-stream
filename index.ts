import { Client } from "discord.js-selfbot-v13";
import express from "express";
import { dashboard } from "./dashboard";
import { createEventLogger } from "./log-event";
import { exportMetadata } from "./metadata";
import { recordFailure } from "./storage";
import { startWebDav, waitForUploads } from "./webdav";
import { beginShutdown, cancelDiscordRequestsOnShutdown, shutdownSignal, throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";

const client = new Client();
const app = express();
app.get("/", async (_request, response) => response.send(await dashboard(client)));
app.listen(Number(process.env.PORT) || 3000);
cancelDiscordRequestsOnShutdown(client);
const activeTasks = new Set<Promise<void>>();

const trackTask = async (operation: () => Promise<void>) => {
    if (shutdownSignal.aborted) return;
    const task = operation();
    activeTasks.add(task);
    try {
        await task;
    } catch (error) {
        if (!shutdownSignal.aborted) recordFailure("Collecting archive data", error);
    } finally {
        activeTasks.delete(task);
    }
};

const shutdown = async () => {
    if (shutdownSignal.aborted) return;
    logProgress("Shutdown", "Stopping collection and waiting for WebDAV uploads.");
    beginShutdown();
    try {
        client.destroy();
        await Promise.allSettled([...activeTasks]);
        await waitForUploads();
        logProgress("Shutdown", "WebDAV uploads finished; exiting.");
        process.exit(0);
    } catch (error) {
        console.error("Shutdown failed:", error);
        process.exit(1);
    }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await trackTask(async () => {
    logProgress("Startup", "Recovering archive from WebDAV before connecting to Discord.");
    await startWebDav(recordFailure);
    logProgress("Startup", "WebDAV recovery finished.");
    throwIfStopping();
    const { logEvent, logMemberEvent, resume } = createEventLogger(client);

    client.on("messageCreate", async (message) => {
        await trackTask(async () => logEvent("messageCreate", message));
    });

    client.on("messageUpdate", async (oldMessage, newMessage) => {
        await trackTask(async () => logEvent("messageUpdate", oldMessage, newMessage));
    });

    client.on("messageDelete", async (message) => {
        await trackTask(async () => logEvent("messageDelete", message));
    });

    client.on("guildMemberAdd", async (member) => {
        await trackTask(async () => logMemberEvent("guildMemberAdd", member));
    });

    client.on("guildMemberUpdate", async (oldMember, member) => {
        await trackTask(async () => logMemberEvent("guildMemberUpdate", member, oldMember));
    });

    client.once("ready", async () => {
        logProgress("Discord", `Connected as user ${client.user!.id}; ${client.guilds.cache.size} servers available.`);
        await Promise.all([
            trackTask(resume),
            trackTask(async () => exportMetadata(client)),
        ]);
        if (!shutdownSignal.aborted) logProgress("Startup", "Initial collection finished; listening for message and member events.");
    });

    logProgress("Discord", "Logging in and waiting for the gateway to become ready.");
    await client.login(process.env.token);
});
