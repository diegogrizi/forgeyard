import { describe, expect, test } from "vitest";

import { createProgram, runCli, type CliDependencies } from "../../../src/cli/program.js";
import { ForgeyardError } from "../../../src/core/errors.js";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeOut: (value: string) => {
        stdout += value;
      },
      writeErr: (value: string) => {
        stderr += value;
      },
      debug: false,
    },
    read: () => ({ stdout, stderr }),
  };
}

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  const succeed = async () => undefined;
  return {
    version: "0.1.0",
    handlers: {
      init: succeed,
      doctor: succeed,
      verify: succeed,
      update: succeed,
      rollback: succeed,
    },
    ...overrides,
  };
}

describe("Forgeyard CLI boundary", () => {
  test("lists the five M1 commands in help", () => {
    const help = createProgram(dependencies()).helpInformation();

    for (const command of ["init", "doctor", "verify", "update", "rollback"]) {
      expect(help).toContain(command);
    }
  });

  test("prints its injected version without touching the current directory", async () => {
    const capture = captureIo();

    const exitCode = await runCli(["--version"], dependencies(), capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read()).toEqual({ stdout: "0.1.0\n", stderr: "" });
  });

  test("preserves a typed error code and exit code in JSON output", async () => {
    const capture = captureIo();
    const deps = dependencies();
    deps.handlers.doctor = async () => {
      throw new ForgeyardError({
        code: "FY_CONFIG_INVALID",
        message: "Configuration is invalid.",
        remediation: "Correct forgeyard.yaml and retry.",
        exitCode: 2,
      });
    };

    const exitCode = await runCli(["doctor", "--json"], deps, capture.io);

    expect(exitCode).toBe(2);
    expect(JSON.parse(capture.read().stdout)).toEqual({
      ok: false,
      error: {
        code: "FY_CONFIG_INVALID",
        message: "Configuration is invalid.",
        remediation: "Correct forgeyard.yaml and retry.",
      },
    });
    expect(capture.read().stderr).toBe("");
  });

  test("maps an unknown failure to FY_INTERNAL without leaking a stack", async () => {
    const capture = captureIo();
    const deps = dependencies();
    deps.handlers.update = async () => {
      throw new Error("private diagnostic detail");
    };

    const exitCode = await runCli(["update"], deps, capture.io);

    expect(exitCode).toBe(1);
    expect(capture.read().stdout).toBe("");
    expect(capture.read().stderr).toContain("FY_INTERNAL");
    expect(capture.read().stderr).not.toContain("private diagnostic detail");
    expect(capture.read().stderr).not.toContain("at ");
  });
});
