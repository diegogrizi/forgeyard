import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { ForgeyardError } from "../core/errors.js";
import { canonicalJson, sha256Text } from "../core/hash.js";
import { resolveInsideRoot } from "../core/paths.js";
import { assertDirectoryChain, atomicText } from "../native/files.js";

/** The recorded kinds. The union below is derived from this list so the two can never drift apart. */
const EVENT_KIND_LIST = [
  "workspace-registered",
  "harness-installed",
  "harness-updated",
  "run-opened",
  "task-claimed",
  "checkpoint-recorded",
  "gate-executed",
  "criterion-recorded",
  "review-recorded",
  "drift-detected",
  "run-blocked",
  "run-delivered",
] as const;

export type LedgerEventKind = (typeof EVENT_KIND_LIST)[number];

export interface LedgerEvent {
  /** 1-based position in the chain; every event increases it by exactly one. */
  sequence: number;
  /** ISO-8601 instant with milliseconds and a Z zone, declared by the caller. */
  at: string;
  kind: LedgerEventKind;
  payload: Record<string, unknown>;
  /** Hash of the preceding event; the genesis event references GENESIS_HASH. */
  previousHash: string;
  /** sha256Text(canonicalJson({ sequence, at, kind, payload, previousHash })). */
  hash: string;
}

export interface SealEventInput {
  sequence: number;
  at: string;
  kind: LedgerEventKind;
  payload: Record<string, unknown>;
}

export interface AppendEventInput {
  at: string;
  kind: LedgerEventKind;
  payload: Record<string, unknown>;
}

export interface AppendEventOptions {
  maximumEvents?: number;
}

export interface ChainVerification {
  valid: boolean;
  length: number;
  /** The verified head: null for an empty chain and for a chain that failed verification. */
  headHash: string | null;
  /** 1-based position of the first incoherent event, which is also the sequence it should declare. */
  brokenAt: number | null;
  reason: string | null;
}

export interface RunProjection {
  runId: string;
  status: "open" | "blocked" | "delivered";
  claimedTaskIds: readonly string[];
  checkpoints: number;
  gatesExecuted: number;
  gatesFailed: number;
  criteriaRecorded: number;
  reviewsRecorded: number;
  openedAt: string;
  lastEventAt: string;
}

export interface LedgerState {
  revision: number;
  workspaceRegisteredAt: string | null;
  harnessCapsuleId: string | null;
  runs: Readonly<Record<string, RunProjection>>;
  openDrift: readonly string[];
  headHash: string | null;
}

/** The chain root: no event precedes the genesis event. */
export const GENESIS_HASH: string = "0".repeat(64);

/**
 * Project-relative location of the append-only chain. The name states what distinguishes this file:
 * it is a verifiable chain, not the register of observations that lives beside it.
 */
export const LEDGER_RELATIVE_PATH = ".forgeyard/ledger/chain.jsonl";

const EVENT_KINDS: ReadonlySet<string> = new Set(EVENT_KIND_LIST);
/** The exact property set of a sealed record, sorted, so an extra or missing key is detectable. */
const EVENT_KEYS: readonly string[] = ["at", "hash", "kind", "payload", "previousHash", "sequence"];
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const DEFAULT_MAXIMUM_EVENTS = 100_000;
const MAXIMUM_LINE_BYTES = 65_536;
const MAXIMUM_LEDGER_BYTES = 67_108_864;
/** The native atomic writer bounds an owned artifact at 16 MiB, so the append path declares that bound. */
const MAXIMUM_WRITABLE_BYTES = 16_777_216;

function invalid(message: string, file?: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_LEDGER_INVALID",
    message,
    remediation: "Record events through appendEvent with a declared ISO-8601 instant and a JSON payload.",
    exitCode: 2,
    ...(file === undefined ? {} : { paths: [file] }),
  });
}

function broken(message: string, file: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_LEDGER_BROKEN",
    message,
    remediation: "Restore the ledger from its source: a tampered chain is not repaired by appending to it.",
    exitCode: 9,
    paths: [file],
  });
}

function limit(message: string, file?: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_LEDGER_LIMIT",
    message,
    remediation: "Archive the recorded chain and start a new ledger instead of growing beyond the declared bound.",
    exitCode: 2,
    ...(file === undefined ? {} : { paths: [file] }),
  });
}

/** Same code the native writer raises, so a caller sees one meaning for "another writer won". */
function drifted(message: string, file: string): ForgeyardError {
  return new ForgeyardError({
    code: "FY_ARTIFACT_DRIFT",
    message,
    remediation: "Read the ledger again and replay the append on top of the current head.",
    exitCode: 9,
    paths: [file],
  });
}

