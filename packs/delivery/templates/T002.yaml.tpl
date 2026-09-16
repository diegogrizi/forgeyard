schemaVersion: 1
id: T002
title: {{task.title}}
objective: {{task.objective}}
acceptanceCriteria:
  - {{task.requestCriterion}}
  - "The journey starts from a reproducible local state and reaches its visible outcome"
  - "Critical loading, empty, failure, and recovery states within the journey are handled"
  - "The configured verification command passes at the frozen Git revision"
dependsOn:
  - T001
writeScopes:
{{task.writeScopes}}
role: {{task.role}}
capabilities:
{{task.capabilities}}
limits:
  minutes: {{task.implementationMinutes}}
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
