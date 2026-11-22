# Underware Layout Tool

A browser tool for planning an openGrid / Underware 2.0 board before printing anything: set the board size, drop channels and holders on it, and see what fits, what collides, and what hangs off the edge. Later steps add STL generation from the QuackWorks SCADs and 3MF export packed per build plate.

## Run it

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for fit checks and part footprints
npm run build    # static build in dist/
```

## Hosting on GitHub Pages

`.github/workflows/deploy-pages.yml` runs the tests, builds, and deploys `dist/` to GitHub Pages on every push to `main` (or by hand from the Actions tab). The site lives at `https://neutral20.github.io/underware-layout-tool/`.

The build uses a relative base (`base: "./"` in `vite.config.ts`), and the SCAD sources are fetched relative to the page, so the same build works under the repo subpath, at a custom domain root, or from a plain folder. OpenSCAD WASM is bundled into the render worker, so there is no extra file to serve.

One-time setup: in the repo, **Settings → Pages → Build and deployment → Source**, pick **GitHub Actions**. On a free GitHub plan Pages needs the repo to be public.

## What's in v1

- Board in cells (default 21×60), grid pitch 28 mm (openGrid) or 25 mm (Multiboard), tile seams drawn every N cells.
- Underware 2.0 parts (I, L, T, X, C, S, diagonal, Y, branch split, item holder) with their SCAD parameters. The mount footprint is computed from those params.
- Custom parts with a manual mount size.
- Per-side body envelope in mm, for parts whose body overhangs the cells they snap into.
- Live checks: mount off board (error), body overhang past the board edge with the mm amount (warning), mount overlap (error), body overlap (warning).
- Drag, rotate (R), nudge (arrows), duplicate (Ctrl/Cmd+D), delete.
- Autosave in the browser, JSON export/import.

## STL export

The Export STLs panel renders every placed Underware part in the browser with OpenSCAD compiled to WebAssembly (`openscad-wasm-prebuilt`, Manifold backend) and BOSL2, then downloads a zip:

- `stl/` with one file per unique piece. Channels come out as separate base and top pieces. Identical parts are merged, and each file name ends in `_xN`, the number to print.
- `parts.csv` with each file, quantity and the SCAD parameters used.
- `layout.json` (the layout it came from) and `README.txt` with credits.

Each piece takes roughly 3 to 30 s; renders run in a small worker pool and are cached for the session, so a second export, or a shape measurement followed by an export, doesn't render twice. Custom parts with a manual size are listed but not generated.

**Real part shapes.** The board draws every generated part as its true top-down outline (curves, T, Y and S shapes, mounting holes), not a box, and the overlap and overhang checks use that outline. Parts can sit in the empty cells of a curve or T; pieces that meet end to end count as touching, not colliding; bridges may cross other channels. Select a part to see its exact size in mm.

Outlines are projected from the rendered mesh (`src/model/outline.ts`): the mesh is seen from the side the parts face, rasterised at 0.2 mm, traced and simplified, then fitted to the grid so channel walls sit 0.8 mm inside their cells and channel ends sit on cell lines. Every fixed clip-on piece, clip-on straights of 1 to 30 cells and each generator's defaults ship pre-computed in `src/model/outlines.prebuilt.json` (rebuild with `npx vite-node scripts/build-outlines.ts`). Any other size is rendered in the background the first time it's placed (a few seconds for straights, up to about 45 s for crosses), drawn as dashed mount cells until then, and saved in the browser so it's instant next time. The render is shared with STL export.

**Clip-on channels for openGrid.** "Underware for openGrid" by David D: one-piece channels that snap straight onto the grid bars. The pieces (curves r1 to r4, Y, T, X, Z, S jog, ends, bridges) come from the original 3MF and export as-is; straights of any length are built from the 1-cell straight, which gives exactly the 3MF's own 2x to 8x straights. Re-vendor with `node scripts/vendor-opengrid-underware.mjs <file.3mf>`. These are sized for a 28 mm grid only, and come in one width.

**Clip-on channels, any size (Monokini).** Pedro Leite's [Monokini](https://github.com/pleite/Monokini) SCADs, the parametric version of the same clip-on profile: straight, L corner (with extra radius), T, X, S jog, diagonal and bridge, in any width (cells), arm lengths and height. Footprints were measured from renders and are pinned in `src/render/plan.test.ts`. Vendored from commit `fa601de` into `public/scad/Monokini`.

**Channel mount** for the QuackWorks channels is a swappable style (`src/render/mounts.ts`); today it uses each channel's own Mounting option.

The SCAD sources are vendored into `public/scad/` by `scripts/vendor-scad.mjs` from pinned BOSL2 and QuackWorks commits. The script applies one patch to the C channel so it renders in WASM (the geometry is unchanged). The worker also gives OpenSCAD an 8 MB stack (the prebuilt WASM ships with about 128 KB, which deeply nested SCADs like Monokini overflow, corrupting memory); see `src/render/worker.ts`.

## Part footprints

Footprints in `src/model/library.ts` were checked by rendering each QuackWorks SCAD with OpenSCAD (Manifold backend, `Grid_Size=28`, base only) and reading the STL bounding box. The rendered cases are pinned in `src/model/geometry.test.ts`. Parts marked "estimated" extrapolate beyond those cases.

Note: the stock Underware 2.0 SCADs use a 25 mm (Multiboard) grid. `Grid_Size=28` scales them correctly, but their mounting options don't include an openGrid snap.

## Credits

Parametric clip-on channels: [Monokini](https://github.com/pleite/Monokini) by Pedro Leite, CC BY-NC-SA 4.0 per the SCAD headers (the repo's LICENSE file is AGPL-3.0).

Clip-on channels: [Underware for openGrid](https://www.printables.com/model/1214427-underware-for-opengrid-manage-your-cables-lite-ly) by David D, CC BY-NC-SA 4.0. The meshes are vendored in `public/scad/openGridUnderware/pieces`.

Part generators are the [QuackWorks](https://github.com/AndyLevesque/QuackWorks) Underware 2.0 SCADs by Hands on Katie and BlackjackDuck (Andy Levesque), licensed CC BY-NC-SA 4.0. Copies of the SCADs are vendored in `public/scad/Underware` under that licence, along with [BOSL2](https://github.com/BelfrySCAD/BOSL2) (BSD 2-clause).
Part generators are the [QuackWorks](https://github.com/AndyLevesque/QuackWorks) Underware 2.0 SCADs by Hands on Katie and BlackjackDuck (Andy Levesque), licensed CC BY-NC-SA 4.0. The openGrid clip-on channels are David D's Underware for openGrid, with parametric versions from Pedro Leite's [Monokini](https://github.com/pleite/Monokini) (CC BY-NC-SA 4.0). This tool is shared under the same terms: free to use and remix with credit, non-commercial, changes shared alike. Copies of the SCADs are vendored in `public/scad/Underware` under that licence, along with [BOSL2](https://github.com/BelfrySCAD/BOSL2) (BSD 2-clause).
