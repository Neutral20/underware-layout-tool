import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { pack } from "./pack";
import { bambuProject, packPieces, parseStl, plateColumns, plateFiles, readBambuTemplate, type Mesh } from "./threemf";

/** A binary STL of an axis-aligned box. */
function boxStl(w: number, h: number, d: number, at: [number, number, number] = [0, 0, 0]): ArrayBuffer {
  const [x0, y0, z0] = at, [x1, y1, z1] = [x0 + w, y0 + h, z0 + d];
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const buf = new ArrayBuffer(84 + f.length * 50);
  const v = new DataView(buf);
  v.setUint32(80, f.length, true);
  f.forEach((t, i) => t.forEach((k, j) => c[k].forEach((n, a) => v.setFloat32(84 + i * 50 + 12 + j * 12 + a * 4, n, true))));
  return buf;
}

/** Apply a 3MF transform to a point. */
const apply = (t: number[], [x, y, z]: number[]) => [x * t[0] + y * t[3] + z * t[6] + t[9], x * t[1] + y * t[4] + z * t[7] + t[10], x * t[2] + y * t[5] + z * t[8] + t[11]];

function footprint(m: Mesh, t: number[]) {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < m.vertices.length; i += 3) {
    const [x, y, z] = apply(t, [m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]);
    xs.push(x);
    ys.push(y);
    zs.push(z);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs) };
}

describe("pack", () => {
  it("fills a plate before starting another, with gaps", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, w: 80, h: 80 }));
    const r = pack(items, 254, 254, 4);
    expect(r.plates.map((p) => p.items.length)).toEqual([9]);
    const xs = r.plates[0].items.map((i) => i.x).sort((a, b) => a - b);
    expect(new Set(xs)).toEqual(new Set([0, 84, 168]));
    expect(pack([...items, { id: "x", w: 80, h: 80 }], 254, 254, 4).plates.map((p) => p.items.length)).toEqual([9, 1]);
  });
  it("turns pieces to fit and reports pieces too big", () => {
    const r = pack([{ id: "long", w: 240, h: 30 }, { id: "tall", w: 30, h: 240 }, { id: "huge", w: 400, h: 400 }], 254, 254, 4);
    expect(r.tooBig).toEqual(["huge"]);
    expect(r.plates).toHaveLength(1);
  });
  it("lays a piece that only fits corner to corner on its own plate", () => {
    const r = pack([{ id: "d", w: 26.4, h: 308 }], 254, 254, 4);
    expect(r.plates).toHaveLength(1);
    expect(r.plates[0].items[0].angle).toBeDefined();
  });
});

