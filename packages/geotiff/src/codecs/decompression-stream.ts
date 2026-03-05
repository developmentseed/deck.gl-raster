export function assert(
  expression: unknown,
  msg: string | undefined = "",
): asserts expression {
  if (!expression) {
    throw new Error(msg);
  }
}

export async function decompressWithDecompressionStream(
  data: ArrayBuffer | Uint8Array,
  { format, signal }: { format: CompressionFormat; signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const array = data instanceof Uint8Array ? data : new Uint8Array(data);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(array);
      controller.close();
    },
  });

  const transform = new DecompressionStream(
    format,
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;

  const decompressed = new Response(stream.pipeThrough(transform, { signal }));
  return await decompressed.arrayBuffer();
}
