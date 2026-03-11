import { streamHandle } from "hono/aws-lambda";
import app from "./index.js";

// Lambda Function URL のレスポンスストリーミングに対応したハンドラー
// SSEベースのStreamable HTTP Transportに必要
export const handler = streamHandle(app);
