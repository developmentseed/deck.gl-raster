# Developer documentation

This is a monorepo managed with pnpm workspaces.

## Package setup

Some packages (e.g. `morecantile`, `geozarr`) reference files from git submodules.
Initialize them before building.

```bash
# Initialize git submodules (required for the build)
git submodule update --init --recursive

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode for development
pnpm build:watch
```

## Package Testing

```bash
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

## Publishing

Publishing happens automatically when a new tag is pushed to the `main` branch with format `v*`.

You must be part of the "release" environment in the repository settings to publish a new version.

To make a release, open a PR that bumps `version` in the root `package.json` and in every `packages/*/package.json`, and adds the release to `CHANGELOG.md` (for example [#666](https://github.com/developmentseed/deck.gl-raster/pull/666)). Once it's merged, tag the merge commit `vX.Y.Z` and push the tag.
