#!/usr/bin/env node
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import dotenv from "dotenv";
import { authenticateKey } from "./auth.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerFixesTools } from "./tools/fixes.js";

// Load environment variables from .env if present
dotenv.config();

const DEFAULT_SUPABASE_URL = "https://kqgquprgfhdgvuvgirmz.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxZ3F1cHJnZmhkZ3Z1dmdpcm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI3ODk1MTgsImV4cCI6MjA2ODM2NTUxOH0.Ya8M5DZO_N73-ioRBtaf3-C9t4suokKp2AZvQCxQz9U";

function createServerForUser(user: any) {
  const server = new McpServer({
    name: "portal-mcp",
    version: "1.0.0",
  });

  registerAnalyticsTools(server, user);
  registerCatalogTools(server, user);
  registerFixesTools(server, user);

  return server;
}

async function runStdio() {
  const apiKey = process.env.PORTAL_API_KEY;
  if (!apiKey) {
    console.error(
      "[portal-mcp] Error: Missing PORTAL_API_KEY environment variable.\n" +
        "Please generate an MCP token in Portal Settings -> AI Integrations and set PORTAL_API_KEY.",
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

  console.error("[portal-mcp] Authenticating user API key...");
  let user;
  try {
    user = await authenticateKey(apiKey, supabaseUrl, anonKey);
    console.error(
      `[portal-mcp] Authenticated as user ${user.userId} (${user.name}) with scopes: [${user.scopes.join(", ")}]`,
    );
  } catch (err: any) {
    console.error(`[portal-mcp] Authentication failed: ${err.message}`);
    process.exit(1);
  }

  const server = createServerForUser(user);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[portal-mcp] Server connected via Stdio. Ready for tool calls.");
}

async function runSse(port: number) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

  const activeTransports = new Map<string, SSEServerTransport>();

  const server = http.createServer(async (req, res) => {
    // Enable CORS for web clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);

    // Health check
    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "portal-mcp",
          version: "1.0.0",
        }),
      );
      return;
    }

    // SSE connection endpoint: GET /sse
    if (req.method === "GET" && parsedUrl.pathname === "/sse") {
      const authHeader = req.headers.authorization;
      const token =
        authHeader?.replace(/^Bearer\s+/i, "") ||
        parsedUrl.searchParams.get("token") ||
        process.env.PORTAL_API_KEY;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing Bearer token or ?token= param" }));
        return;
      }

      try {
        const user = await authenticateKey(token, supabaseUrl, anonKey);

        const mcpServer = createServerForUser(user);
        const transport = new SSEServerTransport("/message", res);
        activeTransports.set(transport.sessionId, transport);

        transport.onclose = () => {
          activeTransports.delete(transport.sessionId);
        };

        await mcpServer.connect(transport);
        console.error(`[portal-mcp] Connected SSE session ${transport.sessionId} for ${user.name}`);
      } catch (err: any) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Authentication failed: ${err.message}` }));
      }
      return;
    }

    // Message handler: POST /message
    if (req.method === "POST" && parsedUrl.pathname === "/message") {
      const sessionId = parsedUrl.searchParams.get("sessionId");
      const transport = sessionId ? activeTransports.get(sessionId) : null;

      if (!transport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found or closed" }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end("Not found");
  });

  server.listen(port, () => {
    console.error(`[portal-mcp] Remote SSE Server listening on http://0.0.0.0:${port}`);
    console.error(`[portal-mcp] SSE Endpoint: http://localhost:${port}/sse`);
    console.error(`[portal-mcp] Message Endpoint: http://localhost:${port}/message`);
  });
}

async function main() {
  const isSse =
    process.argv.includes("--sse") || process.env.MCP_TRANSPORT === "sse";
  const ssePortArg = process.argv.find((a) => a.startsWith("--port="));
  const port = ssePortArg
    ? parseInt(ssePortArg.split("=")[1], 10)
    : parseInt(process.env.PORT || "3000", 10);

  if (isSse) {
    await runSse(port);
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error("[portal-mcp] Fatal error:", err);
  process.exit(1);
});
