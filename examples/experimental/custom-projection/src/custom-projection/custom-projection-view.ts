import type { OrthographicViewProps } from "@deck.gl/core";
import { OrthographicView } from "@deck.gl/core";
import { CustomProjectionController } from "./custom-projection-controller.js";
import type {
  FromBounds,
  ProjectionConverter,
} from "./custom-projection-viewport.js";
import { CustomProjectionViewport } from "./custom-projection-viewport.js";

/**
 * Props for {@link CustomProjectionView}. The projection options match
 * upstream deck.gl's `CustomProjectionViewProps`.
 */
export type CustomProjectionViewProps = Omit<
  OrthographicViewProps,
  "flipY" | "near" | "far"
> & {
  /** `{forward, inverse}` conversion functions, e.g. a proj4 converter. */
  projection: ProjectionConverter;
  /** CRS name or PROJ string describing world coordinates. Default `"WGS84"`. */
  fromCrs?: string;
  /** Planar, meter-based map CRS name or PROJ string. */
  toCrs?: string;
  /** The projection's valid domain, `[minX, minY, maxX, maxY]` in `fromCrs`. */
  fromBounds?: FromBounds;
  /** Accepted for API parity with upstream; unused by the shim. */
  resolution?: number;
};

/**
 * View state for {@link CustomProjectionView}: upstream's `center` + `zoom`.
 * (`target` also appears in view states the controller emits; see
 * {@link CustomProjectionController}.)
 */
export type CustomProjectionViewState = {
  /** Camera center in world coordinates (`fromCrs`), e.g. `[lng, lat, 0]`. */
  center?: number[];
  /** Zoom level; each increment doubles the scale. Matches `MapView` zoom. */
  zoom?: number;
  /** Minimum zoom. */
  minZoom?: number;
  /** Maximum zoom. */
  maxZoom?: number;
};

/**
 * Interim stand-in for upstream deck.gl's experimental `_CustomProjectionView`
 * (visgl/deck.gl#10741, merged after deck.gl 9.4.0). Renders a planar map in
 * the CRS produced by an application-supplied `projection`, with a top-down
 * orthographic camera.
 *
 * Once deck.gl ships `_CustomProjectionView`, replace
 *
 * ```ts
 * import { CustomProjectionView } from "./custom-projection";
 * ```
 *
 * with
 *
 * ```ts
 * import { _CustomProjectionView as CustomProjectionView } from "@deck.gl/core";
 * ```
 *
 * See {@link CustomProjectionViewport} for the behavioral differences.
 */
export class CustomProjectionView extends OrthographicView {
  static override displayName = "CustomProjectionView";

  constructor(props: CustomProjectionViewProps) {
    super(props);
  }

  override getViewportType() {
    return CustomProjectionViewport;
  }

  override get ControllerType() {
    return CustomProjectionController;
  }
}
