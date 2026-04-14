# Texture Row Alignment And luma.gl

> All luma.gl source references and line numbers in this doc point at
> [`visgl/luma.gl@v9.3.0`](https://github.com/visgl/luma.gl/tree/v9.3.0).

## TL;DR

**Do not pre-pad tile row data for `UNPACK_ALIGNMENT`.** Pass tightly packed
pixel buffers directly to [`device.createTexture`](https://luma.gl/docs/api-reference/core/resources/texture/)
with `{data, width, height, format}` and let luma.gl set the WebGL unpack
state. This is true for any format and any width, including single-band 8-bit
images with odd widths.

## How luma.gl computes row stride

When you call `device.createTexture({data, width, height, format})` without
passing an explicit `bytesPerRow`, luma.gl computes the texture's memory
layout from the target format and the texture's `byteAlignment`
([`@luma.gl/core` `texture.ts:559-607`](https://github.com/visgl/luma.gl/blob/v9.3.0/modules/core/src/adapter/resources/texture.ts#L559-L607)):

```ts
// @luma.gl/core texture.ts (_normalizeTextureWriteOptions)
const layout = textureFormatDecoder.computeMemoryLayout({
  format: this.format,
  width: options.width,
  height: options.height,
  depth: options.depthOrArrayLayers,
  byteAlignment: this.byteAlignment
});
options.bytesPerRow = optionsWithoutUndefined.bytesPerRow ?? layout.bytesPerRow;
```

The WebGL backend constructs every `WEBGLTexture` with `byteAlignment: 1`
([`@luma.gl/webgl` `webgl-texture.ts:85`](https://github.com/visgl/luma.gl/blob/v9.3.0/modules/webgl/src/adapter/resources/webgl-texture.ts#L85)):

```ts
// @luma.gl/webgl webgl-texture.ts
super(device, props, {byteAlignment: 1});
```

So the default, when you don't pass `bytesPerRow`, is **a packed
`width * bytesPerPixel` stride**.

That same `byteAlignment` is then used on every upload to set the WebGL
unpack state explicitly
([`webgl-texture.ts:324-349`](https://github.com/visgl/luma.gl/blob/v9.3.0/modules/webgl/src/adapter/resources/webgl-texture.ts#L324-L349)):

```ts
// @luma.gl/webgl webgl-texture.ts (writeData)
const unpackRowLength = bytesPerPixel ? options.bytesPerRow / bytesPerPixel : undefined;
const glParameters = {
  [GL.UNPACK_ALIGNMENT]: this.byteAlignment,       // = 1
  ...(unpackRowLength !== undefined
    ? {[GL.UNPACK_ROW_LENGTH]: unpackRowLength}    // = width
    : {}),
  [GL.UNPACK_IMAGE_HEIGHT]: options.rowsPerImage
};
```

Net effect: WebGL is told that rows are packed with no padding and to advance
exactly `width` pixels per row, for every upload, regardless of whether
`width * bytesPerPixel` is divisible by 4. See the
[OpenGL ES `glPixelStorei` reference](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glPixelStorei.xhtml)
for what `UNPACK_ALIGNMENT` / `UNPACK_ROW_LENGTH` actually do.

## What this means for us

- **Pass unpadded row data.** For an `M × N` `r8unorm` texture, pass
  `M × N` bytes. For `M × N` `rgba8unorm`, pass `M × N × 4` bytes.
- **Do not call any `padToAlignment` / `enforceAlignment` helper** before
  `createTexture`. Any pre-padded buffer you hand to luma.gl will be
  misinterpreted unless you also pass an explicit `bytesPerRow` that matches
  the padded stride.
- **Do not rely on WebGL's historical `UNPACK_ALIGNMENT = 4` default.**
  luma.gl overrides it on every write.

## How we ended up with warped edge tiles on deck.gl/luma.gl 9.3

See [developmentseed/deck.gl-raster#416](https://github.com/developmentseed/deck.gl-raster/issues/416)
for the original bug report against the `cog-basic` example's Anderson Co.
imagery.

Prior to luma.gl
[PR #2461](https://github.com/visgl/luma.gl/pull/2461), `writeData` never
touched `UNPACK_ALIGNMENT` and never set `UNPACK_ROW_LENGTH` when
`bytesPerRow` was undefined. WebGL then fell back to its default
`UNPACK_ALIGNMENT = 4`, which happened to match the 4-byte padding that
`padToAlignment` was applying in
[`packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts`](../packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts).
Both sides shared the same "4-byte aligned rows" assumption and it worked by
accident.

After PR #2461:

- luma.gl tells WebGL `UNPACK_ALIGNMENT = 1` and `UNPACK_ROW_LENGTH = width`.
- Our pre-padded buffers still had 4-byte aligned row strides.
- WebGL read `width` pixels per row but advanced by `width` bytes per row
  instead of the padded `Math.ceil(width * bytesPerPixel / 4) * 4`, so every
  row after the first was shifted by `paddedStride - width * bytesPerPixel`
  bytes.

This only visibly breaks when `width * bytesPerPixel` is not a multiple of 4,
which requires both a narrow/odd width and a small `bytesPerPixel`. Typical
trigger:

- 1-band 8-bit grayscale (`bytesPerPixel = 1`), any odd-width edge tile.
- 16-bit single-band (`bytesPerPixel = 2`), odd width.

3-band RGB gets implicit-alpha padding to `bytesPerPixel = 4` before it
reaches luma.gl, so it's always aligned and was never affected.

The
[Anderson Co. Ortho Pan 2ft (2000) COG](https://data.source.coop/giswqs/tn-imagery/imagery/AndersonCo_OrthoPan_2ft_2000.tif)
hit every unlucky condition: 1-band uint8, 512-px internal block size, and
overview widths (2625, 1313, 657, 329, …) that generate right-edge tiles of
width 65, 289, 145, 329 — none of which are divisible by 4.

## Caveats

- **You may still pass `bytesPerRow` explicitly** if you have a reason to
  pre-pad the buffer (e.g. reusing a pooled allocation or matching some other
  constraint). In that case luma.gl will honor the stride you give it. We
  just don't have a reason to do that here.
- **WebGPU has its own alignment rules.** WebGPU requires `bytesPerRow` to be
  a multiple of 256 for image copies
  ([`GPUImageCopyBuffer.bytesPerRow`](https://www.w3.org/TR/webgpu/#dom-gpuimagecopybuffer-bytesperrow));
  luma.gl handles this internally on the WebGPU backend but the requirement
  is stricter than WebGL's. If we ever write directly to
  `CopyExternalImage` / `writeBuffer` we should revisit this.
- **Do not re-introduce `UNPACK_ALIGNMENT = 4` assumptions** in deck.gl-raster
  or downstream caller code. If a future regression makes it tempting to add
  padding back, the right fix is to also pass an explicit `bytesPerRow` to
  `createTexture`, not to silently mutate the GL unpack state.

## References

- luma.gl [PR #2461](https://github.com/visgl/luma.gl/pull/2461) —
  `fix(webgl): unpack row length handling for texture uploads` (shipped in
  [`v9.2.4`](https://github.com/visgl/luma.gl/releases/tag/v9.2.4) /
  [`v9.2.5`](https://github.com/visgl/luma.gl/releases/tag/v9.2.5) /
  [`v9.3.0`](https://github.com/visgl/luma.gl/releases/tag/v9.3.0)).
- [`@luma.gl/webgl` `webgl-texture.ts:85`](https://github.com/visgl/luma.gl/blob/v9.3.0/modules/webgl/src/adapter/resources/webgl-texture.ts#L85)
  — hardcoded `byteAlignment: 1` on WebGL textures.
- [`@luma.gl/webgl` `webgl-texture.ts:343-349`](https://github.com/visgl/luma.gl/blob/v9.3.0/modules/webgl/src/adapter/resources/webgl-texture.ts#L343-L349)
  — explicit `UNPACK_ALIGNMENT = this.byteAlignment` in `writeData`.
- [`@luma.gl/core` `texture.ts:585`](https://github.com/visgl/luma.gl/blob/v9.3.0/modules/core/src/adapter/resources/texture.ts#L585)
  — default `bytesPerRow = layout.bytesPerRow`.
- [`boundless-tiles.md`](./boundless-tiles.md) — related guidance on why
  `COGLayer` / `MultiCOGLayer` fetch tiles with `boundless: true`, which is
  what avoids the clipped-edge-tile shape that triggered this bug.
- [developmentseed/deck.gl-raster#411](https://github.com/developmentseed/deck.gl-raster/pull/411)
  — earlier `MultiCOGLayer` edge-tile fix that switched that layer to
  `boundless: true`.
- [developmentseed/deck.gl-raster#289](https://github.com/developmentseed/deck.gl-raster/pull/289)
  / [#237](https://github.com/developmentseed/deck.gl-raster/issues/237) —
  prior edge-tile rendering history for `COGLayer`.
