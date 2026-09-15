# Replace this generic title and command only when the first visible slice is explicit.
schemaVersion: 1
id: T001
title: "Define and verify the first visible slice"
objective: "Deliver one observable end-to-end user journey before generalized infrastructure"
acceptanceCriteria:
  - "A user can complete the selected journey locally"
  - "The configured verification command passes at the frozen Git revision"
dependsOn: []
writeScopes:
{{task.writeScopes}}
role: "full-stack-implementer"
capabilities:
  - "product-framing"
  - "implementation"
  - "testing"
limits:
  minutes: {{task.initialMinutes}}
  maxRetries: 2
evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
required: true
