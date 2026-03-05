export function copyIfNeeded(view: Uint8Array): ArrayBuffer {
  // If the view is already aligned, we can return its underlying buffer directly
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }

  // Otherwise, we need to copy the relevant portion of the buffer into a new ArrayBuffer
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
