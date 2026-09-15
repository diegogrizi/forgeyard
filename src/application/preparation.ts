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

export interface AnalyzePreparationInput extends InspectProjectInput, ComposeProjectOptions {}

export interface PreparationAnalysis {
  inspection: ProjectInspection;
  decision: PreparationDecision;
}

export async function analyzePreparation(
  input: AnalyzePreparationInput,
  registryRoot: string,
): Promise<PreparationAnalysis> {
  const inspection = await inspectProject(input);
  const rules = await loadCapabilityRules(registryRoot);
  const decision = composeProject(inspection, input, rules);
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
  if (decision.presentation.enabled) mutableRoots.add("presentation");

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
      presentation: "presentation",
    },
    orchestration: decision.orchestration,
    presentation: decision.presentation,
    intake: {
      strategy: "automatic",
      request: inspection.request,
      sources: inspection.sources,
      kind: inspection.kind,
      languages: inspection.languages,
      frameworks: inspection.frameworks,
      evidence: inspection.evidence,
      confidence: inspection.confidence,
      questions: inspection.questions,
    },
    composition: {
      strategy: "automatic",
      packs: decision.packs,
      selected: decision.selected,
      excluded: decision.excluded,
      analysisSha256: decision.analysisSha256,
    },
    autonomy: decision.autonomy,
  });
}
