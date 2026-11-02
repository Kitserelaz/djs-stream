import type { Client } from "discord.js-selfbot-v13";

const controller = new AbortController();
export const shutdownSignal = controller.signal;

export const beginShutdown = () => {
    controller.abort(new DOMException("Application is shutting down", "AbortError"));
};

export const throwIfStopping = () => shutdownSignal.throwIfAborted();

export const cancelDiscordRequestsOnShutdown = (client: Client) => {
    // The installed library sends its REST requests through this fetch method.
    const rest: {
        fetch: (url: string, options?: RequestInit) => Promise<unknown>;
    } = client.rest;
    const originalFetch = rest.fetch.bind(rest);
    rest.fetch = async (url, options = {}) => {
        throwIfStopping();
        const signals = options.signal ? [options.signal, shutdownSignal] : [shutdownSignal];
        return await originalFetch(url, { ...options, signal: AbortSignal.any(signals) });
    };
};
