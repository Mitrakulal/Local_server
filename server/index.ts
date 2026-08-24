import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicGatewayProxy } from "./gatewayProxy.js";
import { createPublicChatProxy } from "./ownerChatProxy.js";
import { createOwnerConsoleProxy } from "./ownerConsoleProxy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  const port = Number(process.env.CHAT_ROUTER_PORT || process.env.PORT || 3001);
  const publicChat = createPublicChatProxy();

  // Nocturne Ledger style: the public same-host router understands only the
  // chat surface plus the established /v1 API. Secret-bearing admin routes
  // remain unavailable on the public port and continue to live on port 3000.
  if (port === 3000) app.use("/admin/api", createOwnerConsoleProxy());
  app.get("/chat/api/status", (_req, res) =>
    res.status(200).set("cache-control", "no-store").json(publicChat.status())
  );
  app.use("/chat/api/completions", publicChat.handler);
  app.use("/v1", createPublicGatewayProxy());
  app.use("/healthz", createPublicGatewayProxy());
  if (port !== 3000) {
    app.use("/admin", (_req, res) =>
      res.status(404).set("cache-control", "no-store").json({ error: "not_found" })
    );
    app.use("/lab", (_req, res) =>
      res.status(404).set("cache-control", "no-store").json({ error: "not_found" })
    );
  }
  app.use(
    express.static(staticPath, {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          // The document owns the asset manifest and must never point at stale chunks.
          res.setHeader("cache-control", "no-store");
          return;
        }
        // Vite asset names include a content hash, so immutable caching is safe.
        res.setHeader("cache-control", "public, max-age=31536000, immutable");
      },
    })
  );

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.set("cache-control", "no-store");
    res.sendFile(path.join(staticPath, "index.html"));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Same-host chat router running on http://127.0.0.1:${port}/`);
  });
}

startServer().catch(console.error);
