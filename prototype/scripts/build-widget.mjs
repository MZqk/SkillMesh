import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(root, "dist", "quick-use-widget.html");

async function renderBundle() {
  const [template, css, bundle] = await Promise.all([
    fs.readFile(path.join(root, "widget", "quick-use.html"), "utf8"),
    fs.readFile(path.join(root, "widget", "quick-use.css"), "utf8"),
    build({
      entryPoints: [path.join(root, "widget", "quick-use.js")],
      bundle: true,
      write: false,
      minify: true,
      format: "iife",
      platform: "browser",
      target: ["es2022"],
      legalComments: "none",
    }),
  ]);
  const javascript = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
  return template
    .replace("/*__SKILLMESH_CSS__*/", () => css)
    .replace("/*__SKILLMESH_JS__*/", () => javascript);
}

const rendered = await renderBundle();
const check = process.argv.includes("--check");
if (check) {
  const existing = await fs.readFile(outputPath, "utf8").catch(() => "");
  if (existing !== rendered) {
    console.error("SkillMesh Widget bundle is stale. Run npm run build:widget.");
    process.exitCode = 1;
  } else {
    const digest = crypto.createHash("sha256").update(rendered).digest("hex").slice(0, 12);
    console.log(`SkillMesh Widget bundle is current (${digest}).`);
  }
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendered);
  console.log(`Built ${path.relative(root, outputPath)} (${Buffer.byteLength(rendered)} bytes).`);
}
