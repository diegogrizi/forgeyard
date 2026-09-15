import type { ForgeyardConfig, HarnessAdapter } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";

function pending(): ForgeyardError {
  return new ForgeyardError({
    code: "FY_UNSUPPORTED_SELECTION",
    message: "The Cursor adapter has not finished rendering in this build step.",
    remediation: "Complete the Cursor adapter before initializing this selection.",
    exitCode: 2,
  });
}

export function createCursorAdapter(): HarnessAdapter {
  return {
    id: "cursor",
    capabilities: {
      projectInstructions: "native",
      projectSkills: "adapted",
      reviewerAgents: "adapted",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    },
    validateConfig(config: ForgeyardConfig): void {
      if (config.harnesses[0] !== "cursor") throw pending();
    },
    async render() {
      throw pending();
    },
    async validateOutput() {
      throw pending();
    },
  };
}
