// Vendors the openGrid tile connector (David D, CC BY 4.0) from the
// openGrid 3MF: the first mesh in 3D/Objects/object_1.model, written as a
// binary STL next to a one-line SCAD that imports it, so it renders like
// every other part.
//
//   node scripts/vendor-opengrid-connector.mjs <openGridConnector.3mf>
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { writeManifest } from "./scad-manifest.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/vendor-opengrid-connector.mjs <openGridConnector.3mf>");
  process.exit(1);
}
const z = unzipSync(new Uint8Array(fs.readFileSync(file)), { filter: (f) => f.name === "3D/Objects/object_1.model" });
const xml = strFromU8(z["3D/Objects/object_1.model"]);
const v = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) => m.slice(1, 4).map(Number));
const t = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => m.slice(1, 4).map(Number));
if (!v.length || !t.length) throw new Error("no mesh found in object_1.model");

const buf = Buffer.alloc(84 + t.length * 50);
buf.write("openGrid connector by David D, CC BY 4.0", 0, "ascii");
buf.writeUInt32LE(t.length, 80);
t.forEach((tri, i) => {
  const o = 84 + i * 50;
  const [a, b, c] = tri.map((k) => v[k]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  [...n.map((x) => x / l), ...a, ...b, ...c].forEach((x, k) => buf.writeFloatLE(x, o + k * 4));
});
fs.mkdirSync("public/scad/openGrid", { recursive: true });
fs.writeFileSync("public/scad/openGrid/openGrid_Connector.stl", buf);
fs.writeFileSync(
  "public/scad/openGrid/openGrid_Connector.scad",
  `// openGrid tile connector by David D (CC BY 4.0), from the openGrid 3MF:
// https://www.printables.com/model/1214361-opengrid-walldesk-mounting-framework-and-ecosystem
// Joins two tiles at one cell line. Printed flat, as in the 3MF.
import("openGrid_Connector.stl");
`,
);
writeManifest({ openGridConnector: "openGrid connector by David D, from the openGrid 3MF (BambuStudio 01.10.01.50, 2025-03-21)" });
console.log(`connector: ${v.length} vertices, ${t.length} triangles`);
