# Live review investigation

- [x] Route through the **how** skill. For motivation questions, also route through the **why** skill.
- [x] Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`.
- [ ] Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
  - User overrides the output format with a ranked advisory review.
- [ ] Apply the **unslop** skill to the reply.
- [x] Inspect all eight live screens.
- [x] Drive and test constructor selection and body changes.
- [x] Confirm ambiguous absence claims with source.
- [x] Deliver ranked markdown and screenshot evidence.

No-comments skip: This is a live product review, with no application code or comment edits authorized.
Screenshot limit: Raw CDP permission denied. Supported screenshot API returns 1744 by 976 at DPR 2, so device-pixel capture is unverified.

Deployment changed mid-review. Initial eight-screen screenshots match the provided brief and local source. The replacement bundle index-bVh14wWE.js has root 16px, a different title and constructor, and ignores screen query addresses. City W/S reversal was reproduced again on that bundle; constructor rows still measured 14px. Earlier findings must retain initial-build scope.

Gallery browser verification blocked. Sandbox denied localhost binding and browser URL policy denied file protocol. Deliver the downloadable gallery and screenshots with this limit disclosed; do not try an alternate surface.
