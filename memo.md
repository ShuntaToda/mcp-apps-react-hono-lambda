# Hono × MCP Apps × AWS Lambda ブログ用メモ

## 概要

Hono + MCP + MCP Apps (ext-apps) + AWS Lambda でリモートMCPサーバーをサーバーレスデプロイし、
React UIをMCP Appsとしてインライン表示するプロジェクト。

## 技術スタック

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Hono | 4.12.7 | HTTPフレームワーク（Lambda上） |
| @hono/mcp | 0.2.4 | Hono用 Streamable HTTP Transport |
| @modelcontextprotocol/sdk | 1.27.1 | MCP サーバーSDK |
| @modelcontextprotocol/ext-apps | 1.2.2 | MCP Apps（ReactカスタムUI） |
| React | 19 | MCP Apps UI |
| Vite | 6 | React ビルド（singlefile出力） |
| AWS CDK | 2.x | インフラ (Lambda + Function URL) |
| pnpm workspaces | - | モノレポ管理 |
| TypeScript | 5.x | 全パッケージ共通 |

## プロジェクト構成（最終形）

```
line-chart-mcp-apps/
├── pnpm-workspace.yaml
├── package.json              (root)
├── tsconfig.base.json        (共通TS設定)
├── packages/
│   ├── server/               Hono + MCP サーバー (Lambda)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts      ... Hono app + MCP ツール登録
│   │       ├── lambda.ts     ... Lambda ハンドラー (streamHandle)
│   │       └── dev.ts        ... ローカル開発サーバー
│   ├── app/                  React (MCP Apps UI)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── mcp-app.html      ... Vite エントリHTML
│   │   └── src/
│   │       └── mcp-app.tsx   ... useApp フック利用
│   └── infra/                AWS CDK
│       ├── package.json
│       ├── tsconfig.json
│       └── lib/
│           ├── app.ts        ... CDK App エントリ
│           └── stack.ts      ... Lambda + Function URL スタック
```

## MCP Apps (ext-apps) の仕組み

### フロー

1. **ビルド**: Vite + `vite-plugin-singlefile` で React を単一HTMLファイルに出力 (`dist/mcp-app.html`)
2. **サーバー登録**: `registerAppTool` でツールに `_meta.ui.resourceUri: "ui://tool-name/mcp-app.html"` を付与
3. **リソース登録**: `registerAppResource` でビルド済みHTMLを `ui://` URIで配信
4. **クライアント表示**: Claude/ChatGPT等がツール呼び出し時に `ui://` リソースを取得し、サンドボックスiframeで表示
5. **双方向通信**: iframe内のReactアプリが `useApp` フックで `PostMessageTransport` 経由でホストと通信

### サーバー側コード例 (`@modelcontextprotocol/ext-apps/server`)

```typescript
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

registerAppTool(server, "tool-name", {
  title: "Tool Title",
  description: "...",
  inputSchema: {},
  _meta: { ui: { resourceUri: "ui://tool-name/mcp-app.html" } },
}, async () => ({ content: [{ type: "text", text: "result" }] }));

registerAppResource(server, "ui://tool-name/mcp-app.html", "ui://tool-name/mcp-app.html", {
  mimeType: RESOURCE_MIME_TYPE,  // "text/html;profile=mcp-app"
}, async () => ({
  contents: [{ uri: "ui://tool-name/mcp-app.html", mimeType: RESOURCE_MIME_TYPE, text: htmlContent }],
}));
```

### クライアント側コード例 (`@modelcontextprotocol/ext-apps/react`)

```typescript
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

function MyApp() {
  const { app, error } = useApp({
    appInfo: { name: "My App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (result) => { /* ツール結果受信 */ };
      app.ontoolinput = async (input) => { /* ツール入力受信 */ };
    },
  });
  useHostStyles(app, app?.getHostContext());
  // サーバーツール呼び出し
  const result = await app.callServerTool({ name: "tool-name", arguments: {} });
}
```

### Vite設定 (vite-plugin-singlefile)

```typescript
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { rollupOptions: { input: "mcp-app.html" }, outDir: "dist" },
});
```

## Hono × MCP の主要ポイント

