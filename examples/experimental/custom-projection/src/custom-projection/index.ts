// Interim shim for upstream deck.gl's experimental custom projection support
// (visgl/deck.gl#10741). Delete this directory once deck.gl ships
// `_CustomProjectionView`; see ../../README.md.
export { CustomProjectionController } from "./custom-projection-controller.js";
export type {
  CustomProjectionViewProps,
  CustomProjectionViewState,
} from "./custom-projection-view.js";
export { CustomProjectionView } from "./custom-projection-view.js";
export type {
  CustomProjectionViewportOptions,
  FromBounds,
  ProjectionConverter,
} from "./custom-projection-viewport.js";
export {
  CustomProjectionViewport,
  NORMALIZATION_SCALE,
  pixelToWorld,
} from "./custom-projection-viewport.js";
