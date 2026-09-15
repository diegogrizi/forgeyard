import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { normalizePortablePath, resolveInsideRoot } from "../core/paths.js";

const SLIDE_IDS = [
  "opening",
  "problem",
  "audience",
  "insight",
  "solution",
  "demo",
  "evidence",
  "architecture",
  "value",
  "ask",
] as const;

const REQUIRED_FILES = ["index.html", "styles.css", "app.js"] as const;

export type PresentationRuleId =
  | "presentation.missing-file"
  | "presentation.unsafe-path"
  | "presentation.remote-reference"
  | "presentation.unsafe-embed"
  | "presentation.identity-metadata"
  | "presentation.identity-mark"
  | "presentation.tracking"
  | "presentation.unresolved-template"
  | "presentation.document-structure"
  | "presentation.slide-structure"
  | "presentation.control-structure"
  | "presentation.script-behavior"
  | "presentation.style-behavior"
  | "presentation.network-code";

export interface PresentationFinding {
  ruleId: PresentationRuleId;
  path: string;
}

export interface PresentationAuditInput {
  root: string;
  directory: string;
  denyTerms?: readonly string[];
}

export interface PresentationSourceInput {
  directory: string;
  html: string;
  css: string;
  javascript: string;
  denyTerms?: readonly string[];
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replaceAll(/\s+/g, " ").trim();
}

function finding(ruleId: PresentationRuleId, filePath: string): PresentationFinding {
  return { ruleId, path: filePath };
}

function hasRemoteReference(source: string): boolean {
  return /(?:https?:|wss?:)?\/\//i.test(source);
}

function hasTracking(source: string): boolean {
  return /\b(?:analytics|gtag|googletagmanager|mixpanel|posthog|plausible|matomo|telemetry|tracker|sendBeacon)\b/i.test(source);
}

function tagCount(source: string, tag: string): number {
  return [...source.matchAll(new RegExp(`<${tag}\\b`, "gi"))].length;
}

function attribute(openingTag: string, name: string): string | undefined {
  const match = openingTag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1];
}

