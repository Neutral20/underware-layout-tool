import { BED_MARGIN_MM } from "../model/printers";
import type { Packed } from "../render/threemf";

/** Small top-down view of each packed plate. */
export function PlatePreview({ packed }: { packed: Packed }) {
  const { x: W, y: H } = packed.bed;
  const m = BED_MARGIN_MM;
  return (
    <div className="plates">
      <p className="muted">
        {packed.plates.length} plate{packed.plates.length === 1 ? "" : "s"}
        {packed.tooBig.length ? `; too big for the bed: ${packed.tooBig.join(", ")}` : ""}.
      </p>
      <div className="plate-grid">
        {packed.plates.map((pl, i) => (
          <figure key={i} className="plate">
            {/* 3MF y points up; flip so the preview matches the slicer's top view. */}
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Plate ${i + 1}`}>
              <rect x={0} y={0} width={W} height={H} className="plate-bed" />
              <g transform={`translate(0 ${H}) scale(1 -1)`}>
                {pl.pieces.map((p, k) => {
                  const a = p.at;
                  if (a.angle !== undefined) {
                    const w = p.mesh.max[0] - p.mesh.min[0], h = p.mesh.max[1] - p.mesh.min[1];
                    return (
                      <rect
                        key={k}
                        x={-w / 2}
                        y={-h / 2}
                        width={w}
                        height={h}
                        className="plate-piece"
                        transform={`translate(${m + (W - 2 * m) / 2} ${m + (H - 2 * m) / 2}) rotate(${(a.angle * 180) / Math.PI})`}
                      >
                        <title>{p.name}</title>
                      </rect>
                    );
                  }
                  return (
                    <rect key={k} x={m + a.x} y={m + a.y} width={a.w} height={a.h} className="plate-piece">
                      <title>{p.name}</title>
                    </rect>
                  );
                })}
              </g>
            </svg>
            <figcaption>
              Plate {i + 1} · {pl.pieces.length}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
