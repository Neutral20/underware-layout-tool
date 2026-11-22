import { useRef, useState } from "react";
import type { Resolved } from "../model/geometry";
import type { Board, Issue } from "../model/types";

interface Props {
  board: Board;
  resolved: Resolved[];
  issues: Issue[];
  selectedId: string | null;
  pxPerMm: number;
  onSelect(id: string | null): void;
  onMove(id: string, x: number, y: number): void;
}

const MARGIN_MM = 60; // room around the board so overhang is visible

export function BoardView({ board, resolved, issues, selectedId, pxPerMm, onSelect, onMove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const p = board.pitchMm;
  const Wmm = board.widthCells * p;
  const Hmm = board.heightCells * p;

  const severityFor = (id: string) => {
    let s: "error" | "warning" | null = null;
    for (const i of issues) {
      if (!i.placementIds.includes(id)) continue;
      if (i.severity === "error") return "error";
      s = "warning";
    }
    return s;
  };

  // Pointer position in board mm.
  const toMm = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    const q = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: q.x, y: q.y };
  };

  const onDown = (e: React.PointerEvent, r: Resolved) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const m = toMm(e);
    setDrag({ id: r.placement.id, dx: m.x - r.x * p, dy: m.y - r.y * p });
    onSelect(r.placement.id);
  };
  const onMoveEvt = (e: React.PointerEvent) => {
    if (!drag) return;
    const m = toMm(e);
    const x = Math.round((m.x - drag.dx) / p);
    const y = Math.round((m.y - drag.dy) / p);
    const cur = resolved.find((r) => r.placement.id === drag.id);
    if (cur && (cur.x !== x || cur.y !== y)) onMove(drag.id, x, y);
  };

  const cellLines: JSX.Element[] = [];
  for (let i = 1; i < board.widthCells; i++) {
    const seam = board.tile.widthCells > 0 && i % board.tile.widthCells === 0;
    cellLines.push(<line key={`v${i}`} x1={i * p} y1={0} x2={i * p} y2={Hmm} className={seam ? "seam" : "cell"} />);
  }
  for (let j = 1; j < board.heightCells; j++) {
    const seam = board.tile.heightCells > 0 && j % board.tile.heightCells === 0;
    cellLines.push(<line key={`h${j}`} x1={0} y1={j * p} x2={Wmm} y2={j * p} className={seam ? "seam" : "cell"} />);
  }

  // Draw the selected part last so it sits on top while dragging.
  const ordered = [...resolved].sort((a, b) => (a.placement.id === selectedId ? 1 : 0) - (b.placement.id === selectedId ? 1 : 0));

  return (
    <svg
      ref={svgRef}
      className="board"
      width={(Wmm + 2 * MARGIN_MM) * pxPerMm}
      height={(Hmm + 2 * MARGIN_MM) * pxPerMm}
      viewBox={`${-MARGIN_MM} ${-MARGIN_MM} ${Wmm + 2 * MARGIN_MM} ${Hmm + 2 * MARGIN_MM}`}
      onPointerMove={onMoveEvt}
      onPointerUp={() => setDrag(null)}
      onPointerDown={() => onSelect(null)}
    >
      <rect x={0} y={0} width={Wmm} height={Hmm} className="board-bg" />
      {cellLines}
      <rect x={0} y={0} width={Wmm} height={Hmm} className="board-edge" />
      <text x={Wmm / 2} y={-MARGIN_MM / 3} className="dim">
        {board.widthCells} cells · {Wmm} mm
      </text>
      <text x={-MARGIN_MM / 3} y={Hmm / 2} className="dim" transform={`rotate(-90 ${-MARGIN_MM / 3} ${Hmm / 2})`}>
        {board.heightCells} cells · {Hmm} mm
      </text>

      {ordered.map((r) => {
        const sev = severityFor(r.placement.id);
        const sel = r.placement.id === selectedId;
        const hasEnv = r.env.leftMm || r.env.rightMm || r.env.topMm || r.env.bottomMm;
        const label = r.placement.label || r.partType.name;
        const cx = (r.x + r.w / 2) * p;
        const cy = (r.y + r.h / 2) * p;
        const fs = Math.min(16, (r.w * p) / Math.max(4, label.length * 0.62), r.h * p * 0.6);
        return (
          <g key={r.placement.id} className={`part ${sev ?? ""} ${sel ? "selected" : ""}`} onPointerDown={(e) => onDown(e, r)}>
            {hasEnv ? (
              <rect
                x={r.body.x0}
                y={r.body.y0}
                width={r.body.x1 - r.body.x0}
                height={r.body.y1 - r.body.y0}
                className="envelope"
                style={{ stroke: r.partType.color }}
              />
            ) : null}
            <rect x={r.x * p + 1} y={r.y * p + 1} width={r.w * p - 2} height={r.h * p - 2} rx={3} className="mount" style={{ fill: r.partType.color }} />
            <text x={cx} y={cy} className="part-label" style={{ fontSize: fs }}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
