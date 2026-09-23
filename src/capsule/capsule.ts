import { lstat } from "node:fs/promises";

import type { ForgeyardConfig, NonEmptyArgv, PlannedFile } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";
import { loadConfig } from "../config/config.js";
import { loadInstallManifest } from "../installer/manifest.js";
import { regularBytes } from "../native/files.js";

export const NATIVE_PROTOCOL_VERSION = "0.2";
export const CAPSULE_COMPILER_VERSION = "1";

export interface GateDefinition {
  id: string;
  name: string;
  argv: NonEmptyArgv;
  parser: "exit-code" | "test-summary";
  timeoutMs: number;
  maxOutputBytes: number;
  cwd?: string;
}

export interface CapsulePolicy {
  mutableRoots: readonly string[];
  protectedPaths: readonly string[];
  maxConcurrency: number;
  timeboxMinutes: number;
  maxRepairs: number;
  autonomy: "supervised" | "balanced" | "autonomous";
  maxRecordedCostUsd: number | null;
  externalEffects: "ask";
  automaticMerge: false;
}

export interface Capsule {
  schemaVersion: 1;
  id: string;
  payload: {
    compiler: { version: string; forgeyardVersion: string; protocolVersion: string };
    adapters: readonly string[];
    profile: { kind: string; languages: readonly string[]; frameworks: readonly string[] };
    policy: CapsulePolicy;
    gates: readonly GateDefinition[];
    method: { id: "native-cooperative"; version: "1"; review: "risk-proportionate" };
    files: readonly { path: string; sha256: string; componentId: string }[];
    components: readonly string[];
    selection: { profile: string; catalog: ForgeyardConfig["catalog"]; packs: readonly string[] };
    normalizedNeeds: import("../intake/semantic.js").ProjectNeedsProfile | null;
  };
}

export function operationalPolicy(config: ForgeyardConfig): CapsulePolicy {
  return {
    mutableRoots: config.paths.mutableRoots,
    protectedPaths: config.paths.protectedPaths,
    maxConcurrency: config.orchestration.maxConcurrency,
    timeboxMinutes: config.timeboxMinutes,
    maxRepairs: 3,
    autonomy: config.autonomy?.level ?? "supervised",
    maxRecordedCostUsd: config.autonomy?.maxCostUsd ?? null,
    externalEffects: "ask",
    automaticMerge: false,
  };
}

export function gateDefinitions(config: ForgeyardConfig): readonly GateDefinition[] {
  return config.quality.commands.map((command, index) => ({
    id: `G${String(index + 1).padStart(3, "0")}`,
    name: command.name,
    argv: command.argv,
    parser: /test|unit|integration|e2e/i.test(command.name) ? "test-summary" : "exit-code",
    timeoutMs: 900_000,
    maxOutputBytes: 1_048_576,
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
  }));
}

/** Product output, not harness: the capsule freezes what governs the work, not what it produces. */
function isProductArtifact(file: PlannedFile): boolean {
  return file.ownership === "seed" || file.path.startsWith(".forgeyard/tasks/") ||
    file.path === ".forgeyard/COMPOSITION.md";
}

export function compileCapsule(
  config: ForgeyardConfig,
  files: readonly PlannedFile[],
  forgeyardVersion = "0.1.0",
): Capsule {
  const inventory = files.filter((file) => !isProductArtifact(file))
    .map((file) => ({ path: normalizePortablePath(file.path), sha256: file.sha256, componentId: file.componentId }))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  const payload: Capsule["payload"] = {
    compiler: { version: CAPSULE_COMPILER_VERSION, forgeyardVersion, protocolVersion: NATIVE_PROTOCOL_VERSION },
    adapters: [...config.harnesses].sort(),
    profile: { kind: config.intake?.kind ?? "unknown", languages: config.intake?.languages ?? [],
      frameworks: config.intake?.frameworks ?? [] },
    policy: operationalPolicy(config),
    gates: gateDefinitions(config),
    method: { id: "native-cooperative", version: "1", review: "risk-proportionate" },
    files: inventory,
    components: [...new Set(inventory.map((file) => file.componentId))].sort(),
    selection: { profile: config.profile, catalog: config.catalog, packs: [...(config.composition?.packs ?? [])].sort() },
    normalizedNeeds: config.composition?.normalizedNeeds ?? null,
  };
  return { schemaVersion: 1, id: sha256Text(canonicalJson(payload)), payload };
}

