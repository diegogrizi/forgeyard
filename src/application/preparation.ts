import type { ForgeyardConfig } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { validateConfig } from "../config/config.js";
import { loadCapabilityRules } from "../intake/capability-rules.js";
import { composeProject } from "../intake/compose.js";
import type {
  ComposeProjectOptions,
  InspectProjectInput,
  PreparationDecision,
  ProjectInspection,
} from "../intake/contracts.js";
import { inspectProject } from "../intake/inspect.js";
import { validateProjectNeeds } from "../intake/semantic.js";
import { BUNDLED_CAPABILITIES, resolveCapabilities } from "../intake/capabilities.js";
import { projectRequirements } from "../intake/requirements.js";
import { canonicalJson, sha256Text } from "../core/hash.js";

export interface AnalyzePreparationInput extends InspectProjectInput, ComposeProjectOptions {}

export interface PreparationAnalysis {
  inspection: ProjectInspection;
  decision: PreparationDecision;
}

export async function analyzePreparation(
  input: AnalyzePreparationInput,
  registryRoot: string,
): Promise<PreparationAnalysis> {
  let inspection = await inspectProject(input);
  if (input.qualityCommands || input.mutableRoots) inspection = { ...inspection,
    qualityCommands: input.qualityCommands ?? inspection.qualityCommands,
    mutableRoots: input.mutableRoots ?? inspection.mutableRoots,
    analysisSha256: sha256Text(canonicalJson({ inspection: inspection.analysisSha256,
      qualityCommands: input.qualityCommands ?? null, mutableRoots: input.mutableRoots ?? null })) };
  const rules = await loadCapabilityRules(registryRoot);
  let decision = composeProject(inspection, input, rules);
  if (input.needsProposal !== undefined) {
    const profile = validateProjectNeeds(inspection, input.needsProposal);
    const requirements = projectRequirements(inspection, profile);
    const resolution = resolveCapabilities(requirements, BUNDLED_CAPABILITIES, {
      client: decision.adapter, allowedLicenses: ["Apache-2.0", "MIT"], maxContextTokens: 32768,
    });
    const plugins = resolution.selected.flatMap((id) => {
      const pluginId = BUNDLED_CAPABILITIES.find((candidate) => candidate.id === id)?.source?.pluginId;
      return pluginId ? [pluginId] : [];
    }).sort();
    const focused = profile.intent === "maintenance";
    decision = { ...decision,
      packs: ["ecosystem", "foundation", ...(!focused ? ["delivery"] : [])].sort(),
      catalog: { selection: "curated", plugins },
      selected: plugins.map((id) => ({ id, reason: "Selected by admitted structured capability coverage, not prompt keywords." })),
      excluded: resolution.excluded.map((item) => ({ id: item.id, reason: item.reason })),
      orchestration: { ...decision.orchestration,
        maxConcurrency: input.maxConcurrency ?? (focused ? 1 : decision.orchestration.maxConcurrency) },
      analysisSha256: sha256Text(canonicalJson({ profile, requirements, resolution })),
      normalizedNeeds: profile,
    };
  }
  return { inspection, decision };
}

export function intakeIncomplete(): ForgeyardError {
  return new ForgeyardError({
    code: "FY_INTAKE_INCOMPLETE",
    message: "Forgeyard could not infer the software outcome from the supplied project inputs.",
    remediation: "Provide --brief with the desired outcome or --spec with a project-relative specification file.",
    exitCode: 2,
  });
}

function bounded(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

export function preparationConfig(
  inspection: ProjectInspection,
  decision: PreparationDecision,
): ForgeyardConfig {
  if (inspection.request.trim().length === 0) throw intakeIncomplete();
  const mutableRoots = new Set(inspection.mutableRoots);

  return validateConfig({
    schemaVersion: 1,
    project: {
      name: bounded(inspection.name, 120),
      purpose: bounded(inspection.request, 500),
      mode: inspection.mode,
    },
    harnesses: [decision.adapter],
    profile: decision.profile,
    catalog: decision.catalog,
    timeboxMinutes: decision.timeboxMinutes,
    quality: { commands: inspection.qualityCommands },
    paths: {
      mutableRoots: [...mutableRoots].sort((left, right) => left.localeCompare(right, "en")),
      protectedPaths: [".env", ".git"],
    },
    orchestration: decision.orchestration,
    intake: {
      strategy: "automatic",
      request: inspection.request,
      sources: inspection.sources,
      kind: inspection.kind,
      languages: inspection.languages,
      frameworks: inspection.frameworks,
      evidence: inspection.evidence.map((item) => {
        const record = inspection.evidenceRecords?.find((record) => record.path === item.path && record.signal === item.signal);
        return record ? { ...item, sha256: record.sha256, locator: record.locator, inference: record.inference } : item;
      }),
      confidence: inspection.confidence,
      questions: inspection.questions,
      ...(inspection.scan ? { scan: inspection.scan } : {}),
    },
    composition: {
      strategy: "automatic",
      packs: decision.packs,
      selected: decision.selected,
      excluded: decision.excluded,
      analysisSha256: decision.analysisSha256,
      ...(decision.normalizedNeeds ? { normalizedNeeds: decision.normalizedNeeds } : {}),
    },
    autonomy: decision.autonomy,
  });
}
