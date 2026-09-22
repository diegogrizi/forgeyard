import { describe, expect, test } from "vitest";

import { createHarnessAdapter } from "../../../src/adapters/create.js";

describe("harness adapter factory", () => {
  test.each(["codex", "claude-code"] as const)("creates the %s adapter", (id) => {
    expect(createHarnessAdapter(id).id).toBe(id);
  });

  test("rejects an unknown runtime adapter instead of falling back", () => {
    expect(() => createHarnessAdapter("unknown" as never)).toThrowError(
      expect.objectContaining({ code: "FY_UNSUPPORTED_SELECTION", exitCode: 2 }),
    );
  });
});
