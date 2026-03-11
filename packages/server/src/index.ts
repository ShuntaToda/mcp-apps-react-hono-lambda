import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

const app = new Hono();

// packages/app のビルド成果物（単一HTML）のパス
const APP_DIST_DIR = path.resolve(import.meta.dirname, "../../app/dist");

// MCP Apps の ui:// リソースURI（ツールとReact UIを紐付ける識別子）
const RESOURCE_URI = "ui://line-chart/mcp-app.html";

/**
 * MCPサーバーのファクトリ関数
 * セッションごとに新しいインスタンスを生成する（マルチクライアント対応）
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "line-chart-mcp",
    version: "1.0.0",
  });

  // ツール登録: line-chart
  // _meta.ui.resourceUri でこのツールに対応するReact UIを指定
  registerAppTool(
    server,
    "line-chart",
    {
      title: "Line Chart",
      description: "Render a line chart from labeled data points. Pass structured data extracted from any source.",
      inputSchema: {
        title: z.string().describe("Chart title"),
        labels: z.array(z.string()).describe("X-axis labels (e.g. months, years)"),
        values: z.array(z.number()).describe("Y-axis values corresponding to each label"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ title, labels, values }) => ({
      content: [{
        type: "text",
        text: JSON.stringify({ title, labels, values }),
      }],
    }),
  );

  // リソース登録: Viteでビルドした単一HTMLファイルをMCP Appsリソースとして配信
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(APP_DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}

// セッション管理: クライアントごとにtransportを保持
const sessions = new Map<string, { transport: StreamableHTTPTransport }>();

// MCPエンドポイント（Streamable HTTP Transport）
// GET/POST/DELETE を単一パスで処理する
app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");

  // 既存セッション: そのままtransportに委譲
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!.transport.handleRequest(c);
  }

  // 新規セッション: transport + server を生成して接続
  if (c.req.method === "POST") {
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const server = createMcpServer();
    await server.connect(transport);

    // セッション切断時にMapから削除
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const response = await transport.handleRequest(c);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport });
    }

    return response;
  }

  return c.json({ error: "No valid session" }, 400);
});

// ヘルスチェック
app.get("/", (c) => {
  return c.json({
    name: "line-chart-mcp",
    version: "1.0.0",
    status: "ok",
    mcp_endpoint: "/mcp",
  });
});

export default app;
