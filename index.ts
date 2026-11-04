import { createDiscordClient } from "./discord-client";
import express from "express";
import { fileURLToPath } from "node:url";
import { dashboard } from "./dashboard";
import { dashboardAuth } from "./dashboard-auth";
import { catchUp } from "./catch-up";
import { dashboardState } from "./dashboard-state";
import { createEventLogger } from "./log-event";
import { recordFailure } from "./storage";
import { startWebDav, waitForUploads } from "./webdav";
import { beginShutdown, cancelDiscordRequestsOnShutdown, shutdownSignal, throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";

const client = createDiscordClient();
const app = express();
app.get("/dashboard.css", (_request, response) => response.sendFile(fileURLToPath(new URL("./dashboard.css", import.meta.url))));
app.use(dashboardAuth);
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
    dashboardState.startup = "Shutting down";
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
    try {
        await startWebDav(recordFailure);
    } catch (error) {
        dashboardState.webdav = "Recovery failed";
        dashboardState.startup = "Recovery failed";
        dashboardState.recovery.phase = "Failed";
        throw error;
    }
    dashboardState.startup = "Connecting to Discord";
    logProgress("Startup", "WebDAV recovery finished.");
    throwIfStopping();
    const { logEvent, logMemberEvent, resume } = createEventLogger();

    client.on("messageCreate", async (message) => {
        await trackTask(async () => { await logEvent("messageCreate", message); });
    });

    client.on("messageUpdate", async (oldMessage, newMessage) => {
        await trackTask(async () => { await logEvent("messageUpdate", oldMessage, newMessage); });
    });

    client.on("messageDelete", async (message) => {
        await trackTask(async () => { await logEvent("messageDelete", message); });
    });

    client.on("guildMemberAdd", async (member) => {
        await trackTask(async () => logMemberEvent("guildMemberAdd", member));
    });

    client.on("guildMemberUpdate", async (oldMember, member) => {
        await trackTask(async () => logMemberEvent("guildMemberUpdate", member, oldMember));
    });

    client.once("ready", async () => {
        dashboardState.startup = "Catching up messages";
        const boundary = ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();
        logProgress("Discord", `Connected as user ${client.user!.id}; ${client.guilds.cache.size} servers available.`);
        await trackTask(async () => {
            await resume();
            try {
                await catchUp(client, boundary, logEvent);
            } catch (error) {
                dashboardState.catchUp.status = shutdownSignal.aborted ? "Interrupted" : "Failed";
                dashboardState.catchUp.channel = "";
                throw error;
            }
        });
        if (!shutdownSignal.aborted) {
            dashboardState.startup = dashboardState.catchUp.status === "Complete" ? "Ready" : "Finished with errors";
            logProgress("Startup", "Initial collection finished; listening for message and member events.");
        }
    });

    logProgress("Discord", "Logging in and waiting for the gateway to become ready.");
    try {
        await client.login(process.env.token);
    } catch (error) {
        dashboardState.startup = "Discord login failed";
        throw error;
    }
});
