export interface ForgeyardErrorOptions {
  code: string;
  message: string;
  remediation?: string;
  exitCode: number;
  paths?: readonly string[];
  components?: readonly string[];
  cause?: unknown;
}

export class ForgeyardError extends Error {
  readonly code: string;
  readonly remediation: string | undefined;
  readonly exitCode: number;
  readonly paths: readonly string[] | undefined;
  readonly components: readonly string[] | undefined;

  constructor(options: ForgeyardErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ForgeyardError";
    this.code = options.code;
    this.remediation = options.remediation;
    this.exitCode = options.exitCode;
    this.paths = options.paths;
    this.components = options.components;
  }
}

export interface FormattedFailure {
  exitCode: number;
  text: string;
}

function publicError(error: unknown): ForgeyardError {
  if (error instanceof ForgeyardError) {
    return error;
  }

  return new ForgeyardError({
    code: "FY_INTERNAL",
    message: "An unexpected internal error occurred.",
    remediation: "Run again with --debug to inspect the local diagnostic.",
    exitCode: 1,
    cause: error,
  });
}

export function formatFailure(error: unknown, json: boolean, debug = false): FormattedFailure {
  const normalized = publicError(error);

  if (json) {
    const details: Record<string, unknown> = {
      code: normalized.code,
      message: normalized.message,
    };
    if (normalized.remediation !== undefined) details.remediation = normalized.remediation;
    if (normalized.paths !== undefined) details.paths = normalized.paths;
    if (normalized.components !== undefined) details.components = normalized.components;
    if (debug && normalized.stack !== undefined) details.stack = normalized.stack;

    return {
      exitCode: normalized.exitCode,
      text: `${JSON.stringify({ ok: false, error: details })}\n`,
    };
  }

  const lines = [`${normalized.code}: ${normalized.message}`];
  if (normalized.remediation !== undefined) lines.push(`Remediation: ${normalized.remediation}`);
  if (normalized.paths !== undefined) lines.push(`Paths: ${normalized.paths.join(", ")}`);
  if (normalized.components !== undefined) lines.push(`Components: ${normalized.components.join(", ")}`);
  if (debug && normalized.stack !== undefined) lines.push(normalized.stack);

  return { exitCode: normalized.exitCode, text: `${lines.join("\n")}\n` };
}
