import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BoardView } from "./components/BoardView";
import { ExportPanel } from "./components/ExportPanel";
import { Inspector } from "./components/Inspector";
import { checkBoard, resolve, type OutlineLookup } from "./model/geometry";
import { retryOutline, useOutlines } from "./render/outlines";
import { PartPicker } from "./components/PartPicker";
import { PrinterPanel } from "./components/PrinterPanel";
import { loadSaved, newLayout, parseLayout, reducer, save, type Action, type Occupied, type State } from "./state/store";

function init(): State {
  return { layout: loadSaved() ?? newLayout(), selectedId: null };
}

/** Cells each placed part reaches with its real shape, so new parts land clear of them. */
function occupiedCells(st: State, outlineFor: OutlineLookup): Occupied[] {
  const p = st.layout.board.pitchMm;
  return resolve(st.layout.board, st.layout.partTypes, outlineFor).map((r) => {
    const x = Math.floor(r.body.x0 / p + 1e-6), y = Math.floor(r.body.y0 / p + 1e-6);
    return { x: r.x, y: r.y, w: r.w, h: r.h, cells: { x, y, w: Math.ceil(r.body.x1 / p - 1e-6) - x, h: Math.ceil(r.body.y1 / p - 1e-6) - y } };
  });
}

export default function App() {
  // The reducer runs outside render, so it reads the latest outlines from a ref.
  const outlineRef = useRef<OutlineLookup>(() => null);
  // Resolved shapes are needed inside the reducer (to find free spots), so
  // wrap it to pass a function that computes them from the current state.
  const [state, dispatch] = useReducer(
    (s: State, a: Action) => reducer(s, a, (st) => occupiedCells(st, outlineRef.current)),
    undefined,
    init,
  );
  const { layout, selectedId } = state;
  const { board, partTypes } = layout;
  const [zoom, setZoom] = useState(0.5);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Real outlines, measured from the models in the background.
  const shapes = useOutlines(board, partTypes);
  const outlineFor = useMemo<OutlineLookup>(() => (pt) => {
    const s = shapes.get(pt.id);
    return s?.status === "ready" ? s.outline : null;
  }, [shapes]);
  outlineRef.current = outlineFor;
  const resolved = useMemo(() => resolve(board, partTypes, outlineFor), [board, partTypes, outlineFor]);
  const issues = useMemo(() => checkBoard(board, partTypes, outlineFor, resolved), [board, partTypes, outlineFor, resolved]);
  const selected = resolved.find((r) => r.placement.id === selectedId) ?? null;

  useEffect(() => save(layout), [layout]);

  // Keyboard: R rotate, Delete remove, arrows nudge, Ctrl/Cmd+D duplicate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!selected || t.closest("input, textarea, select")) return;
      const id = selected.placement.id;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (e.key === "r" || e.key === "R") dispatch({ type: "rotate", placementId: id });
      else if (e.key === "Delete" || e.key === "Backspace") dispatch({ type: "removePlacement", placementId: id });
      else if ((e.ctrlKey || e.metaKey) && e.key === "d") dispatch({ type: "duplicate", placementId: id });
      else if (nudge[e.key]) dispatch({ type: "move", placementId: id, x: selected.x + nudge[e.key][0], y: selected.y + nudge[e.key][1] });
      else if (e.key === "Escape") dispatch({ type: "select", id: null });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${board.name.replace(/[^\w-]+/g, "_") || "layout"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => {
    try {
      dispatch({ type: "load", layout: parseLayout(await f.text()) });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  const num = (v: string, min = 1) => Math.max(min, Math.round(Number(v) || min));
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Underware Layout</h1>

        <section>
          <h2>Board</h2>
          <label className="field">
            <span>Name</span>
            <input value={board.name} onChange={(e) => dispatch({ type: "board", patch: { name: e.target.value } })} />
          </label>
          <div className="row">
            <label className="field">
              <span>Width (cells)</span>
              <input type="number" min={1} value={board.widthCells} onChange={(e) => dispatch({ type: "board", patch: { widthCells: num(e.target.value) } })} />
            </label>
            <label className="field">
              <span>Height (cells)</span>
              <input type="number" min={1} value={board.heightCells} onChange={(e) => dispatch({ type: "board", patch: { heightCells: num(e.target.value) } })} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>Grid pitch</span>
              <select value={board.pitchMm} onChange={(e) => dispatch({ type: "board", patch: { pitchMm: Number(e.target.value) } })}>
                <option value={28}>28 mm (openGrid)</option>
                <option value={25}>25 mm (Multiboard)</option>
              </select>
            </label>
            <label className="field">
              <span>Tile (cells)</span>
              <input
                type="number"
                min={0}
                value={board.tile.widthCells}
                title="Tile size for seam lines. 0 hides seams."
                onChange={(e) => {
                  const n = num(e.target.value, 0);
                  dispatch({ type: "board", patch: { tile: { widthCells: n, heightCells: n } } });
                }}
              />
            </label>
          </div>
          <p className="muted">
            {board.widthCells * board.pitchMm} × {board.heightCells * board.pitchMm} mm
          </p>
        </section>

        <PrinterPanel board={board} onChange={(printer) => dispatch({ type: "board", patch: { printer } })} />

        <PartPicker
          pitchMm={board.pitchMm}
          onAdd={(shape, connection) => dispatch({ type: "addPart", shape, connection })}
          onAddCustom={() => dispatch({ type: "addCustom" })}
        />

        <ExportPanel board={board} partTypes={partTypes} onMount={(id) => dispatch({ type: "board", patch: { channelMount: id } })} />

        <section>
          <h2>File</h2>
          <div className="row buttons">
            <button onClick={exportJson}>Export JSON</button>
            <button onClick={() => fileRef.current?.click()}>Import JSON</button>
            <button
              className="danger"
              onClick={() => {
                if (board.placements.length === 0 || window.confirm("Clear this layout? Export it first if you want to keep it.")) dispatch({ type: "load", layout: newLayout() });
              }}
            >
              New
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
          {loadError ? <p className="error-text">{loadError}</p> : <p className="muted">Autosaves in this browser.</p>}
        </section>

        <footer className="credits">
          <p>
            Underware by <a href="https://www.youtube.com/@HandsOnKatie" target="_blank" rel="noreferrer">Hands on Katie</a> and{" "}
            <a href="https://github.com/AndyLevesque/QuackWorks" target="_blank" rel="noreferrer">BlackjackDuck (Andy Levesque)</a>.
            Underware for openGrid by David D. Parametric openGrid channels by{" "}
            <a href="https://github.com/pleite/Monokini" target="_blank" rel="noreferrer">Pedro Leite</a>.
          </p>
          <p>
            The part designs and this tool are shared under{" "}
            <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a>: free to
            use and remix with credit, not for commercial use, and changes shared under the same terms.
          </p>
        </footer>
      </aside>

      <main className="canvas">
        <div className="toolbar">
          <span className={errors ? "pill error" : warnings ? "pill warning" : "pill ok"}>
            {errors || warnings ? `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}` : "Everything fits"}
          </span>
          <label>
            Zoom
            <input type="range" min={0.2} max={2} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <span className="muted">Drag to move · R rotate · arrows nudge · Del remove</span>
        </div>
        <div className="scroll">
          <BoardView
            board={board}
            resolved={resolved}
            issues={issues}
            selectedId={selectedId}
            pxPerMm={zoom}
            onSelect={(id) => dispatch({ type: "select", id })}
            onMove={(id, x, y) => dispatch({ type: "move", placementId: id, x, y })}
          />
        </div>
      </main>

      <aside className="panel">
        {selected ? (
          <Inspector
            r={selected}
            shape={shapes.get(selected.partType.id)}
            onRetryShape={() => retryOutline(board, selected.partType)}
            board={board}
            sharedCount={board.placements.filter((p) => p.partTypeId === selected.partType.id).length}
            onPlacement={(patch) => dispatch({ type: "updatePlacement", placementId: selected.placement.id, patch })}
            onPartType={(patch) => dispatch({ type: "updatePartType", partTypeId: selected.partType.id, patch })}
            onKind={(shape, connection) => dispatch({ type: "setKind", partTypeId: selected.partType.id, shape, connection })}
            onRotate={() => dispatch({ type: "rotate", placementId: selected.placement.id })}
            onDuplicate={() => dispatch({ type: "duplicate", placementId: selected.placement.id })}
            onRemove={() => dispatch({ type: "removePlacement", placementId: selected.placement.id })}
          />
        ) : (
          <p className="muted">Select a part to edit it.</p>
        )}

        <h3>Issues</h3>
        {issues.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="issues">
            {issues.map((i, n) => (
              <li key={n} className={i.severity} onClick={() => dispatch({ type: "select", id: i.placementIds[0] })}>
                {i.detail}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
