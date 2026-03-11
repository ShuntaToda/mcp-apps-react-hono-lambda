import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

export class HonoMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      // cdk destroy でスタックを削除できるようにする
      terminationProtection: false,
    });

    cdk.Aspects.of(this).add(new cdk.Tag("Project", "line-chart-mcp"));
    // 全リソースを cdk destroy で完全削除可能にする
    this.applyRemovalPolicy();

    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const serverDir = path.join(repoRoot, "packages/server");

    // Lambda関数: esbuild で packages/server/src/lambda.ts をESMバンドル
    const fn = new nodejs.NodejsFunction(this, "McpFunction", {
      entry: path.join(serverDir, "src/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      // pnpm workspaces: ルートを projectRoot にし、lockfile もルートを指定
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, "pnpm-lock.yaml"),
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        mainFields: ["module", "main"],
        esbuildArgs: {
          "--conditions": "module",
        },
        // ESMで require() を使うパッケージ向けの polyfill
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // Function URL: 認証なし + レスポンスストリーミング（SSE用）
    const functionUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    new cdk.CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url,
      description: "Lambda Function URL for MCP server",
    });

    new cdk.CfnOutput(this, "McpEndpoint", {
      value: `${functionUrl.url}mcp`,
      description: "MCP Streamable HTTP endpoint",
    });
  }

  /** 全リソースの DeletionPolicy を Delete に設定 */
  private applyRemovalPolicy() {
    cdk.Aspects.of(this).add({
      visit(node) {
        if (node instanceof cdk.CfnResource) {
          node.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
        }
      },
    });
  }
}
