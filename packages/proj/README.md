# @developmentseed/proj

Utilities for coordinate reprojections.

This module depends on [proj4.js](https://github.com/proj4js/proj4js), which `epsgResolver` uses to resolve common EPSG codes, such as 4326, 3857 and the WGS 84 UTM zones, without a network request.

In the future, users may wish to use other proj implementations, such as [`proj-wasm`](https://github.com/willcohen/clj-proj).
