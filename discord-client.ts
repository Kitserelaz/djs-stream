import { Client } from "discord.js-selfbot-v13";
import { HttpsProxyAgent } from "https-proxy-agent";
import { warpProxy } from "./warp";

export const createDiscordClient = () => {
    const agent = new HttpsProxyAgent(warpProxy);
    // The library checks these properties before forwarding the agent to ws.
    Object.assign(agent, { httpAgent: agent, httpsAgent: agent });
    const client = new Client({ http: { agent: { uri: warpProxy } }, ws: { agent } });
    const rest: { fetch: (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => Promise<Response> } = client.rest;
    const originalFetch = rest.fetch.bind(rest);
    rest.fetch = async (input, options = {}) => {
        const proxyOptions = { ...options, proxy: { url: warpProxy, respectNoProxy: false } };
        return await originalFetch(input, proxyOptions);
    };
    return client;
};
