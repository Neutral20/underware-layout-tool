import { useState } from "react";
import { printerFor } from "../model/printers";
import { connectorCount, fitSpace, maxTileCells, oversizeTiles, tileCounts, tileLayout } from "../model/tiles";
import type { Board, TileSpec } from "../model/types";

interface Props {
  board: Board;
  onTile(patch: Partial<TileSpec>): void;
  onSize(widthCells: number, heightCells: number): void;
}

const OG_TILE_URL = "https://makerworld.com/en/models/1304337-opengrid-tile-generator";
const OG_URL = "https://www.printables.com/model/1214361-opengrid-walldesk-mounting-framework-and-ecosystem";

/** Size the board from a space, and split it into tiles that fit the printer. */
export function TilesPanel({ board, onTile, onSize }: Props) {
  const t = board.tile;
  const p = board.pitchMm;
  const [space, setSpace] = useState({ w: String(board.widthCells * p), h: String(board.heightCells * p) });
  const fit = fitSpace(Number(space.w) || 0, Number(space.h) || 0, p);
  const layout = tileLayout(board);
  const counts = tileCounts(layout);
  const oversize = oversizeTiles(board, layout);
  const [mx, my] = maxTileCells(board);
  const mode = t.mode ?? "fixed";
  const variant = t.variant ?? "Full";

  return (
    <section>
      <h2>Space and tiles</h2>
      <div className="row">
        <label className="field">
          <span>Space W (mm)</span>
          <input type="number" min={28} value={space.w} onChange={(e) => setSpace({ ...space, w: e.target.value })} />
        </label>
        <label className="field">
          <span>Space H (mm)</span>
          <input type="number" min={28} value={space.h} onChange={(e) => setSpace({ ...space, h: e.target.value })} />
        </label>
      </div>
      <div className="row buttons">
        <button onClick={() => onSize(fit.widthCells, fit.heightCells)} disabled={fit.widthCells === board.widthCells && fit.heightCells === board.heightCells}>
          Fit board: {fit.widthCells} × {fit.heightCells} cells
        </button>
      </div>
      <p className="muted">
        Leaves {fit.spareX.toFixed(0)} × {fit.spareY.toFixed(0)} mm spare.
      </p>

      <div className="row">
        <label className="field">
          <span>Tile size</span>
          <select value={mode} onChange={(e) => onTile({ mode: e.target.value as TileSpec["mode"] })}>
            <option value="printer">Biggest for the printer</option>
            <option value="fixed">Fixed size</option>
          </select>
        </label>
        {mode === "fixed" ? (
          <label className="field">
            <span>Tile (cells)</span>
            <input
              type="number"
              min={0}
              value={t.widthCells}
              title="Square tiles of this many cells. 0 means one tile, no seams."
              onChange={(e) => {
                const n = Math.max(0, Math.round(Number(e.target.value) || 0));
                onTile({ widthCells: n, heightCells: n });
              }}
            />
          </label>
        ) : null}
      </div>
      <div className="row">
        <label className="field">
          <span>Type</span>
          <select value={variant} onChange={(e) => onTile({ variant: e.target.value as TileSpec["variant"] })}>
            <option value="Full">Full (6.8 mm)</option>
            <option value="Lite">Lite (4 mm)</option>
            <option value="Heavy">Heavy (13.8 mm)</option>
          </select>
        </label>
        <label className="field">
          <span>Screw holes</span>
          <select value={t.screws ?? "Corners"} onChange={(e) => onTile({ screws: e.target.value as TileSpec["screws"] })}>
            <option value="Corners">Corners</option>
            <option value="Everywhere">Everywhere</option>
            <option value="None">None</option>
          </select>
        </label>
      </div>
      <p className="muted">
        {layout.cols.length * layout.rows.length} tile{layout.cols.length * layout.rows.length === 1 ? "" : "s"} ({layout.cols.length} across × {layout.rows.length} down):{" "}
        {counts.map((c) => `${c.w}×${c.h} ×${c.quantity}`).join(", ")}. {connectorCount(layout)} connectors.
        {mode === "printer" ? ` Up to ${mx}×${my} cells on the ${printerFor(board.printer).name}.` : ""}
      </p>
      {oversize.length ? (
        <p className="error-text">
          {oversize.map((c) => `${c.w}×${c.h}`).join(", ")} won't fit the {printerFor(board.printer).name} (max {mx}×{my} cells). Pick "Biggest for the printer" or a smaller size.
        </p>
      ) : null}
      {p !== 28 ? <p className="muted">Tiles are generated for openGrid (28 mm) only.</p> : null}
      <label className="field check">
        <input type="checkbox" disabled={p !== 28} checked={!!t.export && p === 28} onChange={(e) => onTile({ export: e.target.checked })} />
        <span>Include tiles in the export</span>
      </label>
      <p className="muted">
        Tiles from BlackjackDuck's <a href={OG_TILE_URL} target="_blank" rel="noreferrer">openGrid tile generator</a>, with connector holes on every
        edge. Print the connectors from <a href={OG_URL} target="_blank" rel="noreferrer">openGrid</a> by David D.
      </p>
    </section>
  );
}
