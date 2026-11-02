import { setTimeout as delay } from "node:timers/promises";
import { recordFailure } from "./storage";
import { shutdownSignal, throwIfStopping } from "./shutdown";
import { logProgress } from "./logging";
let previousRequest = Promise.resolve();
export const withTimeout = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new DOMException("Request timed out after 45 seconds", "TimeoutError")), 45000);
            }),
            new Promise<never>((_, reject) => {
                onAbort = () => reject(shutdownSignal.reason);
                shutdownSignal.addEventListener("abort", onAbort, { once: true });
                if (shutdownSignal.aborted) onAbort();
            }),
        ]);
    }
    finally {
        clearTimeout(timer);
        shutdownSignal.removeEventListener("abort", onAbort);
    }
};
export const request = async <T>(operation: () => Promise<T>): Promise<T> => {
    throwIfStopping();
    const previous = previousRequest;
    let release = () => { };
    previousRequest = new Promise(resolve => { release = resolve; });
    try {
        await previous;
        for (let attempt = 0;; attempt++) {
            throwIfStopping();
            try {
                return await withTimeout(operation());
            }
            catch (error) {
                throwIfStopping();
                const status = (error as {
                    status?: number;
                    httpStatus?: number;
                }).status
                    ?? (error as {
                        httpStatus?: number;
                    }).httpStatus;
                if (attempt === 2 || (status !== undefined && status !== 429 && status < 500))
                    throw error;
                logProgress("Requests", `Request failed; retry ${attempt + 1}/2 in ${1000 * 2 ** attempt} ms.`);
                await delay(1000 * 2 ** attempt, undefined, { signal: shutdownSignal });
            }
        }
    }
    finally {
        release();
    }
};
export const attempt = async <T>(context: string, operation: () => Promise<T>) => {
    throwIfStopping();
    logProgress("Collection", context);
    try {
        return await operation();
    }
    catch (error) {
        throwIfStopping();
        recordFailure(context, error);
        return null;
    }
};
