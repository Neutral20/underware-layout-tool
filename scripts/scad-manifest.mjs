// Writes public/scad/manifest.json: every vendored folder, which the render
// worker fetches and writes into OpenSCAD's file system. BOSL2 goes under
// /libraries so `include <BOSL2/...>` resolves; every other folder keeps its
// own path. Only .scad and .stl files are listed.
import fs from "node:fs";
import path from "node:path";

export function writeManifest(pins = {}) {
  const root = "public/scad";
  const file = `${root}/manifest.json`;
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const dirs = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    const files = [];
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(path.posix.join(rel, e.name));
      else if (/\.(scad|stl)$/.test(e.name)) files.push(e.name);
    }
    if (files.length) dirs.push({ src: rel, mount: rel.startsWith("BOSL2") ? `/libraries/${rel}` : `/${rel}`, files });
  };
  for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) if (e.isDirectory()) walk(e.name);
  fs.writeFileSync(file, JSON.stringify({ pins: { ...old.pins, ...pins }, dirs }, null, 2) + "\n");
}
