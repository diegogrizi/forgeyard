schemaVersion: 1
id: T002
title: "Harden the visible slice into a reliable demonstration"
objective: "Complete the chosen end-to-end journey, including its critical edge states, without widening the product prematurely"
acceptanceCriteria:
  - "The journey starts from a reproducible local state and reaches its visible outcome"
  - "Critical loading, empty, failure, and recovery states within the journey are handled"
  - "The configured verification command passes at the frozen Git revision"
dependsOn:
  - T001
writeScopes:
{{task.writeScopes}}
role: "full-stack-implementer"
capabilities:
  - "implementation"
  - "testing"
  - "accessibility"
limits:
  minutes: {{task.implementationMinutes}}
  maxRetries: 2
evidence:
  required: true
integration:
  owner: "integrator"
  target: "current"
command:
{{task.command}}
required: true
