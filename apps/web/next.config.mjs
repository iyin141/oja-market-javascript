/** @type {import("next").NextConfig} */
// NEXT_BASE_PATH: set at build time when the app is served under a path (for example /oja-market on a shared domain). Empty = site root.
const basePath = process.env.NEXT_BASE_PATH || "";
export default { reactStrictMode: true, env: { NEXT_PUBLIC_BASE_PATH: basePath }, ...(basePath ? { basePath } : {}) };
