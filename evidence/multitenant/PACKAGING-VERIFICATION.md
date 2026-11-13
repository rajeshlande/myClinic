# Branch packaging verification

- Baseline v1.43.0 b1e174ee00abc6b533e364fa578b5b017802c2d2.
- Node22.22.0 full clinic tests1060/1060 PASS after all new source files were staged.
- Contributing28/28 PASS,0 failures,0 warnings; security/build/Pages exit0.
- Portable in-repo browser suite Chromium145.0.7632.6,43/43 PASS,0 non-harness requests. See browser-results.json. Native browser storage/locks with synthetic Auth/clinical responses, not real trust proof.
- git diff --cached --check PASS.
- Explicit review-panel listener cleanup added after the staged-files ratchet detected unmatched listeners. No suppression/ratchet relaxation.
- Original live App/main/store/Auth/Supabase/Setup/public booking source entrypoints unchanged relative to baseline; service-worker API exclusion is intentional.
- Tier-contract SHA25636c6af2bfe0ba7b82d9f9d240ef3aff1330539e82b1538169a0b66d1b2a96ea1 unchanged.
- Schema22 preparation copied unchanged; no SQL run or live operation in packaging.
- No push, tag, deployment or tenant activation. No Master-repository commit.

The Git commit and bundle checksum are reported outside this file to avoid self-referential hashes. Historical guides may cite /home/user workspace logs; local reproduction uses docs/multitenant/LOCAL-HANDOFF.md and tools/workspace-browser.
