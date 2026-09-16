import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as files from "../../../src/native/files.js";
import { createPersonalWorkspace, inspectPersonalWorkspace } from "../../../src/workspace/personal.js";

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "forgia-recupero-")));
  roots.push(root);
  await writeFile(path.join(root, "codice.txt"), "codice preesistente\n");
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

// Si interrompe la sola scrittura atomica; ricognizione, proprietà e recupero usano il filesystem reale.
for (const failureAt of [1, 2]) {
  test(`un errore alla scrittura ${failureAt} rimuove soltanto i file creati da questa registrazione`, async () => {
    const root = await fixture(); const preview = await inspectPersonalWorkspace(root);
    const original = files.atomicText;
    let calls = 0;
    vi.spyOn(files, "atomicText").mockImplementation(async (...args) => {
      if (++calls === failureAt) throw new Error("Errore di scrittura simulato");
      await original(...args);
    });
    await expect(createPersonalWorkspace(preview)).rejects.toThrow("Errore di scrittura simulato");
    expect(await readdir(root)).toEqual(["codice.txt"]);
    expect(await readFile(path.join(root, "codice.txt"), "utf8")).toBe("codice preesistente\n");
  });
}

test("file concorrenti sconosciuti rimangono privati e non vengono cancellati dal recupero", async () => {
  const root = await fixture(); const preview = await inspectPersonalWorkspace(root);
  const original = files.atomicText; let calls = 0;
  vi.spyOn(files, "atomicText").mockImplementation(async (...args) => {
    if (++calls === 2) {
      await writeFile(path.join(root, ".forgeyard/appunto.txt"), "annotazione concorrente\n");
      throw new Error("Interruzione prima della registrazione");
    }
    await original(...args);
  });
  await expect(createPersonalWorkspace(preview)).rejects.toMatchObject({ code: "FY_PERSONAL_RECOVERY" });
  expect(await readFile(path.join(root, ".forgeyard/appunto.txt"), "utf8")).toBe("annotazione concorrente\n");
  expect(await readFile(path.join(root, ".forgeyard/.gitignore"), "utf8")).toContain("\n*\n");
  expect(await readFile(path.join(root, "codice.txt"), "utf8")).toBe("codice preesistente\n");
});

test("le istruzioni e le configurazioni native preesistenti non vengono toccate dalla registrazione", async () => {
  const root = await fixture();
  await mkdir(path.join(root, ".claude")); await mkdir(path.join(root, ".codex"));
  const existing = {
    "AGENTS.md": "# Convenzioni esistenti\n", "CLAUDE.md": "# Regole personali\n",
    ".claude/settings.json": '{"permissions":{"defaultMode":"default"}}\n',
    ".codex/config.toml": '# Configurazione personale\n',
  };
  for (const [relative, content] of Object.entries(existing)) await writeFile(path.join(root, relative), content);
  await createPersonalWorkspace(await inspectPersonalWorkspace(root));
  for (const [relative, content] of Object.entries(existing)) expect(await readFile(path.join(root, relative), "utf8")).toBe(content);
});
