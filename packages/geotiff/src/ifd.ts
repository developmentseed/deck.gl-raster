import type {
  TiffImage,
  TiffTag,
  TiffTagGeoType,
  TiffTagType,
} from "@cogeotiff/core";
import { TiffTagGeo } from "@cogeotiff/core";

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

export function extractGeoKeyDirectory(image: TiffImage): GeoKeyDirectory {
  return {
    // Configuration keys
    modelType: image.valueGeo(TiffTagGeo.GTModelTypeGeoKey),
    rasterType: image.valueGeo(TiffTagGeo.GTRasterTypeGeoKey),
    citation: image.valueGeo(TiffTagGeo.GTCitationGeoKey),

    // Geographic CRS keys
    geodeticCRS: image.valueGeo(TiffTagGeo.GeodeticCRSGeoKey),
    geodeticCitation: image.valueGeo(TiffTagGeo.GeodeticCitationGeoKey),
    geodeticDatum: image.valueGeo(TiffTagGeo.GeodeticDatumGeoKey),
    primeMeridian: image.valueGeo(TiffTagGeo.PrimeMeridianGeoKey),
    linearUnits: image.valueGeo(TiffTagGeo.GeogLinearUnitsGeoKey),
    linearUnitSize: image.valueGeo(TiffTagGeo.GeogLinearUnitSizeGeoKey),
    angularUnits: image.valueGeo(TiffTagGeo.GeogAngularUnitsGeoKey),
    angularUnitSize: image.valueGeo(TiffTagGeo.GeogAngularUnitSizeGeoKey),
    ellipsoid: image.valueGeo(TiffTagGeo.EllipsoidGeoKey),
    ellipsoidSemiMajorAxis: image.valueGeo(
      TiffTagGeo.EllipsoidSemiMajorAxisGeoKey,
    ),
    ellipsoidSemiMinorAxis: image.valueGeo(
      TiffTagGeo.EllipsoidSemiMinorAxisGeoKey,
    ),
    ellipsoidInvFlattening: image.valueGeo(
      TiffTagGeo.EllipsoidInvFlatteningGeoKey,
    ),
    azimuthUnits: image.valueGeo(TiffTagGeo.GeogAzimuthUnitsGeoKey),
    primeMeridianLongitude: image.valueGeo(
      TiffTagGeo.PrimeMeridianLongitudeGeoKey,
    ),
    toWGS84: image.valueGeo(TiffTagGeo.GeogTOWGS84GeoKey),

    // Projected CRS keys
    projectedCRS: image.valueGeo(TiffTagGeo.ProjectedCRSGeoKey),
    projectedCitation: image.valueGeo(TiffTagGeo.ProjectedCitationGeoKey),
    projection: image.valueGeo(TiffTagGeo.ProjectionGeoKey),
    projMethod: image.valueGeo(TiffTagGeo.ProjMethodGeoKey),
    projLinearUnits: image.valueGeo(TiffTagGeo.ProjLinearUnitsGeoKey),
    projLinearUnitSize: image.valueGeo(TiffTagGeo.ProjLinearUnitSizeGeoKey),
    projStdParallel1: image.valueGeo(TiffTagGeo.ProjStdParallel1GeoKey),
    projStdParallel2: image.valueGeo(TiffTagGeo.ProjStdParallel2GeoKey),
    projNatOriginLong: image.valueGeo(TiffTagGeo.ProjNatOriginLongGeoKey),
    projNatOriginLat: image.valueGeo(TiffTagGeo.ProjNatOriginLatGeoKey),
    projFalseEasting: image.valueGeo(TiffTagGeo.ProjFalseEastingGeoKey),
    projFalseNorthing: image.valueGeo(TiffTagGeo.ProjFalseNorthingGeoKey),
    projFalseOriginLong: image.valueGeo(TiffTagGeo.ProjFalseOriginLongGeoKey),
    projFalseOriginLat: image.valueGeo(TiffTagGeo.ProjFalseOriginLatGeoKey),
    projFalseOriginEasting: image.valueGeo(
      TiffTagGeo.ProjFalseOriginEastingGeoKey,
    ),
    projFalseOriginNorthing: image.valueGeo(
      TiffTagGeo.ProjFalseOriginNorthingGeoKey,
    ),
    projCenterLong: image.valueGeo(TiffTagGeo.ProjCenterLongGeoKey),
    projCenterLat: image.valueGeo(TiffTagGeo.ProjCenterLatGeoKey),
    projCenterEasting: image.valueGeo(TiffTagGeo.ProjCenterEastingGeoKey),
    projCenterNorthing: image.valueGeo(TiffTagGeo.ProjCenterNorthingGeoKey),
    projScaleAtNatOrigin: image.valueGeo(TiffTagGeo.ProjScaleAtNatOriginGeoKey),
    projScaleAtCenter: image.valueGeo(TiffTagGeo.ProjScaleAtCenterGeoKey),
    projAzimuthAngle: image.valueGeo(TiffTagGeo.ProjAzimuthAngleGeoKey),
    projStraightVertPoleLong: image.valueGeo(
      TiffTagGeo.ProjStraightVertPoleLongGeoKey,
    ),
    projRectifiedGridAngle: image.valueGeo(
      TiffTagGeo.ProjRectifiedGridAngleGeoKey,
    ),

    // Vertical CRS keys
    verticalCRS: image.valueGeo(TiffTagGeo.VerticalGeoKey),
    verticalCitation: image.valueGeo(TiffTagGeo.VerticalCitationGeoKey),
    verticalDatum: image.valueGeo(TiffTagGeo.VerticalDatumGeoKey),
    verticalUnits: image.valueGeo(TiffTagGeo.VerticalUnitsGeoKey),
  };
}
