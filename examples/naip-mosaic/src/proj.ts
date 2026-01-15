import proj4 from "proj4";

// Hard-code UTM definitions so we don't need all of geotiff-geokeys-to-proj4 in
// this example app.
// These defintions are from:
// https://epsg.io/26910.js
const utmDef = (zone: number) =>
  `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs`;

for (let zone = 10; zone <= 20; zone++) {
  proj4.defs(`EPSG:269${zone}`, utmDef(zone));
}
