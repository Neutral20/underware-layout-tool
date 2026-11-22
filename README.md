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

Each piece takes roughly 3 to 30 s; renders run in a small worker pool and are cached for the session, so a second export or a size check followed by an export doesn't render twice. Custom parts with a manual size are listed but not generated.

**Check size with a render** (in the part inspector) renders one part and compares its real size with the footprint the planner assumes. If the part is bigger, one click adds the difference to its body envelope.

**Channel mount** is a swappable style (`src/render/mounts.ts`). Today only the stock QuackWorks mounting options are available. An openGrid clip-in style is stubbed out and waiting on its SCAD; adding it means vendoring the file and pointing the style at it.

The SCAD sources are vendored into `public/scad/` by `scripts/vendor-scad.mjs` from pinned BOSL2 and QuackWorks commits. The script applies one patch to the C channel so it renders in WASM (the geometry is unchanged). One known failure remains: the C channel with the Wood Screw mount still crashes OpenSCAD WASM, and the export reports it as failed instead of hanging.

## Part footprints

Footprints in `src/model/library.ts` were checked by rendering each QuackWorks SCAD with OpenSCAD (Manifold backend, `Grid_Size=28`, base only) and reading the STL bounding box. The rendered cases are pinned in `src/model/geometry.test.ts`. Parts marked "estimated" extrapolate beyond those cases.

Note: the stock Underware 2.0 SCADs use a 25 mm (Multiboard) grid. `Grid_Size=28` scales them correctly, but their mounting options don't include an openGrid snap.

## Credits

Part generators are the [QuackWorks](https://github.com/AndyLevesque/QuackWorks) Underware 2.0 SCADs by Hands on Katie and BlackjackDuck (Andy Levesque), licensed CC BY-NC-SA 4.0. The openGrid clip-on channels are David D's Underware for openGrid, with parametric versions from Pedro Leite's [Monokini](https://github.com/pleite/Monokini) (CC BY-NC-SA 4.0). This tool is shared under the same terms: free to use and remix with credit, non-commercial, changes shared alike. Copies of the SCADs are vendored in `public/scad/Underware` under that licence, along with [BOSL2](https://github.com/BelfrySCAD/BOSL2) (BSD 2-clause).
