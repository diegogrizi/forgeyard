import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, test } from "vitest";
import { resolveCapabilities, BUNDLED_CAPABILITIES, BUNDLED_CAPABILITY_SOURCES, type CapabilityCandidate } from "../../../src/intake/capabilities.js";

function candidate(id: string, provides: string[], extra: Partial<CapabilityCandidate> = {}): CapabilityCandidate {
  return { id, provides, admitted: true, license: "Apache-2.0", clients: ["codex"], permissions: [], contextTokens: 10, dependencies: [], conflicts: [], ...extra };
}
const method = candidate("method", ["method.coordinate"], { orchestration: true });
describe("bounded need-level capability resolver", () => {
  test("resolves bundled descriptors without claiming evaluated or live client support", () => {
    const result = resolveCapabilities(["method.coordinate", "domain.spring", "quality.test"], BUNDLED_CAPABILITIES, { client: "codex" });
    expect(result.selected).toEqual(["forgeyard-workflow", "jvm-languages", "unit-testing"]);
    expect(BUNDLED_CAPABILITIES.every((item) => item.source?.support === "descriptor-only")).toBe(true);
  });
  test("chooses stable minimal dependency-closed coverage independently of input order", () => {
    const records = [method, candidate("react", ["domain.react"], { dependencies: ["base"] }), candidate("base", []), candidate("z-big", ["domain.react"], { dependencies: ["react"] })];
    expect(resolveCapabilities(["method.coordinate", "domain.react"], records, { client: "codex" }).selected).toEqual(["base", "method", "react"]);
    expect(resolveCapabilities(["domain.react", "method.coordinate"], records.toReversed(), { client: "codex" }).selected).toEqual(["base", "method", "react"]);
  });
  test("breaks equal component-count ties by fewer distinct permissions then context cost", () => {
    const records = [method, candidate("a-privileged", ["a"], { permissions: ["network"], contextTokens: 1 }), candidate("b-heavy", ["a"], { contextTokens: 20 }), candidate("z-minimal", ["a"], { contextTokens: 2 })];
    expect(resolveCapabilities(["a"], records, { client: "codex", allowedPermissions: ["network"] }).selected).toEqual(["method", "z-minimal"]);
    expect(resolveCapabilities(["a"], records.toReversed(), { client: "codex", allowedPermissions: ["network"] }).selected).toEqual(["method", "z-minimal"]);
  });
  test("includes dependency-provided mandatory coverage without requiring a direct root provider", () => {
    const coordinator = candidate("coordinator", ["method.coordinate"], { orchestration: true, dependencies: ["domain"] });
    const result = resolveCapabilities(["domain.react"], [coordinator, candidate("domain", ["domain.react"])], { client: "codex" });
    expect(result.selected).toEqual(["coordinator", "domain"]);
    expect(result.coverage).toEqual([{ requirement: "domain.react", providers: ["domain"] }]);
  });
  test("uses distinguishable unsupported-coverage and exhausted-search codes", () => {
    expect(() => resolveCapabilities(["missing"], [method], { client: "codex" })).toThrow(expect.objectContaining({ code: "FY_UNSUPPORTED_CAPABILITY" }));
    expect(() => resolveCapabilities(["a"], [method, candidate("a", ["a"])], { client: "codex", maxStates: 1 })).toThrow(expect.objectContaining({ code: "FY_RESOLUTION_LIMIT" }));
    expect(() => resolveCapabilities(["a"], [method], { client: "codex", maxStates: 10001 })).toThrow(expect.objectContaining({ code: "FY_INTAKE_UNSAFE" }));
  });
  test("never admits dangling source or plugin descriptors", () => {
    const source = { sourceId: "missing.source", pluginId: "unit-testing", support: "descriptor-only" as const };
    const result = resolveCapabilities(["a"], [method, candidate("valid", ["a"]), candidate("dangling-source", ["a"], { source }), candidate("dangling-plugin", ["a"], { source: { ...source, sourceId: "github.wshobson-agents", pluginId: "invented-plugin" } })], { client: "codex" });
    expect(result.excluded).toContainEqual({ id: "dangling-source", reason: "source-unavailable" });
    expect(result.excluded).toContainEqual({ id: "dangling-plugin", reason: "plugin-unavailable" });
  });
  test("binds every bundled non-original descriptor to the actual sources manifest and vendored plugin inventory", async () => {
    const catalog = parse(await readFile(new URL("../../../sources/catalog.yaml", import.meta.url), "utf8")) as { sources: { id: string; license: string }[] };
    const plugins = new Set((await readdir(new URL("../../../packs/ecosystem/vendor/plugins/", import.meta.url), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    for (const registered of BUNDLED_CAPABILITY_SOURCES) {
      expect(catalog.sources.find((record) => record.id === registered.sourceId)?.license).toBe(registered.license);
      expect(registered.pluginIds.every((plugin) => plugins.has(plugin))).toBe(true);
    }
    for (const descriptor of BUNDLED_CAPABILITIES) {
      const source = descriptor.source!;
      if (source.sourceId === undefined) continue;
      expect(catalog.sources.find((record) => record.id === source.sourceId)?.license).toBe(descriptor.license);
      if (source.pluginId !== undefined) expect(plugins.has(source.pluginId)).toBe(true);
    }
  });
  test("uses the explicitly bound source registry and rejects mismatched source licenses", () => {
    const source = { sourceId: "custom.source", pluginId: "custom-plugin", support: "descriptor-only" as const };
    const result = resolveCapabilities(["a"], [method, candidate("correct", ["a"], { source, license: "MIT" }), candidate("wrong-license", ["a"], { source })], { client: "codex", sources: [{ sourceId: "custom.source", license: "MIT", pluginIds: ["custom-plugin"] }] });
    expect(result.selected).toEqual(["correct", "method"]);
    expect(result.excluded).toContainEqual({ id: "wrong-license", reason: "source-license-mismatch" });
  });
  test("enforces symmetric conflicts and exactly one coordinator", () => {
    expect(() => resolveCapabilities(["a", "b"], [method, candidate("a", ["a"], { conflicts: ["b"] }), candidate("b", ["b"])], { client: "codex" })).toThrow(/coverage/i);
    expect(() => resolveCapabilities(["a", "b"], [candidate("a", ["a"], { orchestration: true }), candidate("b", ["b"], { orchestration: true })], { client: "codex" })).toThrow(/coverage/i);
  });
  test("excludes revoked, incompatible, unlicensed and over-budget candidates", () => {
    const bad = [candidate("revoked", ["domain.react"], { admitted: false }), candidate("license", ["domain.react"], { license: "" }), candidate("client", ["domain.react"], { clients: ["claude-code"] }), candidate("permission", ["domain.react"], { permissions: ["network"] }), candidate("context", ["domain.react"], { contextTokens: 100 })];
    const result = resolveCapabilities(["domain.react"], [method, candidate("good", ["domain.react"]), ...bad], { client: "codex", allowedPermissions: [], maxContextTokens: 30 });
    expect(result.selected).toEqual(["good", "method"]);
    expect(result.excluded.map((item) => item.id)).toEqual(["client", "context", "license", "permission", "revoked"]);
  });
  test("does not treat absent licensing assertions as a usable license", () => {
    const result = resolveCapabilities(["a"], [method, candidate("good", ["a"]), candidate("unknown", ["a"], { license: "NOASSERTION" }), candidate("private", ["a"], { license: "UNLICENSED" })], { client: "codex" });
    expect(result.excluded).toContainEqual({ id: "unknown", reason: "unlicensed" });
    expect(result.excluded).toContainEqual({ id: "private", reason: "unlicensed" });
  });
  test("enforces exclusive groups and cumulative dependency context budgets", () => {
    const result = resolveCapabilities(["a", "b"], [method, candidate("a", ["a"], { exclusiveGroup: "domain" }), candidate("b", ["b"], { exclusiveGroup: "domain" }), candidate("both", ["a", "b"], { dependencies: ["base"] }), candidate("base", [], { contextTokens: 20 })], { client: "codex", maxContextTokens: 40 });
    expect(result.selected).toEqual(["base", "both", "method"]);
    expect(() => resolveCapabilities(["a", "b"], [method, candidate("both", ["a", "b"], { dependencies: ["base"] }), candidate("base", [], { contextTokens: 21 })], { client: "codex", maxContextTokens: 40 })).toThrow(/coverage/i);
  });
  test("rejects missing dependencies and cycles rather than inventing skills", () => {
    for (const records of [[method, candidate("a", ["a"], { dependencies: ["missing"] })], [method, candidate("a", ["a"], { dependencies: ["b"] }), candidate("b", [], { dependencies: ["a"] })]]) {
      expect(() => resolveCapabilities(["a"], records, { client: "codex" })).toThrow(/coverage/i);
    }
  });
  test("preserves explicit cycle exclusions when a valid alternative exists", () => {
    const result = resolveCapabilities(["a"], [method, candidate("a-cycle", ["a"], { dependencies: ["b-cycle"] }), candidate("b-cycle", [], { dependencies: ["a-cycle"] }), candidate("good", ["a"])], { client: "codex" });
    expect(result.selected).toEqual(["good", "method"]);
    expect(result.excluded).toContainEqual({ id: "a-cycle", reason: "dependency-cycle" });
  });
  test("fails explicitly at its state limit and rejects limits beyond 10000", () => {
    expect(() => resolveCapabilities(["a"], [method, candidate("a", ["a"])], { client: "codex", maxStates: 1 })).toThrow(/limit/i);
    expect(() => resolveCapabilities(["a"], [method], { client: "codex", maxStates: 10001 })).toThrow(/limit/i);
  });
});
