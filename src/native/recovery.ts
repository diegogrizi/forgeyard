import type { Capsule, GateDefinition } from "../capsule/capsule.js";
import { canonicalJson } from "../core/hash.js";

/** Signal zero is a read-only liveness check. PID reuse/permission denial is
 * deliberately treated as alive, never as permission to kill a process. */
export function processMayBeAlive(pid: number | undefined): boolean {
  if (!Number.isSafeInteger(pid) || !pid || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function renderGate(gate: GateDefinition | undefined): string {
  return gate === undefined ? "absent"
    : `${gate.name} ${canonicalJson(gate.argv)} cwd=${gate.cwd ?? "."} parser=${gate.parser} timeout=${String(gate.timeoutMs)}ms`;
}

/**
 * What a human actually accepts when a capsule is swapped: the policy fields that moved, the
 * gates that would now run, and how many frozen harness files changed. Two content addresses
 * are not a description of a policy, and a confirmation that shows only them asks for consent
 * to something nobody can read.
 *
 * A previous capsule that is no longer on disk answers `unavailable`, never "no difference":
 * an absent comparison and an empty one are different claims, and the second would let a
 * policy change pass as nothing at all. Detection compares the canonical form of each value,
 * so a field this renderer does not print still counts as a difference.
 */
export function capsuleDifference(previous: Capsule | null, current: Capsule): readonly string[] {
  if (previous === null) return ["Difference: unavailable — the stored capsule's own bytes are no longer on disk, " +
    "so no field-by-field comparison is claimed here. Read the accepted policy and the gates below before confirming."];
  const lines: string[] = [];
  const order = (left: string, right: string) => left.localeCompare(right, "en");
  const was = previous.payload.policy as unknown as Record<string, unknown>;
  const now = current.payload.policy as unknown as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort(order)) {
    if (canonicalJson(was[key] ?? null) !== canonicalJson(now[key] ?? null))
      lines.push(`policy.${key}: ${canonicalJson(was[key] ?? null)} -> ${canonicalJson(now[key] ?? null)}`);
  }
  const gateIds = [...new Set([...previous.payload.gates, ...current.payload.gates].map((gate) => gate.id))].sort(order);
  for (const id of gateIds) {
    const before = previous.payload.gates.find((gate) => gate.id === id);
    const after = current.payload.gates.find((gate) => gate.id === id);
    if (canonicalJson(before ?? null) === canonicalJson(after ?? null)) continue;
    // A readable form that comes out identical on both sides would announce a change nobody can
    // see — a gate field this renderer omits, today or after the next one is added. The canonical
    // form then carries the difference, whatever field it sits in.
    const readable = [renderGate(before), renderGate(after)] as const;
    const [left, right] = readable[0] === readable[1]
      ? [canonicalJson(before ?? null), canonicalJson(after ?? null)] : readable;
    lines.push(`gates.${id}: ${left} -> ${right}`);
  }
  // Il conteggio e non l'elenco: un aggiornamento ne cambia decine, e una conferma lunga tre
  // schermate non viene letta. Che siano cambiati va detto comunque.
  const inventory = (capsule: Capsule) => new Map(capsule.payload.files.map((file) => [file.path, file.sha256]));
  const previousFiles = inventory(previous); const currentFiles = inventory(current);
  const changed = [...currentFiles].filter(([path, sha256]) => previousFiles.has(path) && previousFiles.get(path) !== sha256).length;
  const added = [...currentFiles.keys()].filter((path) => !previousFiles.has(path)).length;
  const removed = [...previousFiles.keys()].filter((path) => !currentFiles.has(path)).length;
  if (changed + added + removed > 0)
    lines.push(`frozen harness files: ${String(changed)} changed, ${String(added)} added, ${String(removed)} removed`);
  if (lines.length === 0) lines.push("Policy, gates and frozen harness files are identical: " +
    "the capsule identity changed without changing anything this comparison covers.");
  return lines;
}
