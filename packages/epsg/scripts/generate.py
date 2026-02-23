"""A script to generate a compressed CSV of EPSG code definitions.

The EPSG dataset can be downloaded from <https://epsg.org/download-dataset.html>. You'll
need to create an account to download it. Download the WKT version of the file.

Then run this script with the path to the downloaded zip file.

As of February 2026, this uses EPSG version 12.049.
"""

from __future__ import annotations
import gzip
from io import StringIO

from zipfile import ZipFile


def parse_epsg_from_filename(filename: str) -> int:
    """Parse the EPSG code from the filename.

    EPSG-CRS-21457.wkt -> 21457
    """
    return int(filename.split("-")[-1].split(".")[0])


def format_csv(crs_mapping: dict[int, str]) -> str:
    out = StringIO()

    # writer = csv.writer(out, delimiter="|", quotechar=None)
    for epsg_code, wkt in crs_mapping.items():
        # writer.writerow([epsg_code, wkt])
        out.write(f"{epsg_code}|{wkt}\n")

    return out.getvalue()


def main(epsg_zip_path: str, output_path: str) -> None:
    crs_mapping: dict[int, str] = {}

    with ZipFile(epsg_zip_path) as zf:
        crs_entries = [file for file in zf.filelist if "CRS" in file.filename]
        crs_entries = sorted(
            crs_entries, key=lambda x: parse_epsg_from_filename(x.filename)
        )
        for entry in crs_entries:
            epsg_code = parse_epsg_from_filename(entry.filename)
            with zf.open(entry) as f:
                crs_content = f.read().decode("utf-8")

            crs_mapping[epsg_code] = crs_content

    csv_string = format_csv(crs_mapping)
    out = gzip.compress(csv_string.encode("utf-8"))
    with open(output_path, "wb") as f:
        f.write(out)


if __name__ == "__main__":
    main("EPSG-v12_049-WKT.Zip", "../src/epsg.csv.gz")
