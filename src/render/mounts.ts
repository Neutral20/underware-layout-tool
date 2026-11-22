// How channels attach to the board. A mount style decides which SCAD a
// channel renders from and which params it gets, so a different mount
// (like an openGrid clip-in base) can be swapped in without touching the
// layout, the export plan or the renderer. (openGrid clip-on channels are
// their own one-piece parts instead, see OG_GENERATORS in model/library.ts.)

import type { ParamValue } from "../model/types";

export interface ChannelRender {
  /** Absolute path in the OpenSCAD file system. */
  scadPath: string;
  defines: Record<string, ParamValue>;
}

export interface MountStyle {
  id: string;
  label: string;
  /** False when the SCAD for this mount isn't in the tool yet. */
  available: boolean;
  note: string;
  channel(r: ChannelRender): ChannelRender;
}

export const MOUNT_STYLES: MountStyle[] = [
  {
    id: "quackworks",
    label: "QuackWorks mount (per part)",
    available: true,
    note: "Uses each channel's own Mounting option from the stock Underware 2.0 SCADs.",
    channel: (r) => r,
  },
];

export const DEFAULT_MOUNT = "quackworks";

export const mountById = (id?: string) => MOUNT_STYLES.find((m) => m.id === id) ?? MOUNT_STYLES[0];
