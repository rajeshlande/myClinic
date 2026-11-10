/**
 * About & version — v1.35.5.
 *
 * The clinic asked for one thing on this tab: `App version v1.35.4`. The schema
 * tile, build tile, Recent problems, What's new / Release notes, the role matrix
 * and the two version buttons are all gone. Diagnostics still live in
 * `ErrorBoundary` and `scripts/`; permissions are still enforced by Postgres —
 * this is a display decision, not a change to either.
 *
 * The empty destructuring keeps the panel contract the other seven tabs use
 * (`export default function <Tab>({ ... })`) without capturing an unused store.
 */

import { APP_VERSION } from '../../lib/version.js';
import MiniStat from './MiniStat.jsx';

export default function AboutTab({}) {
  return (
    <div className="stack">
      <MiniStat label="App version" value={`v${APP_VERSION}`} tone="brand" />
    </div>
  );
}
