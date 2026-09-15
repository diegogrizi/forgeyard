import type { HarnessAdapter, HarnessId } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { createClaudeCodeAdapter } from "./claude-code.js";
import { createCodexAdapter } from "./codex.js";
import { createCursorAdapter } from "./cursor.js";

export function createHarnessAdapter(id: HarnessId): HarnessAdapter {
  switch (id) {
    case "codex":
      return createCodexAdapter();
    case "claude-code":
      return createClaudeCodeAdapter();
    case "cursor":
      return createCursorAdapter();
    default:
      throw new ForgeyardError({
        code: "FY_UNSUPPORTED_SELECTION",
        message: `Adapter '${String(id)}' is not supported by Forgeyard.`,
        remediation: "Use adapter 'codex', 'claude-code', or 'cursor'.",
        exitCode: 2,
      });
  }
}
