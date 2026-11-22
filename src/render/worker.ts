/// <reference lib="webworker" />
// Renders one SCAD file to a binary STL with OpenSCAD compiled to WASM.
// Runs off the main thread because a render takes 5 to 30 seconds.

import { createOpenSCAD } from "openscad-wasm-prebuilt";
import { scadLiteral, type RenderRequest, type RenderResponse } from "./types";

interface Manifest {
  /** Fetched from <scadBase><src>/<file>, written to <mount>/<file>. */
  dirs: { src: string; mount: string; files: string[] }[];
}

// openscad-wasm-prebuilt 1.2.0 is built with a ~128 KB stack. Deeply nested
// SCADs (BOSL2 attachments inside several modules, e.g. every Monokini
// channel) overflow it, which silently corrupts memory and surfaces as
// random "null function", "table index is out of bounds" or similar
// errors. After startup we allocate a bigger block from the heap and point
// the stack pointer at its top, so the stack grows down inside that block.
// The export names below are the minified ones in that exact build
// (package.json pins it): "cc" is emscripten_builtin_memalign and "fc" is
// _emscripten_stack_restore.
const STACK_BYTES = 8 * 1024 * 1024;

async function createWithBigStack(opts: { print(s: string): void; printErr(s: string): void }) {
  let exportsSeen: Record<string, unknown> | null = null;
  const original = WebAssembly.instantiate;
  // Capture the instance's exports as the library instantiates it.
  (WebAssembly as { instantiate: unknown }).instantiate = async (...args: Parameters<typeof WebAssembly.instantiate>) => {
    const r = (await (original as (...a: unknown[]) => Promise<unknown>)(...args)) as WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance;
    exportsSeen = ("instance" in r ? r.instance : r).exports as Record<string, unknown>;
    return r;
  };
  let inst;
  try {
    inst = (await createOpenSCAD(opts)).getInstance();
  } finally {
    WebAssembly.instantiate = original;
  }
  const ex = exportsSeen as Record<string, unknown> | null;
  const memalign = ex?.cc as ((align: number, size: number) => number) | undefined;
  const stackRestore = ex?.fc as ((sp: number) => void) | undefined;
  if (typeof memalign !== "function" || typeof stackRestore !== "function") {
    throw new Error("Unexpected OpenSCAD build: can't enlarge its stack (check the openscad-wasm-prebuilt version).");
  }
  const base = memalign(16, STACK_BYTES);
  if (!base) throw new Error("Couldn't allocate the OpenSCAD stack.");
  stackRestore(base + STACK_BYTES);
  return inst;
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
    await Promise.all(
      manifest.dirs.flatMap((d) => d.files.map(async (f) => files.set(`${d.mount}/${f}`, await get(`${d.src}/${f}`)))),
    );
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
    const inst = await createWithBigStack({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const FS = inst.FS;
    const mk = (p: string) => {
      try {
        FS.mkdir(p);
      } catch {
        /* exists */
      }
    };
    for (const [p, data] of files) {
      const parts = p.split("/").slice(1, -1);
      for (let i = 1; i <= parts.length; i++) mk("/" + parts.slice(0, i).join("/"));
      FS.writeFile(p, data);
    }

    const args = [req.scadPath, "-o", "/out.stl", "--export-format=binstl", "--backend=manifold"];
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
  if (log.some((l) => /RuntimeError|is not a function|signature mismatch/.test(l))) {
    return "OpenSCAD crashed on this part in the browser (a WASM limitation, not a problem with your layout). Try another mounting option for it.";
  }
  return log.filter((l) => /ERROR|Assertion|failed/i.test(l)).slice(-3).join("\n");
}