export function capsuleFile(capsule: Capsule): PlannedFile {
  const content = `${canonicalJson(capsule)}\n`;
  return { path: ".forgeyard/capsule.json", content, sha256: sha256Text(content),
    componentId: "forgeyard.capsule", ownership: "managed" };
}

export function capsuleError(message: string): ForgeyardError {
  return new ForgeyardError({ code: "FY_CAPSULE_DRIFT", message, exitCode: 9,
    remediation: "Inspect the drift. Explicitly update the harness or restore the approved bytes; do not recertify by editing the lock." });
}

export async function readRegularProjectFile(root: string, relativePath: string, maximum = 16_777_216): Promise<string> {
  const portable = normalizePortablePath(relativePath);
  let cursor = "";
  for (const segment of portable.split("/")) {
    cursor = cursor ? `${cursor}/${segment}` : segment;
    const stats = await lstat(resolveInsideRoot(root, cursor));
    if (stats.isSymbolicLink()) throw capsuleError("A harness path traverses a symbolic link.");
    if (cursor === portable && (!stats.isFile() || stats.size > maximum))
      throw capsuleError("A harness file is not a bounded regular file.");
  }
  return (await regularBytes(root, portable, maximum)).toString("utf8");
}

export async function readCapsule(root: string): Promise<Capsule> {
  try {
    const source = await readRegularProjectFile(root, ".forgeyard/capsule.json");
    const capsule = JSON.parse(source) as Capsule;
    if (capsule.schemaVersion !== 1 || !capsule.payload ||
      capsule.id !== sha256Text(canonicalJson(capsule.payload)) ||
      capsule.payload.compiler.version !== CAPSULE_COMPILER_VERSION ||
      capsule.payload.compiler.protocolVersion !== NATIVE_PROTOCOL_VERSION) throw capsuleError("The capsule identity or runtime contract is invalid.");
    const manifest = await loadInstallManifest(root);
    const owned = manifest.files.find((file) => file.path === ".forgeyard/capsule.json");
    if (owned?.ownership !== "managed" || owned.installedSha256 !== sha256Text(source))
      throw capsuleError("The capsule differs from the installed ownership record.");
    const config = await loadConfig(resolveInsideRoot(root, "forgeyard.yaml"));
    if (canonicalJson(operationalPolicy(config)) !== canonicalJson(capsule.payload.policy) ||
      canonicalJson(gateDefinitions(config)) !== canonicalJson(capsule.payload.gates) ||
      canonicalJson([...config.harnesses].sort()) !== canonicalJson(capsule.payload.adapters) ||
      canonicalJson({ profile: config.profile, catalog: config.catalog, packs: [...(config.composition?.packs ?? [])].sort() }) !== canonicalJson(capsule.payload.selection) ||
      canonicalJson(config.composition?.normalizedNeeds ?? null) !== canonicalJson(capsule.payload.normalizedNeeds))
      throw capsuleError("The operational configuration differs from the frozen capsule.");
    for (const file of capsule.payload.files) {
      const current = await readRegularProjectFile(root, file.path);
      if (sha256Text(current) !== file.sha256) throw capsuleError(`Frozen harness file '${file.path}' changed.`);
    }
    return capsule;
  } catch (error) {
    if (error instanceof ForgeyardError) throw error;
    throw capsuleError("The frozen capsule is unavailable or malformed.");
  }
}
