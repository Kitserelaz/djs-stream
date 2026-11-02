import type { Client, Message, PartialMessage } from "discord.js-selfbot-v13";
import { archiveDirectory, readJson, recordFailure, writeJson } from "./storage";
import { flushUploads } from "./webdav";
import { request } from "./requests";
import { shutdownSignal, throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";
import { dashboardState } from "./dashboard-state";

type SavedEvent = { message?: { id?: string }; oldMessage?: { id?: string }; newMessage?: { id?: string } };

export const catchUp = async (client: Client, boundary: string, logEvent: (event: "messageCreate", message: Message | PartialMessage) => Promise<boolean>) => {
    const progress = dashboardState.catchUp;
    progress.status = "Running";
    const channels = [...client.channels.cache.values()].filter(channel => channel.isText());
    progress.total = channels.length;
    const seen = new Set<string>();
    for (const event of readJson<SavedEvent[]>("logs.json", [])) {
        for (const message of [event.message, event.oldMessage, event.newMessage]) {
            if (message?.id) seen.add(message.id);
        }
    }

    for (const channel of channels) {
        throwIfStopping();
        if (!channel.isText()) continue;
        progress.channel = channel.id;
        const path = `output/checkpoints/catchup/${channel.id}.json`;
        try {
            const guildId = "guild" in channel ? channel.guild.id : null;
            const archived = readJson<{ id: string }[]>(`${archiveDirectory(guildId)}/messages/${channel.id}.json`, []);
            const latest = archived.reduce((id, message) => BigInt(message.id) > BigInt(id) ? message.id : id, "0");
            const since = readJson<string>(path, latest === "0" ? boundary : latest);
            let before = boundary;
            logProgress("Catch-up", `Checking channel ${channel.id} for missed messages.`);
            while (BigInt(before) > BigInt(since)) {
                const page = await request(() => channel.messages.fetch({ limit: 100, before }));
                if (!page.size) break;
                const messages = [...page.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
                for (const message of messages) {
                    if (BigInt(message.id) <= BigInt(since) || seen.has(message.id)) continue;
                    if (!await logEvent("messageCreate", message)) throw new Error(`Failed to capture message ${message.id}`);
                    seen.add(message.id);
                    progress.recovered++;
                }
                before = messages[0]!.id;
            }
            await flushUploads();
            writeJson(path, boundary);
            await flushUploads();
        } catch (error) {
            if (shutdownSignal.aborted) throw error;
            progress.failed++;
            recordFailure(`Catching up channel ${channel.id}`, error);
        }
        progress.completed++;
    }
    progress.channel = "";
    progress.status = progress.failed ? "Completed with errors" : "Complete";
};
