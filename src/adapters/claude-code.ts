import type { ForgeyardConfig, HarnessAdapter } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";

function pending(): ForgeyardError {
  return new ForgeyardError({
    code: "FY_UNSUPPORTED_SELECTION",
    message: "The Claude Code adapter has not finished rendering in this build step.",
    remediation: "Complete the Claude Code adapter before initializing this selection.",
    exitCode: 2,
  });
}

export function createClaudeCodeAdapter(): HarnessAdapter {
  return {
    id: "claude-code",
    capabilities: {
      projectInstructions: "native",
      projectSkills: "native",
      reviewerAgents: "native",
      taskExecution: "emulated",
      evidenceReceipts: "emulated",
      dagScheduling: "unsupported",
    },
    validateConfig(config: ForgeyardConfig): void {
      if (config.harnesses[0] !== "claude-code") throw pending();
    },
    async render() {
      throw pending();
    },
    async validateOutput() {
      throw pending();
    },
  };
}
