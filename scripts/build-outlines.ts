// Pre-computes real top-down outlines so the board shows true shapes right
// away, without waiting for a render. Writes src/model/outlines.prebuilt.json,
// keyed by the same render key the browser uses (see render/outlines.ts).
//
// Covers every fixed clip-on piece, clip-on straights of 1 to 30 cells, and
// each generator at its default params (plus a few common sizes). Anything
// else is measured in the browser the first time it is placed, then saved.
//
//   npx vite-node scripts/build-outlines.ts            # everything
//   npx vite-node scripts/build-outlines.ts -- --only mk-   # ids starting with mk-
//   (add --out <file> to write somewhere else, e.g. to run groups in parallel)
//
// Renders take 10 to 30 s each in WASM, so a full run takes several minutes.
// Existing entries for other generators are kept.

import fs from "node:fs";
import { ALL_GENERATORS, defaultParams, type Generator } from "../src/model/library";
import { outlineFromStl, type Outline } from "../src/model/outline";
import type { Board, ParamValue, PartType } from "../src/model/types";
import { outlineKey, rendersFor } from "../src/render/plan";
// @ts-expect-error plain JS helper
import { renderStl } from "./scad-node.mjs";

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const OUT = arg("--out") ?? "src/model/outlines.prebuilt.json";
const board: Board = {
  id: "b",
  name: "prebuild",
  widthCells: 10,
  heightCells: 10,
  pitchMm: 28,
  tile: { widthCells: 7, heightCells: 7, variant: "Full" },
  placements: [],
};

const only = arg("--only");
const table: Record<string, Outline> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

const pt = (g: Generator, params: Record<string, ParamValue> = {}): PartType => ({
  id: "p",
  name: g.name,
  category: g.category,
  color: g.color,
  generatorId: g.id,
  params: { ...defaultParams(g), ...params },
  envelope: { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 },
});

const asBuf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const stlFile = (id: string) => asBuf(fs.readFileSync(`public/scad/openGridUnderware/pieces/${id}.stl`));

/** A straight of n cells: the 1-cell piece repeated every 28 mm, like the SCAD does. */
function tiledStraight(n: number): ArrayBuffer {
  const one = Buffer.from(stlFile("straight-1"));
  const count = one.readUInt32LE(80);
  const out = Buffer.alloc(84 + count * n * 50);
  out.writeUInt32LE(count * n, 80);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < count; t++) {
      const src = 84 + t * 50, dst = 84 + (i * count + t) * 50;
      one.copy(out, dst, src, src + 50);
      for (let k = 0; k < 3; k++) out.writeFloatLE(one.readFloatLE(src + 12 + k * 12 + 4) + i * 28, dst + 12 + k * 12 + 4);
    }
  }
  return asBuf(out);
}

type Job = { label: string; part: PartType; stl: () => Promise<ArrayBuffer> };
const jobs: Job[] = [];
const viaRender = (g: Generator, params: Record<string, ParamValue> = {}) => {
  const part = pt(g, params);
  const piece = rendersFor(board, part)[0];
  jobs.push({ label: `${g.id} ${JSON.stringify(params)}`, part, stl: () => renderStl(piece.scadPath, piece.defines) });
};

for (const g of ALL_GENERATORS) {
  if (only && !g.id.startsWith(only)) continue;
  if (g.id === "og-piece") {
    for (const id of g.params[0].choices!) jobs.push({ label: `og-piece ${id}`, part: pt(g, { Piece: id }), stl: async () => stlFile(id) });
  } else if (g.id === "og-straight") {
    for (let n = 1; n <= 30; n++) jobs.push({ label: `og-straight ${n}`, part: pt(g, { Length_Units: n }), stl: async () => tiledStraight(n) });
  } else {
    viaRender(g);
    if (g.id === "mk-i") for (let n = 1; n <= 10; n++) if (n !== 5) viaRender(g, { Channel_Length_Units: n });
    if (g.id === "mk-l") for (const r of [1, 2]) viaRender(g, { Added_Radius: r });
  }
}

let done = 0;
for (const j of jobs) {
  const key = outlineKey(board, j.part)!;
  const t0 = Date.now();
  if (table[key]) {
    done++;
    continue;
  }
  try {
    const g = ALL_GENERATORS.find((x) => x.id === j.part.generatorId)!;
    const o = outlineFromStl(await j.stl(), g.boardAxes ?? "xy");
    if (!o) throw new Error("empty outline");
    table[key] = o;
    fs.writeFileSync(OUT, JSON.stringify(table) + "\n");
    console.log(`${++done}/${jobs.length} ${j.label}: ${o.sizeMm.join(" x ")} mm, ${o.loops.reduce((s, l) => s + l.length, 0)} pts (${Date.now() - t0} ms)`);
  } catch (e) {
    console.error(`FAILED ${j.label}: ${e instanceof Error ? e.message : e}`);
  }
}
fs.writeFileSync(OUT, JSON.stringify(table) + "\n");
console.log(`${Object.keys(table).length} outlines in ${OUT}`);
