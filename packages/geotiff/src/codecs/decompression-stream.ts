export function assert(
  expression: unknown,
  msg: string | undefined = "",
): asserts expression {
  if (!expression) {
    throw new Error(msg);
  }
}

export async function decompressWithDecompressionStream(
  data: Uint8Array,
  { format, signal }: { format: CompressionFormat; signal?: AbortSignal },
): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const transform = new DecompressionStream(
    format,
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;

  const decompressed = new Response(stream.pipeThrough(transform, { signal }));
  return new Uint8Array(await decompressed.arrayBuffer());
}
