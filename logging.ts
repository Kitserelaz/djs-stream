export const logProgress = (area: string, message: string) => {
    console.log(`${new Date().toISOString()} [${area}] ${message}`);
};
