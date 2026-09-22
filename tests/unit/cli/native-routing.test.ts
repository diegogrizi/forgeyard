import { describe, expect, test, vi } from "vitest";

import { NATIVE_COMMANDS, runNativeCli } from "../../../src/native/cli.js";
import { createProgram } from "../../../src/cli/program.js";

describe("native command routing", () => {
  test("every routed name is a command the native CLI actually defines", async () => {
    // The binary previously routed on a second, shorter copy of this list, so three
    // documented commands reached the legacy program and failed as unknown.
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      for (const name of NATIVE_COMMANDS) {
        await expect(runNativeCli([name, "--help"])).resolves.toBe(0);
      }
    } finally {
      write.mockRestore();
    }
  });

  test("the legacy program defines none of them, so the router must consult the list", () => {
    const legacy = new Set(createProgram().commands.map((command) => command.name()));

    expect(NATIVE_COMMANDS.filter((name) => legacy.has(name))).toEqual([]);
  });
});
