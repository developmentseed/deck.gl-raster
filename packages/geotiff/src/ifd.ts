import type {
  TiffTag,
  TiffTagGeo,
  TiffTagGeoType,
  TiffTagType,
} from "@cogeotiff/core";

/** Subset of TIFF tags that are pre-fetched in {@link TiffImage.init}. */
export interface PreFetchedTags {
  compression: TiffTagType[TiffTag.Compression];
  imageHeight: TiffTagType[TiffTag.ImageHeight];
  imageWidth: TiffTagType[TiffTag.ImageWidth];
  modelPixelScale?: TiffTagType[TiffTag.ModelPixelScale];
  modelTiePoint?: TiffTagType[TiffTag.ModelTiePoint];
  modelTransformation?: TiffTagType[TiffTag.ModelTransformation];
  tileHeight?: TiffTagType[TiffTag.TileHeight];
  tileWidth?: TiffTagType[TiffTag.TileWidth];
}

/**
 * Parsed GeoKey directory.
 *
 * All fields are optional because any given GeoTIFF may only contain a subset
 * of keys. Types reference `TiffTagGeoType` so `@cogeotiff/core` remains the
 * source of truth.
 *
 * @see https://docs.ogc.org/is/19-008r4/19-008r4.html#_summary_of_geokey_ids_and_names
 */
export type GeoKeyDirectory = {
  // ── Configuration keys (1024–1026) ──────────────────────────────────
  modelType: TiffTagGeoType[TiffTagGeo.GTModelTypeGeoKey] | null;
  rasterType: TiffTagGeoType[TiffTagGeo.GTRasterTypeGeoKey] | null;
  citation: TiffTagGeoType[TiffTagGeo.GTCitationGeoKey] | null;

  // ── Geographic CRS keys (2048–2062) ─────────────────────────────────
  geodeticCRS: TiffTagGeoType[TiffTagGeo.GeodeticCRSGeoKey] | null;
  geodeticCitation: TiffTagGeoType[TiffTagGeo.GeodeticCitationGeoKey] | null;
  geodeticDatum: TiffTagGeoType[TiffTagGeo.GeodeticDatumGeoKey] | null;
  primeMeridian: TiffTagGeoType[TiffTagGeo.PrimeMeridianGeoKey] | null;
  linearUnits: TiffTagGeoType[TiffTagGeo.GeogLinearUnitsGeoKey] | null;
  linearUnitSize: TiffTagGeoType[TiffTagGeo.GeogLinearUnitSizeGeoKey] | null;
  angularUnits: TiffTagGeoType[TiffTagGeo.GeogAngularUnitsGeoKey] | null;
  angularUnitSize: TiffTagGeoType[TiffTagGeo.GeogAngularUnitSizeGeoKey] | null;
  ellipsoid: TiffTagGeoType[TiffTagGeo.EllipsoidGeoKey] | null;
  ellipsoidSemiMajorAxis:
    | TiffTagGeoType[TiffTagGeo.EllipsoidSemiMajorAxisGeoKey]
    | null;
  ellipsoidSemiMinorAxis:
    | TiffTagGeoType[TiffTagGeo.EllipsoidSemiMinorAxisGeoKey]
    | null;
  ellipsoidInvFlattening:
    | TiffTagGeoType[TiffTagGeo.EllipsoidInvFlatteningGeoKey]
    | null;
  azimuthUnits: TiffTagGeoType[TiffTagGeo.GeogAzimuthUnitsGeoKey] | null;
  primeMeridianLongitude:
    | TiffTagGeoType[TiffTagGeo.PrimeMeridianLongitudeGeoKey]
    | null;
  toWGS84: TiffTagGeoType[TiffTagGeo.GeogTOWGS84GeoKey] | null;

  // ── Projected CRS keys (3072–3096) ──────────────────────────────────
  projectedCRS: TiffTagGeoType[TiffTagGeo.ProjectedCRSGeoKey] | null;
  projectedCitation: TiffTagGeoType[TiffTagGeo.ProjectedCitationGeoKey] | null;
  projection: TiffTagGeoType[TiffTagGeo.ProjectionGeoKey] | null;
  projMethod: TiffTagGeoType[TiffTagGeo.ProjMethodGeoKey] | null;
  projLinearUnits: TiffTagGeoType[TiffTagGeo.ProjLinearUnitsGeoKey] | null;
  projLinearUnitSize:
    | TiffTagGeoType[TiffTagGeo.ProjLinearUnitSizeGeoKey]
    | null;
  projStdParallel1: TiffTagGeoType[TiffTagGeo.ProjStdParallel1GeoKey] | null;
  projStdParallel2: TiffTagGeoType[TiffTagGeo.ProjStdParallel2GeoKey] | null;
  projNatOriginLong: TiffTagGeoType[TiffTagGeo.ProjNatOriginLongGeoKey] | null;
  projNatOriginLat: TiffTagGeoType[TiffTagGeo.ProjNatOriginLatGeoKey] | null;
  projFalseEasting: TiffTagGeoType[TiffTagGeo.ProjFalseEastingGeoKey] | null;
  projFalseNorthing: TiffTagGeoType[TiffTagGeo.ProjFalseNorthingGeoKey] | null;
  projFalseOriginLong:
    | TiffTagGeoType[TiffTagGeo.ProjFalseOriginLongGeoKey]
    | null;
  projFalseOriginLat:
    | TiffTagGeoType[TiffTagGeo.ProjFalseOriginLatGeoKey]
    | null;
  projFalseOriginEasting:
    | TiffTagGeoType[TiffTagGeo.ProjFalseOriginEastingGeoKey]
    | null;
  projFalseOriginNorthing:
    | TiffTagGeoType[TiffTagGeo.ProjFalseOriginNorthingGeoKey]
    | null;
  projCenterLong: TiffTagGeoType[TiffTagGeo.ProjCenterLongGeoKey] | null;
  projCenterLat: TiffTagGeoType[TiffTagGeo.ProjCenterLatGeoKey] | null;
  projCenterEasting: TiffTagGeoType[TiffTagGeo.ProjCenterEastingGeoKey] | null;
  projCenterNorthing:
    | TiffTagGeoType[TiffTagGeo.ProjCenterNorthingGeoKey]
    | null;
  projScaleAtNatOrigin:
    | TiffTagGeoType[TiffTagGeo.ProjScaleAtNatOriginGeoKey]
    | null;
  projScaleAtCenter: TiffTagGeoType[TiffTagGeo.ProjScaleAtCenterGeoKey] | null;
  projAzimuthAngle: TiffTagGeoType[TiffTagGeo.ProjAzimuthAngleGeoKey] | null;
  projStraightVertPoleLong:
    | TiffTagGeoType[TiffTagGeo.ProjStraightVertPoleLongGeoKey]
    | null;
  projRectifiedGridAngle:
    | TiffTagGeoType[TiffTagGeo.ProjRectifiedGridAngleGeoKey]
    | null;

  // ── Vertical CRS keys (4096–4099) ───────────────────────────────────
  verticalCRS: TiffTagGeoType[TiffTagGeo.VerticalGeoKey] | null;
  verticalCitation: TiffTagGeoType[TiffTagGeo.VerticalCitationGeoKey] | null;
  verticalDatum: TiffTagGeoType[TiffTagGeo.VerticalDatumGeoKey] | null;
  verticalUnits: TiffTagGeoType[TiffTagGeo.VerticalUnitsGeoKey] | null;
};
