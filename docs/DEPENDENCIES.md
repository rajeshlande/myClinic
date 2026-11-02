# Dependencies

Complete inventory of every package in the installed tree, generated from `package-lock.json` and compared against the npm registry.

**Audited:** 2026-11-02 · **App version:** 1.2.1 · **Installed tree:** 59 packages (9 direct, 50 transitive)

Regenerate this table at any time:

```bash
npm outdated                 # direct dependencies that are behind
npm ls --all                 # full installed tree
npm audit                    # vulnerability scan
```

## Upgrade policy

- **Direct dependencies** are pinned to the newest stable release and upgraded in a dedicated commit, never mixed with a feature change.
- **Transitive packages** are never force-overridden. If npm resolves an older major than the registry latest, it is because a direct dependency declares that range; forcing a newer copy risks duplicate or broken runtime state.
- **Breaking majors** are validated against the full gate: `npm test`, `npm run build`, `npm run check:pages`, `npm run test:security`, and a browser pass over all 18 routes at 1440 / 390 / 360 px.
- **Security:** `npm audit --audit-level=high` runs on every push in CI and currently reports **0 vulnerabilities**.

## Direct dependencies

| Package | Kind | Range in package.json | Installed | Latest stable | License | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `@fontsource-variable/inter` | runtime | `^5.3.0` | 5.3.0 | 5.3.0 | OFL-1.1 | ✅ current |
| `@fontsource-variable/manrope` | runtime | `^5.3.0` | 5.3.0 | 5.3.0 | OFL-1.1 | ✅ current |
| `@supabase/supabase-js` | runtime | `^2.118.0` | 2.118.0 | 2.118.0 | MIT | ✅ current |
| `@vitejs/plugin-react` | dev | `^6.2.1` | 6.2.1 | 6.2.1 | MIT | ✅ current |
| `lucide-react` | runtime | `^1.66.0` | 1.66.0 | 1.66.0 | ISC | ✅ current |
| `react` | runtime | `^19.3.1` | 19.3.1 | 19.3.1 | MIT | ✅ current |
| `react-dom` | runtime | `^19.3.1` | 19.3.1 | 19.3.1 | MIT | ✅ current |
| `react-router` | runtime | `^8.5.1` | 8.5.1 | 8.5.1 | MIT | ✅ current |
| `vite` | dev | `^8.3.5` | 8.3.5 | 8.3.5 | MIT | ✅ current |

All **9 direct dependencies are on the latest stable release** — nothing in the direct set is behind.

## Transitive dependencies

| Package | Installed | Latest stable | License | Scope | Status |
| --- | --- | --- | --- | --- | --- |
| `@oxc-project/types` | 0.156.0 | 0.156.0 | MIT | dev | ✅ current |
| `@remix-run/route-pattern` | 0.22.1 | 1.0.0 | MIT | runtime | ⚠️ held |
| `@rolldown/binding-android-arm-eabi` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-android-arm64` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-darwin-arm64` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-darwin-x64` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-freebsd-x64` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-arm64-musl` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-x64-gnu` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-linux-x64-musl` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-openharmony-arm64` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/binding-win32-x64-msvc` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `@rolldown/pluginutils` | 1.0.1 | 1.0.1 | MIT | dev | ✅ current |
| `@supabase/auth-js` | 2.118.0 | 2.118.0 | MIT | runtime | ✅ current |
| `@supabase/functions-js` | 2.118.0 | 2.118.0 | MIT | runtime | ✅ current |
| `@supabase/phoenix` | 0.4.5 | 0.4.5 | MIT | runtime | ✅ current |
| `@supabase/postgrest-js` | 2.118.0 | 2.118.0 | MIT | runtime | ✅ current |
| `@supabase/realtime-js` | 2.118.0 | 2.118.0 | MIT | runtime | ✅ current |
| `@supabase/storage-js` | 2.118.0 | 2.118.0 | MIT | runtime | ✅ current |
| `cookie-es` | 3.1.1 | 3.1.1 | MIT | runtime | ✅ current |
| `detect-libc` | 2.1.2 | 2.1.2 | Apache-2.0 | dev | ✅ current |
| `fdir` | 6.5.0 | 6.5.0 | MIT | dev | ✅ current |
| `fsevents` | 2.3.3 | 2.3.3 | MIT | dev | ✅ current |
| `iceberg-js` | 0.8.1 | 1.0.0 | MIT | runtime | ⚠️ held |
| `lightningcss` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-android-arm64` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-darwin-arm64` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-darwin-x64` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-freebsd-x64` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-linux-arm64-musl` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-linux-x64-gnu` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-linux-x64-musl` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `lightningcss-win32-x64-msvc` | 1.33.0 | 1.33.0 | MPL-2.0 | dev | ✅ current |
| `nanoid` | 3.3.20 | 6.0.2 | MIT | dev | ⚠️ held |
| `picocolors` | 1.1.1 | 1.1.1 | ISC | dev | ✅ current |
| `picomatch` | 4.0.7 | 4.0.7 | MIT | dev | ✅ current |
| `postcss` | 8.5.32 | 8.5.32 | MIT | dev | ✅ current |
| `rolldown` | 1.2.16 | 1.2.16 | MIT | dev | ✅ current |
| `scheduler` | 0.28.0 | 0.28.0 | MIT | runtime | ✅ current |
| `source-map-js` | 1.2.2 | 1.2.2 | BSD-3-Clause | dev | ✅ current |
| `tinyglobby` | 0.2.17 | 0.2.17 | MIT | dev | ✅ current |
| `tslib` | 2.8.1 | 2.9.1 | 0BSD | runtime | ⚠️ held |

