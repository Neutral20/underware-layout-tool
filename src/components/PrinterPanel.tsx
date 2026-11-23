import { CUSTOM_PRINTER, DEFAULT_PRINTER, PRINTERS, maxLengthOnBed, printerFor, usableBed, type PrinterSetting } from "../model/printers";
import type { Board } from "../model/types";

interface Props {
  board: Board;
  onChange(p: PrinterSetting): void;
}

const brands = [...new Set(PRINTERS.map((p) => p.brand))];

/** The printer: one setting that decides run cuts, tile sizes and plate packing. */
export function PrinterPanel({ board, onChange }: Props) {
  const s: PrinterSetting = board.printer ?? { id: DEFAULT_PRINTER };
  const { bed } = printerFor(s);
  const pitch = board.pitchMm;
  const u = usableBed(bed);
  // A 1-cell straight, for the "longest piece" hint.
  const straight = Math.floor((maxLengthOnBed(bed, 26.4, !!s.diagonal) - 0.05) / pitch);
  const tile = [Math.floor(u.x / pitch), Math.floor(u.y / pitch)];
  const setBed = (k: "x" | "y" | "z", v: string) => {
    const n = Math.max(50, Math.min(1000, Math.round(Number(v) || 0)));
    onChange({ ...s, bed: { ...bed, [k]: n } });
  };

  return (
    <section>
      <h2>Printer</h2>
      <label className="field">
        <span>Printer</span>
        <select
          value={s.id}
          onChange={(e) => {
            const id = e.target.value;
            // Starting a custom size from the current printer is handier than a blank.
            onChange(id === CUSTOM_PRINTER ? { ...s, id, bed: s.bed ?? bed } : { ...s, id });
          }}
        >
          {brands.map((b) => (
            <optgroup key={b} label={b}>
              {PRINTERS.filter((p) => p.brand === b).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} {p.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM_PRINTER}>Custom size…</option>
        </select>
      </label>
      {s.id === CUSTOM_PRINTER ? (
        <div className="row">
          {(["x", "y", "z"] as const).map((k) => (
            <label key={k} className="field">
              <span>{k.toUpperCase()} (mm)</span>
              <input type="number" min={50} max={1000} value={bed[k]} onChange={(e) => setBed(k, e.target.value)} />
            </label>
          ))}
        </div>
      ) : null}
      <label className="field check">
        <input type="checkbox" checked={!!s.diagonal} onChange={(e) => onChange({ ...s, diagonal: e.target.checked })} />
        <span>Lay long straights corner to corner</span>
      </label>
      <p className="muted">
        Bed {bed.x} × {bed.y} × {bed.z} mm. Straights are cut every {straight} cells at most; tiles can be up to {tile[0]} × {tile[1]} cells.
      </p>
    </section>
  );
}
