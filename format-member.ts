import type { GuildMember, PartialGuildMember } from "discord.js-selfbot-v13";
import { captureUser } from "./format-user";
import { safeJson } from "./storage";

export const captureMember = (member: GuildMember | PartialGuildMember) => {
    const serializedUser = captureUser(member.user);
    const json = safeJson(`Serializing member ${member.id}`, member);
    const result = {
        "user": serializedUser,
        "avatar": member.avatar,
        "avatarURL": member.avatarURL({ size: 4096 }),
        "avatarFile": null,
        "bot": member.user.bot,
        "defaultAvatarURL": member.user.defaultAvatarURL,
        "defaultAvatarFile": null,
        "displayAvatarURL": member.displayAvatarURL({ size: 4096 }),
        "displayAvatarFile": null,
        "displayName": member.displayName,
        "id": member.id,
        "roles": [...member.roles.cache.keys()],
        "banner": member.banner,
        "bannerFile": null,
        "bannerURL": member.bannerURL({ size: 4096 }),
        "displayBannerFile": null,
        "displayBannerURL": member.banner ? member.bannerURL({ size: 4096 }) : serializedUser.bannerURL,
        "premiumSinceTimestamp": member.premiumSinceTimestamp,
        "joinedTimestamp": member.joinedTimestamp,
        "communicationDisabledUntilTimestamp": member.communicationDisabledUntilTimestamp,
        "displayColor": member.displayColor,
        "displayHexColor": member.displayHexColor,
        "flags": member.flags.bitfield,
        "nickname": member.nickname,
        "pending": member.pending,
        "permissions": member.permissions.bitfield.toString(),
        "avatarDecorationData": member.user.avatarDecorationData,
        "avatarDecorationFile": null,
        "displayAvatarDecorationURL": member.displayAvatarDecorationURL(),
        "displayAvatarDecorationFile": null,
        "createdTimestamp": member.user.createdTimestamp,
        "discriminator": member.user.discriminator,
        "globalName": member.user.globalName,
        "system": member.user.system,
        "tag": member.user.tag,
        "username": member.user.username,
        "profile": null,
        "json": json
    };
    return JSON.parse(JSON.stringify(result)) as typeof result;
};

export type CapturedMember = ReturnType<typeof captureMember>;
