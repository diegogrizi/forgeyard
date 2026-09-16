schemaVersion: 1
id: T001
title: {{task.title}}
objective: {{task.objective}}
acceptanceCriteria:
  - {{task.requestCriterion}}
  - "A user can complete the selected journey locally"
  - "The configured verification command passes at the frozen Git revision"
dependsOn: []
writeScopes:
{{task.writeScopes}}
role: {{task.role}}
capabilities:
{{task.capabilities}}
limits:
  minutes: {{task.initialMinutes}}
  maxRetries: 2
{{task.costLimit}}evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
commands:
{{task.commands}}
required: true
