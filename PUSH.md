# Pushing myClinic to GitHub (bundle method)

The repository here already contains the full history (`main` + tag `v1.2.1`) and the
remote `origin` is configured as <https://github.com/rajeshlande/myClinic.git>.
Nothing was pushed from the build sandbox — it holds no GitHub credentials — so pick
either route below.

## Route A · free `git bundle` (no credentials in the sandbox, no fork)

A bundle is a single file containing the whole repository. It is the offline-safe way
to hand a repository over.

1. Download **`myClinic-v1.2.1.bundle`** from this workspace.
2. On your machine, next to the empty GitHub repo:

```bash
git clone myClinic-v1.2.1.bundle myClinic
cd myClinic
git remote set-url origin https://github.com/rajeshlande/myClinic.git
git push -u origin main --follow-tags
```

`git bundle verify <file>` reports `The bundle records a complete history` — it is a
full clone source, not a delta.

## Route B · GitHub web uploader (no local git at all)

<https://github.com/rajeshlande/myClinic/upload/main> accepts drag-and-drop of a folder
tree. Skip `node_modules/`, `dist/`, `.env.local` and anything listed in `.gitignore`.

The bundle route is preferable: the web uploader creates a single squashed commit and
loses the tag and per-release history.

## After either route

1. **Settings → Secrets and variables → Actions** → add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Watch the workflow: it prints `node -v` / `npm -v` (expect `v26.13.0` / `12.2.1`),
   then either `Supabase keys present` or a demo-mode warning, then deploys.
4. Site: <https://rajeshlande.github.io/myClinic/> · self-test: `/#/setup`.

## Verify the bundle before pushing (optional)

```bash
git bundle verify myClinic-v1.2.1.bundle     # lists refs + "complete history"
git clone -b main myClinic-v1.2.1.bundle /tmp/check
cd /tmp/check && npm ci && npm test && npm run build && npm run check:pages
```
