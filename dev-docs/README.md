# dev-docs

Internal developer documentation for `deck.gl-raster`. Primary
audience: contributors and future maintainers, including future-you.

## Layout

**Top-level files** in this directory are *living* docs — they explain
how the codebase works as it currently is, and are expected to be kept
up to date alongside the code they describe. If you change a system a
top-level doc covers, update the doc in the same change. Examples:
[`zoom-terminology.md`](zoom-terminology.md),
[`lod-and-pixel-matching.md`](lod-and-pixel-matching.md),
[`gpu-modules.md`](gpu-modules.md),
[`texture-alignment.md`](texture-alignment.md),
[`boundless-tiles.md`](boundless-tiles.md).

[`specs/`](specs/) contains *historical* design documents committed at
the time a non-trivial change was being designed. They preserve the
problem framing, goals, non-goals, and design decisions that shaped
the implementation. Specs are **not** kept in sync with the code as it
evolves — they're read as artifacts of the moment they were written.
If a system changes substantially after its spec was written, capture
the new state in a top-level living doc rather than rewriting the
spec.

[`ideas/`](ideas/) holds design proposals that have been considered
but deferred. Read-only context until promoted into a spec.

[`plans/`](plans/) is gitignored. Ephemeral, implementation-level
task lists that translate a spec into executable steps.

## When to write what

- Changing how the code behaves and want others to understand it
  later → top-level living doc.
- Designing a non-trivial change before writing code → spec.
- Capturing an idea you don't have time to act on → idea.
- Breaking a spec down into bite-sized tasks for execution → plan.

## See also

- [`specs/README.md`](specs/README.md)
- [`ideas/README.md`](ideas/README.md)
