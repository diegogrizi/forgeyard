schemaVersion: 1
id: T004
title: {{task.title}}
objective: {{task.objective}}
acceptanceCriteria:
  - {{task.requestCriterion}}
  - "The offline presentation loads without network dependencies"
  - "The live path and fallback path tell the same evidence-backed story"
  - "The configured verification command passes at the demonstrated Git revision"
dependsOn:
  - T003
writeScopes:
{{task.presentationScope}}
role: {{task.role}}
capabilities:
{{task.capabilities}}
limits:
  minutes: {{task.demoMinutes}}
  maxRetries: 1
{{task.costLimit}}evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
required: true
