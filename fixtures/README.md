# Test fixtures

### NAIP

```bash
aws s3 cp s3://naip-visualization/ny/2022/60cm/rgb/40073/m_4007307_sw_18_060_20220803.tif ./ --request-payer
gdalinfo -json m_4007307_sw_18_060_20220803.tif | jq '{width: .size[0], height: .size[1], geotransform: .geoTransform, projjson: .stac.["proj:projjson"]}' > m_4007307_sw_18_060_20220803.json
```
