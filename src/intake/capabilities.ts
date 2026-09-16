import { ForgeyardError } from "../core/errors.js";

/** Locally attested descriptors; admission/license metadata are caller-owned, never agent-proposed. */
export interface CapabilityCandidate {
  id: string;
  provides: readonly string[];
  admitted: boolean;
  license: string;
  clients: readonly string[];
  permissions: readonly string[];
  contextTokens: number;
  dependencies: readonly string[];
  conflicts: readonly string[];
  orchestration?: boolean;
  exclusiveGroup?: string;
  source?: { sourceId?: string; original?: boolean; pluginId?: string; skillPath?: string; support: "descriptor-only" };
}
/** Caller-attested catalog source and inventory, not model-proposed provenance. */
export interface CapabilitySourceRecord {
  sourceId: string;
  license: string;
  pluginIds: readonly string[];
}
export interface CapabilityConstraints {
  client: string;
  allowedLicenses?: readonly string[];
  allowedPermissions?: readonly string[];
  maxContextTokens?: number;
  maxStates?: number;
  sources?: readonly CapabilitySourceRecord[];
}
export interface CapabilityExclusion { id: string; reason: string }
export interface CapabilityResolution {
  selected: readonly string[];
  excluded: readonly CapabilityExclusion[];
  coverage: readonly { requirement: string; providers: readonly string[] }[];
  exploredStates: number;
  contextTokens: number;
}

// Curated mapping over existing first-party and pinned MIT vendored definitions.
// Context values are policy reservations, not measured model usage or live/evaluated support.
function bundled(id: string, provides: readonly string[], source: NonNullable<CapabilityCandidate["source"]>, orchestration = false): CapabilityCandidate {
  return { id, provides, admitted: true, license: source.pluginId === undefined ? "Apache-2.0" : "MIT", clients: ["codex", "claude-code", "cursor"], permissions: [], contextTokens: 4096, dependencies: [], conflicts: [], orchestration, ...(orchestration ? { exclusiveGroup: "workflow.primary" } : {}), source };
}
export const BUNDLED_CAPABILITIES: readonly CapabilityCandidate[] = [
  bundled("forgeyard-workflow", ["method.coordinate"], { original: true, skillPath: "packs/foundation/skills/forgeyard-workflow/SKILL.md.tpl", support: "descriptor-only" }, true),
  bundled("unit-testing", ["quality.test"], { sourceId: "github.wshobson-agents", pluginId: "unit-testing", support: "descriptor-only" }),
  bundled("comprehensive-review", ["quality.review"], { sourceId: "github.wshobson-agents", pluginId: "comprehensive-review", support: "descriptor-only" }),
  bundled("documentation-generation", ["quality.docs"], { sourceId: "github.wshobson-agents", pluginId: "documentation-generation", support: "descriptor-only" }),
  bundled("frontend-mobile-development", ["domain.react"], { sourceId: "github.wshobson-agents", pluginId: "frontend-mobile-development", support: "descriptor-only" }),
  bundled("jvm-languages", ["domain.java", "domain.spring"], { sourceId: "github.wshobson-agents", pluginId: "jvm-languages", support: "descriptor-only" }),
];
/** Offline default registry checked against the pinned manifest and real vendored inventory by the intake suite. */
export const BUNDLED_CAPABILITY_SOURCES: readonly CapabilitySourceRecord[] = [
  { sourceId: "github.wshobson-agents", license: "MIT", pluginIds: ["unit-testing", "comprehensive-review", "documentation-generation", "frontend-mobile-development", "jvm-languages"] },
];
function failure(message: string, code = "FY_INTAKE_UNSAFE"): never {
  throw new ForgeyardError({ code, message, remediation: "Use admitted licensed capabilities satisfying the project constraints.", exitCode: 4 });
}
function names(values: readonly string[], max = 128): boolean {
  return Array.isArray(values) && values.length <= max && values.every((value) => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value));
}

