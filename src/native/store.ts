import { mkdir, lstat, chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { canonicalJson, sha256Text } from "../core/hash.js";
import { ForgeyardError } from "../core/errors.js";
import type { NativeEnvelope, NativeResponse, NativeState } from "./contracts.js";

export function nativeError(code: string, message: string): ForgeyardError {
  return new ForgeyardError({ code, message, exitCode: 9,
    remediation: "Inspect Forgeyard context and the current revision before retrying. Do not bypass a blocked operation." });
}

/** Raised at 2 when a run's baseline became one commit per member. */
const SCHEMA_VERSION = 2;

function initialState(): NativeState {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, capsuleId: null, writer: null,
    runs: [], grants: [], operations: [], artifacts: [] };
}

export class NativeStore {
  private constructor(private readonly db: DatabaseSync, private readonly workspaceId: string) {}

  static async open(directory: string, workspaceId: string): Promise<NativeStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "state.sqlite");
    const directoryStats = await lstat(directory);
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) throw nativeError("FY_STATE_UNSAFE", "Local state must be a regular private directory.");
    const stats = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stats && (stats.isSymbolicLink() || !stats.isFile())) throw nativeError("FY_STATE_UNSAFE", "Local state must be a regular SQLite file.");
    const db = new DatabaseSync(file, { timeout: 5000, allowExtension: false });
    await chmod(file, 0o600);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    db.exec(`CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, state TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS requests(workspace TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        response TEXT NOT NULL, PRIMARY KEY(workspace,id)) STRICT;
      CREATE TABLE IF NOT EXISTS events(workspace TEXT NOT NULL, revision INTEGER NOT NULL,
        kind TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY(workspace,revision)) STRICT;`);
    db.prepare("INSERT OR IGNORE INTO workspaces(id,state) VALUES (?,?)").run(workspaceId, canonicalJson(initialState()));
    return new NativeStore(db, workspaceId);
  }

  read(): NativeState {
    const row = this.db.prepare("SELECT state FROM workspaces WHERE id=?").get(this.workspaceId)!;
    const state = JSON.parse(String(row.state)) as NativeState;
    // The version was written and never read, which made it a declaration nothing could
    // falsify. A state from before an incompatible change cannot be interpreted, and reading
    // it anyway surfaces as a raw TypeError on a field that is simply absent.
    const version: number = state.schemaVersion;
    if (version !== SCHEMA_VERSION) throw new ForgeyardError({
      code: "FY_STATE_INCOMPATIBLE", exitCode: 9,
      message: `This private execution state declares schema version ${String(version)}; this Forgeyard writes version ${String(SCHEMA_VERSION)}.`,
      remediation: "This state predates an incompatible change and is not migrated. Remove the Forgeyard state directory and start a new run; no project file is touched.",
    });
    return state;
  }

  replay(envelope: NativeEnvelope): NativeResponse | null {
    const previous = this.db.prepare("SELECT fingerprint,response FROM requests WHERE workspace=? AND id=?")
      .get(this.workspaceId, envelope.requestId);
    if (!previous) return null;
    if (previous.fingerprint !== sha256Text(canonicalJson(envelope)))
      throw nativeError("FY_IDEMPOTENCY_CONFLICT", "This request ID was already used for different inputs.");
    return JSON.parse(String(previous.response)) as NativeResponse;
  }

  change(envelope: NativeEnvelope, expectedRevision: number,
    mutate: (state: NativeState) => Record<string, unknown>): { response: NativeResponse; replay: boolean } {
    const fingerprint = sha256Text(canonicalJson(envelope));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db.prepare("SELECT fingerprint,response FROM requests WHERE workspace=? AND id=?")
        .get(this.workspaceId, envelope.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw nativeError("FY_IDEMPOTENCY_CONFLICT", "This request ID was already used for different inputs.");
        this.db.exec("COMMIT");
        return { response: JSON.parse(String(previous.response)) as NativeResponse, replay: true };
      }
      const state = this.read();
      if (state.revision !== expectedRevision) throw nativeError("FY_REVISION_CONFLICT", `Expected revision ${expectedRevision}; current revision is ${state.revision}.`);
      const result = mutate(state);
      state.revision += 1;
      const response: NativeResponse = { protocolVersion: "0.2", requestId: envelope.requestId,
        ok: true, revision: state.revision, result };
      const serialized = canonicalJson(state);
      if (Buffer.byteLength(serialized) > 8_388_608) throw nativeError("FY_STATE_LIMIT", "Local project state reached its bounded capacity.");
      this.db.prepare("UPDATE workspaces SET state=? WHERE id=?").run(serialized, this.workspaceId);
      this.db.prepare("INSERT INTO events(workspace,revision,kind,event) VALUES (?,?,?,?)")
        .run(this.workspaceId, state.revision, envelope.tool, canonicalJson({ requestId: envelope.requestId, result }));
      this.db.prepare("INSERT INTO requests(workspace,id,fingerprint,response) VALUES (?,?,?,?)")
        .run(this.workspaceId, envelope.requestId, fingerprint, canonicalJson(response));
      this.db.exec("COMMIT");
      return { response, replay: false };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  internal(kind: string, id: string, mutate: (state: NativeState) => Record<string, unknown>): NativeResponse {
    return this.change({ protocolVersion: "0.2", requestId: id, tool: kind, payload: {} }, this.read().revision, mutate).response;
  }

  close(): void { this.db.close(); }
}
