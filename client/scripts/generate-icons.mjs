// Real, repeatable icon generation from the one source SVG
// (src/assets/icon-source.svg) — not a one-off hack. Re-run this any time
// the icon design changes; nothing else needs updating by hand except the
// manifest's own icons array (vite.config.ts), which references these
// exact filenames.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, "../src/assets/icon-source.svg");
const outDir = join(__dirname, "../public/icons");
const svg = readFileSync(svgPath);

// "any" purpose icons: the full square, exactly as designed. "maskable"
// (512 only, the size platforms actually request for adaptive icons) needs
// no separate design here — the source SVG's own content already sits
// safely inside the standard 80% safe zone (largest ring at radius 200 of
// a 256 half-canvas, ~78%), so the same raster serves both purposes rather
// than maintaining two near-identical source files.
const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "maskable-512.png", size: 512 },
  // apple-touch-icon: iOS renders this directly with no transparency
  // handling of its own — flattening onto the real void background color
  // (not leaving alpha) is what keeps it looking intentional rather than
  // showing a white/black square where transparency would otherwise be.
  { file: "apple-touch-icon.png", size: 180, flatten: "#0B0A09" },
];

for (const t of targets) {
  let pipeline = sharp(svg).resize(t.size, t.size);
  if (t.flatten) pipeline = pipeline.flatten({ background: t.flatten });
  await pipeline.png().toFile(join(outDir, t.file));
  console.log(`[generate-icons] wrote ${t.file} (${t.size}x${t.size})`);
}
