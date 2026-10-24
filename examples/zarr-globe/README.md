# ZarrLayer Globe Example

Animates the ECMWF IFS ENS 2 m temperature forecast, a global 0.25° Zarr store
from [dynamical.org](https://dynamical.org), on a 3D globe using MapLibre's
`projection="globe"` with deck.gl interleaved rendering. It is the
[`dynamical-zarr-ecmwf`](../dynamical-zarr-ecmwf/) example on a globe.

```bash
pnpm install
pnpm build
cd examples/zarr-globe
pnpm dev
```
