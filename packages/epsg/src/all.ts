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
