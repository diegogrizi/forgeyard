import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const canonical = (value) => JSON.stringify(sortObject(value));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b, "en")).map((name) => [name, sortObject(value[name])]));
  return value;
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
/* One spelling of one directory. The service resolves roots with fs/promises.realpath,
   which expands a Windows 8.3 short component; the JS realpathSync keeps it, so the same
   folder gets two spellings and two workspace identities. The lookup below then finds no
   row and the guard denies every write instead of guarding, which reads as safety and is
   not. Both sides must resolve paths the same way. */
const realPath = (value) => realpathSync.native(value);

async function nativeGuard(root) {
  /* Read-only bridge to HF's private state. A lease is cooperative: a native
     session name is not authenticated identity, and shell writes are not guarded. */
  const realRoot = realPath(root);
  const git = (args) => execFileSync("git", args, { cwd: realRoot, encoding: "utf8", timeout: 10000, maxBuffer: 1048576, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const stateRoot = path.join(process.env.LOCALAPPDATA || (process.platform === "win32" ? path.join(os.homedir(), "AppData/Local") : path.join(os.homedir(), ".local/state")), "Forgeyard");
  const databasePath = path.join(stateRoot, "state.sqlite");
  try { lstatSync(databasePath); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  for (let cursor = databasePath; ; cursor = path.dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("Linked private state");
    if (path.dirname(cursor) === cursor) break;
  }
  const { DatabaseSync } = await import("node:sqlite");
  let commonDirectory;
  try { commonDirectory = realPath(git(["rev-parse", "--path-format=absolute", "--git-common-dir"])); }
  catch { return null; }
  const workspaceId = hash(canonical({ root: realRoot, commonDirectory }));
  const database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false, timeout: 1000 });
  let state;
  try { const row = database.prepare("SELECT state FROM workspaces WHERE id=?").get(workspaceId); state = JSON.parse(row?.state || "null"); }
  finally { database.close(); }
  if (!state) return null; /* No project state: the caller denies, it does not fall back. */
  if (state.capsuleId === null && !state.writer && state.runs.length === 0 && !state.installation) return null;
  if (state.installation || !state.writer || Date.parse(state.writer.expiresAt) < Date.now()) throw new Error("No current writer");
  const capsule = JSON.parse(readFileSync(path.join(root, ".forgeyard/capsule.json"), "utf8"));
  if (capsule.id !== state.capsuleId || hash(canonical(capsule.payload)) !== capsule.id) throw new Error("Capsule mismatch");
  const active = state.runs.filter((run) => run.activeTaskId && ["implementing", "repairing", "reviewing"].includes(run.status));
  if (active.length !== 1) throw new Error("Ambiguous native work order");
  const run = active[0]; const task = run.plan.tasks.find((task) => task.id === run.activeTaskId);
  const grant = state.grants.findLast((grant) => grant.runId === run.plan.id && grant.sessionId === state.writer.sessionId &&
    grant.capsuleId === capsule.id && grant.planSha256 === hash(canonical(run.plan)) && grant.policySha256 === hash(canonical(capsule.payload.policy)));
  if (!grant || !task || Date.parse(run.deadlineAt) < Date.now() || run.repairs > capsule.payload.policy.maxRepairs ||
    (capsule.payload.policy.maxRecordedCostUsd !== null && run.recordedCostUsd !== null && run.recordedCostUsd > capsule.payload.policy.maxRecordedCostUsd)) throw new Error("Missing consent/budget");
  for (const file of capsule.payload.files) {
    const target = path.resolve(root, file.path);
    if (relativeInside(root, target) === undefined || lstatSync(target).isSymbolicLink() || hash(readFileSync(target)) !== file.sha256 ||
      relativeInside(realRoot, nearestRealTarget(target)) === undefined) throw new Error("Frozen harness drift");
  }
  return { guard: { writeScopes: task.writeScopes, protectedPaths: [...capsule.payload.policy.protectedPaths,
    ".git", ".forgeyard", ".codex", ".claude", ".agents", ".cursor", "AGENTS.md", "CLAUDE.md", "forgeyard.yaml", "forgeyard.lock", ".mcp.json"] } };
}

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
      return path.resolve(realPath(cursor), ...missing.reverse());
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
  for await (const chunk of process.stdin) { source += chunk; if (Buffer.byteLength(source) > 1048576) throw new Error("Input limit"); }
  return JSON.parse(source);
}

try {
  const input = await readInput();
  const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  /* One source of scope truth. A second, weaker path that trusted a plain JSON file
     would become the real contract, because the most permissive consumer always does:
     the native route verifies the capsule, the writer lease, the consent grant and every
     frozen harness digest before it answers. */
  const runtime = await nativeGuard(root);
  if (!runtime?.guard || !Array.isArray(runtime.guard.writeScopes) || !Array.isArray(runtime.guard.protectedPaths)) {
    deny("no current native work order defines a write scope for this project");
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
  const realRoot = realPath(lexicalRoot);
  const realCandidate = nearestRealTarget(lexicalCandidate);
  const canonicalRelative = relativeInside(realRoot, realCandidate);
  if (canonicalRelative === undefined) {
    deny("the requested file resolves through a link outside the selected project");
    process.exit(0);
  }
  if (runtime.guard.protectedPaths.some((protectedPath) => containsPath(protectedPath, relative) || containsPath(protectedPath, canonicalRelative))) {
    deny("the requested file is a protected project path");
    process.exit(0);
  }
  if (!runtime.guard.writeScopes.some((scope) => containsPath(scope, relative)) ||
      !runtime.guard.writeScopes.some((scope) => containsPath(scope, canonicalRelative))) {
    deny("the requested file is outside the claimed task write scopes");
    process.exit(0);
  }
} catch {
  deny("the guard could not validate trusted task state");
}
