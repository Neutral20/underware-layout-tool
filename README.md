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
- Two-step part picker: pick how parts attach (clip-in for openGrid, the default; threaded snap; Multiconnect; or screw, magnet or flat), then a shape (straight, corner, curve, T, cross, S jog, diagonal, Y split, branch split, end, bridge, item holder, other clip-in piece). Each pair maps to one generator in `src/model/catalog.ts`; pairs that don't exist are greyed out and say why when clicked. The selected part's shape and connection can be changed in the inspector, which keeps matching sizes and shows only the params that apply.
- Multiconnect: only the QuackWorks item holder has a Multiconnect back. No Underware channel SCAD (QuackWorks or Monokini) offers one, so channels show it as unavailable.
- The mount footprint is computed from each generator's params.
- Custom parts with a manual mount size.
- Per-side body envelope in mm, for parts whose body overhangs the cells they snap into.
- Live checks: mount off board (error), body overhang past the board edge with the mm amount (warning), mount overlap (error), body overlap (warning).
- Drag, rotate (R), nudge (arrows), duplicate (Ctrl/Cmd+D), delete.
- Autosave in the browser, JSON export/import.

## Printer and long runs

The **Printer** panel picks the printer the parts are cut and packed for: Bambu Lab X2D (the default), X1C/X1E, P1S/P1P/P2S, A1, A1 mini, H2D, H2S; Prusa MK4/MK4S, Core One, MINI+, XL; Creality K1, K1 Max, K2 Plus, Ender-3 V3; or a custom bed size. Sizes are in `src/model/printers.ts`. It's stored with the layout and is the one setting behind run cuts, tile sizes and plate packing. A 1 mm clearance is kept from each bed edge.

**Long runs.** Straights (Monokini, clip-on, QuackWorks I) can be drawn up to 400 cells long. On export each run is cut into the fewest segments that fit the bed, as even as possible (a 30-cell run on the X2D prints as 8 + 8 + 7 + 7), so a run gives at most two segment lengths. The board draws the cuts as dashed lines, and the parts list says how each run was cut. "Lay long straights corner to corner" lets segments run diagonally across the bed (11 cells instead of 9 on a 256 mm bed).

How segments join: butt joints on cell lines. None of these straights has a joiner of its own: David D's clip-on straight is a 1-cell piece repeated every 28 mm, Monokini's ends sit flush on a cell line, and the QuackWorks I channel is plain along its length. Each segment clips (or snaps, or screws) to the grid by itself, so the grid holds the run in line and no connector needs printing.

Any other generated part bigger than the bed is flagged with a "doesn't fit the bed" warning. Item holders print on their backer, so their bed footprint isn't checked.

## Space and tiles

Enter the space in mm and **Fit board** sizes the board to the whole cells that fit (700 × 1200 mm → 25 × 42 cells, 24 mm spare).

The board is printed as openGrid tiles from BlackjackDuck's openGrid tile generator (`public/scad/openGrid/openGrid.scad`, vendored from the same QuackWorks commit). **Biggest for the printer** splits the board into the largest tiles the bed takes, as evenly as possible (21 × 60 on the X2D: three columns of 7, rows of 9, 9, 9, 9, 8, 8, 8, so 12 tiles of 9×7 and 9 of 8×7). **Fixed size** keeps square tiles of N cells with a smaller last row or column (older layouts open in this mode at 7). The board draws the seams either way. Full, Lite or Heavy tiles; screw holes at the corners, everywhere or none; chamfered outside corners; connector holes on every edge, so identical sizes are one print, turned or not.

With **Include tiles in the export** ticked (the default for new layouts), the STL zip gets one file per tile size with the count to print. A 9 × 9 Full tile takes about 45 s to render. Tiles join with openGrid connectors, k − 1 per seam of k cells, and the export includes them (`opengrid-connector_xN.stl`). The connector is David D's, from the [openGrid](https://www.printables.com/model/1214361-opengrid-walldesk-mounting-framework-and-ecosystem) 3MF (CC BY 4.0), vendored as `public/scad/openGrid/openGrid_Connector.stl` by `node scripts/vendor-opengrid-connector.mjs <openGridConnector.3mf>`. Tiles are openGrid (28 mm) only.

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

