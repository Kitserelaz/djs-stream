import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import type { GuildMember, PartialGuildMember, Message, PartialMessage } from "discord.js-selfbot-v13";
import { captureMessage, type CapturedMessage } from "./format-message";
import { archiveDirectory, readJson, recordFailure, writeJson } from "./storage";
import { deleteRemoteCheckpoint, flushUploads } from "./webdav";
import { setTimeout as delay } from "node:timers/promises";
import { shutdownSignal, throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";
import { captureMember, type CapturedMember } from "./format-member";
import { saveLiveMember, saveMemberHistory } from "./member-storage";
import { recordActivity } from "./dashboard-state";
type PendingMessageEvent = {
    id: string;
    event: "messageCreate" | "messageUpdate" | "messageDelete";
    messages: CapturedMessage[];
};
type PendingMemberEvent = {
    id: string;
    event: "guildMemberAdd" | "guildMemberUpdate";
    guildId: string;
    member: CapturedMember;
    oldMember?: CapturedMember;
};
type PendingEvent = PendingMessageEvent | PendingMemberEvent;
type SavedEvent = PendingMemberEvent | {
    id: string;
    event: PendingMessageEvent["event"];
    message?: CapturedMessage["value"];
    oldMessage?: CapturedMessage["value"];
    newMessage?: CapturedMessage["value"];
};
export const createEventLogger = () => {
    const pendingDirectory = "output/checkpoints/events";
    mkdirSync(pendingDirectory, { recursive: true });
    const waiting = readdirSync(pendingDirectory).filter(name => name.endsWith(".json")).sort();
    let sequence = 0;
    let running = false;
    let ready = false;
    const drain = async () => {
        if (running || !ready)
            return;
        running = true;
        try {
            while (waiting.length && !shutdownSignal.aborted) {
                const filename = waiting[0]!;
                logProgress("Events", `Processing ${filename}; ${waiting.length} events pending.`);
                try {
                    await flushUploads();
                    throwIfStopping();
                    const pending = readJson<PendingEvent>(`${pendingDirectory}/${filename}`, undefined!);
                    let event: SavedEvent;
                    if ("messages" in pending) {
                        const messages = pending.messages.map(captured => captured.value);
                        throwIfStopping();
                        event = pending.event === "messageUpdate"
                            ? { id: pending.id, event: pending.event, oldMessage: messages[0], newMessage: messages[1] }
                            : { id: pending.id, event: pending.event, message: messages[0] };
                        const message = messages.at(-1)!;
                        const path = `${archiveDirectory(message.guildId)}/messages/${message.channelId}.json`;
                        const saved = readJson<(CapturedMessage["value"] & { deleted?: boolean })[]>(path, []);
                        const remaining = saved.filter(current => current.id !== message.id);
                        if (pending.event === "messageDelete") {
                            remaining.push({ ...message, ...saved.find(current => current.id === message.id), deleted: true });
                        } else {
                            remaining.push(message);
                        }
                        writeJson(path, remaining);
                    } else {
                        event = pending;
                        saveMemberHistory(pending);
                        saveLiveMember(pending.guildId, pending.member);
                    }
                    const logs = readJson<SavedEvent[]>("logs.json", []);
                    const index = logs.findIndex(saved => saved.id === event.id);
                    if (index === -1)
                        logs.push(event);
                    else
                        logs[index] = event;
                    writeJson("logs.json", logs);
                    await flushUploads();
                    throwIfStopping();
                    await deleteRemoteCheckpoint(`${pendingDirectory}/${filename}`);
                    unlinkSync(`${pendingDirectory}/${filename}`);
                    waiting.shift();
                    logProgress("Events", `Saved ${pending.event} (${pending.id}) locally and on WebDAV.`);
                }
                catch (error) {
                    if (shutdownSignal.aborted) return;
                    recordFailure(`Processing event ${filename}; checkpoint retained for retry`, error);
                    try {
                        await delay(30_000, undefined, { signal: shutdownSignal });
                    } catch (error) {
                        if (shutdownSignal.aborted) return;
                        throw error;
                    }
                }
            }
        }
        finally {
            running = false;
        }
    };
    const logEvent = async (event: PendingMessageEvent["event"], ...messages: (Message | PartialMessage)[]) => {
        if (shutdownSignal.aborted) return false;
        try {
            const id = `${Date.now()}-${String(sequence++).padStart(10, "0")}`;
            const filename = `${id}.json`;
            writeJson(`${pendingDirectory}/${filename}`, { id, event, messages: messages.map(captureMessage) });
            recordActivity(event);
            waiting.push(filename);
            logProgress("Events", `Captured ${event} for message ${messages.at(-1)!.id}; checkpoint ${filename}.`);
            await drain();
            return true;
        }
        catch (error) {
            recordFailure(`Saving ${event}`, error);
            return false;
        }
    };
    const logMemberEvent = async (event: PendingMemberEvent["event"], member: GuildMember, oldMember?: GuildMember | PartialGuildMember) => {
        if (shutdownSignal.aborted) return;
        try {
            const id = `${Date.now()}-${String(sequence++).padStart(10, "0")}`;
            const filename = `${id}.json`;
            writeJson(`${pendingDirectory}/${filename}`, {
                id, event, guildId: member.guild.id,
                member: captureMember(member),
                oldMember: oldMember ? captureMember(oldMember) : undefined,
            });
            recordActivity(event);
            waiting.push(filename);
            logProgress("Events", `Captured ${event} for member ${member.id} in server ${member.guild.id}; checkpoint ${filename}.`);
            await drain();
        } catch (error) {
            recordFailure(`Saving ${event}`, error);
        }
    };
    const resume = async () => {
        logProgress("Events", `Resuming ${waiting.length} unfinished events.`);
        ready = true;
        await drain();
    };
    return { logEvent, logMemberEvent, resume };
};
