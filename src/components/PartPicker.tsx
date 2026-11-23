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

/** Connection buttons. Unavailable ones stay clickable so they can say why. */
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
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Connection">
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

/** Sidebar picker: how it attaches, then the shape to add. */
export function PartPicker({ pitchMm, onAdd, onAddCustom }: { pitchMm: number; onAdd(shape: string, c: ConnectionId): void; onAddCustom(): void }) {
  const [conn, setConn] = useState<ConnectionId>(savedConnection);
  const [why, setWhy] = useState<string | null>(null);
  const connection = CONNECTIONS.find((c) => c.id === conn)!;
  const choose = (c: ConnectionId) => {
    setConn(c);
    setWhy(null);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* convenience only */
    }
  };

  return (
    <section>
      <h2>Add a part</h2>
      <ConnectionPicker value={conn} onChange={choose} />
      <p className="muted">{connection.note}</p>
      {conn === "clip" && pitchMm !== 28 ? <p className="muted unavailable">Clip-in parts are sized for a 28 mm grid; this board is {pitchMm} mm.</p> : null}
      {conn !== "clip" && conn !== "multiconnect" && pitchMm === 28 ? (
        <p className="muted">Scaled to the 28 mm grid. The QuackWorks parts are designed for 25 mm Multiboard.</p>
      ) : null}
      <div className="shapes">
        {SHAPES.map((s) => {
          const r = lookup(s.id, conn);
          const reason = "reason" in r ? r.reason : null;
          return (
            <button
              key={s.id}
              aria-disabled={!!reason}
              className={reason ? "off" : ""}
              title={"generator" in r ? r.generator.name : reason ?? undefined}
              onClick={() => {
                if (reason) return setWhy(`${s.label}: ${reason}`);
                setWhy(null);
                onAdd(s.id, conn);
              }}
            >
              <ShapeIcon shape={s} />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
      {why ? <p className="muted unavailable">{why}</p> : <p className="muted">Greyed-out shapes don't exist with this connection. Click one to see why.</p>}
      <div className="library">
        <button onClick={onAddCustom}>
          <span className="swatch" style={{ background: "#64748b" }} />
          Custom part (manual size)
        </button>
      </div>
    </section>
  );
}
