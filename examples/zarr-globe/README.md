# ZarrLayer Globe Example

Animates the ECMWF AIFS Single 2 m temperature forecast, a global 0.25° Zarr
store from [dynamical.org](https://dynamical.org), on a 3D globe using
MapLibre's `projection="globe"` with deck.gl interleaved rendering. It is the
[`dynamical-zarr-ecmwf`](../dynamical-zarr-ecmwf/) example on a globe, with
ECMWF's deterministic AIFS forecast instead of the IFS ensemble: each AIFS
chunk covers 60° x 60°, so the whole globe loads in 18 requests.

```bash
pnpm install
pnpm build
cd examples/zarr-globe
pnpm dev
```
