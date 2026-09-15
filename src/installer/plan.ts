import path from "node:path";

import type { ForgeyardConfig, InstallPlan, PlannedFile } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { sha256Text } from "../core/hash.js";
import { assertNoCaseCollisions, normalizePortablePath } from "../core/paths.js";
import type { ResolvedProfile } from "../registry/resolve.js";
import { serializeConfig } from "../config/config.js";

export interface BuildInstallPlanInput {
  targetRoot: string;
  config: ForgeyardConfig;
  resolved: ResolvedProfile;
  renderedFiles: readonly PlannedFile[];
  operationId: string;
  forgeyardVersion: string;
}

function plannedFile(
  filePath: string,
  content: string,
  componentId: string,
  ownership: "managed" | "seed",
): PlannedFile {
  return {
    path: normalizePortablePath(filePath),
    content,
    sha256: sha256Text(content),
    componentId,
    ownership,
  };
}

function lockContent(input: BuildInstallPlanInput): string {
  const targets = new Map(input.renderedFiles.map((file) => [file.componentId, file]));
  const value = {
    schemaVersion: 1,
    forgeyardVersion: input.forgeyardVersion,
    profile: { id: input.resolved.profileId, version: input.resolved.profileVersion },
    adapter: input.resolved.adapter,
    packs: input.resolved.packIds,
    components: input.resolved.components.map((component) => {
      const target = targets.get(component.id);
      if (target === undefined) {
        throw new ForgeyardError({
          code: "FY_REGISTRY_INVALID",
          message: `Resolved component '${component.id}' has no rendered target.`,
          remediation: "Render every resolved component before building an install plan.",
          exitCode: 3,
          components: [component.id],
        });
      }
      return {
        id: component.id,
        packId: component.packId,
        packVersion: component.packVersion,
        sourceSha256: component.sha256,
        targetPath: target.path,
        targetSha256: target.sha256,
      };
    }),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildInstallPlan(input: BuildInstallPlanInput): InstallPlan {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/.test(input.operationId)) {
    throw new ForgeyardError({
      code: "FY_PATH_UNSAFE",
      message: "Operation ID is not safe for local state paths.",
      remediation: "Generate an operation ID containing only letters, numbers, dot, dash, and underscore.",
      exitCode: 4,
    });
  }

  const files = [
    plannedFile("forgeyard.yaml", serializeConfig(input.config), "forgeyard.config", "seed"),
    plannedFile("forgeyard.lock", lockContent(input), "forgeyard.lock", "managed"),
    plannedFile(
      ".forgeyard/.gitignore",
      "evidence/\nstate/staging/\nstate/backups/\n",
      "forgeyard.runtime-ignore",
      "managed",
    ),
    ...input.renderedFiles,
  ];
  assertNoCaseCollisions(files.map((file) => file.path));
  if (new Set(files.map((file) => file.componentId)).size !== files.length) {
    throw new ForgeyardError({
      code: "FY_COMPONENT_CONFLICT",
      message: "Install plan contains duplicate component IDs.",
      remediation: "Correct the registry or adapter output.",
      exitCode: 3,
    });
  }
  for (const file of files) {
    if (file.sha256 !== sha256Text(file.content)) {
      throw new ForgeyardError({
        code: "FY_REGISTRY_INVALID",
        message: `Planned file '${file.path}' has an invalid content hash.`,
        remediation: "Re-render the install plan.",
        exitCode: 3,
        paths: [file.path],
      });
    }
  }

  return {
    schemaVersion: 1,
    operationId: input.operationId,
    targetRoot: path.resolve(input.targetRoot),
    profile: "hackathon",
    adapter: "codex",
    files,
  };
}