- `@hono/mcp` の `StreamableHTTPTransport` を使用（SSEベース）
- `app.all("/mcp", ...)` で GET/POST/DELETE を一つのエンドポイントで処理
- MCPサーバーAPIは `registerTool`（旧 `.tool()` は deprecated）
- `inputSchema` には Zod raw shape (`{ key: z.string() }`) を渡す
- Lambda では `streamHandle`（レスポンスストリーミング対応）が必要
- Lambda Function URL の `invokeMode: RESPONSE_STREAM` が必須

## CDK モノレポでの注意点

- `esbuild` はルートにインストール
- `NodejsFunction` で以下を明示指定:
  - `entry`: sibling パッケージの .ts ファイルへの絶対パス
  - `projectRoot`: server パッケージのディレクトリ
  - `depsLockFilePath`: ルートの lockfile パス
- pnpm の場合、CDK の `NodejsFunction` が lockfile を正しく検出するか要確認

## 構築ログ

### Step 1: プロジェクト初期化（フラット構成で検証）

```bash
git init
npm init -y
npm i hono @hono/mcp @modelcontextprotocol/sdk zod hono-rate-limiter @hono/node-server source-map-support
npm i -D typescript @types/node aws-cdk-lib constructs aws-cdk esbuild tsx @types/source-map-support
```

### Step 2: Hono MCPサーバー作成 (src/index.ts)

- `McpServer` インスタンス作成 (`name: "line-chart-mcp"`)
- `registerTool` で 3 つのツール登録:
  - `greet` - 挨拶メッセージ返却
  - `calculate-bmi` - BMI 計算
  - `current-time` - 現在時刻
- `StreamableHTTPTransport` で `/mcp` エンドポイント設定（`sessionIdGenerator` 付き）
- ヘルスチェック `/` エンドポイント追加

### Step 3: Lambda ハンドラー作成 (src/lambda.ts)

```typescript
import { streamHandle } from "hono/aws-lambda";
import app from "./index.js";
export const handler = streamHandle(app);
```

### Step 4: CDK スタック作成 (infra/stack.ts)

- `NodejsFunction`: ESM format, Node 22, ARM64, 256MB, 30s timeout
- `addFunctionUrl`: `authType: NONE`, `invokeMode: RESPONSE_STREAM`
- `CfnOutput`: FunctionUrl, McpEndpoint
- `terminationProtection: false` でスタック削除保護なし
- `Aspects` で全リソースに `RemovalPolicy.DESTROY` を適用 → `cdk destroy` で完全削除可能

### Step 5: 動作確認

- `npx tsc --noEmit` → OK
- `npx cdk synth` → CloudFormation テンプレート生成OK
- ローカル `npm run dev` (tsx --watch src/dev.ts) → localhost:3000 OK
- `curl http://localhost:3000/` → ヘルスチェック JSON OK
- MCP initialize (POST /mcp with Accept: application/json, text/event-stream) → `protocolVersion: "2025-03-26"` OK

### Step 6: pnpm workspaces でモノレポ化

1. `npm` の `node_modules` / `package-lock.json` / `cdk.out` を削除
2. ディレクトリ構造を `packages/server`, `packages/app`, `packages/infra` に分割
3. ルートに `pnpm-workspace.yaml` 作成:
   ```yaml
   packages:
     - "packages/*"
   ```
4. ルート `package.json` を workspace root 用に書き換え:
   - `private: true`
   - scripts: `dev`, `build`, `typecheck`, `cdk`, `synth`, `deploy`, `diff`
   - devDependencies: `esbuild`（ルートに必須）, `typescript`, `aws-cdk`, `tsx`
   - `pnpm.onlyBuiltDependencies: ["esbuild"]`（ビルドスクリプト許可）
5. `tsconfig.base.json` をルートに作成、各パッケージは `extends` で参照
6. 各パッケージの `package.json` 作成:
   - `@line-chart-mcp/server`: hono, @hono/mcp, @modelcontextprotocol/sdk, ext-apps, zod
   - `@line-chart-mcp/app`: react, react-dom, ext-apps, vite, vite-plugin-singlefile
   - `@line-chart-mcp/infra`: aws-cdk-lib, constructs, source-map-support
7. `pnpm install` 実行
8. `pnpm rebuild esbuild` でビルドスクリプト実行

