# Open-source sourcing strategy (search, vet, integrate)

Goal: get the best and cheapest implementation of each capability by reusing proven open-source work, without importing legal or security risk.

## Rules
1. **Never auto-clone and execute unvetted code.** The `repo-watch` cron (monthly) only refreshes metadata (stars, last push, license, archived) for repos listed in `repo_candidates` and alerts the CEO on Telegram.
2. **License gate.** MIT / BSD / Apache-2.0 / zlib: may be ported with attribution. GPL / AGPL / LGPL / unknown: do NOT copy code into this proprietary system. Study formats and algorithms only, or run the tool as a separate service.
3. **Security gate.** Prefer packages with recent commits, many users and a small dependency tree. Pin versions. Run `npm audit` after adding anything.
4. **Runtime gate.** The app runs on Vercel serverless (Node, about 60 s, no native toolchain). Pure TypeScript/JS first. Python or native tools go behind a small external worker with an API key.
5. **Cost gate.** Compare against the paid API we use today; adopt only if cheaper or clearly better at the same quality.

## Process
1. **Search** (monthly or when a new need appears): GitHub search by topic (for example `topic:embroidery`, `topic:erp`, `topic:invoice`), sorted by stars and recent push. Use `https://api.github.com/search/repositories?q=<keywords>+pushed:>2025-01-01&sort=stars`.
2. **Shortlist** into `repo_candidates` (url, purpose, license, notes) with status `candidate`.
3. **Vet** using the gates above. Set status to `adopted`, `reference-only` (license blocks copying), or `rejected`.
4. **Integrate** in a branch: wrap behind a `_lib` module with a test, keep attribution comments, deploy, and compare against the previous approach for a week.
5. **Watch**: `repo-watch` alerts on license change, archive, or API errors.

## Where this already applies
| Need | Approach |
| --- | --- |
| Embroidery files | See `docs/EMBROIDERY_RESEARCH.md` |
| PDF quotes | `pdf-lib` (MIT) |
| Word Q&A import | `mammoth` (BSD-2) |
| Images | `sharp` (Apache-2.0) |

## Automated scouting
The weekly improvement-scout cron searches GitHub for each need in pp/api/_lib/scout.ts (SCOUT_NEEDS), keeps active repos (pushed within 12 months, 50+ stars), marks permissive licences as candidate and others as eference-only, and alerts the CEO. Adoption always goes through the gates above.
