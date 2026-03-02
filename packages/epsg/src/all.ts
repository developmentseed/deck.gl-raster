const SEP = "|";

/** A cached promise for the loaded EPSG database */
let cachedLoad: Promise<Map<number, string>> | null = null;

/**
 * Load the EPSG database into memory.
 *
 * The database is stored as a gzipped CSV file. This function loads and parses
 * the file, returning a map of EPSG code to WKT string.
 *
 * The result is cached after the first call, so subsequent calls will return
 * the cached result.
 *
 * @param url - Optional URL to the gzipped CSV file. When using a bundler like
 * Vite, pass the asset URL directly to ensure correct resolution:
 * `import csvUrl from "@developmentseed/epsg/all.csv.gz?url"`
 */
export default function loadEPSG(
  url?: string | URL,
): Promise<Map<number, string>> {
  if (!cachedLoad) {
    cachedLoad = load(url ?? new URL("./all.csv.gz", import.meta.url));
  }

  return cachedLoad;
}

async function load(url: string | URL): Promise<Map<number, string>> {
  const response = await fetch(url);

  if (!response.body) {
    throw new Error("Response has no body");
  }

  // When the server serves the gzipped file with `Content-Encoding: gzip`, the
  // browser automatically decompresses it, so we can just read the text
  // directly.
  // If the header is missing, we need to decompress it ourselves.
  const alreadyDecompressed =
    response.headers.get("Content-Encoding") === "gzip";

  const stream = !alreadyDecompressed
    ? response.body
        .pipeThrough(new DecompressionStream("gzip"))
        .pipeThrough(new TextDecoderStream())
    : response.body.pipeThrough(new TextDecoderStream());

  return parseStream(stream);
}

async function parseStream(
  stream: ReadableStream<string>,
): Promise<Map<number, string>> {
  const reader = stream.getReader();
  const map = new Map<number, string>();

  let buffer = "";

  while (true) {
    // Read the next chunk from the stream
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += value;

    // The position of the newline character
    let newlineIndex = buffer.indexOf("\n");

    // Iterate over each line in the buffer
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);

      // Update buffer range and search for next newline
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");

      if (!line) {
        continue;
      }

      const sep = line.indexOf(SEP);
      if (sep === -1) {
        throw new Error(`Invalid line, missing separator: ${line}`);
      }

      const code = Number.parseInt(line.slice(0, sep), 10);
      const wkt = line.slice(sep + 1);

      map.set(code, wkt);
    }
  }

  return map;
}
