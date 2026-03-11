# Developer documentation

This is a monorepo managed with pnpm workspaces.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode for development
pnpm build:watch

# Run tests in all packages
pnpm test

# Run tests in watch mode (in a specific package)
cd packages/deck.gl-raster
pnpm test:watch

# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm typecheck
```


## Documentation

The docs site lives in `docs/` and is built with [Docusaurus](https://docusaurus.io/). API reference is auto-generated from source using TypeDoc.

```bash
# Start dev server (generates API docs, then starts Docusaurus)
pnpm docs

# Build for production
pnpm docs:build

# Preview the production build
pnpm docs:serve

# Regenerate API docs only (without starting the dev server)
pnpm docs:generate-api
```

Narrative docs (guides, getting started) live in `docs/guides/`.
API reference is generated into `docs/api/` (gitignored — regenerated on each build).

## Publishing

Publishing happens automatically when a new tag is pushed to the `main` branch with format `v*`.

You must be part of the "release" environment in the repository settings to publish a new version.

Generally, you shouldn't have to manually publish tags — we use [release-please](./.github/workflows/release-please.yml) to create release PRs, which create Github Releases (with tags) when they're merged.
