// Bundle the Express app + its dependencies into one self-contained ESM file
// that the Vercel serverless function imports. This sidesteps ESM's inability
// to resolve extensionless relative imports of the server/ tree on Vercel.

import { build } from "esbuild";

await build({
  entryPoints: ["server/serverless.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "api/_app.mjs",
  // Some bundled CommonJS deps use require()/__dirname; provide ESM shims.
  banner: {
    js: [
      "import { createRequire as __cr } from 'module';",
      "import { fileURLToPath as __ftu } from 'url';",
      "import { dirname as __dn } from 'path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __ftu(import.meta.url);",
      "const __dirname = __dn(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});

// eslint-disable-next-line no-console
console.log("Bundled api/_app.mjs");
