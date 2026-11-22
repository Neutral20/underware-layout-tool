// A small pool of OpenSCAD workers. Each render holds a few hundred MB, so
// the pool stays small.

import type { RenderRequest, RenderResponse } from "./types";

type Pending = { resolve(r: RenderResponse): void; onStart?: () => void };

export class RenderPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { req: RenderRequest; p: Pending }[] = [];
  private pending = new Map<number, { p: Pending; w: Worker }>();
  private nextId = 1;

  constructor(size = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<RenderResponse>) => this.done(w, e.data);
      w.onerror = (e) => {
        // An uncaught worker error fails its current job; the worker stays in the pool
        // because each job builds a fresh OpenSCAD instance.
        const entry = [...this.pending.entries()].find(([, v]) => v.w === w);
        if (entry) this.done(w, { id: entry[0], ok: false, error: e.message || "Renderer crashed (out of memory?)", ms: 0 });
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get size() {
    return this.workers.length;
  }

  /** Queue a render. onStart fires when a worker picks it up. */
  render(req: Omit<RenderRequest, "id">, onStart?: () => void): Promise<RenderResponse> {
    return new Promise((resolve) => {
      this.queue.push({ req: { ...req, id: this.nextId++ }, p: { resolve, onStart } });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { req, p } = this.queue.shift()!;
      this.pending.set(req.id, { p, w });
      p.onStart?.();
      w.postMessage(req);
    }
  }

  private done(w: Worker, r: RenderResponse) {
    const entry = this.pending.get(r.id);
    if (!entry) return;
    this.pending.delete(r.id);
    this.idle.push(w);
    entry.p.resolve(r);
    this.pump();
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const { p } of this.queue) p.resolve({ id: 0, ok: false, error: "Cancelled", ms: 0 });
    for (const [id, { p }] of this.pending) p.resolve({ id, ok: false, error: "Cancelled", ms: 0 });
    this.queue = [];
    this.pending.clear();
  }
}
