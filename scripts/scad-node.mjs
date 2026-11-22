// Renders a vendored SCAD to a binary STL in Node, with the same OpenSCAD
// WASM build (and the same stack fix) as the browser worker. Used by
// scripts/build-outlines.mjs.
import fs from "node:fs";
import path from "node:path";
import { createOpenSCAD } from "openscad-wasm-prebuilt";

const STACK_BYTES = 8 * 1024 * 1024;
const root = "public/scad";
let files = null;

function loadFiles() {
  if (files) return files;
  const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, "utf8"));
  files = [];
  for (const d of manifest.dirs) for (const f of d.files) files.push([`${d.mount}/${f}`, fs.readFileSync(path.join(root, d.src, f))]);
  return files;
}

const literal = (v) => (typeof v === "boolean" ? String(v) : typeof v === "number" ? String(v) : JSON.stringify(v));

export async function renderStl(scadPath, defines) {
  const log = [];
  let ex = null;
  const original = WebAssembly.instantiate;
  WebAssembly.instantiate = async (...args) => {
    const r = await original(...args);
    ex = ("instance" in r ? r.instance : r).exports;
    return r;
  };
  let inst;
  try {
    inst = (await createOpenSCAD({ print: (s) => log.push(s), printErr: (s) => log.push(s) })).getInstance();
  } finally {
    WebAssembly.instantiate = original;
  }
  const base = ex.cc(16, STACK_BYTES);
  ex.fc(base + STACK_BYTES);
  const FS = inst.FS;
  for (const [p, data] of loadFiles()) {
    const parts = p.split("/").slice(1, -1);
    for (let i = 1; i <= parts.length; i++) {
      try {
        FS.mkdir("/" + parts.slice(0, i).join("/"));
      } catch {}
    }
    FS.writeFile(p, data);
  }
  const args = [scadPath, "-o", "/out.stl", "--export-format=binstl", "--backend=manifold"];
  for (const [k, v] of Object.entries(defines)) args.push("-D", `${k}=${literal(v)}`);
  try {
    inst.callMain(args);
  } catch {}
  try {
    const stl = FS.readFile("/out.stl", { encoding: "binary" });
    return stl.slice().buffer;
  } catch {
    throw new Error(`render failed: ${scadPath} ${JSON.stringify(defines)}\n${log.slice(-5).join("\n")}`);
  }
}
