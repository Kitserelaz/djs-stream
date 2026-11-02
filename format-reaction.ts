import type { Client, GuildEmoji, MessageReaction } from "discord.js-selfbot-v13";
import { formatUser } from "./format-user";
import { attempt, request } from "./requests";
import { safeJson } from "./storage";
export const captureReaction = (reaction: MessageReaction) => {
    const emoji = reaction.emoji as GuildEmoji;
    return {
        burstColors: reaction.burstColors,
        count: reaction.count,
        countDetails: reaction.countDetails,
        emoji: {
            animated: emoji.animated,
            author: null as unknown,
            available: emoji.available,
            createdTimestamp: emoji.createdTimestamp,
            guild: emoji.guild ? safeJson(`Serializing emoji guild ${emoji.guild.id}`, emoji.guild) : undefined,
            id: emoji.id,
            identifier: emoji.identifier,
            imageURL: emoji.url,
            imageFile: null,
            managed: emoji.managed,
            name: emoji.name,
            requiresColons: emoji.requiresColons,
            roles: [...(emoji.roles?.cache.values() ?? [])].map(role => safeJson(`Serializing emoji role ${role.id}`, role)),
        },
        authorId: emoji.author?.id,
    };
};
export type CapturedReaction = ReturnType<typeof captureReaction>;
export const formatReaction = async (client: Client, directory: string, channelId: string, messageId: string, captured: CapturedReaction) => {
    const { authorId, ...reaction } = captured;
    const users = { normal: [] as unknown[], burst: [] as unknown[] };
    const emoji = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name!;
    for (const [kind, type] of [["normal", 0], ["burst", 1]] as const) {
        const collected = new Map<string, any>();
        await attempt(`Fetching ${kind} reaction users for ${messageId}`, async () => {
            let after: string | undefined;
            while (true) {
                const page = await request<any[]>(() => (client.api as any).channels(channelId).messages(messageId).reactions(emoji).get({ query: { limit: 100, after, type } }));
                if (!page.length)
                    break;
                for (const user of page)
                    collected.set(user.id, user);
                const next = page.map(user => user.id as string).reduce((largest, id) => BigInt(id) > BigInt(largest) ? id : largest);
                if (after && BigInt(next) <= BigInt(after))
                    throw new Error("Reaction user pagination did not advance");
                after = next;
                if (page.length < 100)
                    break;
            }
        });
        for (const raw of collected.values()) {
            const user = (client.users as any)._add(raw);
            const formatted = await attempt(`Serializing reaction user ${user.id}`, () => formatUser(user, directory));
            if (formatted)
                users[kind].push(formatted);
        }
    }
    if (authorId) {
        reaction.emoji.author = await attempt(`Fetching emoji author ${authorId}`, async () => {
            const user = await request(() => client.users.fetch(authorId));
            return await formatUser(user, directory);
        });
    }
    return { ...reaction, users };
};
