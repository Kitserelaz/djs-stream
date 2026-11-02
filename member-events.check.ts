import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "discord.js-selfbot-v13";
import { captureMember } from "./format-member";
import { saveLiveMember, saveMetadataMembers } from "./member-storage";
import { readJson } from "./storage";

const directory = mkdtempSync(join(tmpdir(), "member-events-check-"));
const originalDirectory = process.cwd();
const client = new Client();
try {
    process.chdir(directory);
    const guild = (client.guilds as any)._add({
        id: "100000000000000001", name: "Test",
        roles: [{ id: "100000000000000001", name: "@everyone", permissions: "0", position: 0, flags: 0, colors: { primary_color: 0, secondary_color: null, tertiary_color: null } }],
    });
    const member = guild.members._add({
        user: { id: "100000000000000002", username: "test", discriminator: "0", avatar: null, banner: null },
        roles: [], joined_at: "2026-01-01T00:00:00Z", nick: "before", flags: 0,
    });
    member.user.getProfile = async () => { throw new Error("Member events must not fetch profiles"); };
    const before = captureMember(member);
    member._patch({ nick: "after" });
    const after = captureMember(member);
    assert.equal(before.nickname, "before");
    assert.equal(after.nickname, "after");
    assert.equal(after.profile, null);
    saveLiveMember(guild.id, after);
    saveMetadataMembers(guild.id, { [member.id]: before });
    const saved = readJson<Record<string, typeof after>>(`output/${guild.id}/members.json`, {});
    assert.equal(saved[member.id]!.nickname, "after");
    const checkpoint = readJson<typeof after>(`output/${guild.id}/checkpoints/members/${member.id}.json`, undefined!);
    assert.equal(checkpoint.nickname, "after");
    console.log("Member checks passed: snapshots stay fixed, no profiles requested, and live updates survive startup export.");
} finally {
    client.destroy();
    process.chdir(originalDirectory);
    rmSync(directory, { recursive: true, force: true });
}
