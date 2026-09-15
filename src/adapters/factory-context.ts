import type { ForgeyardConfig } from "../core/contracts.js";
import { escapeMarkdownInline } from "./strict-template.js";

function inlineList(values: readonly string[], fallback: string): string {
  return values.length === 0 ? fallback : values.map(escapeMarkdownInline).join(", ");
}

function bulletList(values: readonly string[], fallback: string): string {
  if (values.length === 0) return `- ${fallback}`;
  return values.map((value) => `- ${escapeMarkdownInline(value)}`).join("\n");
}

function choiceList(
  values: readonly { id: string; reason: string }[],
  label: "Selected" | "Excluded",
  fallback: string,
): string {
  if (values.length === 0) return `- ${fallback}`;
  return values
    .map((value) => `- ${label}: \`${escapeMarkdownInline(value.id)}\` — ${escapeMarkdownInline(value.reason)}`)
    .join("\n");
}

export function hasExistingHostInstructions(config: ForgeyardConfig, canonicalPath: string): boolean {
  return config.intake?.strategy === "automatic" && config.intake.evidence.some(
    (item) => item.path === canonicalPath && item.signal.startsWith("host-instructions:"),
  );
}

export function instructionTarget(config: ForgeyardConfig, canonicalPath: string): string {
  return hasExistingHostInstructions(config, canonicalPath) ? ".forgeyard/HOST.md" : canonicalPath;
}

export function compositionVariables(config: ForgeyardConfig): Readonly<Record<string, string>> {
  const intake = config.intake;
  const composition = config.composition;
  const autonomy = config.autonomy;
  return {
    "composition.strategy": escapeMarkdownInline(composition?.strategy ?? "manual"),
    "intake.request": escapeMarkdownInline(intake?.request || config.project.purpose),
    "intake.kind": escapeMarkdownInline(intake?.kind ?? "unknown"),
    "intake.languages": inlineList(intake?.languages ?? [], "None detected"),
    "intake.frameworks": inlineList(intake?.frameworks ?? [], "None detected"),
    "intake.sources": bulletList(intake?.sources ?? [], "No specification source recorded"),
    "intake.evidence": intake?.evidence.length
      ? intake.evidence
        .map((item) => `- ${escapeMarkdownInline(item.path)}: ${escapeMarkdownInline(item.signal)}`)
        .join("\n")
      : "- No repository evidence recorded",
    "composition.selected": choiceList(composition?.selected ?? [], "Selected", "No optional capability selected"),
    "composition.excluded": choiceList(composition?.excluded ?? [], "Excluded", "No capability explicitly excluded"),
    "intake.questions": bulletList(intake?.questions ?? [], "No unresolved product question"),
    "harness.id": escapeMarkdownInline(config.harnesses[0]),
    "autonomy.level": escapeMarkdownInline(autonomy?.level ?? "supervised"),
    "autonomy.maxCost": autonomy?.maxCostUsd === undefined
      ? "Not configured"
      : `USD ${String(autonomy.maxCostUsd)}`,
    "orchestration.mode": escapeMarkdownInline(config.orchestration.mode),
    "workflow.maxConcurrency": String(config.orchestration.maxConcurrency),
    "workflow.timeboxMinutes": String(config.timeboxMinutes),
  };
}

export function projectContextVariables(config: ForgeyardConfig): Readonly<Record<string, string>> {
  const intake = config.intake;
  return {
    "intake.request": escapeMarkdownInline(intake?.request || config.project.purpose),
    "intake.kind": escapeMarkdownInline(intake?.kind ?? "unknown"),
    "intake.languages": inlineList(intake?.languages ?? [], "None detected"),
    "intake.frameworks": inlineList(intake?.frameworks ?? [], "None detected"),
    "intake.sources": bulletList(intake?.sources ?? [], "No specification source recorded"),
    "intake.questions": bulletList(intake?.questions ?? [], "No unresolved product question"),
    "presentation.audience": config.presentation.enabled
      ? escapeMarkdownInline(config.presentation.audience)
      : "Not selected for this preparation",
    "presentation.scope": config.presentation.enabled
      ? escapeMarkdownInline(config.paths.presentation)
      : "Disabled for this preparation",
    "delivery.proofRequirement": config.presentation.enabled
      ? "The offline presentation shows the same behavior and cites only captured evidence."
      : "The delivered behavior is backed by revision-bound verification evidence.",
  };
}
