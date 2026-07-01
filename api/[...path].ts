// Vercel serverless function for /api/*. The actual Express app is bundled into
// _app.mjs at build time (see scripts/build-api.mjs) — imported here with an
// explicit extension so native ESM on Vercel can resolve it.
// @ts-nocheck
import handler from "./_app.mjs";

export default handler;
