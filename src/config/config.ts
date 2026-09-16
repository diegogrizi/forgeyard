import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import * as formatsModule from "ajv-formats";
import { parse, stringify } from "yaml";

import { HARNESS_IDS, type ForgeyardConfig, type HarnessId, type ProfileId } from "../core/contracts.js";
import { ForgeyardError } from "../core/errors.js";
import { normalizePortablePath } from "../core/paths.js";

let validator: ValidateFunction | undefined;

function configError(message: string, paths?: readonly string[], cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CONFIG_INVALID",
    message,
    remediation: "Correct the Forgeyard configuration and retry.",
    exitCode: 2,
    ...(paths === undefined ? {} : { paths }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function selectionError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_UNSUPPORTED_SELECTION",
    message,
    remediation: "Use profile 'minimal', 'hackathon', 'full', or 'tailored' with adapter 'codex', 'claude-code', or 'cursor'.",
    exitCode: 2,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withDefaults(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const copy = structuredClone(value);
  if (copy.timeboxMinutes === undefined) copy.timeboxMinutes = 300;
  if (!isRecord(copy.catalog)) {
    copy.catalog = copy.profile === "minimal"
      ? { selection: "none", plugins: [] }
      : copy.profile === "full"
        ? { selection: "all", plugins: [] }
        : { selection: "curated", plugins: [] };
  } else if (copy.catalog.plugins === undefined) {
    copy.catalog.plugins = [];
  }

  if (!isRecord(copy.orchestration)) {
    copy.orchestration = { mode: "guided", maxConcurrency: 4 };
  } else {
    if (copy.orchestration.mode === undefined) copy.orchestration.mode = "guided";
    if (copy.orchestration.maxConcurrency === undefined) copy.orchestration.maxConcurrency = 4;
  }

  if (isRecord(copy.presentation)) {
    if (copy.presentation.enabled === undefined) copy.presentation.enabled = copy.profile !== "minimal";
    if (copy.presentation.durationMinutes === undefined) copy.presentation.durationMinutes = 7;
    if (copy.presentation.offline === undefined) copy.presentation.offline = true;
  }

  if (!isRecord(copy.intake)) {
    const project = isRecord(copy.project) ? copy.project : {};
    copy.intake = {
      strategy: "manual",
      request: typeof project.purpose === "string" ? project.purpose : "",
      sources: [],
      kind: "unknown",
      languages: [],
      frameworks: [],
      evidence: [],
      confidence: "low",
      questions: [],
    };
  }

  if (!isRecord(copy.composition)) {
    const profile = typeof copy.profile === "string" ? copy.profile : "minimal";
    const packs = profile === "minimal"
      ? ["foundation"]
      : profile === "tailored"
        ? ["foundation", "delivery", "ecosystem"]
        : ["foundation", "delivery", "presentation", "ecosystem"];
    copy.composition = {
      strategy: "manual",
      packs,
      selected: [],
      excluded: [],
      analysisSha256: "0".repeat(64),
    };
  }

  if (!isRecord(copy.autonomy)) {
    copy.autonomy = {
      level: "supervised",
      stopOnAmbiguity: true,
      externalEffects: "ask",
    };
  }

  return copy;
}

function getValidator(): ValidateFunction {
  if (validator !== undefined) return validator;
  const schemaUrl = new URL("../../schemas/forgeyard-config.schema.json", import.meta.url);
  const schemaText = requireSchema(schemaUrl);
  const ajv = new Ajv({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false });
  formatsModule.default.default(ajv);
  const compiled = ajv.compile(JSON.parse(schemaText));
  validator = compiled;
  return compiled;
}

function requireSchema(url: URL): string {
  // The schema is packaged beside dist/ and is read synchronously only during first validation.
  const path = decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, "");
  return readFileSync(path, "utf8");
}

function formatValidation(errors: readonly ErrorObject[] | null | undefined): string {
  if (errors === undefined || errors === null || errors.length === 0) return "unknown schema error";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("; ");
}

function normalizedPath(candidate: string): string {
  try {
    return normalizePortablePath(candidate);
  } catch (error) {
    throw configError(`Configuration path '${candidate}' is not portable.`, [candidate], error);
  }
}

function caseKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function overlaps(left: string, right: string): boolean {
  const a = caseKey(left);
  const b = caseKey(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizeAndCheckPaths(config: ForgeyardConfig): ForgeyardConfig {
  const mutableRoots = config.paths.mutableRoots.map(normalizedPath);
  const protectedPaths = config.paths.protectedPaths.map(normalizedPath);
  const presentation = normalizedPath(config.paths.presentation);

  for (const mutable of mutableRoots) {
    for (const protectedPath of protectedPaths) {
      if (overlaps(mutable, protectedPath)) {
        throw configError("Mutable and protected paths overlap.", [mutable, protectedPath]);
      }
    }
  }

  if (
    config.presentation.enabled &&
    !mutableRoots.some((root) => overlaps(root, presentation) && !presentation.startsWith(`${root}/../`))
  ) {
    throw configError("The presentation path must be inside a mutable root.", [presentation]);
  }

  const duplicates = [...mutableRoots, ...protectedPaths].map(caseKey);
  if (new Set(duplicates).size !== duplicates.length) {
    throw configError("Configuration paths collide on a case-insensitive filesystem.");
  }

  return {
    ...config,
    quality: { commands: config.quality.commands.map((command) => ({ ...command,
      ...(command.cwd === undefined ? {} : { cwd: normalizedPath(command.cwd) }) })) },
    catalog: {
      ...config.catalog,
      plugins: [...config.catalog.plugins].sort((left, right) => left.localeCompare(right, "en")),
    },
    paths: { mutableRoots, protectedPaths, presentation },
    ...(config.intake === undefined ? {} : {
      intake: {
        ...config.intake,
        sources: config.intake.sources.map(normalizedPath).sort((left, right) => left.localeCompare(right, "en")),
        languages: [...config.intake.languages].sort((left, right) => left.localeCompare(right, "en")),
        frameworks: [...config.intake.frameworks].sort((left, right) => left.localeCompare(right, "en")),
        evidence: [...config.intake.evidence]
          .map((item) => ({ ...item, path: normalizedPath(item.path) }))
          .sort((left, right) => left.path.localeCompare(right.path, "en") || left.signal.localeCompare(right.signal, "en")),
        questions: [...config.intake.questions],
      },
    }),
    ...(config.composition === undefined ? {} : {
      composition: {
        ...config.composition,
        packs: [...config.composition.packs].sort((left, right) => left.localeCompare(right, "en")),
        selected: [...config.composition.selected].sort((left, right) => left.id.localeCompare(right.id, "en")),
        excluded: [...config.composition.excluded].sort((left, right) => left.id.localeCompare(right.id, "en")),
      },
    }),
  };
}

const SUPPORTED_PROFILES = new Set<ProfileId>(["minimal", "hackathon", "full", "tailored"]);
const SUPPORTED_HARNESSES = new Set<HarnessId>(HARNESS_IDS);

export function validateConfig(value: unknown): ForgeyardConfig {
  if (isRecord(value)) {
    if (value.profile !== undefined && !SUPPORTED_PROFILES.has(value.profile as ProfileId)) {
      throw selectionError(`Profile '${String(value.profile)}' is not supported by Forgeyard.`);
    }
    if (
      value.harnesses !== undefined &&
      (!Array.isArray(value.harnesses) ||
        value.harnesses.length !== 1 ||
        !SUPPORTED_HARNESSES.has(value.harnesses[0] as HarnessId))
    ) {
      throw selectionError("The selected adapter set is not supported by Forgeyard.");
    }
  }

  const candidate = withDefaults(value);
  const validate = getValidator();
  if (!validate(candidate)) {
    throw configError(`Configuration failed schema validation: ${formatValidation(validate.errors)}`);
  }

  return normalizeAndCheckPaths(candidate as ForgeyardConfig);
}

export async function loadConfig(filePath: string): Promise<ForgeyardConfig> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw configError(`Unable to read configuration file '${filePath}'.`, [filePath], error);
  }

  try {
    return validateConfig(parse(source));
  } catch (error) {
    if (error instanceof ForgeyardError) throw error;
    throw configError(`Configuration file '${filePath}' is not valid YAML.`, [filePath], error);
  }
}

export function serializeConfig(config: ForgeyardConfig): string {
  const value = validateConfig(config);
  return stringify(value, { indent: 2, lineWidth: 0, sortMapEntries: false });
}
