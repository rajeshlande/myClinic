/**
 * Two lines that make the scripts work on Windows, which is where they get run.
 *
 * `npm`, `npx` and `deno` are `.cmd` shims on Windows, and Node has refused to
 * `execFile` a `.cmd` since the CVE-2024-27980 fix: the call fails with ENOENT or
 * EINVAL, and the *caller* sees only an exit that failed. That is how
 * `npm run deploy:function` reported "the function does not type-check" without a
 * single line from the type-checker — the type-checker had never started.
 *
 * `shell: true` on Windows is the supported way to reach a shim; it is deliberately
 * not used elsewhere, because it changes argument quoting.
 */
export const WINDOWS = process.platform === 'win32';

/** @returns {{shell: boolean}} options to spread into execFileSync/spawnSync. */
export const shellOptions = (platform = process.platform) => ({ shell: platform === 'win32' });
