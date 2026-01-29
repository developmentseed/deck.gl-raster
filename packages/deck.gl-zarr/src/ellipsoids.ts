/**
 * Vendored and edited from proj4.js.
 *
 * In the implementation of metersPerUnit while generating a TileMatrixSet,
 * we need to know the size of the semi major axis in the case the CRS is in
 * degrees.
 *
 * https://github.com/proj4js/proj4js/blob/e90e5fa6872a1ffc40edb161cbeb4bd5e3bd9db5/lib/constants/Ellipsoid.js
 */

const ellipsoids = {
  MERIT: {
    a: 6378137,
  },
  SGS85: {
    a: 6378136,
  },
  GRS80: {
    a: 6378137,
  },
  IAU76: {
    a: 6378140,
  },
  airy: {
    a: 6377563.396,
    b: 6356256.91,
  },
  APL4: {
    a: 6378137,
  },
  NWL9D: {
    a: 6378145,
  },
  mod_airy: {
    a: 6377340.189,
    b: 6356034.446,
  },
  andrae: {
    a: 6377104.43,
  },
  aust_SA: {
    a: 6378160,
  },
  GRS67: {
    a: 6378160,
  },
  bessel: {
    a: 6377397.155,
  },
  bess_nam: {
    a: 6377483.865,
  },
  clrk66: {
    a: 6378206.4,
    b: 6356583.8,
  },
  clrk80: {
    a: 6378249.145,
  },
  clrk80ign: {
    a: 6378249.2,
    b: 6356515,
  },
  clrk58: {
    a: 6378293.645208759,
  },
  CPM: {
    a: 6375738.7,
  },
  delmbr: {
    a: 6376428,
  },
  engelis: {
    a: 6378136.05,
  },
  evrst30: {
    a: 6377276.345,
  },
  evrst48: {
    a: 6377304.063,
  },
  evrst56: {
    a: 6377301.243,
  },
  evrst69: {
    a: 6377295.664,
  },
  evrstSS: {
    a: 6377298.556,
  },
  fschr60: {
    a: 6378166,
  },
  fschr60m: {
    a: 6378155,
  },
  fschr68: {
    a: 6378150,
  },
  helmert: {
    a: 6378200,
  },
  hough: {
    a: 6378270,
  },
  intl: {
    a: 6378388,
  },
  kaula: {
    a: 6378163,
  },
  lerch: {
    a: 6378139,
  },
  mprts: {
    a: 6397300,
  },
  new_intl: {
    a: 6378157.5,
    b: 6356772.2,
  },
  plessis: {
    a: 6376523,
  },
  krass: {
    a: 6378245,
  },
  SEasia: {
    a: 6378155,
    b: 6356773.3205,
  },
  walbeck: {
    a: 6376896,
    b: 6355834.8467,
  },
  WGS60: {
    a: 6378165,
  },
  WGS66: {
    a: 6378145,
  },
  WGS7: {
    a: 6378135,
  },
  WGS84: {
    a: 6378137,
  },
  sphere: {
    a: 6370997,
    b: 6370997,
  },
};

export default ellipsoids;
