## Investigation checklist

- [x] Route through the **how** skill. For motivation questions, also route through the **why** skill.
  - skip why: this is a live defect review, not a motivation question.
- [x] Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`.
- [x] Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
  - user override: report ranked player defects with screen, behavior, impact, and concrete remedy; separate whole-game gaps.
- [x] Apply the **unslop** skill to the reply.
- [x] Inspect all eight live screens and capture screenshots.
- [x] Exercise interactions relevant to each claimed defect.
- [x] Corroborate ambiguous claims with narrow source inspection.
- [x] Disclose unavailable native-DPR screenshot capture.
- [x] Write review and evidence gallery.
- [x] Verify the evidence gallery in the browser.
  - skip: local HTTP server binding was denied by the sandbox; file URL navigation was denied by browser policy. JavaScript syntax and screenshot references were checked instead. Browser rendering remains unverified.