/** Exact closed cover: minimize component count, distinct permissions, context reservation, then lexicographic IDs. Exactly one coordinator is mandatory. */
export function resolveCapabilities(requirements: readonly string[], candidates: readonly CapabilityCandidate[], constraints: CapabilityConstraints): CapabilityResolution {
  const maxStates = constraints.maxStates ?? 10_000;
  if (!Number.isInteger(maxStates) || maxStates < 1 || maxStates > 10_000) failure("Resolution state limit must be between 1 and 10000.");
  if (!names(requirements) || candidates.length > 256 || typeof constraints.client !== "string" || constraints.client.length === 0 || (constraints.maxContextTokens !== undefined && (!Number.isSafeInteger(constraints.maxContextTokens) || constraints.maxContextTokens < 0))) failure("Invalid bounded capability constraints.");
  const required = [...new Set(requirements)].sort();
  const records = new Map<string, CapabilityCandidate>();
  for (const candidate of candidates) {
    if (!names([candidate.id]) || records.has(candidate.id) || !names(candidate.provides) || !names(candidate.dependencies) || !names(candidate.conflicts) || !names(candidate.clients) || !names(candidate.permissions) || !Number.isSafeInteger(candidate.contextTokens) || candidate.contextTokens < 0 || typeof candidate.admitted !== "boolean" || typeof candidate.license !== "string" || (candidate.orchestration !== undefined && typeof candidate.orchestration !== "boolean") || (candidate.exclusiveGroup !== undefined && !names([candidate.exclusiveGroup]))) failure("Invalid capability descriptor.");
    records.set(candidate.id, candidate);
  }
  const excluded = new Map<string, string>();
  const sources = new Map<string, CapabilitySourceRecord>();
  for (const source of constraints.sources ?? BUNDLED_CAPABILITY_SOURCES) {
    if (!names([source.sourceId]) || sources.has(source.sourceId) || typeof source.license !== "string" || !names(source.pluginIds, 256)) failure("Invalid trusted capability source registry.");
    sources.set(source.sourceId, source);
  }
  const permissions = constraints.allowedPermissions ?? [];
  const budget = constraints.maxContextTokens ?? Number.MAX_SAFE_INTEGER;
  for (const candidate of records.values()) {
    const license = candidate.license.trim();
    const source = candidate.source;
    const registeredSource = source?.sourceId === undefined ? undefined : sources.get(source.sourceId);
    const sourceReason = source === undefined ? undefined : source.original === true && source.sourceId === undefined && source.pluginId === undefined ? undefined : registeredSource === undefined ? "source-unavailable" : source.pluginId === undefined || !registeredSource.pluginIds.includes(source.pluginId) ? "plugin-unavailable" : registeredSource.license !== candidate.license ? "source-license-mismatch" : undefined;
    const reason = !candidate.admitted ? "not-admitted" : license.length === 0 || ["UNLICENSED", "NONE", "NOASSERTION"].includes(license.toUpperCase()) ? "unlicensed" : sourceReason ?? (constraints.allowedLicenses !== undefined && !constraints.allowedLicenses.includes(candidate.license) ? "license-not-allowed" : !candidate.clients.includes(constraints.client) ? "client-incompatible" : candidate.permissions.some((permission) => !permissions.includes(permission)) ? "permission-not-allowed" : candidate.contextTokens > budget ? "context-budget" : undefined);
    if (reason !== undefined) excluded.set(candidate.id, reason);
  }
  const closureCache = new Map<string, Set<string>>();
  function closure(id: string, visiting = new Set<string>()): Set<string> | undefined {
    if (visiting.has(id)) { excluded.set(id, "dependency-cycle"); return undefined; }
    const candidate = records.get(id);
    if (candidate === undefined || excluded.has(id)) return undefined;
    const cached = closureCache.get(id);
    if (cached !== undefined) return cached;
    const next = new Set(visiting).add(id);
    const result = new Set([id]);
    for (const dependency of [...candidate.dependencies].sort()) {
      const child = closure(dependency, next);
      if (child === undefined) { if (!excluded.has(id)) excluded.set(id, records.has(dependency) ? "dependency-unavailable" : "dependency-missing"); return undefined; }
      for (const member of child) result.add(member);
    }
    closureCache.set(id, result);
    return result;
  }
  const closures = new Map<string, Set<string>>();
  for (const id of [...records.keys()].sort()) { const value = closure(id); if (value !== undefined) closures.set(id, value); }
  // Recompute after cycle/dependency exclusions have propagated.
  for (const [id, value] of closures) if ([...value].some((member) => excluded.has(member))) { closures.delete(id); excluded.set(id, "dependency-unavailable"); }
  function valid(selected: ReadonlySet<string>): boolean {
    const members = [...selected].map((id) => records.get(id)!);
    if (members.filter((item) => item.orchestration).length > 1 || members.reduce((sum, item) => sum + item.contextTokens, 0) > budget) return false;
    const groups = members.flatMap((item) => item.exclusiveGroup === undefined ? [] : [item.exclusiveGroup]);
    return new Set(groups).size === groups.length && members.every((item) => item.conflicts.every((id) => !selected.has(id)));
  }
  let states = 0;
  let best: string[] | undefined;
  function score(selected: readonly string[]): readonly number[] {
    return [selected.length, new Set(selected.flatMap((id) => records.get(id)!.permissions)).size, selected.reduce((sum, id) => sum + records.get(id)!.contextTokens, 0)];
  }
  function better(selected: readonly string[], current: readonly string[]): boolean {
    const left = score(selected);
    const right = score(current);
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) return left[index]! < right[index]!;
    }
    return JSON.stringify(selected) < JSON.stringify(current);
  }
  const seen = new Set<string>();
  const ids = [...closures.keys()].sort();
  function visit(selected: Set<string>): void {
    const sorted = [...selected].sort();
    const key = JSON.stringify(sorted);
    if (seen.has(key)) return;
    seen.add(key);
    if (++states > maxStates) failure("Capability resolution state limit reached; no partial selection is returned.", "FY_RESOLUTION_LIMIT");
    if (!valid(selected) || (best !== undefined && selected.size > best.length)) return;
    const coordinator = sorted.some((id) => records.get(id)!.orchestration);
    const missing = required.find((need) => !sorted.some((id) => records.get(id)!.provides.includes(need)));
    if (coordinator && missing === undefined) {
      if (best === undefined || better(sorted, best)) best = sorted;
      return;
    }
    for (const id of ids) {
      const candidate = records.get(id)!;
      if (selected.has(id) || (missing !== undefined ? !candidate.provides.includes(missing) : !candidate.orchestration)) continue;
      visit(new Set([...selected, ...closures.get(id)!]));
    }
  }
  visit(new Set());
  if (best === undefined) failure("No admitted capability coverage satisfies dependencies, conflicts and exactly one coordinator.", "FY_UNSUPPORTED_CAPABILITY");
  const selected = best;
  return { selected, excluded: [...records.keys()].filter((id) => !selected.includes(id)).sort().map((id) => ({ id, reason: excluded.get(id) ?? "not-selected" })), coverage: required.map((requirement) => ({ requirement, providers: selected.filter((id) => records.get(id)!.provides.includes(requirement)) })), exploredStates: states, contextTokens: selected.reduce((sum, id) => sum + records.get(id)!.contextTokens, 0) };
}
