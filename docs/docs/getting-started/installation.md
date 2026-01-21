---
sidebar_position: 1
---

# Installation

## Prerequisites

Make sure you have the following peer dependencies installed:

- deck.gl 9.x
- luma.gl 9.x

## Installing Packages

Install the packages you need using your preferred package manager:

### For COG/GeoTIFF Visualization

```bash
npm install @developmentseed/deck.gl-geotiff
```

This package includes `@developmentseed/deck.gl-raster` and `@developmentseed/raster-reproject` as dependencies.

### For Zarr Visualization

```bash
npm install @developmentseed/deck.gl-zarr
```

### Core Package Only

If you're building custom raster layers:

```bash
npm install @developmentseed/deck.gl-raster
```

### Reprojection Utilities Only

For standalone reprojection mesh generation:

```bash
npm install @developmentseed/raster-reproject
```

## TypeScript Support

All packages include TypeScript type definitions. No additional `@types/*` packages are required.

## Bundler Configuration

These packages use ES modules. Most modern bundlers (Vite, esbuild, webpack 5+) should work out of the box.

If you're using webpack, ensure you have the appropriate loaders for GLSL shader files if you're customizing shaders.
