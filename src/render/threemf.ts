// 3MF export: the printed pieces packed onto plates for the chosen printer.
//
// Two forms:
// - One generic 3MF per plate. Any slicer opens it, with the pieces laid
//   out as packed (Bambu Studio keeps the arrangement and centres it).
// - One Bambu Studio project with every plate, when a project saved from
//   Bambu Studio is given as a template. A Bambu project only keeps its
//   plates when it carries the printer, filament and process settings, and
//   those can only come from Bambu Studio itself, so the template's
//   Metadata/project_settings.config is copied in. Plates are laid out the
//   way Bambu Studio lays them out (PartPlate.cpp: a near-square grid, each
//   plate 1.2 bed widths/depths from the last), and Bambu Studio sorts the
//   pieces onto plates by where they sit.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { pack, type PackItem, type Placed, type Plate } from "./pack";

export interface Mesh {
  /** Indexed vertices (x, y, z) and triangles. */
  vertices: Float32Array;
  triangles: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
}

/** Read a binary STL into an indexed mesh. */
export function parseStl(buf: ArrayBuffer): Mesh {
  const v = new DataView(buf);
  const n = buf.byteLength >= 84 ? v.getUint32(80, true) : 0;
  if (84 + n * 50 > buf.byteLength) throw new Error("Not a binary STL");
  const index = new Map<string, number>();
  const verts: number[] = [];
  const tris = new Uint32Array(n * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const x = v.getFloat32(o + k * 12, true), y = v.getFloat32(o + k * 12 + 4, true), z = v.getFloat32(o + k * 12 + 8, true);
      const key = `${x},${y},${z}`;
      let id = index.get(key);
      if (id === undefined) {
        id = verts.length / 3;
        index.set(key, id);
        verts.push(x, y, z);
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
      tris[i * 3 + k] = id;
    }
  }
  return { vertices: new Float32Array(verts), triangles: tris, min, max };
}

export interface Piece {
  /** File name without extension, e.g. "monokini-straight_1x8-h22". */
  name: string;
  mesh: Mesh;
  quantity: number;
}

export interface PlacedPiece {
  name: string;
  mesh: Mesh;
  /** 3MF transform: 3x3 rotation rows then translation, as 12 numbers. */
  transform: number[];
  /** For the preview: footprint and turn on the plate. */
  at: Placed;
}

export interface PlateLayout {
  pieces: PlacedPiece[];
}

