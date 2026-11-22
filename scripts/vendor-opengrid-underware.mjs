// Pulls the clip-on channel pieces out of David D's "Underware for openGrid"
// 3MF (the Bambu Studio project from MakerWorld/Printables) into
// public/scad/openGridUnderware/, as binary STLs moved to the origin, and
// writes src/model/ogPieces.json with each piece's size.
//
//   node scripts/vendor-opengrid-underware.mjs <path to .3mf>
//
// Straights of any length are built from the 1-cell piece by the SCAD in
// that folder, so the 2x..8x straights in the 3MF are only used to check that.
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { writeManifest } from "./scad-manifest.mjs";

// Plate name in the 3MF -> id and label in the tool.
const PIECES = {
  "1x channel": ["straight-1", "Straight (1 cell, repeat unit)"],
  "1 Channel": ["curve-1", "Curve, radius 1"],
  "2 Channel": ["curve-2", "Curve, radius 2"],
  "3 Channel": ["curve-3", "Curve, radius 3"],
  "4 Channel": ["curve-4", "Curve, radius 4"],
  "1 End Channel": ["end-1", "End piece, 1 cell"],
  "2 End Channel": ["end-2", "End piece, 2 cells"],
  "open left channel 1": ["open-left", "Open curve, left"],
  "open right channel 1": ["open-right", "Open curve, right"],
  "Right Channel": ["right", "Right turn exit"],
  "1Y CHannel": ["y1", "1Y"],
  "2Y Channel": ["y2", "2Y"],
  "Straight 1Y Left Channel": ["y1-straight-left", "Straight 1Y, left"],
  "Straight 1Y Right Channel": ["y1-straight-right", "Straight 1Y, right"],
  "Straight 2Y Channel": ["y2-straight", "Straight 2Y"],
  "": ["s-jog", "S jog"],
  "X  Channel": ["x", "X cross"],
  "extreme x channel": ["x-extreme", "Extreme X (1 cell)"],
  "T Channel": ["t", "T"],
  "Z Channel-Left": ["z-left", "Z (diagonal), left"],
  "Z Channel Right": ["z-right", "Z (diagonal), right"],
  "Full 1x Bridge": ["bridge-1", "Bridge, 1 cell"],
  "Full 2x Bridge": ["bridge-2", "Bridge, 2 cells"],
  "Full Open Bridge": ["bridge-open", "Open bridge"],
  "Full Half Bridge": ["bridge-half", "Half bridge"],
};

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/vendor-opengrid-underware.mjs <file.3mf>");
  process.exit(1);
}
const zip = unzipSync(new Uint8Array(fs.readFileSync(src)));
const model = strFromU8(zip["3D/3dmodel.model"]);
const settings = strFromU8(zip["Metadata/model_settings.config"]);

// Objects: meshes, and wrappers whose single component points at a mesh.
const meshes = new Map();
const wrappers = new Map();
for (const m of model.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
  const [, id, body] = m;
  const comp = body.match(/<component objectid="(\d+)"/);
  if (comp) {
    wrappers.set(id, comp[1]);
    continue;
  }
  const v = [...body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((x) => [+x[1], +x[2], +x[3]]);
  const t = [...body.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((x) => [+x[1], +x[2], +x[3]]);
  meshes.set(id, { v, t });
}

// Plates: name and the object on it.
const plates = new Map();
for (const m of settings.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
  const name = m[1].match(/key="plater_name" value="([^"]*)"/)?.[1] ?? "";
  const obj = m[1].match(/key="object_id" value="(\d+)"/)?.[1];
  if (obj) plates.set(name, meshes.get(wrappers.get(obj) ?? obj));
}

function toStl({ v, t }) {
  const min = [0, 1, 2].map((k) => Math.min(...v.map((p) => p[k])));
  const max = [0, 1, 2].map((k) => Math.max(...v.map((p) => p[k])));
  const buf = Buffer.alloc(84 + t.length * 50);
  buf.writeUInt32LE(t.length, 80);
  t.forEach((tri, i) => {
    let o = 84 + i * 50 + 12;
    for (const a of tri) for (let k = 0; k < 3; k++, o += 4) buf.writeFloatLE(v[a][k] - min[k], o);
  });
  const r = (n) => Math.round(n * 100) / 100;
  return { buf, size: [0, 1, 2].map((k) => r(max[k] - min[k])) };
}

const out = "public/scad/openGridUnderware";
fs.rmSync(`${out}/pieces`, { recursive: true, force: true });
fs.mkdirSync(`${out}/pieces`, { recursive: true });
const table = [];
for (const [plate, [id, label]] of Object.entries(PIECES)) {
  const mesh = plates.get(plate);
  if (!mesh) throw new Error(`plate "${plate}" not found in the 3MF`);
  const { buf, size } = toStl(mesh);
  fs.writeFileSync(`${out}/pieces/${id}.stl`, buf);
  table.push({ id, label, sizeMm: size, triangles: mesh.t.length });
}
writeManifest({ openGridUnderware: "Underware for openGrid by David D, 3MF from MakerWorld/Printables (2025-08-10)" });
fs.writeFileSync("src/model/ogPieces.json", JSON.stringify(table, null, 2) + "\n");

// Keep the 3MF's own straights to check the repeat-unit build against.
const straights = {};
for (let n = 1; n <= 8; n++) straights[n] = toStl(plates.get(`${n}x channel`)).size;
console.log(`vendored ${table.length} pieces; 3MF straights (mm):`, JSON.stringify(straights));
