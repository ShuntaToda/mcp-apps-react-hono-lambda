import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { cors } from "hono/cors";
// esbuild の loader: { ".html": "text" } により、ビルド時にHTMLが文字列として埋め込まれる
// Lambda 環境では fs.readFile でファイルを読めないため、この方法でバンドルに含める
import mcpAppHtml from "../../app/dist/mcp-app.html";

const app = new Hono();

app.use("/*", cors());

// MCP Apps の ui:// リソースURI
const RESOURCE_URI = "ui://product-list/mcp-app.html";

// ダミー商品データ
const products = [
  {
    id: 1,
    name: "ワイヤレスイヤホン",
    price: 12800,
    image: "https://placehold.co/200x200/1a1a2e/00d4ff?text=Earbuds",
    category: "electronics",
  },
  {
    id: 2,
    name: "レザーウォレット",
    price: 8500,
    image: "https://placehold.co/200x200/2e1a1a/ff6b6b?text=Wallet",
    category: "fashion",
  },
  {
    id: 3,
    name: "ステンレスボトル",
    price: 3200,
    image: "https://placehold.co/200x200/1a2e1a/6bff6b?text=Bottle",
    category: "lifestyle",
  },
  {
    id: 4,
    name: "メカニカルキーボード",
    price: 15800,
    image: "https://placehold.co/200x200/1a1a2e/d4ff00?text=Keyboard",
    category: "electronics",
  },
  {
    id: 5,
    name: "スニーカー",
    price: 9800,
    image: "https://placehold.co/200x200/2e1a2e/ff6bff?text=Sneakers",
    category: "fashion",
  },
  {
    id: 6,
    name: "デスクライト",
    price: 6400,
    image: "https://placehold.co/200x200/1a2e2e/6bffff?text=Light",
    category: "lifestyle",
  },
];

// --- Hono REST API ---

// 商品一覧API（React UIからfetchされる）
app.get("/api/products", (c) => {
  const category = c.req.query("category");
  const filtered = category
    ? products.filter((p) => p.category === category)
    : products;
  return c.json(filtered);
});

// --- MCP Server ---

/**
 * MCPサーバーのファクトリ関数
 * セッションごとに新しいインスタンスを生成する（マルチクライアント対応）
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "shop-mcp",
    version: "1.0.0",
  });

  // ツール登録: product-list
  // AIがこのツールを呼ぶと、React UIが表示され、Hono APIから商品データを取得して一覧表示する
  registerAppTool(
    server,
    "product-list",
    {
      title: "Product List",
      description:
        "Display a product list from the shop. Optionally filter by category: electronics, fashion, lifestyle.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe("Filter by category: electronics, fashion, lifestyle"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ category }) => {
      const message = category
        ? `Displaying ${category} products.`
        : "Displaying all products.";
      return {
        content: [{ type: "text", text: message }],
      };
    },
  );

  // リソース登録: Viteでビルドした単一HTMLファイルをMCP Appsリソースとして配信
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: mcpAppHtml,
            // サンドボックスiframeで外部画像を読み込むためのCSP設定
            _meta: {
              ui: {
                csp: {
                  resourceDomains: ["https://placehold.co"],
                  connectDomains: [process.env.FUNCTION_URL ?? ""],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}

// MCPエンドポイント（Streamable HTTP Transport）
// Lambda はステートレスなので、リクエストごとに server + transport を生成する
app.all("/mcp", async (c) => {
  const transport = new StreamableHTTPTransport({
    sessionIdGenerator: undefined, // ステートレスモード（セッションIDなし）
  });
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// ヘルスチェック
app.get("/", (c) => {
  return c.json({
    name: "shop-mcp",
    version: "1.0.0",
    status: "ok",
    endpoints: {
      mcp: "/mcp",
      products: "/api/products",
    },
  });
});

export default app;
