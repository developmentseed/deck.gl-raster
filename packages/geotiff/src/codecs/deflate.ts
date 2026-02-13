let codec: any;

async function getCodec() {
  if (!codec) {
    const { Zlib } = await import("numcodecs/zlib");
    codec = new Zlib();
  }
  return codec;
}

export async function decode(bytes: Uint8Array): Promise<Uint8Array> {
  const c = await getCodec();
  return c.decode(bytes);
}
