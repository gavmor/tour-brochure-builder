# Tour Brochure Builder

Interactive tour brochure authoring with Leaflet and OpenStreetMap.

## Local development

```
pnpm install
pnpm dev          # starts Vite dev server (http://localhost:5173)
pnpm build        # production build → dist/
pnpm preview      # preview the production build locally
pnpm typecheck    # run TypeScript type checking
pnpm lint         # run Biome linter
```

## Deployment

Pushes to `main` automatically deploy to GitHub Pages via the workflow in
`.github/workflows/deploy.yml`. The workflow:
1. Installs dependencies with `pnpm install --frozen-lockfile`
2. Runs `pnpm build` (includes typecheck)
3. Uploads `dist/` as a Pages artifact and deploys

The live site is at `https://<owner>.github.io/<repo-name>/`.

### Changing the base path

The Vite `base` config controls the URL prefix for all assets. It defaults to
`/tour-brochure-builder/` in `vite.config.ts`. To change it:

- **Edit the constant:** change `REPO_NAME` in `vite.config.ts`
- **Or set at build time:** `VITE_BASE=/my-other-path/ pnpm build`

### SPA fallback

GitHub Pages returns a 404 for deep-link URLs that don't match a real file.
A Vite plugin copies `index.html` to `404.html` at build time, so GitHub Pages
serves the app shell for any route, enabling client-side routing.

## Stack

- [Preact](https://preactjs.com/) — UI
- [Vite](https://vite.dev/) — build tool
- [Leaflet](https://leafletjs.com/) + OpenStreetMap — map rendering
- [Biome](https://biomejs.dev/) — linting
- pnpm — package manager
- GitHub Pages — hosting
