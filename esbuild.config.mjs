// esbuild.config.mjs
import { build } from "esbuild";

await build({
  entryPoints: ["src/js/app.js", "src/css/app.css"],
  outdir: "dist",            // build to js/
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",           // keep import.meta.url
  loader: { ".css": "css" }
});
console.log("Built to /js");
