// Turns a layout into the list of renders needed to print it. Pure, so
// it can be unit tested without OpenSCAD.

import { generatorById, scadPath } from "../model/library";
import { mountById } from "./mounts";
import type { Board, ParamValue, PartType } from "../model/types";

export interface RenderJob {
  key: string;
  /** Human name for the part, e.g. "I channel (straight)". */
  name: string;
  /** "Base" or "Top" for two-piece channels, null for one-piece parts. */
  piece: "Base" | "Top" | null;
  scadPath: string;
  defines: Record<string, ParamValue>;
  quantity: number;
  fileName: string;
  /** Short param summary for the parts list. */
  summary: string;
}

export interface ManualItem {
  name: string;
  quantity: number;
}

export interface ExportPlan {
  jobs: RenderJob[];
  /** Custom parts: no generator, so nothing to render. */
  manual: ManualItem[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function summarize(defines: Record<string, ParamValue>, skip: Set<string>) {
  return Object.entries(defines)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/** Short tag that tells similar parts apart in a file name, like "1x5-h12". */
function sizeTag(pt: PartType): string {
  const nums = Object.entries(pt.params)
    .filter(([k, v]) => typeof v === "number" && /Unit|Radius|Over|Up|Out|Length|Width|Depth/.test(k) && !/Height/.test(k))
    .map(([, v]) => String(v));
  const h = pt.params.Channel_Internal_Height ?? pt.params.Internal_Height;
  return [nums.join("x"), h !== undefined ? `h${h}` : ""].filter(Boolean).join("-");
}

export interface PieceRender {
  piece: RenderJob["piece"];
  scadPath: string;
  defines: Record<string, ParamValue>;
}

export const renderKey = (scadPath: string, defines: Record<string, ParamValue>) =>
  scadPath + JSON.stringify(Object.entries(defines).sort(([a], [b]) => a.localeCompare(b)));

/** The renders one generated part type needs: base + top for channels, one for the rest. */
export function rendersFor(board: Board, pt: PartType): PieceRender[] {
  const g = generatorById(pt.generatorId);
  if (!g) return [];
  const base: Record<string, ParamValue> = {};
  for (const spec of g.params) base[spec.name] = pt.params[spec.name] ?? spec.default;
  // QuackWorks channels print as base + top; clip-on pieces are one part.
  const isChannel = g.category === "underware-channel" && !g.onePiece;
  // Channels space their mount holes by Grid_Size; match the board.
  if (isChannel) base.Grid_Size = board.pitchMm;
  const pieces: RenderJob["piece"][] = isChannel ? ["Base", "Top"] : [null];
  const mount = mountById(board.channelMount);
  return pieces.map((piece) => {
    let r = { scadPath: scadPath(g), defines: piece ? { ...base, Base_Top_or_Both: piece } : base };
    if (isChannel) r = mount.channel(r);
    return { piece, ...r };
  });
}

export function buildExportPlan(board: Board, partTypes: PartType[]): ExportPlan {
  const counts = new Map<string, number>();
  for (const p of board.placements) counts.set(p.partTypeId, (counts.get(p.partTypeId) ?? 0) + 1);

  const jobs = new Map<string, RenderJob>();
  const manual = new Map<string, ManualItem>();

  for (const pt of partTypes) {
    const qty = counts.get(pt.id) ?? 0;
    if (!qty) continue;
    const g = generatorById(pt.generatorId);
    if (!g) {
      const m = manual.get(pt.name) ?? { name: pt.name, quantity: 0 };
      m.quantity += qty;
      manual.set(pt.name, m);
      continue;
    }
    for (const { piece, scadPath, defines } of rendersFor(board, pt)) {
      const key = renderKey(scadPath, defines);
      const existing = jobs.get(key);
      if (existing) {
        existing.quantity += qty;
        continue;
      }
      jobs.set(key, {
        key,
        name: g.nameFor?.(pt.params) ?? g.name,
        piece,
        scadPath,
        defines,
        quantity: qty,
        fileName: "",
        summary: summarize(defines, new Set(["Base_Top_or_Both"])),
      });
      // Remember a tag for naming; computed from the part type.
      jobs.get(key)!.fileName = [slug(g.nameFor?.(pt.params) ?? g.name), sizeTag(pt), piece?.toLowerCase()].filter(Boolean).join("_");
    }
  }

  // Make file names unique and add the quantity, e.g. "i-channel_1x5-h12_base_x3.stl".
  const used = new Map<string, number>();
  const list = [...jobs.values()];
  for (const j of list) {
    const n = (used.get(j.fileName) ?? 0) + 1;
    used.set(j.fileName, n);
    j.fileName = `${j.fileName}${n > 1 ? `-${n}` : ""}_x${j.quantity}.stl`;
  }
  return { jobs: list, manual: [...manual.values()] };
}

const csvCell = (s: string | number) => {
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function partsCsv(plan: ExportPlan): string {
  const rows: (string | number)[][] = [["file", "part", "piece", "quantity", "parameters"]];
  for (const j of plan.jobs) rows.push([j.fileName, j.name, j.piece ?? "", j.quantity, j.summary]);
  for (const m of plan.manual) rows.push(["", m.name, "(custom, not generated)", m.quantity, ""]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
