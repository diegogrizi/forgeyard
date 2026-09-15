# Forgeyard repository instructions

Forgeyard is a stack-neutral factory kernel plus a pinned, licensed capability catalog. Its current executable adapter is Codex. Keep product-specific semantics in fixtures and installed configuration, never in the kernel or shared catalog transforms.

- Write repository content in English.
- Use test-driven development for behavior changes and run the narrow test before the full release gate.
- Preserve deterministic rendering, project-root confinement, seed versus managed ownership, transactional recovery, revision-bound evidence, and non-leaking errors.
- Do not add network calls, telemetry, automatic external effects, broad command wildcards, or claims of OS isolation.
- Keep `AGENTS.md` navigational; detailed reusable procedures belong in skills that load on demand.
- Treat catalog roles as discoverable definitions, never as automatically running workers. Preserve the default concurrency cap of four.
- Preserve vendored catalog bytes exactly. Put adapter logic outside `packs/ecosystem/vendor/plugins/` and make every catalog update explicit, pinned, and attested.
- Never execute vendored hooks or scripts during discovery, rendering, installation, or validation.
- Contribute original or license-compatible material only. Every non-original pack needs a complete catalog source and `sourceId`.
- Pin direct package versions and regenerate `THIRD_PARTY_NOTICES.md` and `SBOM.spdx.json` after dependency changes.
- Presentation content must remain offline, accessible, responsive, identity-neutral, and free of event-specific assets, remote fonts, tracking, and fake evidence.
- Never commit local evidence, operation state, logs, coverage, screenshots, credentials, private deny values, or generated target projects.
- Before completion run `npm run verify`, `npm run audit:release`, `git diff --check`, and inspect `npm pack --dry-run --json`.
