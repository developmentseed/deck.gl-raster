function f(t){if(t.byteOffset===0&&t.byteLength===t.buffer.byteLength)return t.buffer;const e=new Uint8Array(t.byteLength);return e.set(t),e.buffer}export{f as c};
