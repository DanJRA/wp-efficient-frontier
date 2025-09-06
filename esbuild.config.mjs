import { build } from "esbuild";
import { cp } from "fs/promises";

await build({
  entryPoints: ["src/js/app.js", "src/css/app.css"],
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: false,
  loader: { ".css": "css" }
});

// Copy static CSV data files into the build output so they're available
// when the site is deployed (e.g. GitHub Pages expects everything under `dist`).
await cp("data", "dist/data", { recursive: true });

console.log("Built to /dist");
