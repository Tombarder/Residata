/* MapLibre's tile worker — say where it is, or the map is a black rectangle.

   MapLibre 6 stopped inlining its worker. It now resolves one at RUNTIME, from a
   file it expects to find NEXT TO ITSELF:

     new URL("./maplibre-gl-worker.mjs", import.meta.url)

   A bundler cannot see that. Vite emits the maplibre chunk and nothing else, the
   URL resolves to /assets/maplibre-gl-worker.mjs, our SPA rewrite answers every
   unknown path with index.html, and `new Worker(htmlDocument, {type:"module"})`
   fails the way a module worker fails: silently. No exception, no console error,
   no CSP report.

   What that looks like is not a broken map. The map mounts, the canvas gets its
   real size, the zoom controls and the attribution draw, the sprite and the
   glyphs load (those are main-thread fetches). Only the part that lives in the
   worker — parsing vector tiles — never happens, so no tile is ever requested
   and the only thing painted is the style's background layer. In the dark
   basemap that colour is rgb(14,13,12). Boss got a black rectangle with working
   buttons on it, on both map pages, and nothing anywhere said why.

   `setWorkerUrl` is MapLibre's supported answer, and `?url` is how Vite is told
   to emit a file it would otherwise never notice and to hand back the hashed
   path it emitted it to. Importing this module for its side effect, before any
   Map is constructed, is the whole fix.

   🔴 Two things must stay true or this silently stops working again:
   - `worker-src` in vercel.json must allow 'self'. The URL below is same-origin,
     and MapLibre only wraps a worker in a blob: shim when it is CROSS-origin, so
     a blob:-only policy blocks exactly this one. Both halves ship together.
   - every module that constructs a maplibregl.Map must import this one.
     src/lib/maplibreWorker.test.mjs fails if a new map page forgets. */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(workerUrl);

export { workerUrl };