function unwritable(message: string, file: string, cause: unknown): ForgeyardError {
  return new ForgeyardError({
    code: "FY_LEDGER_UNWRITABLE",
    message,
    remediation: "Check the permissions and free space of the private Forgeyard directory, then append again.",
    exitCode: 9,
    paths: [file],
    cause,
  });
}

function isEventKind(value: unknown): value is LedgerEventKind {
  return typeof value === "string" && EVENT_KINDS.has(value);
}

function instantFault(at: unknown): string | null {
  if (typeof at !== "string" || !INSTANT.test(at)) return "at is not an ISO-8601 instant with milliseconds and Z";
  const parsed = Date.parse(at);
  // A well-formed instant can still be a rollover such as February 31; round-tripping rejects it.
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== at) return "at is not a real calendar instant";
  return null;
}

function payloadFault(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)
    || Object.getPrototypeOf(payload) !== Object.prototype) return "payload is not a plain JSON object";
  try {
    canonicalJson(payload);
  } catch {
    return "payload is not serializable as canonical JSON";
  }
  return null;
}

/** Every format rule of a sealed event except its position in the chain. */
function fieldFault(input: SealEventInput, previousHash: string): string | null {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) return "sequence is not an integer of at least 1";
  const instant = instantFault(input.at);
  if (instant !== null) return instant;
  if (!isEventKind(input.kind)) return "kind is not a recorded ledger event kind";
  const payload = payloadFault(input.payload);
  if (payload !== null) return payload;
  if (!DIGEST.test(previousHash)) return "previousHash is not a lowercase 64-character sha-256 digest";
  return null;
}

function eventHash(fields: Omit<LedgerEvent, "hash">): string {
  return sha256Text(canonicalJson({
    sequence: fields.sequence,
    at: fields.at,
    kind: fields.kind,
    payload: fields.payload,
    previousHash: fields.previousHash,
  }));
}

export function sealEvent(input: SealEventInput, previousHash: string): LedgerEvent {
  const fault = fieldFault(input, previousHash);
  if (fault !== null) throw invalid(`Refusing to seal a ledger event: ${fault}.`);
  // The sealed event owns a canonical copy of the payload, so a later caller mutation cannot invalidate the hash.
  const payload = JSON.parse(canonicalJson(input.payload)) as Record<string, unknown>;
  const fields = { sequence: input.sequence, at: input.at, kind: input.kind, payload, previousHash };
  return { ...fields, hash: eventHash(fields) };
}

function chainFault(event: LedgerEvent, position: number, previous: LedgerEvent | null): string | null {
  const fault = fieldFault(event, event.previousHash);
  if (fault !== null) return fault;
  if (!DIGEST.test(event.hash)) return "hash is not a lowercase 64-character sha-256 digest";
  if (event.sequence !== position) return `declared sequence ${event.sequence} is not the contiguous position ${position}`;
  if (previous === null) {
    if (event.previousHash !== GENESIS_HASH) return "the first event does not chain to the genesis hash";
  } else {
    if (event.previousHash !== previous.hash) return `previousHash does not match the hash of sequence ${previous.sequence}`;
    if (Date.parse(event.at) < Date.parse(previous.at)) return `at regresses below the instant of sequence ${previous.sequence}`;
  }
  if (eventHash(event) !== event.hash) return "the recorded hash does not match the sealed content";
  return null;
}

export function verifyChain(events: readonly LedgerEvent[]): ChainVerification {
  let position = 0;
  let previous: LedgerEvent | null = null;
  for (const event of events) {
    position += 1;
    const fault = chainFault(event, position, previous);
    if (fault !== null) {
      return { valid: false, length: events.length, headHash: null, brokenAt: position, reason: fault };
    }
    previous = event;
  }
  return {
    valid: true,
    length: events.length,
    headHash: previous === null ? null : previous.hash,
    brokenAt: null,
    reason: null,
  };
}

function ledgerFile(root: string): string {
  return resolveInsideRoot(root, LEDGER_RELATIVE_PATH);
}

/**
 * Replaces the ledger with the appended content. The atomic writer owns the write rule, including its
 * retry on a transient rename fault; what belongs here is classifying a failure it could not resolve,
 * because a full disk and a tampered file are not the same fact.
 */
async function replaceLedger(file: string, content: string, previous: string | null): Promise<void> {
  try {
    await atomicText(file, content, previous === null ? null : sha256Text(previous));
  } catch (error) {
    if (error instanceof ForgeyardError) throw error;
    const current = await ledgerText(file);
    // The rename may have landed before the failure surfaced; those bytes are ours, so the append stands.
    if (current === content) return;
    // Anything else on disk is another writer's: its bytes are preserved and the append is refused.
    if (current !== previous) throw drifted("The ledger changed while appending; the event was not recorded.", file);
    throw unwritable("The ledger could not be replaced atomically; the event was not recorded.", file, error);
  }
}

