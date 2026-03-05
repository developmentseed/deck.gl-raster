## Type generation

We use `json-schema-to-typescript` to generate TypeScript types from the original TMS JSON Schema source located. The original source is in `/spec/schemas/tms/2.0/json/`, and the generated files are in `src/types/spec/`.

Use
```
pnpm generate-types
```

to regenerate the TypeScript types.
