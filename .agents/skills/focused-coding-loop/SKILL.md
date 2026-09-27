---
name: focused-coding-loop
description: 'Use when implementing or debugging a scoped code change: investigate the controlling path, form a testable hypothesis, make a minimal edit, and validate it before expanding scope.'
---

# Focused Coding Loop

## When to Use
- Implementing a feature or bug fix in an existing codebase
- Diagnosing a failing test, command, or user-visible behavior
- Making a targeted refactor where the controlling code path is not yet certain

Do not use this workflow to override an explicit request for explanation, brainstorming, or a plan without edits. Follow any repository-specific instructions and required domain skills first.

## Procedure
1. **Anchor the task.** Start from the named file, symbol, behavior, error, or test. If none is named, run one targeted search to locate the likely owner. Read repository instructions and the smallest nearby implementation or test surface needed.
2. **Route locally.** Before editing, state a falsifiable hypothesis about the owning code path, identify the cheapest check that could disprove it, and choose the smallest edit that tests it. If a nearby abstraction boundary is unclear, take one triangulating read. Once these are clear, stop broad exploration and act.
3. **Edit narrowly.** Preserve existing APIs, conventions, and unrelated user changes. Fix the root cause when the local evidence supports it; avoid opportunistic cleanup.
4. **Validate immediately.** Directly after the first substantive edit, run the cheapest relevant behavior check. If unavailable, run a narrow test, typecheck, lint, or compile for the touched slice. Do not resume broad exploration or make more edits before this check unless a concrete blocker prevents it.
5. **Branch on the result.**
   - If validation exposes a local defect consistent with the hypothesis, repair that same slice and rerun the same check.
   - If it disproves the hypothesis or moves control elsewhere, follow one nearby hop to the code that directly controls the behavior, then revise the hypothesis.
   - If it is ambiguous, do one nearby disambiguating read or neighboring test/call-site check, then decide whether to repair or follow that one-hop path.
   - If it passes but an adjacent change is still required, make only that follow-up and rerun focused validation.
6. **Finish against explicit criteria.** Run focused checks for meaningful risks and required project gates. Stop when those criteria pass; do not add checks just for reassurance. If no executable check exists, inspect the diff and report what remains unverified.

## Completion Criteria
- The requested behavior is addressed at its owning code path.
- A focused check supports the change, or its absence and residual risk are stated clearly.
- Changes remain scoped, and unrelated existing work is preserved.
