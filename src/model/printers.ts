// Printers and their build volumes. The printer is one shared board
// setting: it decides where long channel runs are cut, how big each board
// tile can be, and the plate size for 3MF packing.
//
// Sizes are the makers' published build volumes in mm (X x Y x Z).

export interface Printer {
  id: string;
  name: string;
  brand: string;
  bed: Bed;
}

export interface Bed {
  x: number;
  y: number;
  z: number;
}

export const PRINTERS: Printer[] = [
  { id: "bambu-x2d", brand: "Bambu Lab", name: "X2D", bed: { x: 256, y: 256, z: 260 } },
  { id: "bambu-x1c", brand: "Bambu Lab", name: "X1C / X1E", bed: { x: 256, y: 256, z: 256 } },
  { id: "bambu-p1s", brand: "Bambu Lab", name: "P1S / P1P / P2S", bed: { x: 256, y: 256, z: 256 } },
  { id: "bambu-a1", brand: "Bambu Lab", name: "A1", bed: { x: 256, y: 256, z: 256 } },
  { id: "bambu-a1-mini", brand: "Bambu Lab", name: "A1 mini", bed: { x: 180, y: 180, z: 180 } },
  // H2D: 325 x 320 with one nozzle; both nozzles share 300 x 320.
  { id: "bambu-h2d", brand: "Bambu Lab", name: "H2D", bed: { x: 325, y: 320, z: 325 } },
  { id: "bambu-h2s", brand: "Bambu Lab", name: "H2S", bed: { x: 340, y: 320, z: 340 } },
  { id: "prusa-mk4", brand: "Prusa", name: "MK4 / MK4S / MK3S+", bed: { x: 250, y: 210, z: 220 } },
  { id: "prusa-core-one", brand: "Prusa", name: "Core One", bed: { x: 250, y: 220, z: 270 } },
  { id: "prusa-mini", brand: "Prusa", name: "MINI+", bed: { x: 180, y: 180, z: 180 } },
  { id: "prusa-xl", brand: "Prusa", name: "XL", bed: { x: 360, y: 360, z: 360 } },
  { id: "creality-k1", brand: "Creality", name: "K1 / K1C", bed: { x: 220, y: 220, z: 250 } },
  { id: "creality-k1-max", brand: "Creality", name: "K1 Max", bed: { x: 300, y: 300, z: 300 } },
  { id: "creality-k2-plus", brand: "Creality", name: "K2 Plus", bed: { x: 350, y: 350, z: 350 } },
  { id: "creality-ender3-v3", brand: "Creality", name: "Ender-3 V3 / V3 SE", bed: { x: 220, y: 220, z: 250 } },
];

export const DEFAULT_PRINTER = "bambu-x2d";
export const CUSTOM_PRINTER = "custom";

/** The board's printer setting. Missing means the default printer. */
export interface PrinterSetting {
  id: string;
  /** Used when id is "custom". */
  bed?: Bed;
  /** Lay long straights corner to corner on the bed, so they can be longer. */
  diagonal?: boolean;
}

/** Clearance kept free around each part, from each bed edge (mm). */
export const BED_MARGIN_MM = 1;

export function printerFor(s?: PrinterSetting): { id: string; name: string; bed: Bed } {
  if (s?.id === CUSTOM_PRINTER) return { id: CUSTOM_PRINTER, name: "Custom", bed: s.bed ?? { x: 256, y: 256, z: 256 } };
  const p = PRINTERS.find((q) => q.id === (s?.id ?? DEFAULT_PRINTER)) ?? PRINTERS[0];
  return { id: p.id, name: `${p.brand} ${p.name}`, bed: p.bed };
}

/** Usable bed size after the edge margin. */
export function usableBed(bed: Bed): Bed {
  return { x: bed.x - 2 * BED_MARGIN_MM, y: bed.y - 2 * BED_MARGIN_MM, z: bed.z };
}

/** Does a w x h (mm) rectangle fit on the bed, either way round? */
export function fitsBed(bed: Bed, wMm: number, hMm: number): boolean {
  const u = usableBed(bed);
  return (wMm <= u.x + 1e-6 && hMm <= u.y + 1e-6) || (hMm <= u.x + 1e-6 && wMm <= u.y + 1e-6);
}

/**
 * Longest rectangle of the given width that fits on the bed. Straight along
 * the long side, or (diagonal) at whatever angle gives the most length.
 */
export function maxLengthOnBed(bed: Bed, widthMm: number, diagonal = false): number {
  const u = usableBed(bed);
  const long = Math.max(u.x, u.y), short = Math.min(u.x, u.y);
  if (widthMm > short + 1e-6) return 0;
  let best = long;
  if (!diagonal) return best;
  // A w x L rectangle at angle t needs L cos t + w sin t <= X and
  // L sin t + w cos t <= Y. Scan the angle; it's cheap and exact enough.
  for (let i = 1; i < 900; i++) {
    const t = (i / 900) * (Math.PI / 2);
    const c = Math.cos(t), s = Math.sin(t);
    const l = Math.min((u.x - widthMm * s) / c, (u.y - widthMm * c) / s);
    if (l > best) best = l;
  }
  return best;
}

/**
 * Split n cells into the fewest pieces of at most max cells, as even as
 * possible (so a run gives at most two piece lengths). Longest first.
 */
export function balancedSplit(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (max < 1) return [n];
  const k = Math.ceil(n / max);
  const base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}
