import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BoardView } from "./components/BoardView";
import { ExportPanel } from "./components/ExportPanel";
import { Inspector } from "./components/Inspector";
import { checkBoard, resolve } from "./model/geometry";
import { GENERATORS, OG_GENERATORS } from "./model/library";
import { loadSaved, newLayout, parseLayout, reducer, save, type Action, type State } from "./state/store";

function init(): State {
  return { layout: loadSaved() ?? newLayout(), selectedId: null };
}

export default function App() {
  // Resolved shapes are needed inside the reducer (to find free spots), so
  // wrap it to pass a function that computes them from the current state.
  const [state, dispatch] = useReducer(
    (s: State, a: Action) => reducer(s, a, (st) => resolve(st.layout.board, st.layout.partTypes)),
    undefined,
    init,
  );
  const { layout, selectedId } = state;
  const { board, partTypes } = layout;
  const [zoom, setZoom] = useState(0.5);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const resolved = useMemo(() => resolve(board, partTypes), [board, partTypes]);
  const issues = useMemo(() => checkBoard(board, partTypes), [board, partTypes]);
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

        <section>
          <h2>Add clip-on part (openGrid)</h2>
          <div className="library">
            {OG_GENERATORS.map((g) => (
              <button key={g.id} onClick={() => dispatch({ type: "addFromGenerator", generatorId: g.id })} title={g.notes}>
                <span className="swatch" style={{ background: g.color }} />
                {g.name}
              </button>
            ))}
          </div>
          <p className="muted">One-piece channels that snap onto the grid. Pick the piece in the panel on the right.</p>
        </section>

        <section>
          <h2>Add Underware 2.0 part (QuackWorks)</h2>
          <div className="library">
            {GENERATORS.map((g) => (
              <button key={g.id} onClick={() => dispatch({ type: "addFromGenerator", generatorId: g.id })} title={g.scadFile}>
                <span className="swatch" style={{ background: g.color }} />
                {g.name}
              </button>
            ))}
            <button onClick={() => dispatch({ type: "addCustom" })}>
              <span className="swatch" style={{ background: "#64748b" }} />
              Custom part (manual size)
            </button>
          </div>
        </section>

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
            board={board}
            sharedCount={board.placements.filter((p) => p.partTypeId === selected.partType.id).length}
            onPlacement={(patch) => dispatch({ type: "updatePlacement", placementId: selected.placement.id, patch })}
            onPartType={(patch) => dispatch({ type: "updatePartType", partTypeId: selected.partType.id, patch })}
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
