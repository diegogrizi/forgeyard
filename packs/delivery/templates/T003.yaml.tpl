schemaVersion: 1
id: T003
title: {{task.title}}
objective: {{task.objective}}
acceptanceCriteria:
  - {{task.requestCriterion}}
  - "Findings identify a file or observable behavior and explain impact"
  - "The reviewer does not edit implementation files"
  - "The configured verification command passes at the reviewed Git revision"
dependsOn:
  - T002
writeScopes: []
role: {{task.role}}
capabilities:
{{task.capabilities}}
limits:
  minutes: {{task.reviewMinutes}}
  maxRetries: 1
{{task.costLimit}}evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
required: true