describe("3MF", () => {
  it("indexes STL vertices", () => {
    const m = parseStl(boxStl(10, 20, 5, [-3, 4, 1]));
    expect(m.vertices.length).toBe(24);
    expect(m.triangles.length).toBe(36);
    expect(m.min).toEqual([-3, 4, 1]);
  });
  it("places every copy on the bed, flat, without overlaps", () => {
    const tile = parseStl(boxStl(252, 196, 6.8, [-126, -98, -3.4]));
    const seg = parseStl(boxStl(26.4, 224, 22));
    const packed = packPieces([{ name: "tile", mesh: tile, quantity: 3 }, { name: "seg", mesh: seg, quantity: 6 }], { x: 256, y: 256 }, 1);
    const boxes = packed.plates.map((pl) => pl.pieces.map((p) => footprint(p.mesh, p.transform)));
    expect(packed.tooBig).toEqual([]);
    for (const plate of boxes) {
      for (const b of plate) {
        expect(b.x0).toBeGreaterThanOrEqual(1 - 1e-3);
        expect(b.y0).toBeGreaterThanOrEqual(1 - 1e-3);
        expect(b.x1).toBeLessThanOrEqual(255 + 1e-3);
        expect(b.y1).toBeLessThanOrEqual(255 + 1e-3);
        expect(b.z0).toBeCloseTo(0);
      }
      for (let i = 0; i < plate.length; i++)
        for (let j = i + 1; j < plate.length; j++) {
          const a = plate[i], b = plate[j];
          const hit = a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1 && a.y0 < b.y1 - 1 && b.y0 < a.y1 - 1;
          expect(hit).toBe(false);
        }
    }
    expect(boxes.flat()).toHaveLength(9);
    // Turned segments fit beside a 196 mm deep tile? No room: tiles take a plate each, segments share.
    expect(packed.plates.length).toBeLessThanOrEqual(4);
  });
  it("keeps a diagonal piece on the bed", () => {
    const seg = parseStl(boxStl(26.4, 308, 22));
    const packed = packPieces([{ name: "seg", mesh: seg, quantity: 1 }], { x: 256, y: 256 }, 1);
    const b = footprint(seg, packed.plates[0].pieces[0].transform);
    expect(b.x0).toBeGreaterThanOrEqual(1 - 1e-3);
    expect(b.x1).toBeLessThanOrEqual(255 + 1e-3);
    expect(b.y0).toBeGreaterThanOrEqual(1 - 1e-3);
    expect(b.y1).toBeLessThanOrEqual(255 + 1e-3);
  });
  it("writes a readable 3MF per plate", () => {
    const m = parseStl(boxStl(100, 100, 5));
    const packed = packPieces([{ name: "sq", mesh: m, quantity: 5 }], { x: 256, y: 256 }, 1);
    const files = plateFiles(packed, "Desk");
    expect(files).toHaveLength(2);
    const z = unzipSync(files[0]);
    expect(Object.keys(z).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    const xml = strFromU8(z["3D/3dmodel.model"]);
    expect(xml.match(/<object /g)).toHaveLength(4);
    expect(xml.match(/<item /g)).toHaveLength(4);
  });
  it("Bambu project: plates on Bambu's grid with the template's settings", () => {
    const settings = JSON.stringify({ printable_area: ["0x0", "256x0", "256x256", "0x256"], printer_model: "Bambu Lab X2D" });
    const tplZip = zipSync({
      "3D/3dmodel.model": strToU8(`<model><metadata name="Application">BambuStudio-02.04.00.70</metadata></model>`),
      "Metadata/project_settings.config": strToU8(settings),
    });
    const tpl = readBambuTemplate(tplZip);
    expect(tpl.bed).toEqual({ x: 256, y: 256, ox: 0, oy: 0 });
    const m = parseStl(boxStl(100, 100, 5));
    const packed = packPieces([{ name: "sq", mesh: m, quantity: 9 }], tpl.bed, 1);
    expect(packed.plates).toHaveLength(3);
    const z = unzipSync(bambuProject(packed, tpl, "Desk"));
    const model = strFromU8(z["3D/3dmodel.model"]);
    expect(model).toContain(`<metadata name="Application">BambuStudio-02.04.00.70</metadata>`);
    expect(strFromU8(z["Metadata/project_settings.config"])).toBe(settings);
    const cfg = strFromU8(z["Metadata/model_settings.config"]);
    expect(cfg.match(/<plate>/g)).toHaveLength(3);
    expect(cfg.match(/<model_instance>/g)).toHaveLength(9);
    // 3 plates -> 2 columns: plate 3 sits one row down (y - 1.2 * 256).
    expect(plateColumns(3)).toBe(2);
    const xs = [...model.matchAll(/transform="([^"]+)"/g)].map((t) => t[1].split(" ").map(Number));
    const last = xs[xs.length - 1];
    expect(last[10]).toBeLessThan(-256 * 1.2 + 256);
    expect(last[9]).toBeLessThan(256);
  });
  it("rejects files that aren't Bambu projects", () => {
    expect(() => readBambuTemplate(strToU8("nope"))).toThrow(/isn't a 3MF/);
    expect(() => readBambuTemplate(zipSync({ "3D/3dmodel.model": strToU8("<model/>") }))).toThrow(/no Bambu Studio project settings/);
  });
});
