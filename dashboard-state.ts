export const dashboardState = {
    startup: "Recovering archive",
    webdav: "Recovering",
    recovery: { phase: "Starting", path: "", files: 0, bytes: 0, total: null as number | null },
    catchUp: { status: "Waiting", channel: "", completed: 0, total: 0, recovered: 0, failed: 0 },
    activity: [] as { event: string; time: string }[],
};

export const recordActivity = (event: string) => {
    dashboardState.activity.unshift({ event, time: new Date().toISOString() });
    dashboardState.activity.length = Math.min(dashboardState.activity.length, 10);
};