## Plates (3MF)

With **Pack onto plates as 3MF** ticked (the default), the export also packs every printed copy onto build plates for the chosen printer: MaxRects packing, biggest pieces first, 4 mm apart, turned 90° where that fits better, inside the bed's 1 mm margin. A straight cut for corner-to-corner printing gets a plate of its own, laid on the diagonal. The panel shows a small top view of each plate, and `plates.txt` in the zip lists what's on each.

Two forms (`src/render/threemf.ts`):

- **One 3MF per plate** (`plates/plate-01.3mf`, …). Plain 3MF that any slicer opens with the pieces as packed. Bambu Studio keeps the arrangement and centres it on the plate.
- **One Bambu Studio project with every plate** (`plates.3mf`), when you give it a project saved from Bambu Studio (**Use Bambu project…**, remembered in the browser). A Bambu project only keeps its plates when it carries Bambu's printer, filament and process settings, and only Bambu Studio can write those, so the tool copies that project's `Metadata/project_settings.config` and reads the bed size from its `printable_area`. The plates are laid out on Bambu Studio's own plate grid (a near-square grid of plates spaced 1.2 bed widths apart, as in its `PartPlate.cpp`), with one plate entry per plate in `Metadata/model_settings.config`, and Bambu Studio assigns pieces to plates by where they sit. This format was built from Bambu Studio's loader source and checked with unit tests, not yet opened in Bambu Studio itself.

## Part footprints

Footprints in `src/model/library.ts` were checked by rendering each QuackWorks SCAD with OpenSCAD (Manifold backend, `Grid_Size=28`, base only) and reading the STL bounding box. The rendered cases are pinned in `src/model/geometry.test.ts`. Parts marked "estimated" extrapolate beyond those cases.

Note: the stock Underware 2.0 SCADs use a 25 mm (Multiboard) grid. `Grid_Size=28` scales them correctly, but their mounting options don't include an openGrid snap.

## Credits

Parametric clip-on channels: [Monokini](https://github.com/pleite/Monokini) by Pedro Leite, CC BY-NC-SA 4.0 per the SCAD headers (the repo's LICENSE file is AGPL-3.0).

Clip-on channels: [Underware for openGrid](https://www.printables.com/model/1214427-underware-for-opengrid-manage-your-cables-lite-ly) by David D, CC BY-NC-SA 4.0. The meshes are vendored in `public/scad/openGridUnderware/pieces`.

Board tiles: [openGrid](https://www.printables.com/model/1214361-opengrid-walldesk-mounting-framework-and-ecosystem) by David D, with tile connectors from the openGrid 3MF (CC BY 4.0), generated with the [openGrid tile generator](https://makerworld.com/en/models/1304337-opengrid-tile-generator) by BlackjackDuck (Andy Levesque), CC BY-NC-SA 4.0, vendored in `public/scad/openGrid`.

Part generators are the [QuackWorks](https://github.com/AndyLevesque/QuackWorks) Underware 2.0 SCADs by Hands on Katie and BlackjackDuck (Andy Levesque), licensed CC BY-NC-SA 4.0. Copies of the SCADs are vendored in `public/scad/Underware` under that licence, along with [BOSL2](https://github.com/BelfrySCAD/BOSL2) (BSD 2-clause).
Part generators are the [QuackWorks](https://github.com/AndyLevesque/QuackWorks) Underware 2.0 SCADs by Hands on Katie and BlackjackDuck (Andy Levesque), licensed CC BY-NC-SA 4.0. The openGrid clip-on channels are David D's Underware for openGrid, with parametric versions from Pedro Leite's [Monokini](https://github.com/pleite/Monokini) (CC BY-NC-SA 4.0). This tool is shared under the same terms: free to use and remix with credit, non-commercial, changes shared alike. Copies of the SCADs are vendored in `public/scad/Underware` under that licence, along with [BOSL2](https://github.com/BelfrySCAD/BOSL2) (BSD 2-clause).