> The `@rolldown/binding-*` and `lightningcss-*` entries are platform-specific prebuilt binaries. npm installs only the one matching the current OS/CPU, but the lockfile pins all of them for reproducibility, so they are not real install weight.

## Packages not at registry latest

Four transitive packages have a newer release on the registry. None can be moved without an upstream change, and none is a security issue: `npm audit` is clean.

| Package | Installed | Latest | Required by | Why it is held |
| --- | --- | --- | --- | --- |
| `@remix-run/route-pattern` | 0.22.1 | 1.0.0 | `react-router` 8.5.1 | react-router pins the `^0.22` range internally; the 1.0 major is not adopted upstream yet. |
| `iceberg-js` | 0.8.1 | 1.0.0 | `@supabase/supabase-js` 2.118.0 | supabase-js declares the pre-1.0 range and has not moved to 1.0. |
| `nanoid` | 3.3.20 | 6.0.2 | Vite / rolldown tooling | Tooling expects the nanoid 3 API. Build-time only, never shipped in the browser bundle. |
| `tslib` | 2.8.1 | 2.9.1 | `@supabase/*-js` | Minor drift inside the declared range. Pulled in by supabase-js and deduped to a single copy; no action needed. |

## Upgrades applied in 1.2.0

| Package | Was | Now | Note |
| --- | --- | --- | --- |
| `vite` | 7.3.7 | **8.3.5** | Major. Vite 8 bundles rolldown, so `manualChunks` must be a function, not an object. |
| `@vitejs/plugin-react` | 5.2.0 | **6.2.1** | Major, required by Vite 8. |
| `lucide-react` | 0.468.0 | **1.66.0** | Major. Every icon name the app imports is unchanged. |
| `react` / `react-dom` | 19.1.1 | 19.3.1 | Minor. |
| `react-router` | *(via react-router-dom 7.18.5)* | **8.5.1** | Major. `react-router-dom` has no v8, so it was removed and all 20 files import from `react-router`. |
| `@supabase/supabase-js` | 2.109.0 | 2.118.0 | Minor. |
| `@fontsource-variable/inter` | 5.2.8 | 5.3.0 | Minor. |
| `@fontsource-variable/manrope` | 5.2.8 | 5.3.0 | Minor. |

Result: installed tree **135 → 59 packages**, main bundle chunk **552.74 kB → 356.07 kB** (95.89 kB gzip), **0 vulnerabilities**.

## Licenses

The whole tree is permissive or safe for a hosted web app:

| License | Packages | Notes |
| --- | --- | --- |
| MIT | 40 | No obligations beyond attribution. |
| MPL-2.0 | 12 | `lightningcss` plus its platform binaries. File-level copyleft, consumed unmodified at build time — nothing is redistributed. |
| OFL-1.1 | 2 | Inter and Manrope webfonts, redistributable with reserved font names. |
| ISC | 2 | `lucide-react`, `picocolors`. |
| BSD-3-Clause | 1 | `source-map-js`. |
| Apache-2.0 | 1 | `detect-libc`. |
| 0BSD | 1 | `tslib`. |

## Runtime requirements

| Requirement | Value | Where enforced |
| --- | --- | --- |
| Node.js | **26.13.0 LTS** (Lithium) pinned; `engines` floor `>=22.22.0` | `.nvmrc`, `.node-version`, `package.json` → `engines`, CI matrix (22 + 26), Pages workflow |
| npm | **12.2.1** | `package.json` → `packageManager`; Pages workflow installs it explicitly |
| Browser | Chrome/Edge 111+, Safari 16.4+, Firefox 121+ | native ESM, CSS nesting and container queries used by the theme layer |

## Engine notes

- `vite@8` accepts `node ^20.19 || >=22.12`, `@supabase/supabase-js@2.118` needs `>=22`, and `react-router@8.5.1` needs `>=22.22` — so **22.22+ is the real floor** and `engines.node` says `>=22.22.0`.
- Toolchain now runs on **Node 26.13.0 (Lithium, current LTS) + npm 12.2.1**. npm 12 itself requires `node ^22.22.2 || ^24.15.0 || >=26.0.0`, which is why 26 was chosen over 24 for the pinned toolchain.
- Verified end to end on Node 26: `npm ci` (lockfile v3, unchanged), 45/45 tests, build, `check:pages`, `test:security`, `npm audit` clean.
- `@rolldown/binding-*` and `lightningcss-*` platform binaries are optional; `npm ci` on Linux skips the irrelevant ones, which keeps `node_modules` small.
