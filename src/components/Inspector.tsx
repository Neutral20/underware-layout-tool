import type { Resolved } from "../model/geometry";
import { generatorById, scadUrl, type ParamSpec } from "../model/library";
import type { Board, Envelope, ParamValue, PartType, Placement } from "../model/types";
import { SizeCheck } from "./SizeCheck";

interface Props {
  r: Resolved;
  sharedCount: number;
  board: Board;
  onPlacement(patch: Partial<Placement>): void;
  onPartType(patch: Partial<PartType>): void;
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
          {spec.choices!.map((c) => (
            <option key={c}>{c}</option>
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

export function Inspector({ r, sharedCount, board, onPlacement, onPartType, onRotate, onDuplicate, onRemove }: Props) {
  const pitchMm = board.pitchMm;
  const pt = r.partType;
  const g = generatorById(pt.generatorId);
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
        {r.approx ? " · footprint estimated, verify with a render" : ""}
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

      {g ? (
        <>
          <p className="muted">
            Generator: <a href={scadUrl(g)} target="_blank" rel="noreferrer">{g.scadFile}</a>
            {g.notes ? <><br />{g.notes}</> : null}
          </p>
          {g.params.map((s) => (
            <ParamInput key={s.name} spec={s} value={pt.params[s.name] ?? s.default} onChange={(v) => onPartType({ params: { ...pt.params, [s.name]: v } })} />
          ))}
          <SizeCheck board={board} pt={pt} onEnvelope={(envelope) => onPartType({ envelope })} />
        </>
      ) : (
        <div className="row">
          <Num label="Mount W (cells)" min={1} value={pt.mount?.wCells ?? 1} onChange={(n) => onPartType({ mount: { wCells: Math.max(1, Math.round(n)), hCells: pt.mount?.hCells ?? 1 } })} />
          <Num label="Mount H (cells)" min={1} value={pt.mount?.hCells ?? 1} onChange={(n) => onPartType({ mount: { wCells: pt.mount?.wCells ?? 1, hCells: Math.max(1, Math.round(n)) } })} />
        </div>
      )}

      <h4>{g ? "Extra body beyond mount (mm)" : "Body beyond mount (mm)"}</h4>
      <p className="muted">Before rotation. Use this for overhang, like a PSU sticking past its holder.</p>
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
