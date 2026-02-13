import { Compression } from "@cogeotiff/core";
import { decode as uncompressedDecode } from "../codecs/none.js";

export type Decoder = (bytes: Uint8Array) => Promise<Uint8Array>;

export const registry = new Map<Compression, () => Promise<Decoder>>();

registry.set(Compression.None, () => Promise.resolve(uncompressedDecode));
registry.set(Compression.Deflate, () =>
  import("../codecs/deflate.js").then((m) => m.decode),
);
registry.set(Compression.DeflateOther, () =>
  import("../codecs/deflate.js").then((m) => m.decode),
);
registry.set(Compression.Zstd, () =>
  import("../codecs/zstd.js").then((m) => m.decode),
);
registry.set(Compression.Lzma, () =>
  import("../codecs/lzma.js").then((m) => m.decode),
);
registry.set(Compression.Webp, () =>
  import("../codecs/webp.js").then((m) => m.decode),
);
registry.set(Compression.Jp2000, () =>
  import("../codecs/jp2000.js").then((m) => m.decode),
);
registry.set(Compression.Jpeg, () =>
  import("../codecs/jpeg.js").then((m) => m.decode),
);
registry.set(Compression.Jpeg6, () =>
  import("../codecs/jpeg.js").then((m) => m.decode),
);
registry.set(Compression.Lerc, () =>
  import("../codecs/lerc.js").then((m) => m.decode),
);

export async function decode(
  bytes: ArrayBuffer,
  compression: Compression,
): Promise<ArrayBuffer> {
  const loader = registry.get(compression);
  if (!loader) {
    throw new Error(`Unsupported compression: ${compression}`);
  }

  const decoder = await loader();

  const input = new Uint8Array(bytes);
  const output = await decoder(input);

  return output.buffer;
}
