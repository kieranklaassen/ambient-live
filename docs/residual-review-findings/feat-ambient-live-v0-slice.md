# Residual Review Findings — feat/ambient-live-v0-slice

Source: LFG pipeline run 2026-07-21 (plan `docs/plans/2026-07-21-001-feat-ambient-live-plan.md`). No git remote and no issue tracker are configured, so this committed file is the durable record (no_sink).

## Residual Review Findings

- **P2 · repo history · `config/master.key`** — The Rails scaffold's initial commit tracked `config/master.key`; this branch untracked it, but it remains in git history. Before this repo ever gets a remote, either rewrite history or rotate the credentials (`bin/rails credentials:edit` after regenerating the key). Defer status: no_sink — recorded here.
- **P3 · security · `app/controllers/live_controller.rb:6`** — Active Storage blob URLs are signed but not auth-gated (Active Storage's controllers don't include the app's `Authentication` concern). URLs are unguessable and the app is single-owner, so accepted for v0.1; revisit if sharing ever lands. Defer status: no_sink — recorded here.
- **P3 · audio quality · `engine/src/engine.cpp` (`Engine::note_on`)** — Voice stealing retriggers the quietest voice without a fade-out ramp, which can click when all 8 voices are held. Low likelihood on a 13-key surface; fix candidate: fast-release-then-steal. Defer status: no_sink — recorded here.

## Settled-decision notes from implementation

- No `settled_decision_conflicts`. The origin plan's "latency spike first" success criterion was overridden for this run by the user's explicit v0.1 slice directive (live input deferred, not re-added); the plan's Planning Contract records this as a user-directed sequencing override, and the spike remains first in line for the next slice.
