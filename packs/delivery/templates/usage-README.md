# Local usage accounting

Forgeyard records scheduler transitions automatically, but model and provider usage must be supplied from an observed source. Record an observation with `forgeyard ledger record` and explicit provider, model, input tokens, output tokens, cost, and duration fields.

The JSONL ledger intentionally excludes prompts, generated output bodies, credentials, and environment secrets. A missing observation means usage is unknown; it must not be converted into a zero-cost claim.

Useful commands:

- `forgeyard task status --root .`
- `forgeyard task resume --root . --worker <worker-id> --session <session-id>`
- `forgeyard ledger record --task <task-id> --root . --provider <provider> --model <model> --input-tokens <count> --output-tokens <count> --cost-usd <amount> --duration-ms <milliseconds>`
