# Vendored skill: `security-audit`

This directory is a verbatim copy of the `security-audit` skill published by
Cloudflare, kept in the repository so every contributor — and every coding agent
opened on this repository — runs the same audit procedure without a network
install.

| | |
|---|---|
| Upstream | [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) |
| Path upstream | `skills/security-audit/` |
| Pinned commit | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-11-06) |
| Licence | MIT — see `LICENSE` in this directory |
| Vendored | 2026-11-06 |

**Do not edit these files.** A local change is invisible to the next contributor,
who will download the upstream copy and lose it. To update:

```bash
git clone --depth 1 https://github.com/cloudflare/security-audit-skill.git /tmp/cf-audit
cp /tmp/cf-audit/skills/security-audit/* .claude/skills/security-audit/
cp /tmp/cf-audit/LICENSE .claude/skills/security-audit/LICENSE
git -C /tmp/cf-audit rev-parse HEAD    # update the commit above
```

`npm run check:contributing` verifies the skill is present, has a usable
`SKILL.md` frontmatter, and still ships its schema and both validators.
