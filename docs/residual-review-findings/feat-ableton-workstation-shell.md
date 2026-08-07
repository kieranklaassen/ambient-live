## Residual Review Findings

**Source run:** ce-code-review `20260807-135141-1d18d6ea`  
**Branch:** `feat/ableton-workstation-shell`  
**Plan:** `docs/plans/2026-08-07-001-feat-ableton-workstation-shell-plan.md`  
**Applied in step 5:** #1 (fetch `response.ok`), #4 (sample-load mutex); #6 already satisfied (types-only `sample-library.tsx`)

### Filed
- **P1** `app/frontend/pages/live/timeline-model.ts:69` — Region at t=0 never rising-edge fires from start — https://github.com/kieranklaassen/ambient-live/issues/9 (skipped apply: would invert KTD9)

### Failed
- (none)

### No sink
- (none)

### settled_conflict (report-only)
- **P1** `app/frontend/entrypoints/application.css:1` — Ableton token chrome not shipped — conflicting KTD: **KTD10**. Plan labels Ableton tokens as session-settled follow-up; HEAD `bb81ffa`+ ships `al-*` tokens. Treat as product-ledger noise unless tokens regress.
- **P1** `app/frontend/pages/live/sample-browser.tsx:61` — Session-local folder browse not shipped — conflicting KTD: **KTD4**. Plan labels Places local browse as session-settled follow-up; HEAD ships `local-folder` session browse (not a second SoT). Treat as product-ledger noise unless local browse regresses.

### Proceeded-and-flagged settled_decision_conflicts (from ce-work)
- **KTD / Active Storage SoT (LFG brief #3 / plan Governs R4–R6):** Concurrent edits reintroduced local-folder Library tabs mid-run; ce-work removed them then later commits (`a62ece8`, `bb81ffa`) restored session-local Places browse under plan KTD4 (session browse, not SoT). Routing: proceeded-and-flagged → current HEAD aligns with mutated plan KTD4.
- **KTD7 zinc/teal vs Ableton/swiss-grid:** Concurrent `al-*` / swiss-grid drift mid-run; ce-work reverted then later commits restored Ableton tokens + swiss-grid per plan KTD7/KTD10. Routing: proceeded-and-flagged → current HEAD aligns with mutated plan KTD7/KTD10.

### LFG brief note
Original LFG settled-decisions brief treated local-folder and Ableton visual language as **open areas** (ce-plan initially assumed Active Storage-only + zinc/teal). Plan KTDs were later amended with `session-settled: user-directed follow-up` for KTD4/KTD7/KTD10. Residual ledger records that provenance divergence; do not silently re-revert HEAD to the brief’s early assumptions without an explicit product decision.
