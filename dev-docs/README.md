# dev-docs

Internal developer documentation for `deck.gl-raster`.

## Layout

**Top-level files** in this directory are *living* docs. They explain how the
codebase works _as it currently is_, and **must be kept up to date** alongside
the code they describe. If you change a system a top-level doc covers, update
the doc in the same change.

[`specs/`](specs/) contains _historical_ design documents committed at
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

## See also

- [`specs/README.md`](specs/README.md)
- [`ideas/README.md`](ideas/README.md)
