import type { User } from "discord.js-selfbot-v13";
import { warpFetch } from "./warp";
import { collectInvites } from "./references";
import { attempt, request, withTimeout } from "./requests";
import { checkpoint, readJson, recordFailure, safeJson, saveRecord } from "./storage";
import { shutdownSignal, throwIfStopping } from "./shutdown";
let directProfilesUntil = 0;
export const fetchProfile = async (user: User, guildId?: string) => checkpoint(`output/checkpoints/profiles/${user.id}/${guildId ?? "global"}.json`, async () => {
    if (Date.now() >= directProfilesUntil) {
        try {
            return await request(async () => {
                const profile = await withTimeout(user.getProfile(guildId));
                if (!profile)
                    throw new Error("Empty profile response");
                return profile;
            });
        }
        catch (error) {
            throwIfStopping();
            directProfilesUntil = Date.now() + 45000;
            // The failed gateway request is recorded even if direct HTTP succeeds.
            recordFailure(`Fetching gateway profile for ${user.id}`, error);
        }
    }
    return await request(async () => {
        const query = new URLSearchParams({
            with_mutual_guilds: "true", with_mutual_friends: "false", with_mutual_friends_count: "false",
        });
        if (guildId)
            query.set("guild_id", guildId);
        const response = await warpFetch(`https://discord.com/api/v9/users/${user.id}/profile?${query}`, {
            headers: { Authorization: user.client.token! },
            signal: AbortSignal.any([shutdownSignal, AbortSignal.timeout(45000)]),
        });
        if (!response.ok)
            throw Object.assign(new Error(`Profile HTTP ${response.status}`), { status: response.status });
        return await response.json();
    });
});
export const captureUser = (data: User) => ({
    accentColor: data.accentColor,
    avatar: data.avatar,
    avatarURL: data.avatarURL({ size: 4096 }),
    avatarFile: null,
    avatarDecorationData: data.avatarDecorationData,
    avatarDecorationFile: null,
    banner: data.banner,
    bannerURL: data.banner ? data.bannerURL({ size: 4096 }) : null,
    bannerFile: null,
    bot: data.bot,
    createdTimestamp: data.createdTimestamp,
    defaultAvatarURL: data.defaultAvatarURL,
    defaultAvatarFile: null,
    discriminator: data.discriminator,
    displayName: data.displayName,
    flags: data.flags?.bitfield,
    globalName: data.globalName,
    hexAccentColor: data.hexAccentColor,
    id: data.id,
    partial: data.partial,
    profile: null,
    system: data.system,
    tag: data.tag,
    username: data.username,
    json: safeJson(`Serializing user ${data.id}`, data),
});

export const formatUser = async (user: User, directory: string) => {
    const path = `${directory}/all_users.json`;
    const cached = readJson<Record<string, any>>(path, {})[user.id];
    if (cached?.profile)
        return cached;
    const profile = await attempt(`Fetching profile for ${user.id}`, () => fetchProfile(user));
    const data = profile?.user ? (user.client.users as any)._add(profile.user) as User : user;
    await collectInvites(user.client, directory, [profile?.user_profile?.bio, profile?.user_profile?.pronouns, data.displayName].filter(Boolean).join(" "));
    const result = { ...captureUser(data), profile };
    saveRecord(path, user.id, result);
    return result;
};
