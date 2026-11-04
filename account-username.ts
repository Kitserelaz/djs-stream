import { warpFetch } from "./warp";

const token = process.env.token;
if (!token) throw new Error("Set token in the environment");

const response = await warpFetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: token },
});
if (!response.ok) throw new Error(`Discord user lookup failed: HTTP ${response.status}`);

const user = await response.json() as { username: string };
console.log(user.username);
