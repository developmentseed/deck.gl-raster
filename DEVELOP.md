# Developer documentation

This is a monorepo managed with pnpm workspaces.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

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

Publishing happens automatically when you push a new tag to the `main` branch with format `v*`.

You must be part of the "release" environment in the repository settings to publish a new version.
