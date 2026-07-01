import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./server/app";

// Production server: one process, one port. Serves the Vite build from /dist
// and mounts the same /api proxy used in development.
//   1. npm run build   -> emits ./dist
//   2. npm start       -> runs this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "dist");
const PORT = Number(process.env.PORT) || 4000;

const app = express();

// API first so /api/* is handled by the proxy.
app.use(createApiApp());

// Static assets + SPA fallback for everything else.
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Azure DevOps Git Helper running on http://localhost:${PORT}`);
});
