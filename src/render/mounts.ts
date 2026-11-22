// How channels attach to the board. A mount style decides which SCAD a
// channel renders from and which params it gets, so a different mount
// (like an openGrid clip-in base) can be swapped in without touching the
// layout, the export plan or the renderer.

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
  {
    id: "opengrid-clip",
    label: "openGrid clip-in",
    available: false,
    note: "Channels that clip straight onto the openGrid bars. Waiting on the SCAD for this style.",
    // Once the SCAD is vendored, point scadPath at it here (and map params).
    channel: (r) => r,
  },
];

export const DEFAULT_MOUNT = "quackworks";

export const mountById = (id?: string) => MOUNT_STYLES.find((m) => m.id === id) ?? MOUNT_STYLES[0];
