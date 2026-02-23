const SEP = "|";

export default async function loadEPSG(): Promise<Map<number, string>> {
  const url = new URL("./epsg.csv.gz", import.meta.url);
  const response = await fetch(url);

  if (!response.body) {
    throw new Error("Response has no body");
  }

  const stream = response.body
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream());

  return parseStream(stream);
}

async function parseStream(
  stream: ReadableStream<string>,
): Promise<Map<number, string>> {
  const reader = stream.getReader();
  const map = new Map<number, string>();

  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += value;

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) continue;

      const sep = line.indexOf(SEP);
      if (sep === -1) continue; // defensive

      const code = Number.parseInt(line.slice(0, sep), 10);
      const wkt = line.slice(sep + 1);

      map.set(code, wkt);
    }
  }

  // handle trailing line (no newline at EOF)
  if (buffer.length > 0) {
    const sep = buffer.indexOf(SEP);
    if (sep !== -1) {
      const code = Number.parseInt(buffer.slice(0, sep), 10);
      const wkt = buffer.slice(sep + 1);
      map.set(code, wkt);
    }
  }

  return map;
}
