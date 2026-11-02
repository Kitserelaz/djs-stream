import type { Client } from "discord.js-selfbot-v13";
import type { CapturedMessage } from "./format-message";
import { formatReaction } from "./format-reaction";
import { formatUser } from "./format-user";
import { collectInvites } from "./references";
import { attempt, request } from "./requests";
import { archiveDirectory, initializeArchive, readJson, saveRecord, writeJson } from "./storage";
export const enrichMessage = async (client: Client, captured: CapturedMessage) => {
    const { value, mentionedIds, reactions } = captured;
    const directory = archiveDirectory(value.guildId);
    initializeArchive(directory);
    const saveUser = async (id: string) => {
        const user = await request(() => client.users.fetch(id));
        return await formatUser(user, directory);
    };
    if (value.authorId && !value.webhookId) {
        const author = await attempt(`Fetching author ${value.authorId}`, () => saveUser(value.authorId!));
        if (author)
            saveRecord(`${directory}/authors.json`, author.id, author);
    }
    for (const id of mentionedIds) {
        const user = await attempt(`Fetching mentioned user ${id}`, () => saveUser(id));
        if (!user)
            continue;
        const users = readJson<any[]>(`${directory}/mentioned_users.json`, []);
        const index = users.findIndex(saved => saved.id === user.id);
        if (index === -1)
            users.push(user);
        else
            users[index] = user;
        writeJson(`${directory}/mentioned_users.json`, users);
    }
    await collectInvites(client, directory, `${value.content ?? ""} ${JSON.stringify(value.embeds)}`);
    value.reactions = [];
    for (const reaction of reactions) {
        value.reactions.push(await formatReaction(client, directory, value.channelId!, value.id, reaction));
    }
    return value;
};
