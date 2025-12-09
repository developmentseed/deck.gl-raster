# Test fixtures

### NAIP

```bash
aws s3 cp s3://naip-visualization/ny/2022/60cm/rgb/40073/m_4007307_sw_18_060_20220803.tif ./ --request-payer
gdalinfo -json m_4007307_sw_18_060_20220803.tif | jq '{width: .size[0], height: .size[1], geotransform: .geoTransform, projjson: .stac.["proj:projjson"]}' > m_4007307_sw_18_060_20220803.json
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
