// True when running on a shared/cloud host (Vercel sets VERCEL=1). Desktop-only
// features (local git, filesystem browsing, background schedulers, key entry)
// are disabled there.
export const IS_HOSTED = process.env.VERCEL === "1" || process.env.HOSTED === "1";
