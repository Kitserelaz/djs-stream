import type { CapturedMember } from "./format-member";
import { archiveDirectory, readJson, saveRecord, writeJson } from "./storage";

const liveMembers = new Map<string, Record<string, CapturedMember>>();

export const saveMemberHistory = (event: {
    id: string;
    event: "guildMemberAdd" | "guildMemberUpdate";
    guildId: string;
    member: CapturedMember;
    oldMember?: CapturedMember;
}) => {
    const path = `${archiveDirectory(event.guildId)}/member-history/${event.member.id}.json`;
    const history = readJson<(typeof event & { time: string })[]>(path, []);
    if (history.some(record => record.id === event.id)) return;
    history.push({ ...event, time: new Date(Number(event.id.split("-")[0])).toISOString() });
    writeJson(path, history);
};

export const saveLiveMember = (guildId: string, member: CapturedMember) => {
    const members = liveMembers.get(guildId) ?? {};
    members[member.id] = member;
    liveMembers.set(guildId, members);
    const directory = archiveDirectory(guildId);
    saveRecord(`${directory}/members.json`, member.id, member);
    writeJson(`${directory}/checkpoints/members/${member.id}.json`, member);
};

export const saveMetadataMembers = (guildId: string, members: Record<string, object>) => {
    const updates = liveMembers.get(guildId) ?? {};
    const directory = archiveDirectory(guildId);
    // A live update takes precedence over the startup snapshot collected earlier.
    for (const member of Object.values(updates)) {
        writeJson(`${directory}/checkpoints/members/${member.id}.json`, member);
    }
    writeJson(`${directory}/members.json`, { ...members, ...updates });
};
