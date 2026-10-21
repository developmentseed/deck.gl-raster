import type { ControllerProps, ViewStateChangeParameters } from "@deck.gl/core";
import { LinearInterpolator, OrthographicController } from "@deck.gl/core";
import type { CustomProjectionViewport } from "./custom-projection-viewport.js";

type ControllerOptions = ConstructorParameters<
  typeof OrthographicController
>[0];

/** Arrow-key pan step in pixels, as in `MapController` and upstream. */
const KEYBOARD_PAN_SPEED = 100;

/**
 * Interim stand-in for upstream deck.gl's experimental
 * `_CustomProjectionController`: pan and zoom over the projected map plane.
 *
 * It wraps `OrthographicController`, translating between the upstream-style
 * view state (`center` in `fromCrs`, e.g. `[lng, lat]`) and the orthographic
 * controller's `target` (map meters):
 *
 * - Incoming view states that carry `center` but no `target` get a `target`
 *   computed from `center`. When both are present, `target` wins — it is what
 *   the controller itself wrote, and it stays valid when the map center lies
 *   outside the projection's invertible area.
 * - Outgoing view states (interaction and transitions) get `center` derived
 *   from `target`, omitted when the inverse projection is undefined there,
 *   and lose the orthographic controller's internal `zoomX` / `zoomY`.
 *
 * To move the camera programmatically, pass a fresh `{center, zoom}` without
 * `target`. A transition interpolator over `center` (upstream's default) is
 * swapped for one over `target`. Arrow keys pan the camera like `MapView`.
 * Pitch and bearing are not supported.
 */
export class CustomProjectionController extends OrthographicController {
  constructor(opts: ControllerOptions) {
    super(opts);
    // Both interaction (`updateViewport`) and transitions (`_onTransition`)
    // report through this callback, so wrapping it covers every outgoing
    // view state.
    const notify = this.onViewStateChange;
    this.onViewStateChange = (params: ViewStateChangeParameters) =>
      notify({ ...params, viewState: this.withCenter(params.viewState) });

    // The orthographic controller's arrow keys slide the map content toward
    // the arrow by 50 px; MapView and upstream move the camera by 100 px.
    // Every state the controller creates comes from `new this.constructor`
    // or `this.ControllerState`, so the subclass sticks.
    const Base = this.ControllerState;
    type State = InstanceType<typeof Base>;
    type Context = Parameters<State["moveLeft"]>[1];
    this.ControllerState = class extends Base {
      override moveLeft(speed = KEYBOARD_PAN_SPEED, context?: Context) {
        return super.moveRight(speed, context);
      }
      override moveRight(speed = KEYBOARD_PAN_SPEED, context?: Context) {
        return super.moveLeft(speed, context);
      }
      override moveUp(speed = KEYBOARD_PAN_SPEED, context?: Context) {
        return super.moveDown(speed, context);
      }
      override moveDown(speed = KEYBOARD_PAN_SPEED, context?: Context) {
        return super.moveUp(speed, context);
      }
    };
  }

  override setProps(props: ControllerProps & Record<string, any>): void {
    super.setProps(this.withTargetTransition(this.withTarget(props)));
  }

  /**
   * Swap an interpolator that requires `center` for one over `target`: the
   * orthographic controller's states don't carry `center`, so deck.gl would
   * throw when starting the transition.
   */
  private withTargetTransition<T extends Record<string, any>>(props: T): T {
    const interpolator = props.transitionInterpolator as
      | { _requiredProps?: string[] }
      | undefined;
    if (!interpolator?._requiredProps?.includes("center")) {
      return props;
    }
    return {
      ...props,
      transitionInterpolator: new LinearInterpolator([
        "target",
        "zoomX",
        "zoomY",
      ]),
    };
  }

  private withTarget<T extends Record<string, any>>(props: T): T {
    if (props.target || !props.center) {
      return props;
    }
    const viewport = this.makeViewport(
      props,
    ) as CustomProjectionViewport | null;
    return viewport ? { ...props, target: [...viewport.target] } : props;
  }

  private withCenter(viewState: Record<string, any>): Record<string, any> {
    const viewport = this.makeViewport(
      viewState,
    ) as CustomProjectionViewport | null;
    const center = viewport?.getCenterInWorld();
    // Drop the orthographic controller's per-axis zoom: the shim's viewport
    // treats `zoomX` as authoritative over `zoom`, so a stale `zoomX` left in
    // app state would override a later `zoom` change. Upstream view states
    // only carry `zoom`.
    const { center: _stale, zoomX: _zoomX, zoomY: _zoomY, ...rest } = viewState;
    return center ? { ...rest, center } : rest;
  }
}
