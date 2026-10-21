import type { HarnessAdapter, HarnessId } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { createClaudeCodeAdapter } from "./claude-code.js";
import { createCodexAdapter } from "./codex.js";
import type { CatalogDownloadOptions } from "../catalog/acquire.js";

export function createHarnessAdapter(id: HarnessId, catalogOptions: CatalogDownloadOptions = {}): HarnessAdapter {
  switch (id) {
    case "codex":
      return createCodexAdapter(catalogOptions);
    case "claude-code":
      return createClaudeCodeAdapter(catalogOptions);
    default:
      throw new ForgeyardError({
        code: "FY_UNSUPPORTED_SELECTION",
        message: `Adapter '${String(id)}' is not supported by Forgeyard.`,
        remediation: "Use adapter 'codex' or 'claude-code'.",
        exitCode: 2,
      });
  }
}
