# Staging build environment isolation correction

Parent a20fa37; same v2 branch. Reproduced user artifact failure locally on supported Node22.22.0 by explicitly setting VITE_SUPABASE_URL to original clinical public URL during staging build. Prior entry passed entire import.meta.env object, causing Vite to embed unrelated VITE_* variables even though runtime policy only uses Central inputs. Therefore original-project-string artifact check correctly refused; this was not evidence the legacy client was mounted. User Node22.18 is separately below required floor, not the cause of this reproduced failure.

Fixed composition to read precisely VITE_CENTRAL_SUPABASE_URL and VITE_CENTRAL_SUPABASE_ANON_KEY via individual static env references; no complete Vite env object. Added regression source-contract test. Guard remains intact, not weakened.

Executed full1367/1367 tests, zero failures/skips, Node22.22.0/npm10.9.0; contributing/security, default build/Pages PASS. Staging build WITH original clinical URL and an unrelated synthetic VITE sentinel present PASS; staging artifact checker PASS; sentinel absent from emitted JS; staging Pages PASS. No real credentials used/read/printed. No environment file changed or removed.

No Windows interactive browser execution or hosted redeployment this increment. No Central/SQL/schema/grants/FK/trigger/user/flag changes, no push/deploy/main merge. Two existing validator mode edits unchanged. Further Central boot/mint/provisioning gaps remain exactly as cross-repo review documents.
