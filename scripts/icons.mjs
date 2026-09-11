// Renders public/icon/*.png from a single inline SVG: a rounded square in the
// accent blue with a white "R" for Rules.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";

const ACCENT = "#1074cc";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="${ACCENT}"/>
  <path d="M40 96V32h27c15 0 24 8 24 20 0 9-5 15-13 18l16 26H78L64 72H55v24z M55 60h11c7 0 11-3 11-8s-4-8-11-8H55z" fill="#fff"/>
</svg>`;

mkdirSync("public/icon", { recursive: true });
// The sizes Chrome reads: toolbar (16/32), extensions page (48), install/store (128).
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(`public/icon/${size}.png`, png);
}
console.log("icons written to public/icon/");