/** Reads the ledger as bounded UTF-8 text, or null when no ledger has been opened yet. */
async function ledgerText(file: string): Promise<string | null> {
  const stats = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (stats === undefined) return null;
  await assertDirectoryChain(path.dirname(file));
  if (stats.isSymbolicLink() || !stats.isFile()) throw invalid("The ledger is not a regular file.", file);
  if (stats.size > MAXIMUM_LEDGER_BYTES) throw limit("The ledger exceeds its bounded size.", file);
  const bytes = await readFile(file);
  if (bytes.byteLength > MAXIMUM_LEDGER_BYTES) throw limit("The ledger exceeds its bounded size.", file);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("The ledger is not valid UTF-8.", file);
  }
  if (text.includes("\0")) throw invalid("The ledger contains forbidden NUL bytes.", file);
  return text;
}

function parseEvent(line: string, file: string): LedgerEvent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    throw invalid("The ledger contains a line that is not JSON.", file);
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw invalid("A ledger line is not a JSON object.", file);
  }
  const record = decoded as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right, "en"));
  if (keys.length !== EVENT_KEYS.length || keys.some((key, index) => key !== EVENT_KEYS[index])) {
    throw invalid("A ledger record does not carry exactly the sealed event properties.", file);
  }
  if (typeof record.sequence !== "number" || typeof record.at !== "string" || typeof record.kind !== "string"
    || typeof record.previousHash !== "string" || typeof record.hash !== "string") {
    throw invalid("A ledger record carries a sealed property of the wrong type.", file);
  }
  const event: LedgerEvent = {
    sequence: record.sequence,
    at: record.at,
    kind: record.kind as LedgerEventKind,
    payload: record.payload as Record<string, unknown>,
    previousHash: record.previousHash,
    hash: record.hash,
  };
  const fault = fieldFault(event, event.previousHash);
  if (fault !== null) throw invalid(`A ledger record is not a sealed event: ${fault}.`, file);
  if (!DIGEST.test(event.hash)) throw invalid("A ledger record carries a malformed hash.", file);
  return event;
}

/** Shape validation only: a malformed line is a failure, never a skipped event. */
function parseChain(text: string, file: string): readonly LedgerEvent[] {
  if (text.length === 0) return [];
  if (!text.endsWith("\n")) throw invalid("The ledger does not end with a newline; its last record may be torn.", file);
  const events: LedgerEvent[] = [];
  for (const line of text.slice(0, -1).split("\n")) {
    if (line.length === 0) throw invalid("The ledger contains a blank line; every line holds exactly one event.", file);
    if (Buffer.byteLength(line, "utf8") > MAXIMUM_LINE_BYTES) throw limit("A ledger record exceeds its bounded size.", file);
    events.push(parseEvent(line, file));
  }
  return events;
}

export async function readChain(root: string): Promise<readonly LedgerEvent[]> {
  const file = ledgerFile(root);
  const text = await ledgerText(file);
  return text === null ? [] : parseChain(text, file);
}

/**
 * Seals one event onto the verified head of the ledger. The instant is declared by the caller:
 * this module never reads the ambient clock, so a recorded chain is reproducible.
 */
export async function appendEvent(
  root: string,
  input: AppendEventInput,
  options: AppendEventOptions = {},
): Promise<LedgerEvent> {
  const maximumEvents = options.maximumEvents ?? DEFAULT_MAXIMUM_EVENTS;
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1) {
    throw invalid("The maximumEvents bound must be an integer of at least 1.");
  }
  const file = ledgerFile(root);
  const text = await ledgerText(file);
  const events = text === null ? [] : parseChain(text, file);
  const verification = verifyChain(events);
  if (!verification.valid) {
    throw broken(`Refusing to append to a broken ledger at sequence ${verification.brokenAt}: ${verification.reason}.`, file);
  }
  if (events.length >= maximumEvents) {
    throw limit(`The ledger reached its bounded capacity of ${maximumEvents} events.`, file);
  }
  const instant = instantFault(input.at);
  if (instant !== null) throw invalid(`Refusing to append a ledger event: ${instant}.`, file);
  const head = events.at(-1);
  // Appending a regressing instant would seal a chain that cannot verify, so it is refused before any write.
  if (head !== undefined && Date.parse(input.at) < Date.parse(head.at)) {
    throw invalid(`Refusing to append a ledger event whose instant precedes sequence ${head.sequence}.`, file);
  }

  const event = sealEvent(
    { sequence: events.length + 1, at: input.at, kind: input.kind, payload: input.payload },
    verification.headHash ?? GENESIS_HASH,
  );
  const line = canonicalJson(event);
  if (Buffer.byteLength(line, "utf8") > MAXIMUM_LINE_BYTES) {
    throw limit("The sealed event exceeds the bounded record size.", file);
  }
  const content = `${text ?? ""}${line}\n`;
  // Refused here rather than inside the atomic writer, so the bound the caller hit is the one reported.
  if (Buffer.byteLength(content, "utf8") > MAXIMUM_WRITABLE_BYTES) {
    throw limit("The ledger would exceed the bounded size of a writable artifact.", file);
  }
  // The private directory is created only once the event is accepted, so a refusal leaves no trace.
  await assertDirectoryChain(path.dirname(file), true);
  // Full-file rewrite against the digest just read: a concurrent change is refused, never overwritten.
  await replaceLedger(file, content, text);
  // An acknowledged append must be the append that landed, so the recorded bytes are read back.
  if (await ledgerText(file) !== content) {
    throw drifted("The ledger changed while appending; the event was not recorded.", file);
  }
  return event;
}

