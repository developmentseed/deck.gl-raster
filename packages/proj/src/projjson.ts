// ── PROJJSON types ────────────────────────────────────────────────────────────
// Subset of the PROJJSON spec covering the two CRS types we emit.
// https://proj.org/en/stable/specifications/projjson.html

export interface ProjJsonUnit {
  type: "LinearUnit" | "AngularUnit";
  name: string;
  conversion_factor: number;
}

export interface ProjJsonAxis {
  name: string;
  abbreviation: string;
  direction: string;
  unit: string | ProjJsonUnit;
}

export interface ProjJsonCoordinateSystem {
  subtype: string;
  axis: ProjJsonAxis[];
}

export interface ProjJsonEllipsoid {
  name: string;
  semi_major_axis?: number;
  semi_minor_axis?: number;
  inverse_flattening?: number;
}

export interface ProjJsonPrimeMeridian {
  name: string;
  longitude: number;
}

export interface ProjJsonDatum {
  type: "GeodeticReferenceFrame";
  name: string;
  ellipsoid?: ProjJsonEllipsoid;
  prime_meridian?: ProjJsonPrimeMeridian;
}

export interface ProjJsonParameter {
  name: string;
  value: number;
  unit: string | ProjJsonUnit;
}

export interface ProjJsonConversion {
  name: string;
  method: { name: string };
  parameters: ProjJsonParameter[];
}

export interface ProjJsonDatumEnsemble {
  name: string;
  members: { name: string; id?: { authority: string; code: number } }[];
  ellipsoid: ProjJsonEllipsoid;
  accuracy?: string;
  id?: { authority: string; code: number };
}

export interface GeographicCRS {
  type: "GeographicCRS";
  $schema?: string;
  name: string;
  datum?: ProjJsonDatum;
  datum_ensemble?: ProjJsonDatumEnsemble;
  coordinate_system: ProjJsonCoordinateSystem;
}

export interface ProjectedCRS {
  type: "ProjectedCRS";
  $schema: string;
  name: string;
  base_crs: GeographicCRS;
  conversion: ProjJsonConversion;
  coordinate_system: ProjJsonCoordinateSystem;
}

export type ProjJson = GeographicCRS | ProjectedCRS;
