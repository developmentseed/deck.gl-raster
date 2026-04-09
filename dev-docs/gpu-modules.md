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
