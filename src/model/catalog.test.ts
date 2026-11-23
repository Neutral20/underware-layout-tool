import { describe, expect, it } from "vitest";
import { CONNECTIONS, DEFAULT_CONNECTION, SHAPES, isAvailable, kindOf, lookup, paramsFor, visibleParams } from "./catalog";
import { ALL_GENERATORS, defaultParams, generatorById } from "./library";
import type { PartType } from "./types";

const env0 = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 };
const part = (generatorId: string, over = {}): PartType => {
  const g = generatorById(generatorId)!;
  return { id: "p", name: g.name, category: g.category, color: g.color, generatorId, params: { ...defaultParams(g), ...over }, envelope: env0 };
};

describe("part catalog", () => {
  it("defaults to clip-in for openGrid", () => {
    expect(DEFAULT_CONNECTION).toBe("clip");
  });

  it("maps every offered pair to a real generator with valid pinned params", () => {
    for (const s of SHAPES) {
      for (const c of CONNECTIONS) {
        const r = lookup(s.id, c.id);
        if (!("option" in r)) {
          expect(r.reason.length).toBeGreaterThan(10);
          continue;
        }
        const params = paramsFor(r.option, r.generator);
        for (const spec of r.generator.params) {
          if (spec.kind === "choice") expect(spec.choices, `${s.id}/${c.id} ${spec.name}`).toContain(params[spec.name]);
        }
      }
    }
  });

  it("only offers Multiconnect for the item holder", () => {
    const mc = SHAPES.filter((s) => isAvailable(s.id, "multiconnect")).map((s) => s.id);
    expect(mc).toEqual(["holder"]);
    expect(lookup("straight", "multiconnect")).toMatchObject({ reason: expect.stringContaining("Multiconnect") });
  });

  it("has a clip-in version of every common channel shape", () => {
    for (const id of ["straight", "corner", "curve", "t", "x", "s", "diagonal", "y", "end", "bridge"]) expect(isAvailable(id, "clip"), id).toBe(true);
    expect(isAvailable("holder", "clip")).toBe(false);
  });

  it("pins the mounting method for snaps and hides it", () => {
    const r = lookup("straight", "snap");
    if (!("option" in r)) throw new Error("missing");
    expect(paramsFor(r.option, r.generator).Mounting_Method).toBe("Threaded Snap Connector");
    expect(visibleParams(r.generator, r.option).map((s) => s.name)).not.toContain("Mounting_Method");
  });

  it("narrows mounting to non-snap methods for screw and keeps sizes when switching", () => {
    const r = lookup("corner", "screw");
    if (!("option" in r)) throw new Error("missing");
    const p = paramsFor(r.option, r.generator, { Channel_Width_in_Units: 2, Mounting_Method: "Threaded Snap Connector" });
    expect(p.Channel_Width_in_Units).toBe(2);
    expect(p.Mounting_Method).toBe("Wood Screw");
    expect(visibleParams(r.generator, r.option).find((s) => s.name === "Mounting_Method")?.choices).not.toContain("Threaded Snap Connector");
  });

  it("works out the shape and connection of parts made before the picker", () => {
    expect(kindOf(part("uw-i"))).toEqual({ shape: "straight", connection: "snap" });
    expect(kindOf(part("uw-i", { Mounting_Method: "Magnet" }))).toEqual({ shape: "straight", connection: "screw" });
    expect(kindOf(part("mk-l"))).toEqual({ shape: "corner", connection: "clip" });
    expect(kindOf(part("og-straight"))).toEqual({ shape: "straight", connection: "clip" });
    expect(kindOf(part("og-piece"))).toEqual({ shape: "other", connection: "clip" });
    expect(kindOf(part("uw-item"))).toEqual({ shape: "holder", connection: "multiconnect" });
  });

  it("can place every generator that has a picker entry", () => {
    const reachable = new Set(SHAPES.flatMap((s) => Object.values(s.options).map((o) => o!.generatorId)));
    const unreachable = ALL_GENERATORS.map((g) => g.id).filter((id) => !reachable.has(id));
    // og-straight is the same clip-in profile as the Monokini straight, which the picker uses.
    expect(unreachable).toEqual(["og-straight"]);
  });
});
