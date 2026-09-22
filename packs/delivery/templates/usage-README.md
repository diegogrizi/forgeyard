# Local usage accounting

Model and provider usage is never inferred: it must be supplied from an observed source.
Record an observation with `fy_record` using the `usage` record kind, taking the amount
from an actual host or provider report.

The stored accounting intentionally excludes prompts, generated output bodies, credentials
and environment secrets. **A missing observation means usage is unknown, and unknown must
never be converted into a zero-cost claim.** A delivery report states `unmeasured` where
nothing was reported.

Forgeyard cannot enforce a provider bill or a subscription quota. The recorded ceiling
stops the prepared workflow; it does not stop the provider.
