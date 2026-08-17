import { defineConfig } from "vite";

export default defineConfig({
  // A GitHub Pages project site is served from /<repo>/, not from the domain
  // root. The deploy workflow passes the prefix in; everything under public/ is
  // fetched through `asset()`, which reads it back out of import.meta.env.
  base: process.env.BASE_PATH || "/",
  // Default port, unless the environment asks for another — which lets a second
  // dev server run alongside the first without treading on it.
  server: { port: Number(process.env.PORT) || 5173 },
  // Addons under three/addons import the bare "three" specifier. Without
  // deduping, Vite's dependency optimiser can hand the app and the addons two
  // separate copies of the library.
  resolve: { dedupe: ["three"] },
  optimizeDeps: { include: ["three", "three/addons/utils/BufferGeometryUtils.js"] },
});
