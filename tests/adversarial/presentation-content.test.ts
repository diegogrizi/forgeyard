import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { auditPresentationBundle } from "../../src/doctor/presentation-audit.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("presentation contamination audit", () => {
  test("finds remote, tracking, embedded, identity-bearing, network, and unresolved content without echoing it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgeyard-presentation-adversarial-"));
    temporaryRoots.push(root);
    const directory = path.join(root, "presentation");
    await mkdir(directory);
    await writeFile(
      path.join(directory, "index.html"),
      `<!doctype html><html><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <meta name="author" content="Example Sponsor">
        <script src="//analytics.example.invalid/tracker.js"></script>
      </head><body>
        <header class="sponsor-logo">Example Sponsor</header>
        <main><section id="opening" data-slide><h1>{{project.name}}</h1><iframe src="local.html"></iframe></section></main>
        <nav><button id="previous-slide">Previous</button><p id="slide-status" aria-live="polite">1</p><button id="next-slide">Next</button></nav>
        <script src="app.js"></script>
      </body></html>`,
      "utf8",
    );
    await writeFile(
      path.join(directory, "styles.css"),
      '@import url("https://fonts.example.invalid/type.css");\n.logo:focus-visible { outline: 0; }\n',
      "utf8",
    );
    await writeFile(
      path.join(directory, "app.js"),
      'fetch("/telemetry"); navigator.sendBeacon("/metrics"); new WebSocket("ws://example.invalid");\n',
      "utf8",
    );

    const findings = await auditPresentationBundle({
      root,
      directory: "presentation",
      denyTerms: ["Example Sponsor"],
    });
    const serialized = JSON.stringify(findings);

    expect(findings).toEqual(expect.arrayContaining([
      { ruleId: "presentation.remote-reference", path: "presentation/app.js" },
      { ruleId: "presentation.remote-reference", path: "presentation/index.html" },
      { ruleId: "presentation.remote-reference", path: "presentation/styles.css" },
      { ruleId: "presentation.unsafe-embed", path: "presentation/index.html" },
      { ruleId: "presentation.identity-metadata", path: "presentation/index.html" },
      { ruleId: "presentation.identity-mark", path: "presentation/index.html" },
      { ruleId: "presentation.tracking", path: "presentation/app.js" },
      { ruleId: "presentation.tracking", path: "presentation/index.html" },
      { ruleId: "presentation.network-code", path: "presentation/app.js" },
      { ruleId: "presentation.unresolved-template", path: "presentation/index.html" },
    ]));
    expect(serialized.toLocaleLowerCase("en-US")).not.toContain("example sponsor");
  });
});
