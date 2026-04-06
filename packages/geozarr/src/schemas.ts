/**
 * Zod schemas for zarr-conventions: spatial, geo-proj, multiscales.
 *
 * Mirrors the upstream JSON schemas in the submodules (spatial/, geo-proj/,
 * multiscales/). Update this file when upstream conventions change.
 *
 * Key design note: `spatial:transform` is required for affine transforms
 * (the default), but when composing with multiscales it may live on each
 * layout item instead of at the top-level attributes. The schemas reflect
 * this with a superRefine that accepts either location.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// geo-proj convention
// https://github.com/zarr-conventions/geo-proj
// ---------------------------------------------------------------------------

export const GeoProjAttrsSchema = z.union([
  z.object({ "proj:code": z.string().regex(/^[A-Z]+:[0-9]+$/) }),
  z.object({ "proj:wkt2": z.string() }),
  z.object({ "proj:projjson": z.record(z.string(), z.unknown()) }),
]);

export type GeoProjAttrs = z.infer<typeof GeoProjAttrsSchema>;

// ---------------------------------------------------------------------------
// multiscales convention — layout item
// https://github.com/zarr-conventions/multiscales
// ---------------------------------------------------------------------------

const Affine2dSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

const SpatialShape2dSchema = z.tuple([z.int().min(1), z.int().min(1)]);

export const LayoutItemSchema = z
  .object({
    asset: z.string(),
    derived_from: z.string().optional(),
    transform: z
      .object({
        scale: z.array(z.number()).optional(),
        translation: z.array(z.number()).optional(),
      })
      .optional(),
    resampling_method: z.string().optional(),
    // spatial: overrides per level — required here when not at group level
    "spatial:transform": Affine2dSchema.optional(),
    "spatial:shape": SpatialShape2dSchema.optional(),
  })
  .passthrough();

export const MultiscalesAttrsSchema = z.object({
  multiscales: z.object({
    layout: z.array(LayoutItemSchema).min(1),
    resampling_method: z.string().optional(),
  }),
});

export type LayoutItem = z.infer<typeof LayoutItemSchema>;
export type MultiscalesAttrs = z.infer<typeof MultiscalesAttrsSchema>;

// ---------------------------------------------------------------------------
// spatial convention
// https://github.com/zarr-conventions/spatial
//
// `spatial:transform` is required for affine transforms (the default when
// `spatial:transform_type` is absent or "affine"). When composing with
// multiscales, the transform may instead appear on each layout item.
// ---------------------------------------------------------------------------

const SpatialAttrsBaseSchema = z.object({
  "spatial:dimensions": z.array(z.string()).min(2).max(3),
  "spatial:transform": Affine2dSchema.optional(),
  "spatial:shape": SpatialShape2dSchema.optional(),
  "spatial:bbox": z
    .union([
      z.tuple([z.number(), z.number(), z.number(), z.number()]),
      z.tuple([
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
      ]),
    ])
    .optional(),
  "spatial:transform_type": z.string().optional(),
  "spatial:registration": z.enum(["node", "pixel"]).optional(),
  multiscales: MultiscalesAttrsSchema.shape.multiscales.optional(),
});

export const SpatialAttrsSchema = SpatialAttrsBaseSchema.superRefine(
  (val, ctx) => {
    const transformType = val["spatial:transform_type"] ?? "affine";

    if (transformType !== "affine") {
      // non-affine: no transform array required
      return;
    }

    const hasTopLevelTransform = val["spatial:transform"] !== undefined;
    const layout = val.multiscales?.layout;
    const hasPerLevelTransform = layout?.every(
      (item) => item["spatial:transform"] !== undefined,
    );

    if (!hasTopLevelTransform && !hasPerLevelTransform) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "spatial:transform is required for affine transforms. " +
          "Provide it at the top level or on every multiscales layout item.",
      });
    }
  },
);

export type SpatialAttrs = z.infer<typeof SpatialAttrsSchema>;
