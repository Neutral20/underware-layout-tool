# Underware Layout Tool

A browser tool for planning an openGrid / Underware 2.0 board before printing anything: set the board size, drop channels and holders on it, and see what fits, what collides, and what hangs off the edge. Later steps add STL generation from the QuackWorks SCADs and 3MF export packed per build plate.

## Run it

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for fit checks and part footprints
npm run build    # static build in dist/
```

## What's in v1

- Board in cells (default 21×60), grid pitch 28 mm (openGrid) or 25 mm (Multiboard), tile seams drawn every N cells.
- Underware 2.0 parts (I, L, T, X, C, S, diagonal, Y, branch split, item holder) with their SCAD parameters. The mount footprint is computed from those params.
- Custom parts with a manual mount size.
- Per-side body envelope in mm, for parts whose body overhangs the cells they snap into.
- Live checks: mount off board (error), body overhang past the board edge with the mm amount (warning), mount overlap (error), body overlap (warning).
- Drag, rotate (R), nudge (arrows), duplicate (Ctrl/Cmd+D), delete.
- Autosave in the browser, JSON export/import.

## Part footprints

Footprints in `src/model/library.ts` were checked by rendering each QuackWorks SCAD with OpenSCAD (Manifold backend, `Grid_Size=28`, base only) and reading the STL bounding box. The rendered cases are pinned in `src/model/geometry.test.ts`. Parts marked "estimated" extrapolate beyond those cases.

Note: the stock Underware 2.0 SCADs use a 25 mm (Multiboard) grid. `Grid_Size=28` scales them correctly, but their mounting options don't include an openGrid snap.

## Credits

Part generators are the [QuackWorks](https://github.com/AndyLevesque/QuackWorks) Underware 2.0 SCADs by Hands on Katie and BlackjackDuck (Andy Levesque), licensed CC BY-NC-SA 4.0. This tool links to them and passes parameters; it doesn't include them yet.