export interface Packed {
  plates: PlateLayout[];
  tooBig: string[];
  bed: { x: number; y: number };
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Transform that puts a mesh, as rendered, at its packed spot on a plate (origin at the usable area's corner). */
function placeTransform(mesh: Mesh, at: Placed, W: number, H: number, ox: number, oy: number): number[] {
  const [x0, y0, z0] = mesh.min, [x1, y1] = mesh.max;
  if (at.angle !== undefined) {
    // Turn about the footprint's centre and set it on the plate's centre.
    const c = Math.cos(at.angle), s = Math.sin(at.angle);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const tx = ox + W / 2 - (cx * c - cy * s), ty = oy + H / 2 - (cx * s + cy * c);
    return [c, s, 0, -s, c, 0, 0, 0, 1, tx, ty, -z0];
  }
  if (!at.rotated) return [1, 0, 0, 0, 1, 0, 0, 0, 1, ox + at.x - x0, oy + at.y - y0, -z0];
  // 90° counter-clockwise: x' = -y, y' = x. The turned footprint is at.w wide.
  return [0, 1, 0, -1, 0, 0, 0, 0, 1, ox + at.x + at.w + y0, oy + at.y - x0, -z0];
}

/**
 * Pack every copy of every piece onto plates of the bed's usable area,
 * offset by `margin` from the bed corner.
 */
export function packPieces(pieces: Piece[], bed: { x: number; y: number }, margin: number, gap = 4): Packed {
  const W = bed.x - 2 * margin, H = bed.y - 2 * margin;
  const items: PackItem[] = [];
  const byId = new Map<string, Piece>();
  for (const p of pieces) {
    for (let i = 0; i < p.quantity; i++) {
      const id = `${p.name}#${i + 1}`;
      byId.set(id, p);
      items.push({ id, w: p.mesh.max[0] - p.mesh.min[0], h: p.mesh.max[1] - p.mesh.min[1] });
    }
  }
  const res = pack(items, W, H, gap);
  const plates = res.plates.map((pl: Plate) => ({
    pieces: pl.items.map((at) => {
      const p = byId.get(at.id)!;
      return { name: at.id.replace(/#(\d+)$/, " $1"), mesh: p.mesh, transform: placeTransform(p.mesh, at, W, H, margin, margin), at };
    }),
  }));
  return { plates, tooBig: res.tooBig, bed };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The <mesh> element for a mesh; built once per piece and shared by its copies. */
function meshXml(m: Mesh): string {
  const out: string[] = ["<mesh><vertices>"];
  const v = m.vertices;
  for (let i = 0; i < v.length; i += 3) out.push(`<vertex x="${r4(v[i])}" y="${r4(v[i + 1])}" z="${r4(v[i + 2])}"/>`);
  out.push("</vertices><triangles>");
  const t = m.triangles;
  for (let i = 0; i < t.length; i += 3) out.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  out.push("</triangles></mesh>");
  return out.join("");
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="config" ContentType="text/xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

interface ModelOpts {
  /** Bambu Studio application string, e.g. "BambuStudio-02.04.00.70", to load as a project. */
  application?: string;
  title: string;
}

/** 3D/3dmodel.model with one object per placed copy (meshes are shared as strings, not re-encoded). */
function modelXml(pieces: { name: string; mesh: Mesh; transform: number[] }[], opts: ModelOpts, meshCache: Map<Mesh, string>): string {
  const head = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${opts.application ? ` xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"` : ""}>`,
    ` <metadata name="Title">${esc(opts.title)}</metadata>`,
    ` <metadata name="Designer">Underware Layout Tool</metadata>`,
    ` <metadata name="License">CC BY-NC-SA 4.0</metadata>`,
    opts.application ? ` <metadata name="Application">${esc(opts.application)}</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>` : ` <metadata name="Application">Underware Layout Tool</metadata>`,
    ` <resources>`,
  ];
  const objs: string[] = [];
  const items: string[] = [];
  pieces.forEach((p, i) => {
    let m = meshCache.get(p.mesh);
    if (!m) meshCache.set(p.mesh, (m = meshXml(p.mesh)));
    objs.push(`  <object id="${i + 1}" name="${esc(p.name)}" type="model">${m}</object>`);
    items.push(`  <item objectid="${i + 1}" transform="${p.transform.map(r4).join(" ")}" printable="1"/>`);
  });
  return [...head, ...objs, ` </resources>`, ` <build>`, ...items, ` </build>`, `</model>`].join("\n");
}

const zip = (files: Record<string, Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: /\.png$/.test(k) ? 0 : 6 }]])) as never);

/** One generic 3MF per plate. */
export function plateFiles(packed: Packed, title: string): Uint8Array[] {
  const cache = new Map<Mesh, string>();
  return packed.plates.map((pl, i) =>
    zip({
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "3D/3dmodel.model": strToU8(modelXml(pl.pieces, { title: `${title} plate ${i + 1}` }, cache)),
    }),
  );
}

export interface BambuTemplate {
  application: string;
  projectSettings: string;
  /** Bed from the template's printable_area: size and its corner. */
  bed: { x: number; y: number; ox: number; oy: number };
}

/** Pull what a project needs from a 3MF saved by Bambu Studio. Throws with a readable message. */
export function readBambuTemplate(file: Uint8Array): BambuTemplate {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(file, { filter: (f) => f.name === "Metadata/project_settings.config" || f.name === "3D/3dmodel.model" });
  } catch {
    throw new Error("That file isn't a 3MF.");
  }
  const settings = files["Metadata/project_settings.config"];
  const model = files["3D/3dmodel.model"];
  if (!settings || !model) throw new Error("That 3MF has no Bambu Studio project settings. Save a project from Bambu Studio (File > Save Project) and use that.");
  const app = /<metadata name="Application">(BambuStudio-[^<]+)<\/metadata>/.exec(strFromU8(model))?.[1];
  if (!app) throw new Error("That 3MF wasn't saved by Bambu Studio.");
  const text = strFromU8(settings);
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(text);
  } catch {
    throw new Error("Couldn't read the project settings in that 3MF.");
  }
  const area = (cfg.printable_area as string[] | undefined) ?? [];
  const pts = area.map((s) => s.split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) throw new Error("The project settings don't say the bed size (printable_area).");
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const ox = Math.min(...xs), oy = Math.min(...ys);
  return { application: app, projectSettings: text, bed: { x: Math.max(...xs) - ox, y: Math.max(...ys) - oy, ox, oy } };
}

/** Bambu Studio's plate grid (PartPlate.cpp, compute_colum_count). */
export function plateColumns(n: number): number {
  const v = Math.sqrt(n), r = Math.round(v);
  return v > r ? r + 1 : r;
}

/** One Bambu Studio project with every plate. */
export function bambuProject(packed: Packed, tpl: BambuTemplate, title: string): Uint8Array {
  const cols = plateColumns(packed.plates.length);
  const { x: W, y: D, ox, oy } = tpl.bed;
  const pieces: { name: string; mesh: Mesh; transform: number[] }[] = [];
  const plates: string[] = [];
  packed.plates.forEach((pl, i) => {
    const dx = (i % cols) * W * 1.2 + ox, dy = -Math.floor(i / cols) * D * 1.2 + oy;
    const ids: number[] = [];
    for (const p of pl.pieces) {
      const t = [...p.transform];
      t[9] += dx;
      t[10] += dy;
      pieces.push({ name: p.name, mesh: p.mesh, transform: t });
      ids.push(pieces.length);
    }
    plates.push(
      [
        `  <plate>`,
        `    <metadata key="plater_id" value="${i + 1}"/>`,
        `    <metadata key="plater_name" value=""/>`,
        `    <metadata key="locked" value="false"/>`,
        ...ids.map((id) => `    <model_instance>\n      <metadata key="object_id" value="${id}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${1000 + id}"/>\n    </model_instance>`),
        `  </plate>`,
      ].join("\n"),
    );
  });
  const config = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${plates.join("\n")}\n</config>\n`;
  return zip({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "3D/3dmodel.model": strToU8(modelXml(pieces, { title, application: tpl.application }, new Map())),
    "Metadata/project_settings.config": strToU8(tpl.projectSettings),
    "Metadata/model_settings.config": strToU8(config),
  });
}
