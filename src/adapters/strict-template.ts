import { ForgeyardError } from "../core/errors.js";

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const UNRESOLVED = /\{\{[^}]*\}\}/;

function templateError(message: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_REGISTRY_INVALID",
    message,
    remediation: "Correct the component template and its declared rendering variables.",
    exitCode: 3,
  });
}

export function renderStrictTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
): string {
  const normalized = template.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const used = new Set<string>();
  const rendered = normalized.replace(TOKEN, (_match, token: string) => {
    if (!Object.hasOwn(variables, token)) throw templateError(`Template variable '${token}' is missing.`);
    used.add(token);
    return variables[token]!;
  });

  const unused = Object.keys(variables).filter((key) => !used.has(key)).sort((a, b) => a.localeCompare(b, "en"));
  if (unused.length > 0) throw templateError(`Template variables were supplied but not used: ${unused.join(", ")}.`);
  if (UNRESOLVED.test(rendered)) throw templateError("Template output contains an unsupported or unresolved expression.");
  return rendered;
}

export function escapeMarkdownInline(value: string): string {
  return value
    .replaceAll("\r\n", " ")
    .replaceAll(/[\r\n]/g, " ")
    .replaceAll(/[\\`*_[\]<>]/g, "\\$&");
}

export function quoteYamlString(value: string): string {
  return JSON.stringify(value.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
}

export function quoteTomlMultiline(value: string): string {
  const escaped = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return `"""${escaped}"""`;
}

export function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
