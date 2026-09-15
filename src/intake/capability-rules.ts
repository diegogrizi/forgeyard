import { readFile } from "node:fs/promises";
import path from "node:path";

import { Ajv, type ErrorObject } from "ajv";
import { parse } from "yaml";

import { ForgeyardError } from "../core/errors.js";
import { loadRegistry } from "../registry/load.js";
import type { CapabilityRules } from "./contracts.js";

function rulesError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the authored capability rules and keep every plugin pinned in the portable catalog.",
    exitCode: 3,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("; ");
}

function sortedChoices<T extends { id: string }>(choices: readonly T[]): T[] {
  const ids = choices.map((choice) => choice.id);
  if (new Set(ids).size !== ids.length) throw rulesError(`Capability rules repeat plugin '${ids.find((id, index) => ids.indexOf(id) !== index)}'.`);
  return [...choices].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

export async function loadCapabilityRules(registryRoot: string): Promise<CapabilityRules> {
  const root = path.resolve(registryRoot);
  const rulesPath = path.join(root, "sources", "capabilities.yaml");
  const schemaPath = path.join(root, "schemas", "capability-rules.schema.json");
  let value: unknown;
  try {
    value = parse(await readFile(rulesPath, "utf8"));
  } catch (error) {
    throw rulesError("Unable to parse capability rules.", [rulesPath], error);
  }
  let schema: object;
  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  } catch (error) {
    throw rulesError("Unable to load the capability-rules schema.", [schemaPath], error);
  }
  const validate = new Ajv({ allErrors: true, strict: true, coerceTypes: false }).compile(schema);
  if (!validate(value)) {
    throw rulesError(`Capability rules failed schema validation: ${formatErrors(validate.errors)}`, [rulesPath]);
  }

  const source = value as CapabilityRules;
  const registry = await loadRegistry(root);
  const catalogPack = registry.packs.get("ecosystem");
  const catalogComponent = catalogPack?.manifest.components.find((component) => component.kind === "catalog");
  const catalogEntry = catalogComponent === undefined ? undefined : catalogPack?.entries.get(catalogComponent.id);
  if (catalogEntry?.files === undefined) throw rulesError("The ecosystem catalog is unavailable.");
  const available = new Set(
    catalogEntry.files
      .map((file) => /^plugins\/([^/]+)\//.exec(file.relativePath)?.[1])
      .filter((id): id is string => id !== undefined),
  );

  const normalized: CapabilityRules = {
    schemaVersion: 1,
    baseline: sortedChoices(source.baseline),
    rules: [...source.rules]
      .map((rule) => ({
        ...rule,
        when: {
          ...(rule.when.kinds === undefined ? {} : { kinds: [...rule.when.kinds].sort() }),
          ...(rule.when.languages === undefined ? {} : { languages: [...rule.when.languages].sort() }),
          ...(rule.when.frameworks === undefined ? {} : { frameworks: [...rule.when.frameworks].sort() }),
          ...(rule.when.requestPatterns === undefined ? {} : { requestPatterns: [...rule.when.requestPatterns].sort() }),
        },
        include: sortedChoices(rule.include),
      }))
      .sort((left, right) => left.id.localeCompare(right.id, "en")),
    exclusions: sortedChoices(source.exclusions),
  };
  const referenced = new Set([
    ...normalized.baseline.map((choice) => choice.id),
    ...normalized.rules.flatMap((rule) => rule.include.map((choice) => choice.id)),
    ...normalized.exclusions.map((choice) => choice.id),
  ]);
  const missing = [...referenced].filter((id) => !available.has(id)).sort((left, right) => left.localeCompare(right, "en"));
  if (missing.length > 0) throw rulesError(`Capability rules reference missing catalog plugin '${missing[0]}'.`);
  return normalized;
}
