import { randomBytes } from "node:crypto";
import { warpFetch } from "./warp";
import { Router } from "express";

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, MANAGER_USER_ID } = process.env;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ?? "https://djs-stream.onrender.com/auth/discord/callback";
const configured = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && MANAGER_USER_ID);
const redirectUrl = configured ? new URL(DISCORD_REDIRECT_URI!) : undefined;
if (redirectUrl && (redirectUrl.protocol !== "https:" && !(redirectUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirectUrl.hostname)))) {
    throw new Error("DISCORD_REDIRECT_URI must use HTTPS, except on localhost");
}
const cookieOptions = { httpOnly: true, secure: redirectUrl?.protocol === "https:", sameSite: "lax" as const, path: "/" };
const states = new Map<string, number>();
const sessions = new Map<string, number>();
const token = () => randomBytes(32).toString("hex");
const cookie = (header: string | undefined, name: string) => header?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
const clearExpired = (items: Map<string, number>) => {
    for (const [key, expires] of items) if (expires <= Date.now()) items.delete(key);
};

export const dashboardAuth = Router();
dashboardAuth.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (!configured) {
        response.status(503).send("Dashboard login is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and MANAGER_USER_ID.");
        return;
    }
    next();
});

dashboardAuth.get("/login", (_request, response) => {
    response.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · DJS Stream</title><link rel="stylesheet" href="/dashboard.css"></head><body><main><section class="card panel"><span class="eyebrow">DJS STREAM</span><h1>Collector dashboard</h1><p>Sign in with the manager's Discord account to continue.</p><p><a href="/auth/discord">Sign in with Discord</a></p></section></main></body></html>`);
});

dashboardAuth.get("/auth/discord", (_request, response) => {
    clearExpired(states);
    const state = token();
    states.set(state, Date.now() + 10 * 60_000);
    response.cookie("oauth_state", state, { ...cookieOptions, maxAge: 10 * 60_000 });
    const params = new URLSearchParams({ client_id: DISCORD_CLIENT_ID!, redirect_uri: DISCORD_REDIRECT_URI!, response_type: "code", scope: "identify", state });
    response.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

dashboardAuth.get("/auth/discord/callback", async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const code = typeof request.query.code === "string" ? request.query.code : "";
    const validState = state && state === cookie(request.headers.cookie, "oauth_state") && (states.get(state) ?? 0) > Date.now();
    states.delete(state);
    response.clearCookie("oauth_state", cookieOptions);
    if (!validState || !code) {
        response.status(400).send("Discord sign-in expired or was cancelled. Please try again.");
        return;
    }
    try {
        const exchange = await warpFetch("https://discord.com/api/v10/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID!, client_secret: DISCORD_CLIENT_SECRET!, grant_type: "authorization_code", code, redirect_uri: DISCORD_REDIRECT_URI! }),
            signal: AbortSignal.timeout(15_000),
        });
        if (!exchange.ok) throw new Error(`Discord token exchange failed: HTTP ${exchange.status}`);
        const { access_token } = await exchange.json() as { access_token: string };
        const profile = await warpFetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
            signal: AbortSignal.timeout(15_000),
        });
        if (!profile.ok) throw new Error(`Discord user lookup failed: HTTP ${profile.status}`);
        const user = await profile.json() as { id: string };
        if (user.id !== MANAGER_USER_ID) {
            response.status(403).send("This Discord account is not authorized to access the dashboard.");
            return;
        }
        clearExpired(sessions);
        const session = token();
        sessions.set(session, Date.now() + 24 * 60 * 60_000);
        response.cookie("dashboard_session", session, { ...cookieOptions, maxAge: 24 * 60 * 60_000 });
        response.redirect("/");
    } catch (error) {
        console.error("Discord dashboard sign-in failed:", error);
        response.status(502).send("Discord sign-in failed. Please try again.");
    }
});

dashboardAuth.post("/logout", (request, response) => {
    sessions.delete(cookie(request.headers.cookie, "dashboard_session") ?? "");
    response.clearCookie("dashboard_session", cookieOptions);
    response.redirect("/login");
});

dashboardAuth.use((request, response, next) => {
    const session = cookie(request.headers.cookie, "dashboard_session") ?? "";
    if ((sessions.get(session) ?? 0) <= Date.now()) {
        sessions.delete(session);
        response.redirect("/login");
        return;
    }
    next();
});
