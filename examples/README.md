# Examples

This folder contains runnable examples demonstrating `deck.gl-raster` features.

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
[Chakra UI](https://chakra-ui.com/). Examples that adopt it list
`"deck.gl-raster-examples-shared": "workspace:*"` and import from the package
root.
