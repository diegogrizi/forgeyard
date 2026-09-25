import { describe, expect, test } from "vitest";

import { NATIVE_TOOL_SCHEMAS } from "../../../src/native/protocol.js";

/**
 * Tools whose payload carries no `runId`, so `ProjectService.execute` answers them before the
 * run branch: the project-intake family, the read-only context, the cooperative lease, the plan
 * that creates a run in the first place, and the handle on a recorded gate operation.
 *
 * Most of them also bind nothing to a revision and demand a commit from no member. `fy_plan`
 * does not: it sets `bindsToRevision` and refuses every touched member that has no commit. It
 * is exempt from carrying an identifier it is itself about to create, not from the binding —
 * and in this repository a comment that mis-states the invariant it guards is what later
 * becomes the contract.
 */
const WITHOUT_RUN_BINDING: ReadonlySet<string> = new Set([
  "fy_inspect", "fy_compose", "fy_prepare", "fy_apply",
  "fy_context", "fy_attach", "fy_plan", "fy_operation",
]);

/**
 * `execute` decides whether a call binds evidence to a revision by looking for a plan or a
 * `runId` in its payload, and only then requires every touched member to have a commit. That
 * default — bind nothing, check nothing — is safe only while every tool reaching the run branch
 * is forced by schema to carry a `runId`. It was a comment in `service.ts`, and a comment is not
 * a check: a tool added with `runId` merely optional would not be refused, it would fall back to
 * the placeholder member "." and, in a workspace root that is no working tree, be certified with
 * `gitCommits: { ".": null }`. A wrong certificate is worse than a refusal.
 *
 * Adding a tool that genuinely answers before the run branch makes this fail, which is the
 * intended failure: the exemption becomes a decision somebody takes on purpose, in writing.
 */
describe("ogni strumento che lega prove a una revisione porta un runId", () => {
  test("nessuno strumento fuori dall'elenco esente lascia runId facoltativo", () => {
    const optional = Object.entries(NATIVE_TOOL_SCHEMAS)
      .filter(([name]) => !WITHOUT_RUN_BINDING.has(name))
      .filter(([, tool]) => !(tool.inputSchema.required as readonly string[] | undefined)?.includes("runId"))
      .map(([name]) => name);

    // Named, not counted: a count says a rule was broken without saying by whom.
    expect(optional).toEqual([]);
  });

  test("l'elenco esente non trattiene strumenti che non esistono piu'", () => {
    // An exemption for a tool that was renamed or removed is an exemption nobody re-decided,
    // and it would silently cover the next tool that inherits the name.
    expect([...WITHOUT_RUN_BINDING].filter((name) => !(name in NATIVE_TOOL_SCHEMAS))).toEqual([]);
  });
});
