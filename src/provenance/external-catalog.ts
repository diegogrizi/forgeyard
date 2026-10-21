import type { ExternalCatalogReference } from "../catalog/acquire.js";
import { BUNDLED_CAPABILITIES, BUNDLED_CAPABILITY_SOURCES } from "../intake/capabilities.js";
import { loadCapabilityRules } from "../intake/capability-rules.js";
import { loadRegistry } from "../registry/load.js";
import { normalizeRepositoryUrl, ProvenanceValidationError } from "./validate.js";

export interface ExternalCatalogSummary {
  sourceId: string;
  reference: ExternalCatalogReference;
  curatedPlugins: number;
}

/** Checks authored source references only. No upstream request or acquisition is performed. */
export async function verifyExternalCatalogReference(root: string): Promise<ExternalCatalogSummary> {
  const registry = await loadRegistry(root);
  const pack = registry.packs.get("ecosystem");
  const components = pack?.manifest.components.filter((component) => component.kind === "catalog") ?? [];
  const component = components[0];
  const entry = component === undefined ? undefined : pack?.entries.get(component.id);
  const sourceId = pack?.manifest.provenance.sourceId;
  const reference = entry?.externalCatalog;
  if (pack?.manifest.provenance.mode !== "reference-only" || components.length !== 1
    || component?.entryType !== "external" || component.format !== "portable-plugin-marketplace-v1"
    || reference === undefined || sourceId === undefined) {
    throw new ProvenanceValidationError(["The ecosystem pack must declare one reference-only external catalog."]);
  }
  const source = registry.sources.get(sourceId);
  if (source?.provenance !== "reference-only" || source.revision !== reference.revision
    || source.license !== reference.license || pack.manifest.license !== reference.license
    || normalizeRepositoryUrl(source.url) !== normalizeRepositoryUrl(reference.repository)) {
    throw new ProvenanceValidationError([`External catalog '${sourceId}' does not match its source metadata.`]);
  }

  const available = new Set(reference.plugins);
  const rules = await loadCapabilityRules(root);
  const referenced = new Set([
    ...rules.baseline.map((choice) => choice.id),
    ...rules.rules.flatMap((rule) => rule.include.map((choice) => choice.id)),
    ...[...registry.profiles.values()].flatMap((profile) => profile.catalog.plugins),
  ]);
  for (const candidate of BUNDLED_CAPABILITIES) {
    if (candidate.source?.pluginId === undefined) continue;
    if (candidate.source.sourceId !== sourceId || candidate.license !== reference.license) {
      throw new ProvenanceValidationError([`Capability '${candidate.id}' has inconsistent external source metadata.`]);
    }
    referenced.add(candidate.source.pluginId);
  }
  for (const capabilitySource of BUNDLED_CAPABILITY_SOURCES) {
    if (capabilitySource.sourceId !== sourceId || capabilitySource.license !== reference.license) {
      throw new ProvenanceValidationError([`Capability source '${capabilitySource.sourceId}' is not the declared external catalog.`]);
    }
    for (const pluginId of capabilitySource.pluginIds) referenced.add(pluginId);
  }
  const missing = [...referenced].filter((id) => !available.has(id)).sort((left, right) => left.localeCompare(right, "en"));
  if (missing.length > 0) {
    throw new ProvenanceValidationError([`Authored selections reference an undeclared external plugin '${missing[0]}'.`]);
  }
  return { sourceId, reference, curatedPlugins: reference.plugins.length };
}
