import rasterio
from rasterio.transform import Affine

with rasterio.open("public/xjejfvrbm1fbu1ecw-0000000000-0000008192.tiff") as src:
    data = src.read()
    # Flip all bands on the y-axis
    data = data[:, ::-1, :]

    transform = src.transform
    # Negate the y pixel size and adjust the origin to the top-left
    new_transform = Affine(
        transform.a,
        transform.b,
        transform.c,
        transform.d,
        -transform.e,
        transform.f + transform.e * src.height,
    )

    profile = src.profile.copy()
    profile.update(transform=new_transform)

    with rasterio.open("flipped.tif", "w", **profile) as dst:
        dst.write(data)
