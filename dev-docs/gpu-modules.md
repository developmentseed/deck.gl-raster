# GPU Modules (luma.gl ShaderModule) Guide

## Key Rules for Uniform Binding

luma.gl's `ShaderModule` system has two distinct paths for binding values to shaders. Getting these wrong results in uniforms silently defaulting to 0.

### Scalar Uniforms (numbers, vectors, matrices)

Scalar uniforms **must** use all three of:

1. **`fs:`** — A uniform block declaration string
2. **`uniformTypes:`** — A mapping of uniform names to type strings
3. **`getUniforms:`** — Returns the values keyed by uniform name

The uniform block name must follow the pattern `<moduleName>Uniforms` and the instance name must match the module's `name` field. Access uniforms in GLSL as `<moduleName>.<uniformName>`.

```ts
const MODULE_NAME = "myModule";

export const MyModule = {
  name: MODULE_NAME,
  fs: `\
uniform ${MODULE_NAME}Uniforms {
  float myValue;
  vec4 myVector;
} ${MODULE_NAME};
`,
  uniformTypes: {
    myValue: "f32",
    myVector: "vec4<f32>",
  },
  inject: {
    "fs:DECKGL_FILTER_COLOR": `
      color.rgb *= ${MODULE_NAME}.myValue;
    `,
  },
  getUniforms: (props) => ({
    myValue: props.myValue ?? 1.0,
    myVector: props.myVector ?? [0, 0, 0, 0],
  }),
};
```

**Without `uniformTypes` and the `fs:` uniform block, scalar uniforms will silently be 0.**

### Texture Bindings (sampler2D)

Texture bindings use a different path:

1. **`inject["fs:#decl"]:`** — Declare `uniform sampler2D <name>;`
2. **`getUniforms:`** — Return the texture object keyed by the **same name** as the GLSL uniform

Textures do NOT use `uniformTypes` or `fs:` uniform blocks.

```ts
export const MyTextureModule = {
  name: "myTexture",
  inject: {
    "fs:#decl": `uniform sampler2D myTex;`,
    "fs:DECKGL_FILTER_COLOR": `
      color = texture(myTex, geometry.uv);
    `,
  },
  getUniforms: (props) => ({
    myTex: props.myTex,  // must match the GLSL uniform name exactly
  }),
};
```

**The prop key, `getUniforms` return key, and GLSL uniform name must all be identical.**

### Mixing Textures and Scalars

A single module can use both paths. Textures go through `inject` + `getUniforms`; scalars go through `fs:` uniform block + `uniformTypes` + `getUniforms`. The `getUniforms` function returns both textures and scalars together.

See `CompositeBands` for a working example of this pattern.

## How Props Flow

1. `MeshTextureLayer.draw()` calls `model.shaderInputs.setProps({ [moduleName]: moduleProps })`
2. luma.gl calls `module.getUniforms(moduleProps)` to get the combined uniforms + bindings
3. Scalar values are matched against `uniformTypes` and written to the uniform buffer
4. Texture values are matched by name against `uniform sampler2D` declarations and bound to texture units

## Common Pitfalls

- **Uniform is always 0**: Missing `uniformTypes` or `fs:` uniform block declaration
- **Texture not bound / "Binding not found"**: Prop key doesn't match GLSL uniform name, or texture declared in uniform block instead of `inject`
- **All textures sample the same value**: Textures declared but not actually bound — check that `getUniforms` returns them with matching keys

## Existing Module Patterns

| Module | Textures | Scalars | Pattern |
|--------|----------|---------|---------|
| `CreateTexture` | 1 (`textureName`) | none | inject only |
| `MaskTexture` | 1 (`maskTexture`) | none | inject only |
| `FilterNoDataVal` | none | 1 (`value`) | fs + uniformTypes |
| `LinearRescale` | none | 2 (`rescaleMin`, `rescaleMax`) | fs + uniformTypes |
| `CompositeBands` | 4 (`band0`–`band3`) | 5 (`uvTransform0`–`3`, `channelMap`) | both |
| `CutlineBbox` | none | 1 (`bbox`) | fs + uniformTypes, VS + FS `#main-start` injection, pass-through `getUniforms` |

## Injection Hooks: Where Your Code Ends Up

luma.gl has **two distinct injection mechanisms** and mixing them up produces "undeclared identifier" errors that are hard to diagnose. When you pick an `inject` key, you are choosing which mechanism is used.

### Mechanism 1 — Shader hook functions (`fs:DECKGL_FILTER_COLOR`, etc.)

Hook functions are **separate GLSL functions** that luma.gl generates from the hook name. Your injected code becomes the *body* of that function:

```glsl
// luma.gl generates this at assembly time:
void DECKGL_FILTER_COLOR(inout vec4 color, FragmentGeometry geometry) {
  // ← your injected code goes here
}
```

The key thing to understand: the hook function is assembled *before* the vendored main shader source. That means:

