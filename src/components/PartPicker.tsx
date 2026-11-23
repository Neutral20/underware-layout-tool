import { useState } from "react";
import { CONNECTIONS, DEFAULT_CONNECTION, SHAPES, lookup, type ConnectionId, type Shape } from "../model/catalog";

const KEY = "underware-layout-tool:connection";
function savedConnection(): ConnectionId {
  try {
    const v = localStorage.getItem(KEY);
    if (CONNECTIONS.some((c) => c.id === v)) return v as ConnectionId;
  } catch {
    /* storage blocked: use the default */
  }
  return DEFAULT_CONNECTION;
}

function ShapeIcon({ shape }: { shape: Shape }) {
  return (
    <svg className="shape-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={shape.icon} />
    </svg>
  );
}

/** Connections a shape can use, in picker order. */
export const connectionsFor = (shape: string) => CONNECTIONS.filter((c) => !("reason" in lookup(shape, c.id))).map((c) => c.id);

/**
 * Connection buttons. Unavailable ones stay clickable so they can say why.
 * When only one is possible it's shown as already set, with nothing to pick.
 */
export function ConnectionPicker({
  value,
  onChange,
  reasonFor,
}: {
  value: ConnectionId;
  onChange(c: ConnectionId): void;
  reasonFor?(c: ConnectionId): string | null;
}) {
  const [why, setWhy] = useState<string | null>(null);
  const possible = CONNECTIONS.filter((c) => !reasonFor?.(c.id));
  if (reasonFor && possible.length === 1) {
    const only = possible[0];
    return (
      <p className="only-mount" title={only.note}>
        <span className="pill-on">{only.label}</span> <span className="muted">the only way this part mounts</span>
      </p>
    );
  }
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Mounting">
        {CONNECTIONS.map((c) => {
          const reason = reasonFor?.(c.id) ?? null;
          return (
            <button
              key={c.id}
              role="radio"
              aria-checked={value === c.id}
              aria-disabled={!!reason}
              className={[value === c.id ? "on" : "", reason ? "off" : ""].join(" ")}
              title={reason ?? c.note}
              onClick={() => {
                if (reason) return setWhy(reason);
                setWhy(null);
                onChange(c.id);
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {why ? <p className="muted unavailable">{why}</p> : null}
    </>
  );
}

/** Sidebar picker: the part shape first, then how it mounts, then add. */
export function PartPicker({ pitchMm, onAdd, onAddCustom }: { pitchMm: number; onAdd(shape: string, c: ConnectionId): void; onAddCustom(): void }) {
  const [shape, setShape] = useState(SHAPES[0].id);
  // The mounting you last picked, used whenever the chosen shape supports it.
  const [preferred, setPreferred] = useState<ConnectionId>(savedConnection);
  const mountFor = (id: string) => {
    const o = connectionsFor(id);
    return o.includes(preferred) ? preferred : o[0];
  };
  const conn = mountFor(shape);
  const connection = CONNECTIONS.find((c) => c.id === conn)!;
  const current = SHAPES.find((s) => s.id === shape)!;
  const reasonFor = (c: ConnectionId) => {
    const r = lookup(shape, c);
    return "reason" in r ? r.reason : null;
  };
  const choose = (c: ConnectionId) => {
    setPreferred(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* convenience only */
    }
  };

  return (
    <section>
      <h2>Add a part</h2>
      <div className="shapes" role="radiogroup" aria-label="Part">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={s.id === shape}
            className={s.id === shape ? "on" : ""}
            title="Double-click to add it right away"
            onClick={() => setShape(s.id)}
            onDoubleClick={() => onAdd(s.id, mountFor(s.id))}
          >
            <ShapeIcon shape={s} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="field">
        <span>Mounting</span>
        <ConnectionPicker key={shape} value={conn} onChange={choose} reasonFor={reasonFor} />
      </div>
      <p className="muted">{connection.note}</p>
      {conn === "clip" && pitchMm !== 28 ? <p className="muted unavailable">Clip-in parts are sized for a 28 mm grid; this board is {pitchMm} mm.</p> : null}
      {(conn === "snap" || conn === "screw") && pitchMm === 28 ? (
        <p className="muted">Scaled to the 28 mm grid. The QuackWorks parts are designed for 25 mm Multiboard.</p>
      ) : null}
      <button className="primary add" onClick={() => onAdd(shape, conn)}>
        Add {current.label.toLowerCase()}
      </button>

      <div className="library">
        <button onClick={onAddCustom}>
          <span className="swatch" style={{ background: "#64748b" }} />
          Custom part (manual size)
        </button>
      </div>
    </section>
  );
}
