import type { TiffImage, TiffTagGeoType, TiffTagType } from "@cogeotiff/core";
import { SampleFormat, TiffTag, TiffTagGeo } from "@cogeotiff/core";

/** Subset of TIFF tags that we pre-fetch for easier visualization. */
export interface CachedTags {
  bitsPerSample: Uint16Array;
  colorMap?: Uint16Array; // TiffTagType[TiffTag.ColorMap];
  compression: TiffTagType[TiffTag.Compression];
  nodata: number | null;
  photometric: TiffTagType[TiffTag.Photometric];
  sampleFormat: TiffTagType[TiffTag.SampleFormat];
  samplesPerPixel: TiffTagType[TiffTag.SamplesPerPixel];
}

/** Pre-fetch TIFF tags for easier visualization. */
export async function prefetchTags(image: TiffImage): Promise<CachedTags> {
  // Compression is pre-fetched in init
  const compression = image.value(TiffTag.Compression);
  if (compression === null) {
    throw new Error("Compression tag should always exist.");
  }

  const nodata = image.noData;

  const [bitsPerSample, colorMap, photometric, sampleFormat, samplesPerPixel] =
    await Promise.all([
      image.fetch(TiffTag.BitsPerSample),
      image.fetch(TiffTag.ColorMap),
      image.fetch(TiffTag.Photometric),
      image.fetch(TiffTag.SampleFormat),
      image.fetch(TiffTag.SamplesPerPixel),
    ]);

  if (bitsPerSample === null) {
    throw new Error("BitsPerSample tag should always exist.");
  }

  if (samplesPerPixel === null) {
    throw new Error("SamplesPerPixel tag should always exist.");
  }

  if (photometric === null) {
    throw new Error("Photometric tag should always exist.");
  }

  return {
    bitsPerSample: new Uint16Array(bitsPerSample),
    colorMap: colorMap ? new Uint16Array(colorMap as number[]) : undefined,
    compression,
    nodata,
    photometric,
    // Uint is the default sample format according to the spec
    // https://web.archive.org/web/20240329145340/https://www.awaresystems.be/imaging/tiff/tifftags/sampleformat.html
    sampleFormat: sampleFormat ?? [SampleFormat.Uint],
    samplesPerPixel,
  };
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
  const geo = <K extends TiffTagGeo>(key: K): TiffTagGeoType[K] | null =>
    image.valueGeo(key) ?? null;

  return {
    // Configuration keys
    modelType: geo(TiffTagGeo.GTModelTypeGeoKey),
    rasterType: geo(TiffTagGeo.GTRasterTypeGeoKey),
    citation: geo(TiffTagGeo.GTCitationGeoKey),

    // Geographic CRS keys
    geodeticCRS: geo(TiffTagGeo.GeodeticCRSGeoKey),
    geodeticCitation: geo(TiffTagGeo.GeodeticCitationGeoKey),
    geodeticDatum: geo(TiffTagGeo.GeodeticDatumGeoKey),
    primeMeridian: geo(TiffTagGeo.PrimeMeridianGeoKey),
    linearUnits: geo(TiffTagGeo.GeogLinearUnitsGeoKey),
    linearUnitSize: geo(TiffTagGeo.GeogLinearUnitSizeGeoKey),
    angularUnits: geo(TiffTagGeo.GeogAngularUnitsGeoKey),
    angularUnitSize: geo(TiffTagGeo.GeogAngularUnitSizeGeoKey),
    ellipsoid: geo(TiffTagGeo.EllipsoidGeoKey),
    ellipsoidSemiMajorAxis: geo(TiffTagGeo.EllipsoidSemiMajorAxisGeoKey),
    ellipsoidSemiMinorAxis: geo(TiffTagGeo.EllipsoidSemiMinorAxisGeoKey),
    ellipsoidInvFlattening: geo(TiffTagGeo.EllipsoidInvFlatteningGeoKey),
    azimuthUnits: geo(TiffTagGeo.GeogAzimuthUnitsGeoKey),
    primeMeridianLongitude: geo(TiffTagGeo.PrimeMeridianLongitudeGeoKey),
    toWGS84: geo(TiffTagGeo.GeogTOWGS84GeoKey),

    // Projected CRS keys
    projectedCRS: geo(TiffTagGeo.ProjectedCRSGeoKey),
    projectedCitation: geo(TiffTagGeo.ProjectedCitationGeoKey),
    projection: geo(TiffTagGeo.ProjectionGeoKey),
    projMethod: geo(TiffTagGeo.ProjMethodGeoKey),
    projLinearUnits: geo(TiffTagGeo.ProjLinearUnitsGeoKey),
    projLinearUnitSize: geo(TiffTagGeo.ProjLinearUnitSizeGeoKey),
    projStdParallel1: geo(TiffTagGeo.ProjStdParallel1GeoKey),
    projStdParallel2: geo(TiffTagGeo.ProjStdParallel2GeoKey),
    projNatOriginLong: geo(TiffTagGeo.ProjNatOriginLongGeoKey),
    projNatOriginLat: geo(TiffTagGeo.ProjNatOriginLatGeoKey),
    projFalseEasting: geo(TiffTagGeo.ProjFalseEastingGeoKey),
    projFalseNorthing: geo(TiffTagGeo.ProjFalseNorthingGeoKey),
    projFalseOriginLong: geo(TiffTagGeo.ProjFalseOriginLongGeoKey),
    projFalseOriginLat: geo(TiffTagGeo.ProjFalseOriginLatGeoKey),
    projFalseOriginEasting: geo(TiffTagGeo.ProjFalseOriginEastingGeoKey),
    projFalseOriginNorthing: geo(TiffTagGeo.ProjFalseOriginNorthingGeoKey),
    projCenterLong: geo(TiffTagGeo.ProjCenterLongGeoKey),
    projCenterLat: geo(TiffTagGeo.ProjCenterLatGeoKey),
    projCenterEasting: geo(TiffTagGeo.ProjCenterEastingGeoKey),
    projCenterNorthing: geo(TiffTagGeo.ProjCenterNorthingGeoKey),
    projScaleAtNatOrigin: geo(TiffTagGeo.ProjScaleAtNatOriginGeoKey),
    projScaleAtCenter: geo(TiffTagGeo.ProjScaleAtCenterGeoKey),
    projAzimuthAngle: geo(TiffTagGeo.ProjAzimuthAngleGeoKey),
    projStraightVertPoleLong: geo(TiffTagGeo.ProjStraightVertPoleLongGeoKey),
    projRectifiedGridAngle: geo(TiffTagGeo.ProjRectifiedGridAngleGeoKey),

    // Vertical CRS keys
    verticalCRS: geo(TiffTagGeo.VerticalGeoKey),
    verticalCitation: geo(TiffTagGeo.VerticalCitationGeoKey),
    verticalDatum: geo(TiffTagGeo.VerticalDatumGeoKey),
    verticalUnits: geo(TiffTagGeo.VerticalUnitsGeoKey),
  };
}
