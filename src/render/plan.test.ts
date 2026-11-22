import { buildExportPlan, partsCsv } from "./plan";
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
