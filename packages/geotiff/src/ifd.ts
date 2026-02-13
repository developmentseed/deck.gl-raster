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
  modelType?: TiffTagGeoType[TiffTagGeo.GTModelTypeGeoKey];
  rasterType?: TiffTagGeoType[TiffTagGeo.GTRasterTypeGeoKey];
  citation?: TiffTagGeoType[TiffTagGeo.GTCitationGeoKey];

  // ── Geographic CRS keys (2048–2062) ─────────────────────────────────
  geodeticCRS?: TiffTagGeoType[TiffTagGeo.GeodeticCRSGeoKey];
  geodeticCitation?: TiffTagGeoType[TiffTagGeo.GeodeticCitationGeoKey];
  geodeticDatum?: TiffTagGeoType[TiffTagGeo.GeodeticDatumGeoKey];
  primeMeridian?: TiffTagGeoType[TiffTagGeo.PrimeMeridianGeoKey];
  linearUnits?: TiffTagGeoType[TiffTagGeo.GeogLinearUnitsGeoKey];
  linearUnitSize?: TiffTagGeoType[TiffTagGeo.GeogLinearUnitSizeGeoKey];
  angularUnits?: TiffTagGeoType[TiffTagGeo.GeogAngularUnitsGeoKey];
  angularUnitSize?: TiffTagGeoType[TiffTagGeo.GeogAngularUnitSizeGeoKey];
  ellipsoid?: TiffTagGeoType[TiffTagGeo.EllipsoidGeoKey];
  ellipsoidSemiMajorAxis?: TiffTagGeoType[TiffTagGeo.EllipsoidSemiMajorAxisGeoKey];
  ellipsoidSemiMinorAxis?: TiffTagGeoType[TiffTagGeo.EllipsoidSemiMinorAxisGeoKey];
  ellipsoidInvFlattening?: TiffTagGeoType[TiffTagGeo.EllipsoidInvFlatteningGeoKey];
  azimuthUnits?: TiffTagGeoType[TiffTagGeo.GeogAzimuthUnitsGeoKey];
  primeMeridianLongitude?: TiffTagGeoType[TiffTagGeo.PrimeMeridianLongitudeGeoKey];
  toWGS84?: TiffTagGeoType[TiffTagGeo.GeogTOWGS84GeoKey];

  // ── Projected CRS keys (3072–3096) ──────────────────────────────────
  projectedCRS?: TiffTagGeoType[TiffTagGeo.ProjectedCRSGeoKey];
  projectedCitation?: TiffTagGeoType[TiffTagGeo.ProjectedCitationGeoKey];
  projection?: TiffTagGeoType[TiffTagGeo.ProjectionGeoKey];
  projMethod?: TiffTagGeoType[TiffTagGeo.ProjMethodGeoKey];
  projLinearUnits?: TiffTagGeoType[TiffTagGeo.ProjLinearUnitsGeoKey];
  projLinearUnitSize?: TiffTagGeoType[TiffTagGeo.ProjLinearUnitSizeGeoKey];
  projStdParallel1?: TiffTagGeoType[TiffTagGeo.ProjStdParallel1GeoKey];
  projStdParallel2?: TiffTagGeoType[TiffTagGeo.ProjStdParallel2GeoKey];
  projNatOriginLong?: TiffTagGeoType[TiffTagGeo.ProjNatOriginLongGeoKey];
  projNatOriginLat?: TiffTagGeoType[TiffTagGeo.ProjNatOriginLatGeoKey];
  projFalseEasting?: TiffTagGeoType[TiffTagGeo.ProjFalseEastingGeoKey];
  projFalseNorthing?: TiffTagGeoType[TiffTagGeo.ProjFalseNorthingGeoKey];
  projFalseOriginLong?: TiffTagGeoType[TiffTagGeo.ProjFalseOriginLongGeoKey];
  projFalseOriginLat?: TiffTagGeoType[TiffTagGeo.ProjFalseOriginLatGeoKey];
  projFalseOriginEasting?: TiffTagGeoType[TiffTagGeo.ProjFalseOriginEastingGeoKey];
  projFalseOriginNorthing?: TiffTagGeoType[TiffTagGeo.ProjFalseOriginNorthingGeoKey];
  projCenterLong?: TiffTagGeoType[TiffTagGeo.ProjCenterLongGeoKey];
  projCenterLat?: TiffTagGeoType[TiffTagGeo.ProjCenterLatGeoKey];
  projCenterEasting?: TiffTagGeoType[TiffTagGeo.ProjCenterEastingGeoKey];
  projCenterNorthing?: TiffTagGeoType[TiffTagGeo.ProjCenterNorthingGeoKey];
  projScaleAtNatOrigin?: TiffTagGeoType[TiffTagGeo.ProjScaleAtNatOriginGeoKey];
  projScaleAtCenter?: TiffTagGeoType[TiffTagGeo.ProjScaleAtCenterGeoKey];
  projAzimuthAngle?: TiffTagGeoType[TiffTagGeo.ProjAzimuthAngleGeoKey];
  projStraightVertPoleLong?: TiffTagGeoType[TiffTagGeo.ProjStraightVertPoleLongGeoKey];
  projRectifiedGridAngle?: TiffTagGeoType[TiffTagGeo.ProjRectifiedGridAngleGeoKey];

  // ── Vertical CRS keys (4096–4099) ───────────────────────────────────
  verticalCRS?: TiffTagGeoType[TiffTagGeo.VerticalGeoKey];
  verticalCitation?: TiffTagGeoType[TiffTagGeo.VerticalCitationGeoKey];
  verticalDatum?: TiffTagGeoType[TiffTagGeo.VerticalDatumGeoKey];
  verticalUnits?: TiffTagGeoType[TiffTagGeo.VerticalUnitsGeoKey];
};
