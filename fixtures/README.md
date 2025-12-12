# Test fixtures

This document details how we construct our test fixtures. The mesh algorithm doesn't need any of the source _image data_, we only need specific metadata (width, height, geotransform, projection). Therefore, we either use `gdalinfo` to extract such metadata or we parse from STAC metadata.

### NAIP

```bash
AWS_REQUEST_PAYER=requester pixi run gdalinfo -json /vsis3/naip-visualization/ny/2022/60cm/rgb/40073/m_4007307_sw_18_060_20220803.tif | jq '{width: .size[0], height: .size[1], geotransform: .geoTransform, reorderTransform: true, projjson: .stac.["proj:projjson"]}' > m_4007307_sw_18_060_20220803.json
```

### linz

See https://www.linz.govt.nz/products-services/maps/new-zealand-topographic-maps/topo250-map-chooser/topo250-map-25-te-anau.

```bash
pixi run gdalinfo -json https://static.topo.linz.govt.nz/maps/topo250/geotiff/250-25_GeoTifv1-05.tif | jq '{width: .size[0], height: .size[1], geotransform: .geoTransform, reorderTransform: true, projjson: .stac.["proj:projjson"]}' > linz_250-25_GeoTifv1-05.json
```

```bash
pixi run gdalinfo -json https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff | jq '{width: .size[0], height: .size[1], geotransform: .geoTransform, reorderTransform: true, projjson: .stac.["proj:projjson"]}' > CC11.json
```

### National Land Cover Database

```bash
AWS_REQUEST_PAYER=requester pixi run gdalinfo -json /vsis3/usgs-landcover/annual-nlcd/c1/v0/cu/mosaic/Annual_NLCD_LndCov_2023_CU_C1V0.tif | jq '{width: .size[0], height: .size[1], geotransform: .geoTransform, reorderTransform: true, wkt2: .stac.["proj:wkt2"], projjson: .stac.["proj:projjson"]}' > Annual_NLCD_LndCov_2023_CU_C1V0.json
```

### MODIS

Notes:

- since we're parsing from STAC metadata, we set `reorderTransform` to false as the geotransform is already in the correct order.
- We hard-code the proj4 string since proj4js currently has a bug with the WKT2 string: https://github.com/proj4js/proj4js/issues/539

```bash
curl -s https://planetarycomputer.microsoft.com/api/stac/v1/collections/modis-09A1-061/items/MYD09A1.A2025169.h10v05.061.2025178160305 | jq '{width: .properties.["proj:shape"][0], height: .properties.["proj:shape"][1], geotransform: .properties.["proj:transform"], reorderTransform: false, wkt2: "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs +type=crs"}' > MYD09A1.A2025169.h10v05.061.2025178160305.json
```

### Inspecting a mesh in Lonboard

```py
import json

import numpy as np
from geoarrow.rust.core import polygons

from lonboard import viz

# REPLACE MESH PATH
path = "/Users/kyle/github/developmentseed/deck.gl-raster/fixtures/m_4007307_sw_18_060_20220803.mesh.json"
with open(path) as f:
    mesh = json.load(f)

triangles = np.array(mesh["indices"], dtype=np.uint32).reshape((-1, 3))
coords = np.array(mesh["positions"], dtype=np.float64).reshape((-1, 2))
tex_coords = np.array(mesh["texCoords"], dtype=np.float32).reshape((-1, 2))


np_coords = np.hstack(
    [
        coords[triangles[:, 0]],
        coords[triangles[:, 1]],
        coords[triangles[:, 2]],
        coords[triangles[:, 0]],
    ],
).reshape(-1, 2)
ring_offsets = np.arange((triangles.shape[0] + 1) * 4, step=4)
geom_offsets = np.arange(triangles.shape[0] + 1)


geo_arr = polygons(
    coords=np_coords,
    geom_offsets=geom_offsets,
    ring_offsets=ring_offsets,
)

COLORS = [
    "#FC49A3",  # pink
    "#FF33CC",  # magenta-pink
    "#CC66FF",  # purple-ish
    "#9933FF",  # deep purple
    "#66CCFF",  # sky blue
    "#3399FF",  # clear blue
    "#66FFCC",  # teal
    "#33FFAA",  # aqua-teal
    "#00FF00",  # lime green
    "#33CC33",  # stronger green
    "#FFCC66",  # light orange
    "#FFB347",  # golden-orange
    "#FF6666",  # salmon
    "#FF5050",  # red-salmon
    "#FF0000",  # red
    "#CC0000",  # crimson
    "#FF8000",  # orange
    "#FF9933",  # bright orange
    "#FFFF66",  # yellow
    "#FFFF33",  # lemon
    "#00FFFF",  # turquoise
    "#00CCFF",  # cyan
]


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


RGB_COLORS = np.array([hex_to_rgb(c) for c in COLORS], dtype=np.uint8)

idx = np.arange(len(geo_arr)) % len(COLORS)
get_fill_color = RGB_COLORS[idx]


m = viz(geo_arr, polygon_kwargs={"get_fill_color": get_fill_color})
m
```
