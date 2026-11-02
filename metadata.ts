import type { Client, Guild, GuildEmoji, Emoji, NonThreadGuildBasedChannel, TextChannel, ThreadChannel, User } from "discord.js-selfbot-v13";
import { captureUser } from "./format-user";
import { captureMember } from "./format-member";
import { saveMetadataMembers } from "./member-storage";
import { collectInvites } from "./references";
import { attempt, request } from "./requests";
import { archiveDirectory, checkpoint, initializeArchive, recordFailure, safeJson, writeJson } from "./storage";
import { throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";
const serializeThreadMembers = (thread: ThreadChannel) => [...thread.members.cache.values()].map(member => ({
    id: member.id,
    flags: member.flags.bitfield,
    joinedTimestamp: member.joinedTimestamp,
    member: safeJson(`Serializing thread member ${member.id}`, member),
}));
const exportGuildMetadata = async (guild: Guild) => {
    logProgress("Metadata", `Starting server ${guild.id} (${guild.name}).`);
    const client = guild.client;
    const directory = archiveDirectory(guild.id);
    initializeArchive(directory);
    const checkpoints = {
        run: async <T>(key: string, operation: () => Promise<T>) => checkpoint(`${directory}/checkpoints/${key}.json`, operation),
    };
    const requestWithRetries = request;
    const handleInvites = async (text: string) => collectInvites(client, directory, text);
    const serializeUser = async (user: User) => captureUser(user);
    const files: Record<string, string> = {};
    const memberList = await attempt(`Fetching members for ${guild.id}`, () => checkpoints.run("member-list", async () => {
        const fetched = await request(() => guild.members.fetch());
        return [...fetched.values()].map(member => ({ id: member.id, roles: [...member.roles.cache.keys()] }));
    })) ?? [];
    const members: Record<string, object> = {};
    for (const [index, { id }] of memberList.entries()) {
        logProgress("Metadata", `Server ${guild.id}: member ${index + 1}/${memberList.length} (${id}).`);
        const result = await attempt(`Fetching member ${id}`, () => checkpoints.run(`members/${id}`, async () => {
            const member = await request(() => guild.members.fetch(id));
            await handleInvites(member.displayName);
            return captureMember(member);
        }));
        if (result)
            members[id] = result;
    }
    const rawChannels = await attempt(`Fetching channels for ${guild.id}`, () => checkpoints.run("channel-list", () => request<any[]>(() => (client.api as any).guilds(guild.id).channels.get()))) ?? [];
    const channelList = rawChannels.map(data => (client.channels as any)._add(data, guild) as NonThreadGuildBasedChannel);
    const threadsByChannel = new Map<string, Map<string, ThreadChannel>>();
    for (const channel of channelList) {
        if (!("threads" in channel) || !channel.permissionsFor(client.user!)?.has("VIEW_CHANNEL"))
            continue;
        const threads = new Map<string, ThreadChannel>();
        threadsByChannel.set(channel.id, threads);
        for (const archived of [false, true]) {
            await attempt(`Discovering threads in ${channel.id}`, async () => {
                const rawThreads = await checkpoints.run(`threads/${channel.id}/${archived}`, async () => {
                    const found: any[] = [];
                    let offset = 0;
                    while (true) {
                        const page = await request<any>(() => (client.api as any).channels(channel.id).threads.search.get({
                            query: { archived, limit: 25, offset, sort_by: "last_message_time", sort_order: "desc" },
                        }));
                        found.push(...page.threads);
                        if (!page.has_more)
                            return found;
                        if (!page.threads.length)
                            throw new Error("Thread pagination did not advance");
                        offset += page.threads.length;
                    }
                });
                for (const raw of rawThreads) {
                    const thread = (client.channels as any)._add(raw, guild) as ThreadChannel;
                    threads.set(thread.id, thread);
                }
            });
        }
    }
    const channelTypes: Record<string, number> = {
        GUILD_TEXT: 0,
        DM: 1,
        GUILD_VOICE: 2,
        GROUP_DM: 3,
        GUILD_CATEGORY: 4,
        GUILD_ANNOUNCEMENT: 5,
        ANNOUNCEMENT_THREAD: 10,
        PUBLIC_THREAD: 11,
        PRIVATE_THREAD: 12,
        GUILD_STAGE_VOICE: 13,
        GUILD_DIRECTORY: 14,
        GUILD_FORUM: 15,
        GUILD_MEDIA: 16
    };
    const channels = await attempt(`Exporting channels for ${guild.id}`, () => checkpoints.run("collections/channels", async () => {
        const channels: Record<string, {
            parentId?: string | null;
            parentName?: string;
            nsfw: boolean | null;
            position: number;
            rawPosition: number;
            url: string;
            topic: string | null;
            name: string;
            threads: {
                url: string;
                name: string;
                type: number;
                id: string;
            }[] | null;
            type: string | number;
            id: string;
            flags: number;
            permissionsFor: Record<string, string>;
            permissionOverwrites: {
                allow: string;
                channelId: string;
                deny: string;
                id: string;
                type: string;
            }[];
            json: unknown;
        }> = {};
        const guildRoleList = [...(await requestWithRetries(() => guild.roles.fetch())).values()];
        const channelsList = channelList;
        for (const [index, channel] of channelsList.entries()) {
            if (!channel)
                continue;
            let threads: any[] | null = [];
            const canAccess = (channel as TextChannel).permissionsFor(client.user!)?.has('VIEW_CHANNEL');
            if ("threads" in channel && canAccess) {
                for (const thread of threadsByChannel.get(channel.id)?.values() ?? []) {
                    await handleInvites(thread.name);
                    threads.push({
                        url: `https://discord.com/channels/${thread.guildId}/${thread.id}`,
                        name: thread.name,
                        type: channelTypes[thread.type] ?? thread.type,
                        id: thread.id,
                        appliedTags: thread.appliedTags,
                        archived: thread.archived,
                        archiveTimestamp: thread.archiveTimestamp,
                        autoArchiveDuration: thread.autoArchiveDuration,
                        createdTimestamp: thread.createdTimestamp,
                        flags: thread.flags.bitfield,
                        invitable: thread.invitable,
                        lastMessageId: thread.lastMessageId,
                        lastPinTimestamp: thread.lastPinTimestamp,
                        locked: thread.locked,
                        memberCount: thread.memberCount,
                        members: serializeThreadMembers(thread),
                        messageCount: thread.messageCount,
                        ownerId: thread.ownerId,
                        rateLimitPerUser: thread.rateLimitPerUser,
                        totalMessageSent: thread.totalMessageSent,
                        json: thread.toJSON()
                    });
                }
            }
            else {
                threads = null;
            }
            await handleInvites(channel.name);
            if ("topic" in channel ? channel.topic : "")
                await handleInvites("topic" in channel ? channel.topic ?? "" : "");
            channels[channel.id] = {
                parentId: channel?.parentId,
                parentName: channel?.parent?.name,
                nsfw: "nsfw" in channel ? channel?.nsfw : null,
                position: channel.position,
                rawPosition: channel.rawPosition,
                url: "https://discord.com/channels/" + channel.guildId + "/" + channel.id,
                topic: "topic" in channel ? channel.topic : null,
                name: channel.name,
                threads,
                type: channelTypes[channel.type] ?? channel.type,
                id: channel.id,
                flags: channel.flags.bitfield,
                permissionsFor: Object.fromEntries(guildRoleList.map(role => [role.id, channel.permissionsFor(role).bitfield.toString()])),
                permissionOverwrites: [...channel.permissionOverwrites.cache.values()].map(permissionOverwrite => ({
                    allow: permissionOverwrite.allow.bitfield.toString(),
                    channelId: permissionOverwrite.channel.id,
                    deny: permissionOverwrite.deny.bitfield.toString(),
                    id: permissionOverwrite.id,
                    type: permissionOverwrite.type
                })),
                json: channel.toJSON()
            };
        }
        return channels;
    }));
    const roles = await attempt(`Exporting roles for ${guild.id}`, () => checkpoints.run("collections/roles", async () => {
        const roles: Record<string, object> = {};
        for (const role of [...(await requestWithRetries(() => guild.roles.fetch())).values()]) {
            await handleInvites(role.name);
            roles[role.id] = {
                "color": role.color,
                "colors": role.colors,
                "createdTimestamp": role.createdTimestamp,
                "flags": role.flags.bitfield,
                "hexColor": role.hexColor,
                "hoist": role.hoist,
                "icon": role.icon,
                "managed": role.managed,
                "members": memberList.filter(member => member.roles.includes(role.id)).map(member => member.id),
                "mentionable": role.mentionable,
                "name": role.name,
                "permissions": role.permissions.bitfield.toString(),
                "position": role.position,
                "rawPosition": role.rawPosition,
                "tags": role.tags,
                "unicodeEmoji": role.unicodeEmoji,
                "id": role.id,
                "iconFile": null,
                "json": role.toJSON()
            };
        }
        return roles;
    }));
    const emojis = await attempt(`Exporting emojis for ${guild.id}`, () => checkpoints.run("collections/emojis", async () => {
        const emojis: Record<string, object> = {};
        for (const emoji of [...(await requestWithRetries(() => guild.emojis.fetch())).values()]) {
            emojis[emoji.id] = {
                "animated": emoji.animated,
                "author": emoji.author ? await serializeUser(emoji.author) : null,
                "authorId": emoji.author?.id,
                "available": emoji.available,
                "createdTimestamp": emoji.createdTimestamp,
                "identifier": emoji.identifier,
                "managed": emoji.managed,
                "name": emoji.name,
                "requiresColons": emoji.requiresColons,
                "roles": [...emoji.roles.cache.keys()],
                "id": emoji.id,
                "imageFile": null,
                "json": emoji.toJSON()
            };
        }
        return emojis;
    }));
    const stickers = await attempt(`Exporting stickers for ${guild.id}`, () => checkpoints.run("collections/stickers", async () => {
        const stickers: Record<string, object> = {};
        for (const sticker of [...(await requestWithRetries(() => guild.stickers.fetch())).values()]) {
            await handleInvites(sticker.name);
            await handleInvites(sticker.description ?? "");
            stickers[sticker.id] = {
                available: sticker.available,
                createdTimestamp: sticker.createdTimestamp,
                description: sticker.description,
                format: sticker.format,
                guildId: sticker.guildId,
                id: sticker.id,
                name: sticker.name,
                packId: sticker.packId,
                partial: sticker.partial,
                sortValue: sticker.sortValue,
                tags: sticker.tags,
                type: sticker.type,
                url: sticker.url,
                user: sticker.user ? await serializeUser(sticker.user) : null,
                file: null,
                json: sticker.toJSON()
            };
        }
        return stickers;
    }));
    const parseGlobalOrGuildEmoji = async (emoji: Emoji | GuildEmoji | null) => emoji ? {
        animated: emoji.animated,
        author: (emoji as GuildEmoji).author ? await serializeUser((emoji as GuildEmoji).author!) : null,
        available: (emoji as GuildEmoji).available,
        createdTimestamp: emoji.createdTimestamp,
        deletable: (emoji as GuildEmoji).deletable,
        guildId: (emoji as GuildEmoji).guild?.id,
        imageURL: emoji.url,
        imageFile: null,
        id: emoji.id,
        identifier: emoji.identifier,
        managed: (emoji as GuildEmoji).managed,
        name: emoji.name,
        requiresColons: (emoji as GuildEmoji).requiresColons,
        roles: (emoji as GuildEmoji).roles ? [...(emoji as GuildEmoji).roles?.cache.values()] : null,
        json: emoji.toJSON()
    } : null;
    await attempt(`Fetching templates for ${guild.id}`, async () => {
        const templates = await requestWithRetries(() => guild.fetchTemplates());
        files["templates.json"] = JSON.stringify(await Promise.all([...templates.values()].map(async (template) => ({
            code: template.code,
            createdTimestamp: template.createdTimestamp,
            creator: await serializeUser(template.creator),
            creatorId: template.creatorId,
            description: template.description,
            guildId: template.guildId,
            name: template.name,
            serializedGuild: template.serializedGuild,
            unSynced: template.unSynced,
            updatedTimestamp: template.updatedTimestamp,
            url: template.url,
            usageCount: template.usageCount,
            json: template.toJSON()
        }))));
    });
    await attempt(`Fetching server metadata for ${guild.id}`, async () => {
        let vanityData = null;
        try {
            vanityData = await requestWithRetries(() => guild.fetchVanityData());
        }
        catch (e) {
            throwIfStopping();
            recordFailure("Fetching vanity data", e);
        }
        ;
        let widget = null;
        try {
            widget = await requestWithRetries(() => guild.fetchWidget());
        }
        catch (e) {
            throwIfStopping();
            recordFailure("Fetching widget", e);
        }
        ;
        let welcomeScreen = null;
        try {
            welcomeScreen = await requestWithRetries(() => guild.fetchWelcomeScreen());
        }
        catch (e) {
            throwIfStopping();
            recordFailure("Fetching welcome screen", e);
        }
        ;
        let widgetSettings = null;
        try {
            widgetSettings = await requestWithRetries(() => guild.fetchWidgetSettings());
        }
        catch (e) {
            throwIfStopping();
            recordFailure("Fetching widget settings", e);
        }
        files["server.json"] = JSON.stringify({
            "afkChannelId": guild.afkChannelId,
            "afkTimeout": guild.afkTimeout,
            "applicationId": guild.applicationId,
            "approximateMemberCount": guild.approximateMemberCount,
            "approximatePresenceCount": guild.approximatePresenceCount,
            "available": guild.available,
            "banner": guild.banner,
            "bannerURL": guild.bannerURL({ size: 4096 }),
            "bannerFile": null,
            "createdTimestamp": guild.createdTimestamp,
            "defaultMessageNotifications": guild.defaultMessageNotifications,
            "description": guild.description,
            "discoverySplash": guild.discoverySplash,
            "discoverySplashURL": guild.discoverySplashURL({ size: 4096 }),
            "discoverySplashFile": null,
            "explicitContentFilter": guild.explicitContentFilter,
            "features": guild.features,
            "icon": guild.icon,
            "iconURL": guild.iconURL({ size: 4096 }),
            "iconFile": null,
            "id": guild.id,
            "incidentsData": guild.incidentsData ? {
                dmsDisabledUntil: guild.incidentsData.dmsDisabledUntil?.getTime(),
                dmSpamDetectedAt: guild.incidentsData.dmSpamDetectedAt?.getTime(),
                invitesDisabledUntil: guild.incidentsData.invitesDisabledUntil?.getTime(),
                raidDetectedAt: guild.incidentsData.raidDetectedAt?.getTime()
            } : null,
            "large": guild.large,
            "maximumBitrate": guild.maximumBitrate,
            "maximumMembers": guild.maximumMembers,
            "maximumPresences": guild.maximumPresences,
            "maxStageVideoChannelUsers": guild.maxStageVideoChannelUsers,
            "maxVideoChannelUsers": guild.maxVideoChannelUsers,
            "memberCount": guild.memberCount,
            "mfaLevel": guild.mfaLevel,
            "name": guild.name,
            "nameAcronym": guild.nameAcronym,
            "nsfwLevel": guild.nsfwLevel,
            "ownerId": guild.ownerId,
            "partnered": guild.partnered,
            "preferredLocale": guild.preferredLocale,
            "premiumProgressBarEnabled": guild.premiumProgressBarEnabled,
            "premiumSubscriptionCount": guild.premiumSubscriptionCount,
            "premiumTier": guild.premiumTier,
            "publicUpdatesChannelId": guild.publicUpdatesChannelId,
            "rulesChannelId": guild.rulesChannelId,
            "safetyAlertsChannelId": guild.safetyAlertsChannelId,
            "splash": guild.splash,
            "splashURL": guild.splashURL({ size: 4096 }),
            "splashFile": null,
            "systemChannelFlags": guild.systemChannelFlags.bitfield,
            "systemChannelId": guild.systemChannelId,
            "vanityURLCode": guild.vanityURLCode,
            "vanityURLUses": guild.vanityURLUses,
            "verificationLevel": guild.verificationLevel,
            "verified": guild.verified,
            "widgetChannelId": guild.widgetChannelId,
            "widgetEnabled": guild.widgetEnabled,
            "vanity": vanityData,
            "welcomeScreen": welcomeScreen ? {
                description: welcomeScreen.description,
                enabled: welcomeScreen.enabled,
                guildId: welcomeScreen.guild.id,
                welcomeChannels: await Promise.all([...welcomeScreen.welcomeChannels.values()].map(async (welcomeChannel) => ({
                    channelId: welcomeChannel.channelId,
                    emoji: await parseGlobalOrGuildEmoji(welcomeChannel.emoji),
                    guildId: welcomeScreen.guild.id,
                    json: welcomeChannel.toJSON()
                }))),
                json: welcomeScreen.toJSON()
            } : null,
            "widget": widget ? {
                channels: [...widget.channels.values()],
                id: widget.id,
                instantInvite: widget.instantInvite,
                members: await Promise.all([...widget.members.entries()].map(async ([id, member]) => [id, {
                        activity: member.activity,
                        avatar: member.avatar,
                        avatarURL: member.avatarURL,
                        avatarFile: null,
                        channelId: member.channelId,
                        deaf: member.deaf,
                        discriminator: member.discriminator,
                        id: member.id,
                        mute: member.mute,
                        selfDeaf: member.selfDeaf,
                        selfMute: member.selfMute,
                        status: member.status,
                        suppress: member.suppress,
                        username: member.username,
                        json: member.toJSON()
                    }])),
                name: widget.name,
                presenceCount: widget.presenceCount,
                json: widget.toJSON(),
            } : null,
            "widgetSettings": widgetSettings,
            "json": guild.toJSON()
        });
    });
    files["channels.json"] = JSON.stringify(channels ?? {});
    files["roles.json"] = JSON.stringify(roles ?? {});
    files["emojis.json"] = JSON.stringify(emojis ?? {});
    files["stickers.json"] = JSON.stringify(stickers ?? {});
    throwIfStopping();
    saveMetadataMembers(guild.id, members);
    for (const [name, content] of Object.entries(files))
        writeJson(`${directory}/${name}`, JSON.parse(content));
    logProgress("Metadata", `Saved ${Object.keys(files).length + 1} metadata files for server ${guild.id}.`);
};
export const exportMetadata = async (client: Client) => {
    logProgress("Metadata", `Collecting metadata for ${client.guilds.cache.size} servers; profiles are fetched only for message events.`);
    for (const [index, guild] of [...client.guilds.cache.values()].entries()) {
        logProgress("Metadata", `Server ${index + 1}/${client.guilds.cache.size}: ${guild.id}.`);
        await attempt(`Exporting metadata for ${guild.id}`, () => exportGuildMetadata(guild));
    }
};
