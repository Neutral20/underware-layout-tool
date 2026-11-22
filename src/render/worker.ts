/// <reference lib="webworker" />
// Renders one SCAD file to a binary STL with OpenSCAD compiled to WASM.
// Runs off the main thread because a render takes 5 to 30 seconds.

import { createOpenSCAD } from "openscad-wasm-prebuilt";
import { scadLiteral, type RenderRequest, type RenderResponse } from "./types";

interface Manifest {
  bosl2: string[];
  underware: string[];
}

let sources: Promise<Map<string, Uint8Array>> | null = null;

// Fetch every SCAD source once per worker and keep it in memory.
function loadSources(base: string): Promise<Map<string, Uint8Array>> {
  if (sources) return sources;
  sources = (async () => {
    const get = async (p: string) => {
      const r = await fetch(base + p);
      if (!r.ok) throw new Error(`Couldn't load ${p} (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    };
    const manifest: Manifest = JSON.parse(new TextDecoder().decode(await get("manifest.json")));
    const files = new Map<string, Uint8Array>();
    await Promise.all([
      ...manifest.bosl2.map(async (f) => files.set(`/libraries/BOSL2/${f}`, await get(`BOSL2/${f}`))),
      ...manifest.underware.map(async (f) => files.set(`/Underware/${f}`, await get(`Underware/${f}`))),
    ]);
    return files;
  })();
  sources.catch(() => (sources = null)); // let a later job retry
  return sources;
}

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const req = e.data;
  const log: string[] = [];
  const reply = (r: RenderResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(r, transfer);
  try {
    const files = await loadSources(req.scadBase);
    const t0 = performance.now();
    // A fresh instance per job: callMain isn't safe to reuse after exit.
    const inst = (await createOpenSCAD({ print: (s) => log.push(s), printErr: (s) => log.push(s) })).getInstance();
    const FS = inst.FS;
    const mk = (p: string) => {
      try {
        FS.mkdir(p);
      } catch {
        /* exists */
      }
    };
    mk("/libraries");
    mk("/libraries/BOSL2");
    mk("/Underware");
    for (const [p, data] of files) FS.writeFile(p, data);

    const args = [`/Underware/${req.scadFile}`, "-o", "/out.stl", "--export-format=binstl", "--backend=manifold"];
    for (const [k, v] of Object.entries(req.defines)) args.push("-D", `${k}=${scadLiteral(v)}`);

    let rc: number;
    try {
      rc = inst.callMain(args);
    } catch (err) {
      // Emscripten throws on exit(); a non-zero status lands here.
      rc = typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : 1;
      log.push(String(err));
    }
    let stl: Uint8Array | null = null;
    try {
      stl = FS.readFile("/out.stl", { encoding: "binary" });
    } catch {
      /* no output */
    }
    if (rc !== 0 || !stl || stl.byteLength <= 84) {
      reply({ id: req.id, ok: false, error: lastErrors(log) || `OpenSCAD exited with ${rc}`, ms: performance.now() - t0 });
      return;
    }
    const copy = stl.slice().buffer;
    reply({ id: req.id, ok: true, stl: copy, ms: performance.now() - t0, warnings: log.filter((l) => /WARNING/.test(l)).slice(0, 5) }, [copy]);
  } catch (err) {
    reply({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), ms: 0 });
  }
};

function lastErrors(log: string[]) {
  return log.filter((l) => /ERROR|Assertion|failed/i.test(l)).slice(-3).join("\n");
}
