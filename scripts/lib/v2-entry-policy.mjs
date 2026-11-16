import { readFileSync } from 'node:fs';
export function releaseTarget(value = '') {
  if (value === '' || value === 'legacy') return 'legacy';
  if (value === 'v2-staging') return value;
  throw new Error('INVALID_APP_TARGET');
}
// Run before Vite discovers module scripts: staging must not import main.jsx.
export function guardedEntryPlugin(target) {
  const mode = releaseTarget(target);
  return {name:'myclinic:guarded-entry',transformIndexHtml:{order:'pre',handler(html,context) {
    if (mode !== 'v2-staging' || !context.filename.replace(/\\/g,'/').endsWith('/index.html')) return html;
    return readFileSync(new URL('../../v2-staging.html',import.meta.url),'utf8');
  }}};
}
