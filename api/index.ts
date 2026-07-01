// Vercel serverless function for the API. vercel.json rewrites every /api/*
// request (any depth) to this function, which imports the bundled Express app
// (_app.mjs, produced by scripts/build-api.mjs at build time).
// @ts-nocheck
import handler from "./_app.mjs";

export default handler;
