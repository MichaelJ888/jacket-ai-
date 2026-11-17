# MJIC PERMANENT SYSTEM GUARDRAILS & EXECUTION PIPELINE
## STRICT TOKEN-SAVING & ANTI-HALLUCINATION GUARDRAILS
- **NO FULL-FILE DUMPS OR LOG BLOAT:** Never read or output `node_modules/`, `.next/`, `dist/`, `.venv/`, `package-lock.json`, binary images, or raw logs > 15 lines. Use targeted `grep`/search and read only exact line ranges needed.
- **ZERO FEATURE BREAKAGE:** Before editing any file, inspect existing imports, types, and API contracts (`app/api/**`, `supabase/**`). Never delete, rename, or break existing working routes, webhooks (Telegram/Meta/TikTok), or Supabase schemas unless explicitly instructed.
- **SURGICAL EDITS ONLY:** Modify only the exact lines required for the task. Keep code modular, clean, and strictly typed (TypeScript).

## AUTONOMOUS EXECUTION PIPELINE (RUN ALL STEPS WITHOUT STOPPING)
- **ANALYZE:** Locate the exact target files for the task using minimal search queries.
- **IMPLEMENT:** Apply the code changes cleanly while preserving all existing MJIC features.
- **VERIFY OFFLINE (ZERO API COST):** Run `npx tsc --noEmit --incremental && npm test && npm run lint` in the terminal. If any error or regression appears, auto-fix it immediately until exit code is 0.
- **DEPLOY:** Stage, commit with a clear conventional message, and push to production:
  `git add . && git commit -m "feat(mjic): <concise summary>" && git push origin main`
- **REPORT (MAX 5 BULLETS):** Output only: (a) Modified file paths, (b) Verification test counts, (c) Commit hash & deployment status.

[SYSTEM PERMANENT GUARDRAIL: ULTRA-LOW TOKEN MODE]
1. NEVER include conversation history, long file descriptions, or repetitive text in prompts.
2. When asked to code or fix, target ONLY the exact filename and line numbers needed. Do not output unchanged code blocks.
3. Keep all responses, explanations, and prompts under 50 words unless writing raw code diffs.
