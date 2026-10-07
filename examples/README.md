# Examples

This folder contains runnable examples demonstrating `deck.gl-raster` features.

## Example intent

These examples are intended to show **how to use deck.gl-raster, specifically**. The interaction with deck.gl and API for using deck.gl-raster is carefully considered and is intended for learning/reuse.

The **UI design** is entirely LLM generated and should not be learned from.

## Experimental examples

[`experimental/`](experimental/) holds examples published to show what
`deck.gl-raster` makes possible, before their architecture has been reviewed and
endorsed. Unlike the examples above, they are **not** intended for learning or
reuse — they may change substantially or be withdrawn.

Each one passes `experimental` to `ControlPanel`, which badges it in the app,
and is listed in its own section on the docs examples page.

Their published URL deliberately omits the `experimental/` segment — an example
deploys to `/examples/<name>/` either way, so promoting one out of
`experimental/` is a pure `git mv` that breaks no links. Keep each example's
Vite `base` and `gh-pages` publish path free of the segment for that reason.

## Running an example

```sh
git clone https://github.com/developmentseed/deck.gl-raster
cd deck.gl-raster
pnpm install
cd examples/[example-of-choice]
pnpm dev
```

## Shared components

[`_shared/`](_shared/) is a private workspace package
(`deck.gl-raster-examples-shared`) of reusable React UI components built on
[Chakra UI](https://chakra-ui.com/). All examples use it: they list
`"deck.gl-raster-examples-shared": "workspace:*"` and import from the package
root, e.g.
`import { ControlPanel, DeckGlOverlay } from "deck.gl-raster-examples-shared"`.
