# Third-party notices

myClinic is built on open-source software. The production bundle includes:

| Package | Licence | Use |
|---|---|---|
| [React](https://react.dev) / react-dom | MIT | UI runtime |
| [React Router](https://reactrouter.com) (`react-router`) | MIT | Client routing (hash history for static hosting) |
| [Vite](https://vite.dev) | MIT | Build tooling (dev dependency) |
| [@supabase/supabase-js](https://supabase.com/docs/reference/javascript) | MIT | Auth + Postgres client |
| [lucide-react](https://lucide.dev) | ISC | Icon set |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | MIT | UPI payment QR codes on invoices (encodes locally, nothing is sent to a QR service) |
| [@fontsource-variable/inter](https://fontsource.org/fonts/inter) | SIL OFL 1.1 | Interface typeface |
| [@fontsource-variable/manrope](https://fontsource.org/fonts/manrope) | SIL OFL 1.1 | Display typeface |

| [Cloudflare `security-audit` skill](https://github.com/cloudflare/security-audit-skill) | MIT | Vendored at `.claude/skills/security-audit/` — developer tooling for agent-run security audits; **not** part of the shipped bundle. Pinned to `c1c8a8c` (see that directory's `VENDORED.md`) |

Every package above is a published dependency with its licence stated. The vendored
skill is the only non-npm entry: it is contributor tooling, it never reaches
`dist/`, and it is MIT like the rest. myClinic's own source is MIT — see [`LICENSE`](LICENSE).
