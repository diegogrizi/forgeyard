import type { ProfileManifest, ResolvedComponent } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import type { LoadedPack, RegistrySnapshot } from "./load.js";

export interface ResolvedProfile {
  profileId: "hackathon";
  profileVersion: string;
  adapter: "codex";
  packIds: readonly string[];
  defaults: ProfileManifest["defaults"];
  components: readonly ResolvedComponent[];
}

function selectionError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_UNSUPPORTED_SELECTION",
    message,
    remediation: "Use profile 'hackathon' with adapter 'codex' for Forgeyard M1.",
    exitCode: 2,
  });
}

function conflict(message: string, components?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_COMPONENT_CONFLICT",
    message,
    remediation: "Correct component dependencies, slots, or conflicts in the selected packs.",
    exitCode: 3,
    ...(components === undefined ? {} : { components }),
  });
}

function registryError(message: string, components?: readonly string[]): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the selected profile or pack registry.",
    exitCode: 3,
    ...(components === undefined ? {} : { components }),
  });
}

function componentOrder(left: { packId: string; id: string }, right: { packId: string; id: string }): number {
  return left.packId.localeCompare(right.packId, "en") || left.id.localeCompare(right.id, "en");
}

function selectedPacks(registry: RegistrySnapshot, profile: ProfileManifest): LoadedPack[] {
  return [...profile.packs]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((id) => {
      const loaded = registry.packs.get(id);
      if (loaded === undefined) throw registryError(`Profile '${profile.id}' references missing pack '${id}'.`);
      return loaded;
    });
}

export function resolveProfile(
  registry: RegistrySnapshot,
  profileId: string,
  adapterId: string,
): ResolvedProfile {
  if (profileId !== "hackathon") throw selectionError(`Profile '${profileId}' is not supported by Forgeyard M1.`);
  if (adapterId !== "codex") throw selectionError(`Adapter '${adapterId}' is not supported by Forgeyard M1.`);

  const profile = registry.profiles.get(profileId);
  if (profile === undefined) throw registryError(`Profile '${profileId}' is missing from the registry.`);
  const packs = selectedPacks(registry, profile);

  const nodes = new Map<string, ResolvedComponent>();
  const slots = new Map<string, string>();
  for (const loadedPack of packs) {
    for (const declaration of loadedPack.manifest.components) {
      if (nodes.has(declaration.id)) throw conflict(`Duplicate component ID '${declaration.id}'.`, [declaration.id]);
      const slotKey = declaration.slot.normalize("NFKC").toLocaleLowerCase("en-US");
      const existingSlot = slots.get(slotKey);
      if (existingSlot !== undefined) {
        throw conflict(`Components '${existingSlot}' and '${declaration.id}' use the same logical slot.`, [
          existingSlot,
          declaration.id,
        ]);
      }
      const entry = loadedPack.entries.get(declaration.id);
      if (entry === undefined) throw registryError(`Component '${declaration.id}' has no loaded entry.`, [declaration.id]);
      nodes.set(declaration.id, {
        ...declaration,
        packId: loadedPack.manifest.id,
        packVersion: loadedPack.manifest.version,
        sourcePath: entry.sourcePath,
        sha256: entry.sha256,
        ...(entry.files === undefined ? {} : { treeFiles: entry.files }),
      });
      slots.set(slotKey, declaration.id);
    }
  }

  for (const node of nodes.values()) {
    for (const requirement of node.requires) {
      if (!nodes.has(requirement)) {
        throw conflict(`Component '${node.id}' requires missing component '${requirement}'.`, [node.id, requirement]);
      }
    }
    for (const excluded of node.conflicts) {
      if (nodes.has(excluded)) {
        throw conflict(`Components '${node.id}' and '${excluded}' conflict.`, [node.id, excluded]);
      }
    }
  }

  const remaining = new Map(
    [...nodes.values()].map((node) => [node.id, new Set(node.requires)] as const),
  );
  const ordered: ResolvedComponent[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.keys()]
      .filter((id) => remaining.get(id)?.size === 0)
      .map((id) => nodes.get(id)!)
      .sort(componentOrder);
    if (ready.length === 0) {
      throw conflict("The selected component dependency graph contains a cycle.", [...remaining.keys()].sort());
    }
    for (const node of ready) {
      ordered.push(node);
      remaining.delete(node.id);
      for (const dependencies of remaining.values()) dependencies.delete(node.id);
    }
  }

  return {
    profileId: "hackathon",
    profileVersion: profile.version,
    adapter: "codex",
    packIds: packs.map((pack) => pack.manifest.id),
    defaults: profile.defaults,
    components: ordered,
  };
}
