import type { Client } from "discord.js-selfbot-v13";
import { attempt, request } from "./requests";
import { readJson, saveRecord } from "./storage";
export const collectInvites = async (client: Client, directory: string, text: string) => {
    const codes = new Set([...text.matchAll(/(?:^|[^a-z0-9.])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|\.?gg)\/([a-z0-9-]+)\b/gi)].map(match => match[1]!));
    for (const code of codes) {
        const path = `${directory}/external_invites.json`;
        if (readJson<Record<string, unknown>>(path, {})[code])
            continue;
        await attempt(`Fetching invite ${code}`, async () => {
            const json = await request(() => (client.api as any).invites(code).get({ query: { with_counts: true } }));
            saveRecord(path, code, {
                ...(json as object), json,
                inviterAvatarFile: null, bannerFile: null, guildFile: null, splashFile: null,
            });
        });
    }
};
export const mentionedUserIds = (content: string, resolved: string[]) => [...new Set([...resolved, ...[...content.matchAll(/<@!?(\d+)>/g)].map(match => match[1]!)])];
