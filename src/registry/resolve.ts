import type {
  CatalogSelection,
  HarnessId,
  ProfileId,
  ProfileManifest,
  ResolvedComponent,
} from "../core/contracts.js";
import { HARNESS_IDS } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import type { LoadedPack, RegistrySnapshot } from "./load.js";

export interface ResolvedProfile {
  profileId: ProfileId;
  profileVersion: string;
  adapter: HarnessId;
  packIds: readonly string[];
  defaults: ProfileManifest["defaults"];
  components: readonly ResolvedComponent[];
}

function selectionError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_UNSUPPORTED_SELECTION",
    message,
    remediation: "Use a supported profile with adapter 'codex' or 'claude-code'.",
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

function selectedPacks(
  registry: RegistrySnapshot,
  profile: ProfileManifest,
  packOverride?: readonly string[],
): LoadedPack[] {
  const requested = packOverride ?? profile.packs;
  if (requested.length === 0) throw selectionError("A profile must select at least one pack.");
  const duplicate = requested.find((id, index) => requested.indexOf(id) !== index);
  if (duplicate !== undefined) throw selectionError(`Pack selection repeats '${duplicate}'.`);
  return [...requested]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((id) => {
      const loaded = registry.packs.get(id);
      if (loaded === undefined) throw selectionError(`Pack '${id}' is not available in the pinned registry.`);
      return loaded;
    });
}

export function resolveProfile(
  registry: RegistrySnapshot,
  profileId: string,
  adapterId: string,
  catalogOverride?: CatalogSelection,
  packOverride?: readonly string[],
): ResolvedProfile {
  if (!["minimal", "hackathon", "full", "tailored"].includes(profileId)) {
    throw selectionError(`Profile '${profileId}' is not supported by Forgeyard.`);
  }
  if (!HARNESS_IDS.includes(adapterId as HarnessId)) {
    throw selectionError(`Adapter '${adapterId}' is not supported by Forgeyard.`);
  }

  const profile = registry.profiles.get(profileId);
  if (profile === undefined) throw registryError(`Profile '${profileId}' is missing from the registry.`);
  const packs = selectedPacks(registry, profile, packOverride);
  const requestedCatalog = catalogOverride ?? profile.catalog;
  const catalogSelection: readonly string[] | "all" = requestedCatalog.selection === "all"
    ? "all"
    : requestedCatalog.selection === "none"
      ? []
      : requestedCatalog.plugins.length > 0
        ? requestedCatalog.plugins
        : profile.catalog.plugins;

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
      const treeFiles = entry.files;
      if (declaration.kind === "catalog" && catalogSelection !== "all") {
        const available = new Set(
          (treeFiles ?? [])
            .map((file) => /^plugins\/([^/]+)\//.exec(file.relativePath)?.[1])
            .filter((name): name is string => name !== undefined),
        );
        const missing = catalogSelection.filter((name) => !available.has(name));
        if (missing.length > 0) {
          throw selectionError(`Catalog plugin '${missing[0]}' is not available in the pinned snapshot.`);
        }
      }
      nodes.set(declaration.id, {
        ...declaration,
        packId: loadedPack.manifest.id,
        packVersion: loadedPack.manifest.version,
        sourcePath: entry.sourcePath,
        sha256: entry.sha256,
        ...(treeFiles === undefined ? {} : { treeFiles }),
        ...(declaration.kind === "catalog" ? { catalogSelection } : {}),
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
    profileId: profile.id,
    profileVersion: profile.version,
    adapter: adapterId as HarnessId,
    packIds: packs.map((pack) => pack.manifest.id),
    defaults: profile.defaults,
    components: ordered,
  };
}