interface MutableRun {
  runId: string;
  status: RunProjection["status"];
  claimedTaskIds: string[];
  checkpoints: number;
  gatesExecuted: number;
  gatesFailed: number;
  criteriaRecorded: number;
  reviewsRecorded: number;
  openedAt: string;
  lastEventAt: string;
}

function openRun(runId: string, at: string): MutableRun {
  return {
    runId,
    status: "open",
    claimedTaskIds: [],
    checkpoints: 0,
    gatesExecuted: 0,
    gatesFailed: 0,
    criteriaRecorded: 0,
    reviewsRecorded: 0,
    openedAt: at,
    lastEventAt: at,
  };
}

/**
 * Folds a chain into the state it describes. Pure and deterministic: no I/O, no ambient clock,
 * no iteration over unordered keys. The same events always produce the same state.
 * Verification is the caller's duty: run verifyChain before trusting a rebuilt state.
 */
export function rebuildState(events: readonly LedgerEvent[]): LedgerState {
  const runs = new Map<string, MutableRun>();
  // Insertion-ordered set of the drift findings that no later harness update has superseded.
  const openDrift = new Set<string>();
  let workspaceRegisteredAt: string | null = null;
  let harnessCapsuleId: string | null = null;
  let headHash: string | null = null;

  for (const event of events) {
    headHash = event.hash;
    switch (event.kind) {
      case "workspace-registered": {
        // The first registration is the registration; a repeated one does not move the date.
        if (workspaceRegisteredAt === null) workspaceRegisteredAt = event.at;
        break;
      }
      case "harness-installed":
      case "harness-updated": {
        if (typeof event.payload.capsuleId === "string") harnessCapsuleId = event.payload.capsuleId;
        // A harness update supersedes every drift finding recorded before it; findings after it stay open.
        if (event.kind === "harness-updated") openDrift.clear();
        break;
      }
      case "drift-detected": {
        if (typeof event.payload.findingId === "string") openDrift.add(event.payload.findingId);
        break;
      }
      default:
        break;
    }

    // An event without a string run identifier still advances the revision, but projects no run.
    const runId = event.payload.runId;
    if (typeof runId !== "string") continue;
    if (event.kind === "run-opened" && !runs.has(runId)) runs.set(runId, openRun(runId, event.at));
    // A run must be opened before its events can be projected, so openedAt is always a recorded instant.
    const run = runs.get(runId);
    if (run === undefined) continue;
    run.lastEventAt = event.at;
    switch (event.kind) {
      case "task-claimed": {
        const taskId = event.payload.taskId;
        // A repeated claim of the same task is one claim.
        if (typeof taskId === "string" && !run.claimedTaskIds.includes(taskId)) run.claimedTaskIds.push(taskId);
        break;
      }
      case "checkpoint-recorded": {
        run.checkpoints += 1;
        break;
      }
      case "gate-executed": {
        run.gatesExecuted += 1;
        // A gate that does not report exit code 0 is not credited as passing: an absent code counts as a failure.
        if (event.payload.exitCode !== 0) run.gatesFailed += 1;
        break;
      }
      case "criterion-recorded": {
        run.criteriaRecorded += 1;
        break;
      }
      case "review-recorded": {
        run.reviewsRecorded += 1;
        break;
      }
      case "run-blocked": {
        run.status = "blocked";
        break;
      }
      case "run-delivered": {
        // A delivery never clears a block: a blocked run stays blocked.
        if (run.status !== "blocked") run.status = "delivered";
        break;
      }
      default:
        break;
    }
  }

  const projected: Record<string, RunProjection> = {};
  for (const runId of [...runs.keys()].sort((left, right) => left.localeCompare(right, "en"))) {
    const run = runs.get(runId);
    if (run === undefined) continue;
    projected[runId] = { ...run, claimedTaskIds: [...run.claimedTaskIds] };
  }

  return {
    revision: events.length,
    workspaceRegisteredAt,
    harnessCapsuleId,
    runs: projected,
    openDrift: [...openDrift],
    headHash,
  };
}
