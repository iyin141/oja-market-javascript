/** @type {import("next").NextConfig} */
// NEXT_BASE_PATH: set at build time when the app is served under a path (for example /oja-market on a shared domain). Empty = site root.
const basePath = process.env.NEXT_BASE_PATH || "";
// NEXT_PUBLIC_API_URL is inlined into the bundle at build time; a production build without it would call localhost.
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn("\n!!! [oja-web] NEXT_PUBLIC_API_URL is not set for this production build: the browser will call http://localhost:4100. Set it before `next build`. !!!\n");
}
export default { reactStrictMode: true, env: { NEXT_PUBLIC_BASE_PATH: basePath }, ...(basePath ? { basePath } : {}) };
