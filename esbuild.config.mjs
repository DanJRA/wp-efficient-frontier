import { build } from "esbuild";

await build({
  entryPoints: ["src/js/app.js", "src/css/app.css"],
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: false,
  loader: { ".css": "css" }
});
console.log("Built to /dist");
