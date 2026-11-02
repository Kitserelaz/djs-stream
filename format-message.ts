import type { Message, PartialMessage, Sticker } from "discord.js-selfbot-v13";
import { captureReaction } from "./format-reaction";
import { safeJson } from "./storage";
import { mentionedUserIds } from "./references";
const formatSticker = (sticker: Sticker) => ({
    createdTimestamp: sticker.createdTimestamp, description: sticker.description, format: sticker.format,
    guildId: sticker.guildId, id: sticker.id, name: sticker.name, packId: sticker.packId,
    type: sticker.type, url: sticker.url, image: null, json: sticker.toJSON(),
});
export const captureMessage = (message: Message | PartialMessage) => {
    const value = {
        activity: message.activity,
        applicationId: message.applicationId,
        attachments: message.attachments.map(attachment => ({
            contentType: attachment.contentType,
            description: attachment.description,
            name: attachment.name,
            spoiler: attachment.spoiler,
            id: attachment.id,
            url: attachment.url,
            proxyURL: attachment.proxyURL,
            file: null,
            json: attachment.toJSON(),
        })),
        authorId: message.author?.id,
        call: message.call,
        channelId: message.channel?.id,
        cleanContent: message.cleanContent,
        components: message.components.map(component => component?.toJSON()),
        content: message.content,
        createdTimestamp: message.createdTimestamp,
        editedTimestamp: message.editedTimestamp,
        embeds: message.embeds.map(embed => ({ ...embed.toJSON(), files: {} })),
        flags: message.flags?.bitfield,
        groupActivityApplication: message.groupActivityApplication?.toJSON(),
        groupActivityApplicationCover: null,
        groupActivityApplicationIcon: null,
        guildId: message.guildId,
        id: message.id,
        interactionMetadata: message.interaction,
        mentions: message.mentions?.toJSON(),
        messageSnapshots: message.messageSnapshots.map(snapshot => ({
            attachments: snapshot.attachments.map(attachment => ({
                contentType: attachment.contentType, description: attachment.description, name: attachment.name,
                spoiler: attachment.spoiler, id: attachment.id, url: attachment.url, proxyURL: attachment.proxyURL,
                file: null, json: attachment.toJSON(),
            })),
            components: snapshot.components.map(component => component.toJSON()),
            content: snapshot.content,
            createdTimestamp: snapshot.createdTimestamp,
            editedTimestamp: snapshot.editedTimestamp,
            embeds: snapshot.embeds.map(embed => ({ ...embed.toJSON(), files: {} })),
            flags: snapshot.flags.bitfield,
            mentions: snapshot.mentions.toJSON(),
            stickers: snapshot.stickers.map(formatSticker),
            type: snapshot.type,
        })),
        pinned: message.pinned,
        poll: message.poll?.toJSON(),
        position: message.position,
        reactions: [] as unknown[],
        reference: message.reference,
        stickers: message.stickers.map(formatSticker),
        system: message.system,
        tts: message.tts,
        type: message.type,
        url: message.url,
        webhookAuthor: message.webhookId && message.author ? {
            avatar: message.author.avatar,
            avatarURL: message.author.avatarURL({ size: 4096 }),
            avatarFile: null,
            bot: message.author.bot,
            defaultAvatarURL: message.author.defaultAvatarURL,
            defaultAvatarFile: null,
            displayName: message.author.displayName,
            id: message.author.id,
        } : null,
        webhookId: message.webhookId,
        json: safeJson(`Serializing message ${message.id}`, message),
    };
    // Freeze event data before any profile, invite, or reaction requests can yield.
    return JSON.parse(JSON.stringify({
        value,
        mentionedIds: mentionedUserIds(message.content ?? "", [...(message.mentions?.users.keys() ?? [])]),
        reactions: [...message.reactions.cache.values()].map(captureReaction),
    })) as {
        value: typeof value;
        mentionedIds: string[];
        reactions: ReturnType<typeof captureReaction>[];
    };
};
export type CapturedMessage = ReturnType<typeof captureMessage>;
