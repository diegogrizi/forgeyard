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

  /**
   * The other direction, which the test above cannot see: a command defined in the native CLI
   * but absent from the routed list is unreachable through the binary — the same defect as the
   * shorter second copy, in mirror image. The native program is built inside `runNativeCli`,
   * so its own help output is where the names it defines can be read.
   */
  test("every command the native CLI defines is a name the binary routes", async () => {
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((value: string | Uint8Array) => {
      written.push(typeof value === "string" ? value : Buffer.from(value).toString("utf8"));
      return true;
    });
    try {
      await expect(runNativeCli(["--help"])).resolves.toBe(0);
    } finally {
      write.mockRestore();
    }
    const help = written.join("");
    const commands = help.slice(help.indexOf("Commands:"));
    const defined = [...commands.matchAll(/^ {2}(\S+)/gm)].map((match) => match[1]!).filter((name) => name !== "help");

    expect(defined.length).toBeGreaterThan(0);
    expect(defined.filter((name) => !NATIVE_COMMANDS.includes(name))).toEqual([]);
  });

  test("the legacy program defines none of them, so the router must consult the list", () => {
    const legacy = new Set(createProgram().commands.map((command) => command.name()));

    expect(NATIVE_COMMANDS.filter((name) => legacy.has(name))).toEqual([]);
  });
});
