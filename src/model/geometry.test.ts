import { checkBoard, rotateShape } from "./geometry";
import { cellsWithEnvelope, defaultParams, generatorById } from "./library";
import type { Board, PartType, Placement } from "./types";

const env0 = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 };

function board(placements: Placement[], w = 21, h = 60): Board {
  return { id: "b", name: "t", widthCells: w, heightCells: h, pitchMm: 28, tile: { widthCells: 7, heightCells: 7, variant: "Full" }, placements };
}

// PSU holder: snaps into 2x3 cells, body sticks out 20 mm left and 34 mm right.
const psu: PartType = {
  id: "psu",
  name: "PSU holder",
  category: "holder",
  color: "#000",
  params: {},
  mount: { wCells: 2, hCells: 3 },
  envelope: { ...env0, leftMm: 20, rightMm: 34 },
};
const pl = (id: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): Placement => ({ id, partTypeId: "psu", x, y, rotation });

describe("checkBoard", () => {
  it("is clean when everything fits", () => {
    expect(checkBoard(board([pl("a", 5, 5)]), [psu])).toEqual([]);
  });

  it("flags overhang past the right edge with the right mm", () => {
    const issues = checkBoard(board([pl("a", 19, 0)]), [psu]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("envelope-overhang");
    expect(issues[0].detail).toContain("34 mm right");
  });

  it("flags a mount off the board as an error", () => {
    const issues = checkBoard(board([pl("a", 20, 0)]), [psu]);
    expect(issues[0]).toMatchObject({ severity: "error", kind: "mount-off-board" });
  });

  it("rotation moves the overhang to the new side", () => {
    // 90° clockwise: left->top, right->bottom. Mount becomes 3 wide, 2 tall.
    const issues = checkBoard(board([pl("a", 0, 58, 90)]), [psu]);
    expect(issues[0].detail).toContain("34 mm bottom");
  });

  it("separates mount overlap (error) from body overlap (warning)", () => {
    const mount = checkBoard(board([pl("a", 5, 5), pl("b", 6, 5)]), [psu]);
    expect(mount[0]).toMatchObject({ severity: "error", kind: "mount-overlap" });
    // 3 cells apart: mounts clear, but 34 mm + 20 mm bodies overlap the 28 mm gap.
    const body = checkBoard(board([pl("a", 5, 5), pl("b", 8, 5)]), [psu]);
    expect(body[0]).toMatchObject({ severity: "warning", kind: "envelope-overlap" });
  });
});

describe("rotateShape", () => {
  it("four quarter turns is identity", () => {
    const e = { ...env0, leftMm: 1, topMm: 2, rightMm: 3, bottomMm: 4 };
    let s = { w: 2, h: 3, env: e };
    for (let i = 0; i < 4; i++) s = rotateShape(s.w, s.h, s.env, 90);
    expect(s).toEqual({ w: 2, h: 3, env: e });
  });
});

describe("library footprints match rendered SCADs (Grid_Size=28)", () => {
  const fp = (id: string, over: Record<string, number> = {}) => {
    const g = generatorById(id)!;
    const f = g.footprint({ ...defaultParams(g), ...over }, 28);
    return [f.wCells, f.hCells];
  };
  it.each([
    ["uw-i", { Channel_Width_in_Units: 2 }, [2, 5]],
    ["uw-l", {}, [2, 2]],
    ["uw-l", { L_Channel_Length_in_Units_X_Axis: 3, L_Channel_Length_in_Units_Y_Axis: 2 }, [4, 3]],
    ["uw-t", {}, [2, 3]],
    ["uw-x", {}, [3, 3]],
    ["uw-c", {}, [3, 3]],
    ["uw-s", {}, [3, 3]],
    ["uw-diag", {}, [3, 3]],
    ["uw-y", {}, [3, 2]],
    ["uw-branch", {}, [2, 4]],
  ] as const)("%s %j", (id, over, want) => {
    expect(fp(id, over)).toEqual(want);
  });

  it("item holder puts the leftover in the envelope", () => {
    const f = cellsWithEnvelope(64, 53, 28);
    expect([f.wCells, f.hCells]).toEqual([2, 1]);
    expect(f.envelope?.leftMm).toBe(4);
    expect(f.envelope?.topMm).toBe(12.5);
  });
});
