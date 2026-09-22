import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  collectInitRequest,
  type PromptDriver,
  type WizardInput,
} from "../../../src/config/wizard.js";

function promptDriver(values: Record<string, unknown>): PromptDriver {
  const read = async <T>(id: string): Promise<T> => {
    if (!(id in values)) throw new Error(`Unexpected prompt: ${id}`);
    return values[id] as T;
  };

  return {
    input: (id) => read<string>(id),
    select: (id) => read<string>(id),
    number: (id) => read<number>(id),
    confirm: (id) => read<boolean>(id),
  };
}

describe("initialization wizard", () => {
  test("collects a complete interactive M1 request with explicit defaults", async () => {
    const input: WizardInput = { targetRoot: ".", nonInteractive: false };
    const prompts = promptDriver({
      profile: "hackathon",
      adapter: "codex",
      "project.name": "Signal Garden",
      "project.purpose": "Demonstrate one trustworthy user journey.",
      "project.mode": "new",
      timeboxMinutes: 300,
      qualityCommandName: "test",
      qualityCommandArgv: '["npm","test"]',
      mutableRoots: '["src","presentation"]',
      protectedPaths: '[".git",".env"]',
      presentationPath: "presentation",
      orchestrationMode: "guided",
      maxConcurrency: 4,
      presentationAudience: "Product reviewers",
      presentationDurationMinutes: 7,
      presentationOffline: true,
    });

    const request = await collectInitRequest(input, prompts);

    expect(request.targetRoot).toBe(path.resolve("."));
    expect(request.config).toEqual(
      expect.objectContaining({
        profile: "hackathon",
        harnesses: ["codex"],
        catalog: { selection: "curated", plugins: [] },
        orchestration: { mode: "guided", maxConcurrency: 4 },
        quality: { commands: [{ name: "test", argv: ["npm", "test"] }] },
      }),
    );
  });

  test("uses a complete answer file without prompting", async () => {
    const prompts = promptDriver({});

    const request = await collectInitRequest(
      {
        targetRoot: "fixture-target",
        nonInteractive: true,
        answersPath: "fixtures/answers/hackathon.yaml",
        profile: "hackathon",
        adapter: "codex",
      },
      prompts,
    );

    expect(request.targetRoot).toBe(path.resolve("fixture-target"));
    expect(request.config.project.name).toBe("Signal Garden");
  });

  test("offers the full profile and selects its complete local catalog", async () => {
    const request = await collectInitRequest(
      { targetRoot: ".", nonInteractive: false },
      promptDriver({
        profile: "full",
        adapter: "codex",
        "project.name": "Complete Factory",
        "project.purpose": "Install every local capability.",
        "project.mode": "existing",
        timeboxMinutes: 300,
        qualityCommandName: "test",
        qualityCommandArgv: '["npm","test"]',
        mutableRoots: '["src","presentation"]',
        protectedPaths: '[".git",".env"]',
        presentationPath: "presentation",
        orchestrationMode: "guided",
        maxConcurrency: 4,
        presentationAudience: "Product reviewers",
        presentationDurationMinutes: 7,
        presentationOffline: true,
      }),
    );

    expect(request.config).toEqual(expect.objectContaining({
      profile: "full",
      catalog: { selection: "all", plugins: [] },
      orchestration: { mode: "guided", maxConcurrency: 4 },
    }));
  });

  test.each(["claude-code"])("collects the %s adapter selected by the user", async (adapter) => {
    const request = await collectInitRequest(
      { targetRoot: ".", nonInteractive: false, profile: "minimal", adapter },
      promptDriver({
        "project.name": "Portable Factory",
        "project.purpose": "Render one canonical workflow for another harness.",
        "project.mode": "new",
        timeboxMinutes: 300,
        qualityCommandName: "test",
        qualityCommandArgv: '["npm","test"]',
        mutableRoots: '["src","presentation"]',
        protectedPaths: '[".git",".env"]',
        presentationPath: "presentation",
        orchestrationMode: "guided",
        maxConcurrency: 4,
        presentationAudience: "Product reviewers",
        presentationDurationMinutes: 7,
        presentationOffline: true,
      }),
    );

    expect(request.config.harnesses).toEqual([adapter]);
  });

  test("rejects missing answers in non-interactive mode", async () => {
    await expect(
      collectInitRequest(
        { targetRoot: ".", nonInteractive: true, profile: "hackathon", adapter: "codex" },
        promptDriver({}),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "FY_CONFIG_INVALID", exitCode: 2 }));
  });

  test("rejects a CLI selection that disagrees with the answer file", async () => {
    await expect(
      collectInitRequest(
        {
          targetRoot: ".",
          nonInteractive: true,
          answersPath: "fixtures/answers/hackathon.yaml",
          profile: "full",
          adapter: "codex",
        },
        promptDriver({}),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: "FY_UNSUPPORTED_SELECTION" }));
  });
});
