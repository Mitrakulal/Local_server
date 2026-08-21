import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicGatewayProxy } from "./gatewayProxy.js";
import { createOwnerChatProxy } from "./ownerChatProxy.js";
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

  // Nocturne Ledger style: the public same-host router understands only the
  // chat surface plus the established /v1 API. Secret-bearing admin routes
  // remain unavailable on the public port and continue to live on port 3000.
  if (port === 3000) app.use("/admin/api", createOwnerConsoleProxy());
  app.use("/chat/api", createOwnerChatProxy());
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
  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Same-host chat router running on http://127.0.0.1:${port}/`);
  });
}

startServer().catch(console.error);
