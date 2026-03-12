import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import "./index.css";

// Hono API のベースURL（Vite の define でビルド時に埋め込み）
declare const API_BASE_URL: string;

interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  category: string;
}

const categoryColors: Record<string, string> = {
  electronics: "bg-cyan-500/20 text-cyan-400",
  fashion: "bg-pink-500/20 text-pink-400",
  lifestyle: "bg-green-500/20 text-green-400",
};

/** 商品カードコンポーネント */
function ProductCard({ product }: { product: Product }) {
  const badgeColor = categoryColors[product.category] ?? "bg-gray-500/20 text-gray-400";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden transition hover:border-white/20 hover:bg-white/10">
      <img
        src={product.image}
        alt={product.name}
        className="w-full h-36 object-cover"
      />
      <div className="p-3">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${badgeColor}`}>
          {product.category}
        </span>
        <h3 className="mt-1.5 text-sm font-medium text-white">
          {product.name}
        </h3>
        <p className="mt-1 text-base font-bold text-white">
          ¥{product.price.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/**
 * MCP Apps メインコンポーネント
 * ontoolinput でツール引数を受け取り、Hono API から商品データを fetch して表示
 */
function McpApp() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [shouldFetch, setShouldFetch] = useState(false);

  useApp({
    appInfo: { name: "Shop App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      // ontoolinput: AIがツールを呼んだ時の引数を受け取る
      app.ontoolinput = (params) => {
        const args = params.arguments as { category?: string } | undefined;
        setCategory(args?.category);
        setShouldFetch(true);
      };
    },
  });

  // Hono API から商品データを fetch
  useEffect(() => {
    if (!shouldFetch) return;
    setLoading(true);

    const url = category
      ? `${API_BASE_URL}/api/products?category=${category}`
      : `${API_BASE_URL}/api/products`;

    fetch(url)
      .then((res) => res.json())
      .then((data: Product[]) => {
        setProducts(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [shouldFetch, category]);

  return (
    <div className="p-4 max-w-2xl font-sans">
      <h2 className="text-lg font-bold text-white mb-4">
        Shop Products
        {category && (
          <span className="ml-2 text-sm font-normal text-white/50">
            / {category}
          </span>
        )}
      </h2>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
          <span className="ml-3 text-sm text-white/50">Loading products...</span>
        </div>
      ) : products.length === 0 ? (
        <p className="text-center text-sm text-white/40 py-12">
          No products found.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpApp />
  </StrictMode>,
);
