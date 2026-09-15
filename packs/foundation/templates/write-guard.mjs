import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

function deny(reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `Forgeyard denied this file tool because ${reason}.`,
    },
  })}\n`);
}

function key(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsPath(parent, candidate) {
  const left = key(parent);
  const right = key(candidate);
  return left === "." || right === left || right.startsWith(`${left}/`);
}

function relativeInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return (relative || ".").replaceAll("\\", "/");
}

function nearestRealTarget(candidate) {
  let cursor = candidate;
  const missing = [];
  while (true) {
    try {
      lstatSync(cursor);
      return path.resolve(realpathSync(cursor), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function readInput() {
  let source = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) source += chunk;
  return JSON.parse(source);
}

try {
  const input = await readInput();
  const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const state = JSON.parse(readFileSync(path.join(root, ".forgeyard", "state", "run.json"), "utf8"));
  const active = Object.entries(state.tasks || {}).filter(([, value]) => value?.status === "active");
  const requestedId = process.env.FORGEYARD_TASK_ID;
  let selected;
  if (requestedId) {
    selected = active.find(([id]) => id === requestedId);
    if (!selected) {
      deny("FORGEYARD_TASK_ID does not name an active claimed task");
      process.exit(0);
    }
  } else if (input.session_id) {
    const sessionMatches = active.filter(([, value]) => value?.sessionId === input.session_id);
    if (sessionMatches.length === 1) selected = sessionMatches[0];
  }
  if (!selected && active.length === 1) selected = active[0];
  if (!selected) {
    deny("the active task identity is ambiguous");
    process.exit(0);
  }
  const runtime = selected[1];
  if (!runtime?.guard || !Array.isArray(runtime.guard.writeScopes) || !Array.isArray(runtime.guard.protectedPaths)) {
    deny("the claimed task has no validated guard snapshot");
    process.exit(0);
  }
  const field = input.tool_name === "NotebookEdit" ? "notebook_path" : input.tool_name === "Edit" || input.tool_name === "Write" ? "file_path" : undefined;
  const candidate = field ? input.tool_input?.[field] : undefined;
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    deny("the tool input does not contain a supported file path");
    process.exit(0);
  }
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(input.cwd || root, candidate);
  const relative = relativeInside(lexicalRoot, lexicalCandidate);
  if (relative === undefined) {
    deny("the requested file is outside the selected project");
    process.exit(0);
  }
  const realRoot = realpathSync(lexicalRoot);
  const realCandidate = nearestRealTarget(lexicalCandidate);
  if (relativeInside(realRoot, realCandidate) === undefined) {
    deny("the requested file resolves through a link outside the selected project");
    process.exit(0);
  }
  if (runtime.guard.protectedPaths.some((protectedPath) => containsPath(protectedPath, relative))) {
    deny("the requested file is a protected project path");
    process.exit(0);
  }
  if (!runtime.guard.writeScopes.some((scope) => containsPath(scope, relative))) {
    deny("the requested file is outside the claimed task write scopes");
    process.exit(0);
  }
} catch {
  deny("the guard could not validate trusted task state");
}
