import type { ForgeyardConfig } from "../core/contracts.js";
import { stringify } from "yaml";
import { escapeMarkdownInline, quoteYamlString } from "./strict-template.js";

export type ProjectTaskSlot = "task.initial" | "task.implementation" | "task.review" | "task.demo";

const TASK_WEIGHTS: Readonly<Record<ProjectTaskSlot, number>> = {
  "task.initial": 0.3,
  "task.implementation": 0.45,
  "task.review": 0.1,
  "task.demo": 0.15,
};

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

/**
 * Navigational instructions must not point at a seed this composition does not install.
 * The sentence is derived from the slots actually being rendered, not from the profile name.
 */
export function continuityVariables(slots: ReadonlySet<string>): Readonly<Record<string, string>> {
  const brief = slots.has("project.brief");
  const handoff = slots.has("memory.handoff");
  if (brief && handoff) {
    return { "continuity.sources": "Read `PROJECT.md` for the visible journey and `.forgeyard/handoffs/CURRENT.md` when resuming another session." };
  }
  if (brief) return { "continuity.sources": "Read `PROJECT.md` for the visible journey; this composition installs no handoff seed." };
  if (handoff) return { "continuity.sources": "Read `.forgeyard/handoffs/CURRENT.md` when resuming another session." };
  return { "continuity.sources": "This composition installs no delivery seed: resume from `fy_context` and the frozen capsule." };
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

function taskRole(config: ForgeyardConfig, slot: ProjectTaskSlot): string {
  if (slot === "task.review") return "read-only-reviewer";
  if (slot === "task.demo") return "demo-producer";
  const kind = config.intake?.kind ?? "unknown";
  return ({
    frontend: "frontend-implementer",
    backend: "backend-implementer",
    "full-stack": "full-stack-implementer",
    mobile: "mobile-implementer",
    data: "data-implementer",
    infrastructure: "infrastructure-implementer",
    library: "library-implementer",
    cli: "cli-implementer",
    unknown: "software-implementer",
  } as const)[kind];
}

function activeTaskSlots(config: ForgeyardConfig): readonly ProjectTaskSlot[] {
  const packs = new Set(config.composition?.packs ?? []);
  return [
    "task.initial" as const,
    ...(packs.has("delivery") ? ["task.implementation" as const, "task.review" as const] : []),
    ...(packs.has("presentation") && config.presentation.enabled ? ["task.demo" as const] : []),
  ];
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function taskBudget(config: ForgeyardConfig, slot: ProjectTaskSlot): number | undefined {
  const total = config.autonomy?.maxCostUsd;
  if (total === undefined) return undefined;
  const slots = activeTaskSlots(config);
  const index = slots.indexOf(slot);
  if (index < 0) return undefined;
  const totalWeight = slots.reduce((sum, candidate) => sum + TASK_WEIGHTS[candidate], 0);
  const allocated = slots.slice(0, -1).map((candidate) => rounded(total * TASK_WEIGHTS[candidate] / totalWeight));
  return index === slots.length - 1
    ? rounded(total - allocated.reduce((sum, value) => sum + value, 0))
    : allocated[index];
}

function taskCapabilities(config: ForgeyardConfig, slot: ProjectTaskSlot): readonly string[] {
  const selected = config.composition?.selected.map((choice) => choice.id) ?? [];
  if (selected.length > 0) return selected;
  if (slot === "task.review") return ["code-review", "risk-analysis"];
  if (slot === "task.demo") return ["demo-rehearsal", "evidence-curation", "presentation"];
  return ["implementation", "testing"];
}

function taskWording(config: ForgeyardConfig, slot: ProjectTaskSlot): {
  title: string;
  objective: string;
  criterion: string;
} {
  const request = config.project.purpose.trim().replaceAll(/[\r\n]+/g, " ");
  const short = request.slice(0, 140);
  const kind = config.intake?.kind ?? "software";
  switch (slot) {
    case "task.initial":
      return {
        title: `Deliver the first verified slice: ${short}`,
        objective: `Establish an observable ${kind} slice for the requested outcome: ${request}`,
        criterion: `The observable behavior advances this requested outcome: ${request}`,
      };
    case "task.implementation":
      return {
        title: `Harden the requested outcome: ${short}`,
        objective: `Complete the critical path and edge states for the requested outcome: ${request}`,
        criterion: `The reliable implementation satisfies this requested outcome: ${request}`,
      };
    case "task.review":
      return {
        title: `Review the requested outcome independently: ${short}`,
        objective: `Review the frozen revision against the requested outcome: ${request}`,
        criterion: `The review explicitly evaluates this requested outcome: ${request}`,
      };
    case "task.demo":
      return {
        title: `Demonstrate the requested outcome: ${short}`,
        objective: `Make the verified result understandable and reproducible for this requested outcome: ${request}`,
        criterion: `The demonstration visibly proves this requested outcome: ${request}`,
      };
  }
}

export function taskContractVariables(
  config: ForgeyardConfig,
  slot: ProjectTaskSlot,
): Readonly<Record<string, string>> {
  const wording = taskWording(config, slot);
  const budget = taskBudget(config, slot);
  return {
    "task.title": quoteYamlString(wording.title),
    "task.commands": stringify(config.quality.commands).trimEnd(),
    "task.objective": quoteYamlString(wording.objective),
    "task.requestCriterion": quoteYamlString(wording.criterion),
    "task.role": quoteYamlString(taskRole(config, slot)),
    "task.capabilities": taskCapabilities(config, slot).map((id) => `  - ${quoteYamlString(id)}`).join("\n"),
    "task.costLimit": budget === undefined ? "" : `  maxCostUsd: ${String(budget)}\n`,
  };
}
