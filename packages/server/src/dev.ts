import { serve } from "@hono/node-server";
import app from "./index.js";

// ローカル開発用サーバー（pnpm -w run dev で起動）
const port = 3000;
console.log(`MCP server running at http://localhost:${port}`);
console.log(`MCP endpoint: http://localhost:${port}/mcp`);

serve({ fetch: app.fetch, port });