**ハマりポイント:**
- CDK `NodejsFunction` の `__dirname` → ESM なので `import.meta.dirname` に変更が必要
- CDK の `depsLockFilePath` は `projectRoot` 配下でないとエラー → `projectRoot` をリポルートに設定
- pnpm の `onlyBuiltDependencies` は v10.11.1 では認識されず → `pnpm rebuild esbuild` で手動対応
- `cdk synth` はルートの `cdk.json` を参照するため、ルートから実行する必要あり

### Step 7: MCP Apps (React UI) 追加

1. `packages/app/vite.config.ts` 作成:
   - `@vitejs/plugin-react` + `vite-plugin-singlefile` で単一HTML出力
   - `rollupOptions.input: "mcp-app.html"`
2. `packages/app/mcp-app.html` 作成（Viteエントリ、`/src/mcp-app.tsx` を読み込み）
3. `packages/app/src/mcp-app.tsx` 作成:
   - `useApp` フックでMCPホストと接続
   - `useHostStyles` でホストのCSS変数を適用
   - `ontoolresult` でツール結果を受信・表示
4. `packages/server/src/index.ts` を MCP Apps 対応に更新:
   - `registerAppTool` で `greet` ツールに `_meta.ui.resourceUri` を付与
   - `registerAppResource` で `ui://greet/mcp-app.html` リソースを登録
   - ビルド済みHTMLを `fs.readFile` で読み込んで配信
5. `pnpm --filter @line-chart-mcp/app build` → `dist/mcp-app.html` (319KB, gzip 95KB) 生成OK

### 動作確認（モノレポ化後）

- `pnpm -r typecheck` → 全3パッケージOK
- `pnpm -w run synth` → CDK synth OK
- `pnpm -w run dev` → localhost:3000 ヘルスチェック OK
- `pnpm --filter @line-chart-mcp/app build` → Vite singlefile build OK

### Step 8: マルチセッション対応 + Claude Desktop 接続

**問題**: `McpServer` と `StreamableHTTPTransport` をシングルトンで共有していたため、
1つのクライアントが接続すると「Server already initialized」で他の接続を拒否していた。

**修正**: `createMcpServer()` ファクトリ関数を導入し、リクエストごとに新しい `McpServer` + `StreamableHTTPTransport` を生成。
セッションIDで `Map` 管理し、既存セッションは再利用、新規POSTは新セッション作成。

```typescript
const sessions = new Map<string, { transport: StreamableHTTPTransport }>();
app.all("/mcp", async (c) => {
  const sessionId = c.req.header("mcp-session-id");
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!.transport.handleRequest(c);
  }
  // 新規セッション: transport + server を生成して接続
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  const server = createMcpServer();
  await server.connect(transport);
  // ...セッション登録
});
```

**Claude Desktop 接続設定** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "line-chart-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

- Claude Desktop は `url` フィールド（Streamable HTTP直接接続）を**サポートしていない**
- `mcp-remote` パッケージで stdio ↔ Streamable HTTP のブリッジが必要
- Claude Code は `.mcp.json` で `"type": "http"` + `"url"` を直接サポートしている

**動作確認**: `npx mcp-remote http://localhost:3000/mcp` → 「Connected to remote server」「Proxy established successfully」

### Step 9: ツールを `line-chart` 1つに絞る

**方針**: greet / calculate-bmi / current-time を全削除し、`line-chart` のみに。
AIがWebサイト等から抽出したデータを構造化JSONで渡し、React UIで折れ線グラフ描画。

**ツール定義**:
```typescript
registerAppTool(server, "line-chart", {
  title: "Line Chart",
  description: "Render a line chart from labeled data points.",
  inputSchema: {
    title: z.string(),
    labels: z.array(z.string()),  // X軸ラベル
    values: z.array(z.number()),  // Y軸値
  },
  _meta: { ui: { resourceUri: "ui://line-chart/mcp-app.html" } },
}, async ({ title, labels, values }) => ({
  content: [{ type: "text", text: JSON.stringify({ title, labels, values }) }],
}));
```

**React UI**: Canvas API で折れ線グラフを直描画（外部チャートライブラリ不使用）
- ダークテーマ（背景 #1a1a2e、線 #00d4ff）
- devicePixelRatio 対応（Retina表示）
- Y軸グリッド線 + ラベル、X軸ラベル（斜め表示）
- データポイントにドット表示

