import { describe, expect, expectTypeOf, it } from "vitest";
import { fileIdentity, initSignature } from "../src/identity.js";
import type { FileKey } from "../src/types.js";

const URL_A = new URL("https://x.test/a.tif");

describe("fileIdentity", () => {
  it("keys a bare URL by href", () => {
    const id = fileIdentity("https://x.test/a.tif");
    expect(id.key).toBe("https://x.test/a.tif ");
    expect(id.url.href).toBe("https://x.test/a.tif");
    expect(id.init).toBeUndefined();
  });

  it("gives the same key for the same headers in any form and order", () => {
    const a = fileIdentity(URL_A, {
      headers: { Authorization: "Bearer t", "X-B": "1" },
    });
    const b = fileIdentity(URL_A, {
      headers: [
        ["x-b", "1"],
        ["authorization", "Bearer t"],
      ],
    });
    const c = fileIdentity(URL_A, {
      headers: new Headers({ "X-B": "1", authorization: "Bearer t" }),
    });
    expect(b.key).toBe(a.key);
    expect(c.key).toBe(a.key);
  });

  it("separates different credentials and modes", () => {
    expect(fileIdentity(URL_A, { credentials: "include" }).key).not.toBe(
      fileIdentity(URL_A, { credentials: "omit" }).key,
    );
    expect(fileIdentity(URL_A, { mode: "cors" }).key).not.toBe(
      fileIdentity(URL_A).key,
    );
  });

  it("ignores signal and cache mode", () => {
    const withExtras = fileIdentity(URL_A, {
      signal: new AbortController().signal,
      cache: "no-store",
    });
    expect(withExtras.key).toBe(fileIdentity(URL_A, {}).key);
  });

  it("keeps the URL and the signature apart in the key", () => {
    // A URL cannot contain a space, so the first space is the split point
    // whatever the signature holds.
    const id = fileIdentity("https://x.test/a%20b.tif", {
      headers: { "x-note": "a b" },
    });
    const at = id.key.indexOf(" ");
    expect(id.key.slice(0, at)).toBe("https://x.test/a%20b.tif");
    expect(id.key.slice(at + 1)).toBe(initSignature(id.init));
  });

  it("brands the key so a plain string is not one", () => {
    expectTypeOf<string>().not.toMatchTypeOf<FileKey>();
    expectTypeOf(
      fileIdentity("https://x.test/a.tif").key,
    ).toMatchTypeOf<string>();
  });

  it("separates different URLs", () => {
    expect(fileIdentity("https://x.test/a.tif").key).not.toBe(
      fileIdentity("https://x.test/b.tif").key,
    );
  });
});

describe("initSignature", () => {
  it("is empty without an init", () => {
    expect(initSignature()).toBe("");
  });

  it("is deterministic for header order", () => {
    expect(initSignature({ headers: { b: "2", a: "1" } })).toBe(
      initSignature({ headers: { a: "1", b: "2" } }),
    );
  });
});
