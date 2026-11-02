import assert from "node:assert/strict";
import type { Client } from "discord.js-selfbot-v13";
import { request, withTimeout } from "./requests";
import { beginShutdown, cancelDiscordRequestsOnShutdown, shutdownSignal } from "./shutdown";

let queuedRequestStarted = false;
let httpAborted = false;
const client = {
    rest: {
        fetch: async (_url: string, options: RequestInit) => await new Promise((_, reject) => {
            options.signal!.addEventListener("abort", () => {
                httpAborted = true;
                reject(options.signal!.reason);
            }, { once: true });
        }),
    },
};
cancelDiscordRequestsOnShutdown(client as unknown as Client);
const http = client.rest.fetch("https://discord.example", {});
const active = request(async () => await new Promise(() => {}));
const queued = request(async () => { queuedRequestStarted = true; });
const gateway = withTimeout(new Promise(() => {}));
await Promise.resolve();
beginShutdown();
const results = await Promise.allSettled([http, active, queued, gateway]);
assert.equal(shutdownSignal.aborted, true);
assert.equal(httpAborted, true);
assert.equal(queuedRequestStarted, false);
assert.ok(results.every(result => result.status === "rejected" && result.reason.name === "AbortError"));
await assert.rejects(() => request(async () => {}), { name: "AbortError" });
console.log("Shutdown checks passed: HTTP aborted, gateway waits cancelled, and queued/new requests stopped.");
