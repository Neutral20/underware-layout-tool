import { buildExportPlan, partsCsv } from "./plan";
import { stlBounds } from "./stl";
import { scadLiteral } from "./types";
import { defaultParams, generatorById } from "../model/library";
import type { Board, PartType } from "../model/types";

const env0 = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 };
const fromGen = (id: string, gen: string, over = {}): PartType => {
  const g = generatorById(gen)!;
  return { id, name: g.name, category: g.category, color: g.color, generatorId: gen, params: { ...defaultParams(g), ...over }, envelope: env0 };
};
const board = (ids: string[]): Board => ({
  id: "b", name: "t", widthCells: 21, heightCells: 60, pitchMm: 28,
  tile: { widthCells: 7, heightCells: 7, variant: "Full" },
  placements: ids.map((pt, i) => ({ id: `p${i}`, partTypeId: pt, x: 0, y: i * 6, rotation: 0 })),
});

describe("buildExportPlan", () => {
  it("renders channels as base + top with the board's grid pitch", () => {
    const plan = buildExportPlan(board(["a"]), [fromGen("a", "uw-i")]);
    expect(plan.jobs.map((j) => j.piece)).toEqual(["Base", "Top"]);
    expect(plan.jobs[0].defines).toMatchObject({ Grid_Size: 28, Base_Top_or_Both: "Base", Channel_Length_Units: 5 });
    expect(plan.jobs[0].fileName).toBe("i-channel_1x5-h12_base_x1.stl");
  });

  it("merges identical parts from different part types and counts them", () => {
    const plan = buildExportPlan(board(["a", "a", "b"]), [fromGen("a", "uw-i"), fromGen("b", "uw-i")]);
    expect(plan.jobs).toHaveLength(2);
    expect(plan.jobs[0].quantity).toBe(3);
  });

  it("keeps different sizes apart", () => {
    const plan = buildExportPlan(board(["a", "b"]), [fromGen("a", "uw-i"), fromGen("b", "uw-i", { Channel_Length_Units: 3 })]);
    expect(plan.jobs).toHaveLength(4);
    expect(new Set(plan.jobs.map((j) => j.fileName)).size).toBe(4);
  });

  it("item holder is one piece without Grid_Size; custom parts are listed, not rendered", () => {
    const custom: PartType = { id: "c", name: "PSU holder", category: "holder", color: "#000", params: {}, mount: { wCells: 2, hCells: 3 }, envelope: env0 };
    const plan = buildExportPlan(board(["h", "c", "c"]), [fromGen("h", "uw-item"), custom]);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0].piece).toBeNull();
    expect(plan.jobs[0].defines.Grid_Size).toBeUndefined();
    expect(plan.manual).toEqual([{ name: "PSU holder", quantity: 2 }]);
    expect(partsCsv(plan)).toContain('PSU holder,"(custom, not generated)",2');
  });

  it("skips part types with nothing placed", () => {
    expect(buildExportPlan(board([]), [fromGen("a", "uw-i")]).jobs).toEqual([]);
  });
});

describe("scadLiteral", () => {
  it("quotes strings and passes numbers and booleans", () => {
    expect(scadLiteral("Threaded Snap Connector")).toBe('"Threaded Snap Connector"');
    expect(scadLiteral(28)).toBe("28");
    expect(scadLiteral(false)).toBe("false");
  });
});

describe("mount styles", () => {
  it("default mount passes channel params through", () => {
    const plan = buildExportPlan(board(["a"]), [fromGen("a", "uw-i")]);
    expect(plan.jobs[0].scadPath).toBe("/Underware/Underware_I_Channel.scad");
    expect(plan.jobs[0].defines.Mounting_Method).toBe("Threaded Snap Connector");
  });
});

describe("stlBounds", () => {
  it("reads the box of a one-triangle STL", () => {
    const buf = new ArrayBuffer(84 + 50);
    const v = new DataView(buf);
    v.setUint32(80, 1, true);
    [0, 0, 0, 10, 0, 0, 0, 5, 2].forEach((c, k) => v.setFloat32(84 + 12 + k * 4, c, true));
    expect(stlBounds(buf)?.size).toEqual([10, 5, 2]);
  });
  it("rejects a truncated file", () => {
    const buf = new ArrayBuffer(84);
    new DataView(buf).setUint32(80, 3, true);
    expect(stlBounds(buf)).toBeNull();
  });
});

