import type { CompositionChoice, HarnessId } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import type {
  CapabilityRule,
  CapabilityRules,
  ComposeProjectOptions,
  PreparationDecision,
  ProjectInspection,
} from "./contracts.js";

function configError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CONFIG_INVALID",
    message,
    remediation: "Use finite positive limits and a supported Forgeyard option.",
    exitCode: 2,
  });
}

function matches(rule: CapabilityRule, inspection: ProjectInspection): boolean {
  const when = rule.when;
  if (when.kinds?.includes(inspection.kind)) return true;
  if (when.languages?.some((language) => inspection.languages.includes(language))) return true;
  if (when.frameworks?.some((framework) => inspection.frameworks.includes(framework))) return true;
  return when.requestPatterns?.some((pattern) => new RegExp(pattern, "iu").test(inspection.request)) === true;
}

function selectAdapter(
  inspection: ProjectInspection,
  options: ComposeProjectOptions,
): { adapter: HarnessId; reason: string } {
  if (options.adapter !== undefined) return { adapter: options.adapter, reason: "Selected by an explicit project constraint." };
  if (inspection.instructionSurfaces.includes("CLAUDE.md")) {
    return { adapter: "claude-code", reason: "Existing CLAUDE.md instructions identify the project host." };
  }
  if (inspection.instructionSurfaces.includes("AGENTS.md")) {
    return { adapter: "codex", reason: "Existing AGENTS.md instructions identify the project host." };
  }
  for (const adapter of ["codex", "claude-code"] as const) {
    if (options.harnessAvailability?.[adapter] === true) {
      return { adapter, reason: `The ${adapter} executable is available on this host.` };
    }
  }
  return { adapter: "codex", reason: "Codex project layout is the portable format fallback; runtime availability is unverified." };
}

function isFocusedMaintenance(inspection: ProjectInspection, timeboxMinutes: number): boolean {
  return inspection.mode === "existing" && timeboxMinutes <= 180 && /\b(bug|correct|fix|maintain|maintenance|patch|refactor|repair)\b/iu.test(inspection.request);
}

function inferredConcurrency(inspection: ProjectInspection, timeboxMinutes: number): number {
  if (isFocusedMaintenance(inspection, timeboxMinutes)) return 1;
  if (inspection.kind === "full-stack") return 3;
  return 2;
}

function checkedLimits(options: ComposeProjectOptions): { timeboxMinutes: number; maxConcurrency?: number; maxCostUsd?: number } {
  const timeboxMinutes = options.timeboxMinutes ?? 300;
  if (!Number.isInteger(timeboxMinutes) || timeboxMinutes < 30 || timeboxMinutes > 1440) {
    throw configError("Timebox must be an integer between 30 and 1440 minutes.");
  }
  if (options.maxConcurrency !== undefined && (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1 || options.maxConcurrency > 16)) {
    throw configError("Maximum concurrency must be an integer between 1 and 16.");
  }
  if (options.maxCostUsd !== undefined && (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0)) {
    throw configError("Maximum cost must be a finite positive amount.");
  }
  return {
    timeboxMinutes,
    ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
    ...(options.maxCostUsd === undefined ? {} : { maxCostUsd: options.maxCostUsd }),
  };
}

export function composeProject(
  inspection: ProjectInspection,
  options: ComposeProjectOptions,
  rules: CapabilityRules,
): PreparationDecision {
  const limits = checkedLimits(options);
  const selected = new Map<string, CompositionChoice>();
  for (const choice of rules.baseline) selected.set(choice.id, choice);
  for (const rule of rules.rules) {
    if (!matches(rule, inspection)) continue;
    for (const choice of rule.include) selected.set(choice.id, choice);
  }
  for (const exclusion of rules.exclusions) selected.delete(exclusion.id);
  const selectedChoices = [...selected.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  const excluded = [...rules.exclusions].sort((left, right) => left.id.localeCompare(right.id, "en"));
  const focused = isFocusedMaintenance(inspection, limits.timeboxMinutes);
  const packs = new Set(["foundation", "ecosystem"]);
  if (!focused) packs.add("delivery");
  const adapter = selectAdapter(inspection, options);
  const autonomyLevel = options.autonomy ?? "balanced";
  const maxConcurrency = limits.maxConcurrency ?? inferredConcurrency(inspection, limits.timeboxMinutes);

  return {
    schemaVersion: 1,
    profile: "tailored",
    adapter: adapter.adapter,
    adapterReason: adapter.reason,
    catalog: { selection: "curated", plugins: selectedChoices.map((choice) => choice.id) },
    packs: [...packs].sort((left, right) => left.localeCompare(right, "en")),
    selected: selectedChoices,
    excluded,
    timeboxMinutes: limits.timeboxMinutes,
    orchestration: {
      mode: autonomyLevel === "supervised" ? "guided" : "native",
      maxConcurrency,
    },
    autonomy: {
      level: autonomyLevel,
      ...(limits.maxCostUsd === undefined ? {} : { maxCostUsd: limits.maxCostUsd }),
      stopOnAmbiguity: true,
      externalEffects: "ask",
    },
    analysisSha256: inspection.analysisSha256,
  };
}
