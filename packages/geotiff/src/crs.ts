interface DatumDefinition {
  /** The type of datum. */
  datum_type: number;
  /** Semi-major axis of the ellipsoid. */
  a: number;
  /** Semi-minor axis of the ellipsoid. */
  b: number;
  /** Eccentricity squared of the ellipsoid. */
  es: number;
  /** Second eccentricity squared of the ellipsoid. */
  ep2: number;
}

interface ProjectionDefinition {
  title: string;
  projName?: string;
  ellps?: string;
  datum?: DatumDefinition;
  datumName?: string;
  rf?: number;
  lat0?: number;
  lat1?: number;
  lat2?: number;
  lat_ts?: number;
  long0?: number;
  long1?: number;
  long2?: number;
  alpha?: number;
  longc?: number;
  x0?: number;
  y0?: number;
  k0?: number;
  a?: number;
  b?: number;
  R_A?: true;
  zone?: number;
  utmSouth?: true;
  datum_params?: string | number[];
  to_meter?: number;
  units?: string;
  from_greenwich?: number;
  datumCode?: string;
  nadgrids?: string;
  axis?: string;
  sphere?: boolean;
  rectified_grid_angle?: number;
  approx?: boolean;
  over?: boolean;
  projStr?: string;
}
