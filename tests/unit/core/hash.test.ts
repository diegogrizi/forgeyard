import { describe, expect, test } from "vitest";

import { canonicalJson, sha256Text } from "../../../src/core/hash.js";

describe("canonical JSON hashing", () => {
  test("sorts object keys recursively while preserving array order", () => {
    const value = { z: 1, nested: { y: true, a: "first" }, list: [{ b: 2, a: 1 }, 3] };

    expect(canonicalJson(value)).toBe(
      '{"list":[{"a":1,"b":2},3],"nested":{"a":"first","y":true},"z":1}',
    );
  });

  test("gives key-order variants the same SHA-256 digest", () => {
    const first = sha256Text(canonicalJson({ beta: 2, alpha: { y: 2, x: 1 } }));
    const second = sha256Text(canonicalJson({ alpha: { x: 1, y: 2 }, beta: 2 }));

    expect(first).toBe(second);
  });

  test("returns the standard SHA-256 digest for text", () => {
    expect(sha256Text("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
