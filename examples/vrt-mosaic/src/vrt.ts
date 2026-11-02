import type { Point } from "@developmentseed/proj";
import {
  geographicBounds,
  parseWkt,
  projectionFunctions,
} from "@developmentseed/proj";

/** One source file of a VRT mosaic, as a `MosaicLayer` item. */
export type VrtItem = {
  /** The file's URL, which keys `MosaicLayer`'s cache of opened sources. */
  id: string;
  /** The file's URL. */
  url: string;
  /** WGS84 bounds of the file's place in the VRT, `[west, south, east, north]`. */
  bbox: [number, number, number, number];
};

const VSICURL = "/vsicurl/";

/**
 * Read the source files of a GDAL VRT mosaic, such as `gdalbuildvrt` writes,
 * in the order the VRT lists them.
 *
 * A file listed under several bands is one item. Only each file's place in
 * the VRT (its `DstRect`) is read, since each file is drawn with its own
 * georeferencing; `SrcRect`, scaling and other per-source options are ignored.
 *
 * @param xml The VRT's XML.
 * @param vrtUrl The VRT's URL, which `relativeToVRT` paths resolve against.
 * @throws If the VRT isn't a plain mosaic: a warped VRT, a derived band, a
 * rotated geotransform, or a source path that isn't a URL.
 */
export function parseVrt(xml: string, vrtUrl: string | URL): VrtItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("VRT is not valid XML");
  }
  if (root.localName !== "VRTDataset") {
    throw new Error(`Not a VRT: root element is <${root.localName}>`);
  }
  const subClass = root.getAttribute("subClass");
  if (subClass) {
    throw new Error(`Unsupported VRT: ${subClass}`);
  }

  const [x0, dx, rx, y0, ry, dy] = readGeoTransform(root);
  if (rx !== 0 || ry !== 0) {
    throw new Error("Unsupported VRT: rotated GeoTransform");
  }
  const { projectTo4326 } = projectionFunctions(
    parseWkt(childText(root, "SRS")),
  );

  const items = new Map<string, VrtItem>();
  for (const band of children(root, "VRTRasterBand")) {
    const bandSubClass = band.getAttribute("subClass");
    if (bandSubClass) {
      throw new Error(`Unsupported VRT band: ${bandSubClass}`);
    }
    for (const source of band.children) {
      const filename = child(source, "SourceFilename");
      if (!filename) {
        continue;
      }
      const url = sourceUrl(filename, vrtUrl);
      if (items.has(url)) {
        continue;
      }

      const dst = child(source, "DstRect");
      if (!dst) {
        throw new Error(`VRT source ${url} has no DstRect`);
      }
      const xOff = numberAttr(dst, "xOff");
      const yOff = numberAttr(dst, "yOff");
      const left = x0 + xOff * dx;
      const right = x0 + (xOff + numberAttr(dst, "xSize")) * dx;
      const top = y0 + yOff * dy;
      const bottom = y0 + (yOff + numberAttr(dst, "ySize")) * dy;
      const outline: Point[] = [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ];
      const bbox = geographicBounds(outline, projectTo4326);
      items.set(url, { id: url, url, bbox });
    }
  }
  return [...items.values()];
}

/** The URL of a `SourceFilename`: a `/vsicurl/` path, a URL, or a path relative to the VRT. */
function sourceUrl(filename: Element, vrtUrl: string | URL): string {
  const path = (filename.textContent ?? "").trim();
  if (filename.getAttribute("relativeToVRT") === "1") {
    return new URL(path, vrtUrl).href;
  }
  const url = path.startsWith(VSICURL) ? path.slice(VSICURL.length) : path;
  if (!/^https?:\/\//.test(url)) {
    throw new Error(`Unsupported VRT source path: ${path}`);
  }
  return url;
}

/** The VRT's six `GeoTransform` coefficients, in GDAL's order. */
function readGeoTransform(
  root: Element,
): [number, number, number, number, number, number] {
  const values = childText(root, "GeoTransform").split(",").map(Number);
  if (values.length !== 6 || values.some((v) => !Number.isFinite(v))) {
    throw new Error(`Invalid VRT GeoTransform: ${values.join(", ")}`);
  }
  return values as [number, number, number, number, number, number];
}

/** The direct children of `parent` named `name`. */
function children(parent: Element, name: string): Element[] {
  return [...parent.children].filter((el) => el.localName === name);
}

/** The first direct child of `parent` named `name`, if any. */
function child(parent: Element, name: string): Element | undefined {
  return children(parent, name)[0];
}

/** The text of the direct child of `parent` named `name`. */
function childText(parent: Element, name: string): string {
  const el = child(parent, name);
  if (!el) {
    throw new Error(`VRT has no <${name}>`);
  }
  return (el.textContent ?? "").trim();
}

/** The numeric attribute `name` of `el`. */
function numberAttr(el: Element, name: string): number {
  const value = Number(el.getAttribute(name));
  if (!el.hasAttribute(name) || !Number.isFinite(value)) {
    throw new Error(`Invalid VRT <${el.localName}> ${name}`);
  }
  return value;
}