- ✅ **Top-level uniforms** are visible (they're declared earlier in the assembled shader).
- ✅ **Function parameters** (`color`, `geometry`) are visible.
- ❌ **Top-level `in` varyings** declared in the main FS source (`position_commonspace`, `vTexCoord`, `cameraPosition`, etc.) are *not yet declared* at the point the hook function is compiled — trying to reference them produces `ERROR: 'position_commonspace' : undeclared identifier`.
- ❌ **Fields not present on `FragmentGeometry`** are not accessible. The FS-side `FragmentGeometry` struct in this codebase only carries `vec2 uv`. It does **not** have `.position`, `.worldPosition`, etc. — those fields only exist on the vertex-side `Geometry` struct used by the VS.

Hook-function hooks are the right choice when:
- You only need `color`, `geometry.uv`, or a top-level uniform.
- You want your code to run in well-defined pipeline order relative to other modules (luma.gl concatenates injections for the same hook in registration order).

`FilterNoDataVal` and `MaskTexture` use `fs:DECKGL_FILTER_COLOR` because they only need `color` and `geometry.uv`.

### Mechanism 2 — Source injections (`fs:#main-start`, `fs:#main-end`, `fs:#decl`, and VS equivalents)

Source injections are **text substitutions against the main shader source** — no hook function is generated. The injected string is spliced directly into the main FS source at one of these points:

- `fs:#decl` → before `main()`, after varying declarations. Use for adding `uniform`, top-level helper functions, `in` varyings.
- `fs:#main-start` → the first line of the `main()` body. Has access to all top-level FS varyings.
- `fs:#main-end` → the last line of the `main()` body. Too late for `discard` to affect color in most cases, since color has usually already been written.

Because the code is spliced into main() itself, **top-level FS varyings are in scope** there. This is the escape hatch for modules that need varying data (like `position_commonspace`) which hook functions can't see.

**Tradeoff:** source injections are not ordered relative to hook-function injections from other modules. If the test needs to happen after another module's color computation, prefer `fs:DECKGL_FILTER_COLOR`. If it needs varying access, you are forced to `fs:#main-start`.

### Worked example — why `CutlineBbox` uses VS injection + `fs:#main-start`

`CutlineBbox` needs to compare each fragment's mercator-meter position against a bbox and `discard`. A first attempt tried to read the existing `position_commonspace` varying inside `fs:DECKGL_FILTER_COLOR`, which failed with `ERROR: 'position_commonspace' : undeclared identifier` for the reasons explained above. Moving the injection to `fs:#main-start` fixed the compile error, but then produced a second bug at higher zoom levels: deck.gl applies a **viewport-dependent precision translation** to common-space positions (it rebases to the current viewport anchor to keep f32 math precise), so an uniform computed absolutely on the CPU ends up in a different coordinate frame than `position_commonspace` after zoom-in, and the test starts discarding every fragment.

The robust fix is to sidestep common space entirely. The layer's mesh `positions` attribute is already in raw EPSG:3857 meters (by CPU-side construction in `RasterLayer._generateMesh`), so we capture it directly in the vertex shader and pass it through a module-owned varying to the fragment shader. The FS then compares against a uniform also in raw 3857 meters. No deck.gl common-space math, no viewport-dependent rebasing, consistent at every zoom level.

```ts
inject: {
  "vs:#decl": `out vec2 v_cutlineBboxMercator;`,
  "vs:#main-start": /* glsl */ `
    v_cutlineBboxMercator = positions.xy;
  `,
  "fs:#decl": `in vec2 v_cutlineBboxMercator;`,
  "fs:#main-start": /* glsl */ `
    {
      if (v_cutlineBboxMercator.x < ${MODULE_NAME}.bbox.x ||
          v_cutlineBboxMercator.x > ${MODULE_NAME}.bbox.z ||
          v_cutlineBboxMercator.y < ${MODULE_NAME}.bbox.y ||
          v_cutlineBboxMercator.y > ${MODULE_NAME}.bbox.w) {
        discard;
      }
    }
  `,
},
```

The module-name prefix on the varying (`v_cutlineBboxMercator`) avoids collisions with other modules. The `{ ... }` block scope on the FS inject is defense-in-depth against local-variable collisions if anything else ever injects at the same hook.

**Tradeoffs to be aware of:**

- This module now assumes `positions.xy` is in EPSG:3857 meters. That's true for `COGLayer` / `RasterLayer`'s mercator rendering path but not for arbitrary layers — the assumption should be documented in the module's JSDoc.
- Float32 precision at |10M| mercator values gives ~1.2m quantization, so the bbox edge starts quantizing to roughly one pixel at z=17 and becomes visibly "wiggly" at z=18+. The interior of the bbox stays correct; only the edges quantize. For use cases that need sharp edges at z=18+, the fix is to emit a `POSITION64LOW` attribute alongside `POSITION` and do two-float arithmetic in both the VS injection and the uniform.

### Diagnosing `undeclared identifier` errors

If a shader module compiles but fails at runtime with `ERROR: '<some varying>' : undeclared identifier` at the line of your injected code, the cause is almost certainly:

1. You are injecting at `fs:DECKGL_FILTER_COLOR` (or another hook-function hook).
2. You are referencing a top-level FS varying that hook functions cannot see.

**Fix:** move the injection to `fs:#main-start`. If you need the test to run after another module has computed color, pipe the data through `geometry` instead (by adding a field to `FragmentGeometry` via a `fs:#decl` struct redeclaration — out of scope here) or do the test in two stages.

### Hook reference cheat sheet

| Hook | Mechanism | Sees top-level varyings? | Sees `geometry` / `color`? | Typical use |
|------|-----------|--------------------------|----------------------------|-------------|
| `fs:#decl` | source | — (declares them) | — | Declare `uniform sampler2D`, helper funcs, new varyings |
| `fs:#main-start` | source | ✅ | ⚠️ `geometry.uv` not yet set — avoid |
| `fs:#main-end` | source | ✅ | ✅ | After color is final — too late to `discard` meaningfully |
| `fs:DECKGL_FILTER_COLOR` | hook function | ❌ | ✅ | Color processing, sampling via `geometry.uv` |
| `vs:#decl` | source | — | — | Declare out varyings, helpers |
| `vs:#main-end` | source | ✅ (in attrs) | — | Write to `out` varyings after `gl_Position` is set |
