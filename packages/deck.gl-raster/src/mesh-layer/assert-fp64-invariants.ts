import type { SimpleMeshLayerProps } from "@deck.gl/mesh-layers";

/**
 * Asserts the SimpleMeshLayer-base-class per-instance transforms are all at
 * identity. The fp64 mesh-vertex precision correction (see
 * `dev-docs/specs/2026-05-19-high-zoom-precision-design.md` § "Invariant")
 * is only valid when `positions` equals the working vertex `pos` the shader
 * computes: that requires `_instanced: false`, identity instance model
 * matrix (`getOrientation: [0,0,0]`, `getScale: [1,1,1]`,
 * `getTranslation: [0,0,0]`, `getTransformMatrix: []`), `sizeScale === 1`,
 * and a constant `getPosition: [0, 0, 0]`.
 *
 * deck.gl's `SimpleMeshLayer.defaultProps` already provides identity values
 * for the four accessor props, so a caller that leaves them unset
 * (RasterLayer) passes the check; this helper exists to catch a future
 * caller that explicitly sets a non-identity value.
 *
 * Throws on any violation. Caller is expected to gate on
 * `process.env.NODE_ENV !== "production"`.
 */
export function assertFp64Invariants(props: SimpleMeshLayerProps): void {
  if (props._instanced !== false) {
    throw new Error(
      `MeshTextureLayer fp64 invariant: _instanced must be false (got ${JSON.stringify(
        props._instanced,
      )}). The fp64 mesh-vertex correction assumes a single non-instanced mesh. See dev-docs/specs/2026-05-19-high-zoom-precision-design.md.`,
    );
  }

  if (props.sizeScale !== undefined && props.sizeScale !== 1) {
    throw new Error(
      `MeshTextureLayer fp64 invariant: sizeScale must be 1 (got ${props.sizeScale}). The mesh-vertex low part is the residual of positions, not of (positions * sizeScale).`,
    );
  }

  assertIdentityVec3(props.getPosition, "getPosition", [0, 0, 0]);
  assertIdentityVec3(props.getOrientation, "getOrientation", [0, 0, 0]);
  assertIdentityVec3(props.getScale, "getScale", [1, 1, 1]);
  assertIdentityVec3(props.getTranslation, "getTranslation", [0, 0, 0]);

  const m = props.getTransformMatrix;
  if (m !== undefined) {
    if (typeof m === "function") {
      throw new Error(
        "MeshTextureLayer fp64 invariant: getTransformMatrix must not be a function accessor — instance model matrix must remain identity (default: empty array).",
      );
    }
    if (Array.isArray(m) && m.length !== 0) {
      throw new Error(
        `MeshTextureLayer fp64 invariant: getTransformMatrix must be left at its default empty value (got length ${m.length}). Any non-empty transform matrix breaks the fp64 correction.`,
      );
    }
  }
}

function assertIdentityVec3(
  value: unknown,
  propName: string,
  identity: readonly [number, number, number],
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === "function") {
    throw new Error(
      `MeshTextureLayer fp64 invariant: ${propName} must be a constant [${identity.join(
        ", ",
      )}] (received a function accessor). The fp64 correction assumes each per-instance transform is at identity for every instance.`,
    );
  }
  if (
    !Array.isArray(value) ||
    value[0] !== identity[0] ||
    value[1] !== identity[1] ||
    value[2] !== identity[2]
  ) {
    throw new Error(
      `MeshTextureLayer fp64 invariant: ${propName} must be [${identity.join(
        ", ",
      )}] (got ${JSON.stringify(value)}). Any non-identity per-instance transform breaks the fp64 correction.`,
    );
  }
}