describe("openGrid clip-on parts", () => {
  it("straight is one piece, footprint 1 x length, no Grid_Size", () => {
    const plan = buildExportPlan(board(["s"]), [fromGen("s", "og-straight", { Length_Units: 7 })]);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0]).toMatchObject({ piece: null, scadPath: "/openGridUnderware/openGrid_Underware.scad", defines: { Length_Units: 7 } });
    expect(plan.jobs[0].fileName).toBe("clip-on-straight_7_x1.stl");
    expect(generatorById("og-straight")!.footprint({ Length_Units: 7 }, 28)).toMatchObject({ wCells: 1, hCells: 7 });
  });

  it("fixed pieces take their footprint from the mesh size", () => {
    const g = generatorById("og-piece")!;
    expect(g.footprint({ Piece: "curve-2" }, 28)).toMatchObject({ wCells: 3, hCells: 3 }); // 82.4 mm
    expect(g.footprint({ Piece: "x" }, 28)).toMatchObject({ wCells: 3, hCells: 3 });
    // 85.2 mm bridge: 3 cells plus 0.6 mm each end
    expect(g.footprint({ Piece: "bridge-1" }, 28)).toMatchObject({ wCells: 1, hCells: 3, envelope: { topMm: 0.6, bottomMm: 0.6, depthMm: 40.6 } });
  });

  it("names files after the chosen piece", () => {
    const plan = buildExportPlan(board(["a", "b"]), [fromGen("a", "og-piece", { Piece: "t" }), fromGen("b", "og-piece", { Piece: "curve-1" })]);
    expect(plan.jobs.map((j) => j.fileName)).toEqual(["clip-on-t_x1.stl", "clip-on-curve-radius-1_x1.stl"]);
  });
});

describe("Monokini clip-on channels", () => {
  // Cases measured by rendering the SCADs (bounding box / 28 mm, rounded).
  const cases: [string, Record<string, number | boolean>, number, number][] = [
    ["mk-i", {}, 1, 5],
    ["mk-i", { Channel_Width_in_Units: 2, Channel_Length_Units: 3 }, 2, 3],
    ["mk-l", {}, 2, 2],
    ["mk-l", { Added_Radius: 2 }, 4, 4],
    ["mk-l", { Channel_Width_in_Units: 2, L_Channel_Length_in_Units_X_Axis: 3, L_Channel_Length_in_Units_Y_Axis: 2 }, 5, 4],
    ["mk-t", {}, 3, 2],
    ["mk-t", { Channel_Width_in_Units_Bottom: 2, T_Channel_Length_in_Units_X_Axis_Left: 2, T_Channel_Length_in_Units_Y_Axis: 3 }, 5, 4],
    ["mk-x", {}, 3, 3],
    ["mk-x", { Channel_Width_in_Units: 2, X_Channel_Length_in_Units_Y_Axis_Bottom: 2, X_Channel_Length_in_Units_X_Axis_Left: 3 }, 6, 5],
    ["mk-s", {}, 3, 4],
    ["mk-s", { Units_Over: -3, Units_Up: 4, S_Channel_Length_in_Units_Y_Axis_Top: 2 }, 4, 7],
    ["mk-diag", {}, 3, 4],
    ["mk-diag", { Units_Over: 3, Units_Up: 2, Channel_Width_in_Units: 2 }, 5, 4],
    ["mk-bridge", {}, 3, 5],
    ["mk-bridge", { Units_Over: 2, Units_Up: 3, Bridge_Channel_Length_in_Units_Y_Axis_Top: 2 }, 3, 10],
  ];
  it.each(cases)("%s %j -> %i x %i cells", (id, over, w, h) => {
    const g = generatorById(id)!;
    expect(g.footprint({ ...defaultParams(g), ...over }, 28)).toMatchObject({ wCells: w, hCells: h });
  });

  it("renders as one piece from the Monokini folder", () => {
    const plan = buildExportPlan(board(["a"]), [fromGen("a", "mk-l", { Added_Radius: 2 })]);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.jobs[0]).toMatchObject({ piece: null, scadPath: "/Monokini/monokini_L_channel.scad" });
    expect(plan.jobs[0].defines.Grid_Size).toBeUndefined();
  });
});
