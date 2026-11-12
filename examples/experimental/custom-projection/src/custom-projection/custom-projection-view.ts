import type { OrthographicViewProps } from "@deck.gl/core";
import { OrthographicView } from "@deck.gl/core";
import type {
  CRSDescriptor,
  TypeScriptCRSInput,
} from "@math.gl/geospatial/projection/core";
import { CustomProjectionController } from "./custom-projection-controller.js";
import type { CustomProjectionViewportOptions } from "./custom-projection-viewport.js";
import { CustomProjectionViewport } from "./custom-projection-viewport.js";
import { resolveCRS } from "./resolve-crs.js";

/**
 * Props for {@link CustomProjectionView}. The projection options match
 * upstream deck.gl's `CustomProjectionViewProps` (v10.0.0-alpha.1).
 */
export type CustomProjectionViewProps = Omit<
  OrthographicViewProps,
  "flipY" | "near" | "far"
> & {
  /**
   * Planar target CRS: an EPSG code math.gl knows (such as `EPSG:3857`), a
   * PROJ string, WKT or PROJJSON.
   */
  crs: TypeScriptCRSInput;
  /** Subdivision intervals around the Earth, as upstream. Default `0`. */
  resolution?: number;
};

/**
 * View state for {@link CustomProjectionView}: upstream's `center` + `zoom`.
 * (`target` also appears in view states the controller emits; see
 * {@link CustomProjectionController}.)
 */
export type CustomProjectionViewState = {
  /** Camera center in WGS84 longitude/latitude, e.g. `[lng, lat, 0]`. */
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
 * (v10.0.0-alpha.1). Renders a planar map in the CRS given by `crs`, with a
 * top-down orthographic camera.
 *
 * Like upstream, the view resolves `crs` asynchronously with math.gl's
 * projection engine (see {@link resolveCRS}) and makes no viewport until it
 * has. deck.gl v10's `Deck` awaits {@link CustomProjectionView.initialize};
 * deck.gl 9.4 doesn't, so resolve the CRS before handing the view to deck.gl.
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

  // deck.gl's View seals its instances; private fields still work.
  #crs?: CRSDescriptor;
  #initialization?: Promise<void>;

  constructor(props: CustomProjectionViewProps) {
    super(props);
  }

  /** Resolve `crs`, once. Throws if it isn't a projected CRS. */
  initialize(): void | Promise<void> {
    if (this.#crs) {
      return;
    }
    if (this.#initialization) {
      return this.#initialization;
    }
    const resolved = resolveCRS(this.#crsInput());
    if (resolved instanceof Promise) {
      this.#initialization = resolved.then((crs) => this.#setCrs(crs));
      return this.#initialization;
    }
    this.#setCrs(resolved);
  }

  /**
   * The viewport for the current view state, or `null` until `crs` has
   * resolved.
   */
  override makeViewport({
    width,
    height,
    viewState,
  }: {
    width: number;
    height: number;
    viewState: Record<string, unknown>;
  }) {
    if (!this.#crs) {
      // deck.gl 9.4 never calls initialize(). Calling it here picks up a CRS
      // that resolveCRS has already loaded, or starts loading it once.
      void this.initialize();
    }
    const dimensions = this.getDimensions({ width, height });
    if (!this.#crs || !dimensions.width || !dimensions.height) {
      return null;
    }
    return new CustomProjectionViewport({
      ...this.filterViewState(viewState),
      ...this.props,
      ...dimensions,
      crs: this.#crs,
    } as CustomProjectionViewportOptions);
  }

  override getViewportType() {
    return CustomProjectionViewport;
  }

  override get ControllerType() {
    return CustomProjectionController;
  }

  #crsInput(): TypeScriptCRSInput {
    return (this.props as unknown as CustomProjectionViewProps).crs;
  }

  #setCrs(crs: CRSDescriptor): void {
    if (crs.coordinateFrame !== "projected") {
      throw new Error("CustomProjectionView requires a projected CRS");
    }
    this.#crs = crs;
  }
}