function documentIsValid(html: string): boolean {
  return (
    /^\s*<!doctype html>/i.test(html) &&
    /<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html) &&
    /<meta\b[^>]*\bcharset\s*=\s*["']?utf-8["']?/i.test(html) &&
    /<meta\b(?=[^>]*\bname\s*=\s*["']viewport["'])(?=[^>]*\bcontent\s*=\s*["'][^"']*width=device-width)/i.test(html) &&
    tagCount(html, "main") === 1 &&
    tagCount(html, "nav") >= 1 &&
    tagCount(html, "h1") === 1 &&
    /<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])(?=[^>]*\bhref\s*=\s*["']styles\.css["'])/i.test(html) &&
    /<script\b[^>]*\bsrc\s*=\s*["']app\.js["'][^>]*>\s*<\/script>/i.test(html)
  );
}

function slidesAreValid(html: string): boolean {
  const ids = [...html.matchAll(/<section\b[^>]*\bdata-slide(?:\s*=\s*["'][^"']*["'])?[^>]*>/gi)]
    .map((match) => attribute(match[0], "id"));
  const allIds = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]!);
  return (
    ids.length === SLIDE_IDS.length &&
    ids.every((id, index) => id === SLIDE_IDS[index]) &&
    new Set(allIds).size === allIds.length
  );
}

function controlsAreValid(html: string): boolean {
  return (
    /<button\b[^>]*\bid\s*=\s*["']previous-slide["'][^>]*>/i.test(html) &&
    /<button\b[^>]*\bid\s*=\s*["']next-slide["'][^>]*>/i.test(html) &&
    /\bid\s*=\s*["']slide-status["'][^>]*\baria-live\s*=\s*["']polite["']/i.test(html)
  );
}

function scriptIsValid(javascript: string): boolean {
  const keys = ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End"];
  return (
    /addEventListener\s*\(\s*["']keydown["']/i.test(javascript) &&
    (javascript.match(/addEventListener\s*\(\s*["']click["']/gi)?.length ?? 0) >= 2 &&
    keys.every((key) => javascript.includes(key)) &&
    javascript.includes("location.hash") &&
    javascript.includes("hashchange")
  );
}

function focusIsVisible(css: string): boolean {
  const blocks = [...css.matchAll(/[^{}]*:focus-visible[^{}]*\{([^}]*)\}/gi)];
  return blocks.some((match) => {
    const declarations = match[1] ?? "";
    return /\b(?:outline|box-shadow)\s*:/i.test(declarations) &&
      !/\boutline\s*:\s*(?:0|none)(?:\s|;|$)/i.test(declarations);
  });
}

function stylesAreValid(css: string): boolean {
  return (
    css.includes("clamp(") &&
    /@media\s+[^{}]*max-width/i.test(css) &&
    /@media\s+[^{}]*max-height[^{}]*orientation\s*:\s*landscape/i.test(css) &&
    /@media\s*print/i.test(css) &&
    /@media\s*\([^)]*prefers-reduced-motion\s*:\s*reduce/i.test(css) &&
    focusIsVisible(css)
  );
}

function sortedUnique(findings: readonly PresentationFinding[]): PresentationFinding[] {
  return [...new Map(findings.map((item) => [`${item.path}\0${item.ruleId}`, item])).values()].sort(
    (left, right) => left.path.localeCompare(right.path, "en") || left.ruleId.localeCompare(right.ruleId, "en"),
  );
}

export function auditPresentationSources(input: PresentationSourceInput): readonly PresentationFinding[] {
  const directory = normalizePortablePath(input.directory);
  const paths = {
    html: `${directory}/index.html`,
    css: `${directory}/styles.css`,
    javascript: `${directory}/app.js`,
  };
  const sources = [
    [paths.html, input.html],
    [paths.css, input.css],
    [paths.javascript, input.javascript],
  ] as const;
  const findings: PresentationFinding[] = [];

  for (const [filePath, source] of sources) {
    if (hasRemoteReference(source)) findings.push(finding("presentation.remote-reference", filePath));
    if (/\{\{[^}]*\}\}/.test(source)) findings.push(finding("presentation.unresolved-template", filePath));
    if (hasTracking(source)) findings.push(finding("presentation.tracking", filePath));
  }

  const normalizedDenyTerms = (input.denyTerms ?? []).map(normalized).filter(Boolean);
  if (normalizedDenyTerms.length > 0) {
    for (const [filePath, source] of sources) {
      const haystack = normalized(source);
      if (normalizedDenyTerms.some((term) => haystack.includes(term))) {
        findings.push(finding("presentation.identity-mark", filePath));
      }
    }
  }

  if (/<(?:iframe|object|embed)\b|\bsrcdoc\s*=/i.test(input.html)) {
    findings.push(finding("presentation.unsafe-embed", paths.html));
  }
  if (/<meta\b[^>]*\bname\s*=\s*["'](?:author|creator|publisher|organization|organizer|event)["']/i.test(input.html)) {
    findings.push(finding("presentation.identity-metadata", paths.html));
  }
  if (/\b(?:class|id)\s*=\s*["'][^"']*(?:sponsor|organizer|partner|event|logo)[^"']*["']/i.test(input.html)) {
    findings.push(finding("presentation.identity-mark", paths.html));
  }
  if (!documentIsValid(input.html)) findings.push(finding("presentation.document-structure", paths.html));
  if (!slidesAreValid(input.html)) findings.push(finding("presentation.slide-structure", paths.html));
  if (!controlsAreValid(input.html)) findings.push(finding("presentation.control-structure", paths.html));
  if (!scriptIsValid(input.javascript)) findings.push(finding("presentation.script-behavior", paths.javascript));
  if (!stylesAreValid(input.css)) findings.push(finding("presentation.style-behavior", paths.css));
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(|\bimport\s*\(/i.test(input.javascript)) {
    findings.push(finding("presentation.network-code", paths.javascript));
  }

  return sortedUnique(findings);
}

export async function auditPresentationBundle(input: PresentationAuditInput): Promise<readonly PresentationFinding[]> {
  const root = path.resolve(input.root);
  const directory = normalizePortablePath(input.directory);
  const sources = new Map<string, string>();
  const findings: PresentationFinding[] = [];

  for (const name of REQUIRED_FILES) {
    const relativePath = `${directory}/${name}`;
    const absolutePath = resolveInsideRoot(root, relativePath);
    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        findings.push(finding("presentation.unsafe-path", relativePath));
        continue;
      }
      sources.set(name, await readFile(absolutePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        findings.push(finding("presentation.missing-file", relativePath));
        continue;
      }
      throw error;
    }
  }

  if (sources.size === REQUIRED_FILES.length) {
    findings.push(...auditPresentationSources({
      directory,
      html: sources.get("index.html")!,
      css: sources.get("styles.css")!,
      javascript: sources.get("app.js")!,
      ...(input.denyTerms === undefined ? {} : { denyTerms: input.denyTerms }),
    }));
  }
  return sortedUnique(findings);
}
