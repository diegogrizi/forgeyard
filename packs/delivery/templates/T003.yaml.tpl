schemaVersion: 1
id: T003
title: "Review the frozen visible slice independently"
objective: "Find concrete correctness, security, accessibility, and demonstration risks in the exact implementation revision"
acceptanceCriteria:
  - "Findings identify a file or observable behavior and explain impact"
  - "The reviewer does not edit implementation files"
  - "The configured verification command passes at the reviewed Git revision"
dependsOn:
  - T002
writeScopes: []
role: "read-only-reviewer"
capabilities:
  - "code-review"
  - "risk-analysis"
limits:
  minutes: {{task.reviewMinutes}}
  maxRetries: 1
evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
required: true
