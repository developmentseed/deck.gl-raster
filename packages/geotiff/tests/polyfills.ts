import { Compression } from "@cogeotiff/core";
import { DECODER_REGISTRY } from "../src/decode.js";

async function identity(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return bytes;
}

// Currently we only support decoding JPEG/WebP decoding via canvas, which would
// cause all tests using those codecs to fail in Node
//
// There's still some benefit to being able to load the data; e.g. we can
// validate mask equality, since masks usually use Deflate compression
DECODER_REGISTRY.set(Compression.Jpeg, () => Promise.resolve(identity));
DECODER_REGISTRY.set(Compression.Jpeg6, () => Promise.resolve(identity));
DECODER_REGISTRY.set(Compression.Webp, () => Promise.resolve(identity));
