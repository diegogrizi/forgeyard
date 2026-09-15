import { parse as parseYaml } from "yaml";

import { ForgeyardError } from "../core/errors.js";

export interface ParsedPortableDocument {
  frontmatter: Readonly<Record<string, unknown>>;
  body: string;
}

function catalogError(message: string, sourcePath: string, cause?: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_CATALOG_INVALID",
    message,
    remediation: "Correct or exclude the malformed portable catalog component.",
    exitCode: 3,
    paths: [sourcePath],
    ...(cause === undefined ? {} : { cause }),
  });
}

export function parsePortableDocument(content: string, sourcePath: string): ParsedPortableDocument {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: {}, body: normalized };

  const lines = normalized.split("\n");
  const closing = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closing < 0) throw catalogError("Portable document frontmatter is not terminated.", sourcePath);

  let parsed: unknown;
  try {
    parsed = parseYaml(lines.slice(1, closing).join("\n"));
  } catch (error) {
    throw catalogError("Portable document frontmatter is not valid YAML.", sourcePath, error);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw catalogError("Portable document frontmatter must be a mapping.", sourcePath);
  }

  return {
    frontmatter: parsed as Record<string, unknown>,
    body: lines.slice(closing + 1).join("\n"),
  };
}
