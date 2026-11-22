// Copies the SCAD sources the renderer needs into public/scad/, from
// pinned commits of BOSL2 and QuackWorks, and writes a manifest.
//
//   node scripts/vendor-scad.mjs <path to BOSL2 checkout> <path to QuackWorks checkout>
//
// Both checkouts must be at the commits below (the script checks).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeManifest } from "./scad-manifest.mjs";

const PINS = {
  BOSL2: "1351a9f7e5f30a95228e580d167fd4f2e184ad2c",
  QuackWorks: "e0c1cb7ec78dd9e9a8476ed739bd3402074354f3",
};
const UNDERWARE = [
  "Underware_I_Channel.scad",
  "Underware_L_Channel.scad",
  "Underware_T_Channel.scad",
  "Underware_X_Channel.scad",
  "Underware_C_Channel.scad",
  "Underware_S_Channel.scad",
  "Underware_Y_Channel.scad",
  "Underware_Diagonal_Channel.scad",
  "Underware_Branch_Split_Channel.scad",
  "Underware_Item_Holder.scad",
];
const BOSL_ROOTS = ["std.scad", "rounding.scad", "threading.scad", "walls.scad"];

const [bosl, quack] = process.argv.slice(2);
if (!bosl || !quack) {
  console.error("usage: node scripts/vendor-scad.mjs <BOSL2 dir> <QuackWorks dir>");
  process.exit(1);
}
for (const [name, dir] of [["BOSL2", bosl], ["QuackWorks", quack]]) {
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  if (head !== PINS[name]) throw new Error(`${name} is at ${head}, expected ${PINS[name]}`);
}

// Transitive closure of BOSL2 includes from the files Underware uses.
const boslFiles = new Set();
const todo = [...BOSL_ROOTS];
while (todo.length) {
  const f = todo.pop();
  if (boslFiles.has(f) || !fs.existsSync(path.join(bosl, f))) continue;
  boslFiles.add(f);
  const src = fs.readFileSync(path.join(bosl, f), "utf8");
  for (const m of src.matchAll(/(?:include|use)\s*<([^>]+)>/g)) todo.push(m[1].replace(/^BOSL2\//, ""));
}

const out = "public/scad";
// Only this script's folders; other vendored sources (openGridUnderware) stay.
fs.rmSync(`${out}/BOSL2`, { recursive: true, force: true });
fs.rmSync(`${out}/Underware`, { recursive: true, force: true });
fs.mkdirSync(`${out}/BOSL2`, { recursive: true });
fs.mkdirSync(`${out}/Underware`, { recursive: true });
for (const f of boslFiles) fs.copyFileSync(path.join(bosl, f), `${out}/BOSL2/${f}`);
fs.copyFileSync(path.join(bosl, "LICENSE"), `${out}/BOSL2/LICENSE`);
for (const f of UNDERWARE) fs.copyFileSync(path.join(quack, "Underware", f), `${out}/Underware/${f}`);
fs.copyFileSync(path.join(quack, "LICENSE"), `${out}/Underware/LICENSE`);

// Small source patches so the SCADs render in OpenSCAD WASM. Each one must
// leave the geometry unchanged (checked by rendering before and after).
const PATCHES = [
  {
    // The mount holes were children of path_sweep(). With threaded snap
    // holes that crashes WASM OpenSCAD ("null function or function signature
    // mismatch"). Making them siblings inside the same diff() gives a
    // byte-identical STL for the Magnet option and fixes the threaded one.
    file: "Underware_C_Channel.scad",
    from: 'turtle(["move", Grid_Size, "arcleft", radiusMM, 90, "move", Grid_Size])) {',
    to: 'turtle(["move", Grid_Size, "arcleft", radiusMM, 90, "move", Grid_Size]));\n                {',
  },
];
for (const p of PATCHES) {
  const f = `${out}/Underware/${p.file}`;
  const src = fs.readFileSync(f, "utf8");
  if (src.split(p.from).length !== 2) throw new Error(`patch for ${p.file} no longer applies`);
  fs.writeFileSync(f, src.replace(p.from, p.to));
}

writeManifest(PINS);
console.log(`vendored ${boslFiles.size} BOSL2 files and ${UNDERWARE.length} Underware files`);
