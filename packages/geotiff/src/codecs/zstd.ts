import { decompress } from "fzstd";

export async function decode(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const result = decompress(new Uint8Array(bytes));
  return copyIfViewNotFullBuffer(result);
}

// Duplicated in lzw.ts: sharing this via a separate module causes the bundler
// to emit a tiny shared chunk, adding a roundtrip on the codec's critical path.
function copyIfViewNotFullBuffer(view: Uint8Array): ArrayBuffer {
  // If the view is already aligned, we can return its underlying buffer directly
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }

  // Otherwise, we need to copy the relevant portion of the buffer into a new ArrayBuffer
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
