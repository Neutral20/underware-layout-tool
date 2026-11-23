import type { Resolved } from "../model/geometry";
import { generatorById, scadUrl, type ParamSpec } from "../model/library";
import { CONNECTIONS, SHAPES, kindOf, lookup, optionOf, visibleParams, type ConnectionId } from "../model/catalog";
import { ConnectionPicker } from "./PartPicker";
import type { Board, Envelope, ParamValue, PartType, Placement } from "../model/types";
import type { OutlineState } from "../render/outlines";
import { maxSegmentCells } from "../model/runs";
import { printerFor } from "../model/printers";

interface Props {
  r: Resolved;
  /** Real-shape measurement for generated parts. */
  shape?: OutlineState;
  onRetryShape(): void;
  sharedCount: number;
  board: Board;
  onPlacement(patch: Partial<Placement>): void;
  onPartType(patch: Partial<PartType>): void;
  onKind(shape: string, connection: ConnectionId): void;
  onRotate(): void;
  onDuplicate(): void;
  onRemove(): void;
}

function Num({ label, value, onChange, min, max, step }: { label: string; value: number; onChange(n: number): void; min?: number; max?: number; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function ParamInput({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue; onChange(v: ParamValue): void }) {
  if (spec.kind === "choice") {
    return (
      <label className="field">
        <span>{spec.label}</span>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {spec.choices!.map((c, i) => (
            <option key={c} value={c}>
              {spec.choiceLabels?.[i] ?? c}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (spec.kind === "bool") {
    return (
      <label className="field check">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>{spec.label}</span>
      </label>
    );
  }
  return (
    <Num
      label={spec.label}
      value={Number(value)}
      min={spec.min}
      max={spec.max}
      step={spec.step ?? 1}
      onChange={(n) => onChange(spec.kind === "int" ? Math.round(n) : n)}
    />
  );
}

const SIDES: [keyof Envelope, string][] = [
  ["leftMm", "Left"],
  ["rightMm", "Right"],
  ["topMm", "Top"],
  ["bottomMm", "Bottom"],
  ["depthMm", "Depth"],
];

const mm = (n: number) => `${n.toFixed(1)} mm`;

function ShapeInfo({ r, shape, onRetry }: { r: Resolved; shape?: OutlineState; onRetry(): void }) {
  if (!shape) return null;
  return (
    <div className="shape-info">
      <h4>Real shape</h4>
      {shape.status === "ready" && r.sizeMm ? (
        <p className="muted">
          {mm(r.sizeMm[0])} × {mm(r.sizeMm[1])} on the board, {mm(r.sizeMm[2])} tall. Measured from the model; the board and the fit checks use this
          outline.
        </p>
      ) : shape.status === "measuring" ? (
        <p className="muted">Measuring the real shape from a render (10 to 30 s). Until then the part is drawn as its mount cells.</p>
      ) : shape.status === "failed" ? (
        <>
          <p className="error-text">Couldn't measure the real shape, so the part is drawn as its mount cells. {shape.error}</p>
          <button onClick={onRetry}>Try again</button>
        </>
      ) : null}
    </div>
  );
}

/** How a straight will be cut for the printer. */
function RunInfo({ r, board }: { r: Resolved; board: Board }) {
  if (!r.segments) return null;
  const max = maxSegmentCells(board, r.partType);
  const printer = printerFor(board.printer).name;
  if (max < 1) return <p className="error-text">Too wide for the {printer} bed.</p>;
  const total = r.segments.reduce((a, b) => a + b, 0);
  return (
    <p className="muted">
      {r.segments.length > 1
        ? `Prints as ${r.segments.length} segments (${r.segments.join(" + ")} cells), butt-jointed on cell lines. The dashed lines on the board show the cuts.`
        : `Prints in one piece.`}{" "}
      Up to {max} cells ({max * board.pitchMm} mm) per piece on the {printer}
      {board.printer?.diagonal ? ", corner to corner" : ""}. Run: {total} cells, {total * board.pitchMm} mm.
    </p>
  );
}

/** Shape + connection for a placed part. Changing either swaps the generator, keeping matching sizes. */
function KindEditor({ shape, connection, onKind }: { shape: string; connection: ConnectionId; onKind(shape: string, c: ConnectionId): void }) {
  const reason = (s: string, c: ConnectionId) => {
    const r = lookup(s, c);
    return "reason" in r ? r.reason : null;
  };
  return (
    <>
      <label className="field">
        <span>Shape</span>
        <select
          value={shape}
          onChange={(e) => {
            const s = e.target.value;
            // Keep the connection if the new shape has it, else the first one it does have.
            const c = !reason(s, connection) ? connection : CONNECTIONS.find((x) => !reason(s, x.id))?.id;
            if (c) onKind(s, c);
          }}
        >
          {SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Connection</span>
        <ConnectionPicker value={connection} onChange={(c) => onKind(shape, c)} reasonFor={(c) => reason(shape, c)} />
      </div>
    </>
  );
}

export function Inspector({ r, shape, onRetryShape, sharedCount, board, onPlacement, onPartType, onKind, onRotate, onDuplicate, onRemove }: Props) {
  const pitchMm = board.pitchMm;
  const pt = r.partType;
  const g = generatorById(pt.generatorId);
  const kind = kindOf(pt);
  const params = g ? visibleParams(g, optionOf(pt)) : [];
  return (
    <div className="inspector">
      <h3>Placement</h3>
      <label className="field">
        <span>Label</span>
        <input value={r.placement.label ?? ""} placeholder={pt.name} onChange={(e) => onPlacement({ label: e.target.value || undefined })} />
      </label>
      <div className="row">
        <Num label="X (cell)" value={r.placement.x} onChange={(x) => onPlacement({ x })} />
        <Num label="Y (cell)" value={r.placement.y} onChange={(y) => onPlacement({ y })} />
      </div>
      <div className="row buttons">
        <button onClick={onRotate} title="R">Rotate {r.placement.rotation}°</button>
        <button onClick={onDuplicate} title="Ctrl+D">Duplicate</button>
        <button onClick={onRemove} className="danger" title="Delete">Remove</button>
      </div>
      <p className="muted">
        Mount {r.w}×{r.h} cells ({r.w * pitchMm}×{r.h * pitchMm} mm)
        {r.approx ? " · footprint estimated until the real shape is measured" : ""}
      </p>

      <h3>Part type{sharedCount > 1 ? ` (shared by ${sharedCount} placements)` : ""}</h3>
      <div className="row">
        <label className="field grow">
          <span>Name</span>
          <input value={pt.name} onChange={(e) => onPartType({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Color</span>
          <input type="color" value={pt.color} onChange={(e) => onPartType({ color: e.target.value })} />
        </label>
      </div>

      {kind ? <KindEditor shape={kind.shape} connection={kind.connection} onKind={onKind} /> : null}

      {g ? (
        <>
          <p className="muted">
            Generator: <a href={scadUrl(g)} target="_blank" rel="noreferrer">{g.scadFile}</a>
            {g.notes ? <><br />{g.notes}</> : null}
          </p>
          {params.map((s) => (
            <ParamInput key={s.name} spec={s} value={pt.params[s.name] ?? s.default} onChange={(v) => onPartType({ params: { ...pt.params, [s.name]: v } })} />
          ))}
          <RunInfo r={r} board={board} />
          <ShapeInfo r={r} shape={shape} onRetry={onRetryShape} />
        </>
      ) : (
        <div className="row">
          <Num label="Mount W (cells)" min={1} value={pt.mount?.wCells ?? 1} onChange={(n) => onPartType({ mount: { wCells: Math.max(1, Math.round(n)), hCells: pt.mount?.hCells ?? 1 } })} />
          <Num label="Mount H (cells)" min={1} value={pt.mount?.hCells ?? 1} onChange={(n) => onPartType({ mount: { wCells: pt.mount?.wCells ?? 1, hCells: Math.max(1, Math.round(n)) } })} />
        </div>
      )}

      <h4>{g ? "Extra space beyond the part (mm)" : "Body beyond mount (mm)"}</h4>
      <p className="muted">
        Before rotation. {g ? "Added around the part's real shape, for things it holds (a PSU sticking out, cables)." : "Use this for overhang, like a PSU sticking past its holder."}
      </p>
      <div className="row wrap">
        {SIDES.map(([k, label]) => (
          <Num key={k} label={label} min={0} step={0.5} value={pt.envelope[k]} onChange={(n) => onPartType({ envelope: { ...pt.envelope, [k]: Math.max(0, n) } })} />
        ))}
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={pt.notes ?? ""} onChange={(e) => onPartType({ notes: e.target.value })} />
      </label>
    </div>
  );
}
