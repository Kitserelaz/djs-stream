export const warpProxy = "http://127.0.0.1:40000";

export const warpFetch = async (input: Parameters<typeof fetch>[0], options: Parameters<typeof fetch>[1] = {}) => await fetch(input, {
    ...options,
    proxy: { url: warpProxy, respectNoProxy: false },
});
