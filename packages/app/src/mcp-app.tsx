import { StrictMode, useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

interface ChartData {
  title: string;
  labels: string[];
  values: number[];
}

/** Canvas API で折れ線グラフを描画するコンポーネント */
function LineChart({ data }: { data: ChartData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Retina対応
    const dpr = window.devicePixelRatio || 1;
    const w = 600;
    const h = 350;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const padding = { top: 40, right: 30, bottom: 60, left: 70 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    const { labels, values, title } = data;
    if (values.length === 0) return;

    // Y軸の範囲を計算（上下に10%の余白）
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const yMin = min - range * 0.1;
    const yMax = max + range * 0.1;

    // タイトル
    ctx.fillStyle = "#e0e0e0";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(title, w / 2, 26);

    // グリッド線 + Y軸ラベル
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = "#999";
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + chartH - (i / gridCount) * chartH;
      const val = yMin + (i / gridCount) * (yMax - yMin);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
      ctx.fillText(val.toLocaleString(undefined, { maximumFractionDigits: 1 }), padding.left - 8, y + 4);
    }

    // X軸ラベル（斜め表示）
    ctx.textAlign = "center";
    ctx.fillStyle = "#999";
    labels.forEach((label, i) => {
      const x = padding.left + (i / (labels.length - 1 || 1)) * chartW;
      ctx.save();
      ctx.translate(x, padding.top + chartH + 16);
      ctx.rotate(-0.4);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });

    // 折れ線
    ctx.strokeStyle = "#00d4ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((val, i) => {
      const x = padding.left + (i / (values.length - 1 || 1)) * chartW;
      const y = padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // データポイント
    ctx.fillStyle = "#00d4ff";
    values.forEach((val, i) => {
      const x = padding.left + (i / (values.length - 1 || 1)) * chartW;
      const y = padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [data]);

  return <canvas ref={canvasRef} style={{ maxWidth: "100%", borderRadius: "8px" }} />;
}

/**
 * MCP Apps のエントリポイント
 * ホストから ontoolinput でツール引数を受け取り、折れ線グラフを描画する
 */
function McpApp() {
  const [chartData, setChartData] = useState<ChartData | null>(null);

  const { app } = useApp({
    appInfo: { name: "Line Chart App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      // ツール引数（title, labels, values）をホストから受け取る
      app.ontoolinput = (params) => {
        const args = params.arguments as ChartData | undefined;
        if (args?.title && args?.labels && args?.values) {
          setChartData(args);
        }
      };

      // ストリーミング中の部分データでも描画（プログレッシブレンダリング）
      app.ontoolinputpartial = (params) => {
        const args = params.arguments as Partial<ChartData> | undefined;
        if (args?.title && args?.labels && args?.values) {
          setChartData(args as ChartData);
        }
      };
    },
  });

  // ホストのCSSテーマを適用
  useHostStyles(app, app?.getHostContext());

  return (
    <div style={{ padding: "16px", fontFamily: "system-ui, sans-serif" }}>
      {chartData ? (
        <LineChart data={chartData} />
      ) : (
        <p style={{ color: "#999", textAlign: "center" }}>
          Waiting for chart data...
        </p>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpApp />
  </StrictMode>,
);
