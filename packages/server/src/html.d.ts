// esbuild の loader: { ".html": "text" } 用の型定義
declare module "*.html" {
  const content: string;
  export default content;
}
