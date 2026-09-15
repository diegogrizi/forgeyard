schemaVersion: 1
id: T004
title: "Rehearse the demonstration and freeze the evidence story"
objective: "Make the visible journey understandable, runnable, and credible within the allotted presentation time"
acceptanceCriteria:
  - "The offline presentation loads without network dependencies"
  - "The live path and fallback path tell the same evidence-backed story"
  - "The configured verification command passes at the demonstrated Git revision"
dependsOn:
  - T003
writeScopes:
{{task.presentationScope}}
role: "demo-producer"
capabilities:
  - "presentation"
  - "demo-rehearsal"
  - "evidence-curation"
limits:
  minutes: {{task.demoMinutes}}
  maxRetries: 1
evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
required: true