**ハマりポイント: ontoolresult vs ontoolinput**:
- 最初 `ontoolresult` でツール結果を受け取ろうとしたが「Waiting for chart data...」のまま表示されなかった
- MCP Apps のフロー: ホストがツール引数を `ontoolinput` で送り、ツール結果を `ontoolresult` で送る
- **グラフデータはツール引数そのもの**（`{ title, labels, values }`）なので `ontoolinput` で受け取るのが正解
- `ontoolinputpartial` も追加するとストリーミング中の途中表示が可能

**Honoの役割の整理**:
- Honoはバックエンドロジックではなく、**Lambda上でMCPのStreamable HTTP Transportを動かすフレームワーク**として使用
- MCPツールの結果JSONをそのままReact UIに渡すだけで、サーバー側APIは不要

### Step 10: AWS Lambda にデプロイ

```bash
# アプリビルド → CDKデプロイ
pnpm --filter @line-chart-mcp/app build
aws-vault exec main -- cdk deploy --require-approval never --app "npx tsx packages/infra/lib/app.ts"
```

**注意**: root の `pnpm -w run deploy` だと `--require-approval never` が `--` の後に渡されて効かない。
TTYなし環境では `cdk deploy` を直接呼ぶ必要あり。

**デプロイ結果**:
- Function URL: `https://oohuqbhplwocq5bonkdwaqqply0horkb.lambda-url.ap-northeast-1.on.aws/`
- MCP Endpoint: `https://oohuqbhplwocq5bonkdwaqqply0horkb.lambda-url.ap-northeast-1.on.aws/mcp`
- リージョン: ap-northeast-1
- デプロイ時間: 約45秒
- バンドルサイズ: 1.2MB (esbuild ESM)

**削除コマンド**:
```bash
aws-vault exec main -- cdk destroy --app "npx tsx packages/infra/lib/app.ts"
```

### Step 11: shop-mcp（商品一覧アプリ）への変更

line-chart-mcp から shop-mcp にリニューアル。Hono APIから商品データを返し、MCP Apps UIで一覧表示。

**変更内容**:
- プロジェクト名を `shop-mcp` にリネーム（全パッケージ）
- `registerAppTool` で `product-list` ツールを登録（カテゴリフィルタ対応）
- Hono REST API `/api/products` でダミー商品データを返却
- React UIで商品カードのグリッド表示（画像・名前・価格・カテゴリ）

### Step 12: Lambda デプロイ時の ENOENT 問題と解決

**問題**: `registerAppResource` 内の `fs.readFile(path.join(APP_DIST_DIR, "mcp-app.html"))` が Lambda 環境で `ENOENT` エラー。
Lambda のバンドルには `packages/app/dist/mcp-app.html` が含まれず、`import.meta.dirname` からの相対パスでファイルが見つからない。

**解決**: esbuild の `loader: { ".html": "text" }` を使い、ビルド時にHTMLを文字列として埋め込む。

```typescript
// packages/server/src/index.ts
import mcpAppHtml from "../../app/dist/mcp-app.html";

// registerAppResource 内で直接使用（fs.readFile 不要）
text: mcpAppHtml
```

```typescript
// packages/infra/lib/stack.ts - CDK bundling 設定
bundling: {
  loader: { ".html": "text" },  // ← 追加
  // ...
}
```

```typescript
// packages/server/src/html.d.ts - TypeScript用の型定義
declare module "*.html" {
  const content: string;
  export default content;
}
```

