import { useEffect, useState } from "react";
import { generatorById } from "../model/library";
import { renderKey, rendersFor } from "../render/plan";
import { render } from "../render/service";
import { stlBounds } from "../render/stl";
import type { Board, Envelope, PartType } from "../model/types";

type Result =
  | { state: "idle" }
  | { state: "rendering" }
  | { state: "failed"; error: string }
  | { state: "done"; across: number; down: number; depth: number; ms: number };

const TOLERANCE_MM = 1;
const mm = (n: number) => `${n.toFixed(1)} mm`;

/**
 * Renders one part and compares its real size with the footprint the
 * planner assumes, so estimated footprints can be checked and fixed.
 */
export function SizeCheck({ board, pt, onEnvelope }: { board: Board; pt: PartType; onEnvelope(e: Envelope): void }) {
  const g = generatorById(pt.generatorId);
  const piece = rendersFor(board, pt)[0];
  const key = piece ? renderKey(piece.scadPath, piece.defines) : "";
  const [res, setRes] = useState<Result>({ state: "idle" });
  useEffect(() => setRes({ state: "idle" }), [key]);
  if (!g || !piece) return null;

  const run = async () => {
    setRes({ state: "rendering" });
    const r = await render(piece.scadPath, piece.defines);
    if (!r.ok) return setRes({ state: "failed", error: r.error });
    const b = stlBounds(r.stl);
    if (!b) return setRes({ state: "failed", error: "The render came back empty." });
    const [x, y, z] = b.size;
    setRes(g.boardAxes === "xz" ? { state: "done", across: x, down: z, depth: y, ms: r.ms } : { state: "done", across: x, down: y, depth: z, ms: r.ms });
  };

  const fp = g.footprint(pt.params, board.pitchMm);
  const ge = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, ...fp.envelope };
  const planW = fp.wCells * board.pitchMm + ge.leftMm + ge.rightMm;
  const planH = fp.hCells * board.pitchMm + ge.topMm + ge.bottomMm;

  let verdict: JSX.Element | null = null;
  if (res.state === "done") {
    const extraW = res.across - planW - (pt.envelope.leftMm + pt.envelope.rightMm);
    const extraH = res.down - planH - (pt.envelope.topMm + pt.envelope.bottomMm);
    // Only worth saying when the part would fit in fewer whole cells.
    const under = (fp.wCells > 1 && res.across < (fp.wCells - 0.5) * board.pitchMm) || (fp.hCells > 1 && res.down < (fp.hCells - 0.5) * board.pitchMm);
    if (extraW > TOLERANCE_MM || extraH > TOLERANCE_MM) {
      const addW = Math.max(0, extraW) / 2;
      const addH = Math.max(0, extraH) / 2;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      verdict = (
        <>
          <p className="error-text">
            The real part is bigger than planned by {mm(Math.max(0, extraW))} across and {mm(Math.max(0, extraH))} down.
          </p>
          <button
            onClick={() =>
              onEnvelope({
                ...pt.envelope,
                leftMm: r1(pt.envelope.leftMm + addW),
                rightMm: r1(pt.envelope.rightMm + addW),
                topMm: r1(pt.envelope.topMm + addH),
                bottomMm: r1(pt.envelope.bottomMm + addH),
                depthMm: Math.max(pt.envelope.depthMm, r1(res.depth)),
              })
            }
          >
            Add the difference to the body envelope
          </button>
        </>
      );
    } else if (under) {
      verdict = <p className="muted">The part is smaller than its mount cells; it fits, but the mount may be one cell too generous.</p>;
    } else {
      verdict = <p className="muted">Matches the plan (within {TOLERANCE_MM} mm).</p>;
    }
  }

  return (
    <div className="size-check">
      <h4>Check size with a render</h4>
      <p className="muted">
        Plan: {mm(planW)} × {mm(planH)} on the board{piece.piece ? ` (${piece.piece.toLowerCase()} piece)` : ""}.
      </p>
      {res.state === "done" ? (
        <p className="muted">
          Rendered: {mm(res.across)} × {mm(res.down)}, {mm(res.depth)} off the board ({(res.ms / 1000).toFixed(0)} s).
        </p>
      ) : null}
      {verdict}
      {res.state === "failed" ? <p className="error-text">{res.error}</p> : null}
      {res.state !== "done" ? (
        <button onClick={run} disabled={res.state === "rendering"}>
          {res.state === "rendering" ? "Rendering… (5 to 30 s)" : "Render and compare"}
        </button>
      ) : null}
    </div>
  );
}
