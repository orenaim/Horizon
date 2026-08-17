/**
 * Resolves a baked asset against the site's base path.
 *
 * Everything under `public/` is fetched at runtime by absolute path, which is
 * correct when the site is served from a domain root and wrong the moment it is
 * not — a GitHub Pages project site lives at `/<repo>/`, where `/terrain/…`
 * resolves to the domain root and 404s. Vite fills `BASE_URL` in from its
 * `base` option, which the deploy workflow sets from the repository name, so
 * the same build works at a root or under a prefix.
 */
export const asset = (path) => `${import.meta.env.BASE_URL}${String(path).replace(/^\/+/, "")}`;