**参考**: [yusukebe/mcp-app-with-hono](https://github.com/yusukebe/mcp-app-with-hono) も同じ `import html from '../dist/index.html'` パターン。

### Step 13: MCP Apps React UIの実装パターン

**`useApp` フック + `ontoolresult`**:
```typescript
import { useApp } from "@modelcontextprotocol/ext-apps/react";

function McpApp() {
  const [data, setData] = useState(null);

  useApp({
    appInfo: { name: "Shop App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        const text = result.content?.find((c) => c.type === "text")?.text;
        if (text) setData(JSON.parse(text));
      };
    },
  });

  return <div>{/* data を使って描画 */}</div>;
}
```

**ハマりポイント**:
- `useApp` の `onAppCreated` は `connect()` 前に呼ばれるため、ハンドラ登録のタイミングは安全
- `ontoolinput`: ツール引数が届く（AIがツールを呼んだ直後）
- `ontoolresult`: ツール実行結果が届く（サーバーが結果を返した後）
- 商品データのようにサーバーが返す結果を表示する場合は `ontoolresult` を使う

### Step 14: MCP Apps の CSP（Content Security Policy）設定

**問題**: サンドボックスiframe内で外部ドメインの画像（`placehold.co`）が読み込めない。

**解決**: `registerAppResource` の `contents` 内の `_meta.ui.csp` で外部ドメインを許可する。

```typescript
registerAppResource(server, uri, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
  contents: [{
    uri,
    mimeType: RESOURCE_MIME_TYPE,
    text: mcpAppHtml,
    // CSP設定は contents の _meta.ui に配置する（config直下ではない）
    _meta: {
      ui: {
        csp: {
          resourceDomains: ["https://placehold.co"],  // img-src, script-src 等
          // connectDomains: ["https://api.example.com"],  // fetch/WebSocket用
        },
      },
    },
  }],
}));
```

**注意**: CSP設定は `registerAppResource` の第4引数（config）ではなく、コールバックが返す `contents[].meta.ui.csp` に配置する必要がある。config直下に置くと `ts(2353)` エラー。

## データフロー

### 全体像

```
ユーザー → Claude Desktop → MCP Server (Lambda/Hono) → React UI (iframe)
                                  ↑                          |
                                  |    fetch /api/products    |
                                  +--------------------------+
```

### 詳細フロー

```
1. ユーザーが「商品一覧を見せて」と入力
      |
      v
2. Claude (AI) が product-list ツールを呼び出す
      |
      +--→ [MCP Server] registerAppTool のハンドラ実行
      |         → "Displaying all products." を返却（確認メッセージのみ）
      |
      +--→ [Claude Desktop] ツールの _meta.ui.resourceUri を検出
      |         → ui://product-list/mcp-app.html のリソースを取得
      |         → [MCP Server] registerAppResource が HTML を返却
      |         → サンドボックス iframe に HTML をレンダリング
      |
      v
3. React UI が iframe 内で起動
      |
      +--→ useApp() で MCP ホスト (Claude Desktop) に接続
      |
      +--→ ontoolinput でツール引数を受信
      |         → { category: "electronics" } など
      |
      v
4. React が Hono API に直接 fetch
      |
      +--→ GET /api/products?category=electronics
      |         → [Hono] ダミー商品データをフィルタして JSON 返却
      |
      v
5. React UI が商品カードのグリッドを描画
      +--→ 商品画像は placehold.co から読み込み（CSP で許可）
```

### 各コンポーネントの役割

| コンポーネント | 役割 |
|------------|------|
| **Hono** | REST API (`/api/products`) + MCP Streamable HTTP Transport (`/mcp`) |
| **MCP Server** | ツール定義 (`product-list`) + UI リソース配信 (`ui://...`) |
| **React UI** | `ontoolinput` で引数受信 → Hono API を fetch → 商品一覧を描画 |
| **Lambda** | Hono アプリのホスティング（Function URL で公開） |
| **Claude Desktop** | MCP クライアント + iframe ホスト |

### ポイント

- **Hono は2つの役割**を持つ: MCP Transport と REST API サーバー
- **React UI は Hono API を直接 fetch** する（MCP ツール結果経由ではない）
- MCP ツールの戻り値はメッセージのみ、**商品データは Hono API から取得**
- `ontoolinput` でカテゴリ引数を受け取り、API の query parameter として使用
- CSP の `connectDomains` で Lambda Function URL への fetch を許可

## 調査で判明した事実

- `@modelcontextprotocol/hono` パッケージは**存在しない**（公式はHono側の `@hono/mcp`）
- `hono-rate-limiter` は `@hono/mcp` の peer dependency（必須インストール）
- Hono の `serveStatic` は Lambda では使えない（read-only FS）
- MCP Apps 対応クライアント: Claude, ChatGPT, VS Code, Goose, Postman, MCPJam
- `vite-plugin-singlefile` で全JS/CSSを単一HTMLにインライン化するのが公式パターン
- MCP Apps の MIME type は `"text/html;profile=mcp-app"`
- 公式スターターテンプレート: `@modelcontextprotocol/server-basic-react`



"mcpServers": {
  "line-chart-mcp": {
    "type": "http",
    "url": "https://oohuqbhplwocq5bonkdwaqqply0horkb.lambda-url.ap-northeast-1.on.aws/mcp"
    }
}
