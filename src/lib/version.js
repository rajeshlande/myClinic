/**
 * Version management.
 *
 * Three numbers that must not be confused:
 *   app    — the product version shown to users (major.minor.patch)
 *   schema — the Supabase migration this build expects (drives upgrade prompts)
 *   build  — injected at build time (commit + timestamp) for support
 */

export const APP_VERSION = '1.8.0';
export const SCHEMA_VERSION = 6;

/** Injected by vite.config.js define(). */
export const BUILD = (() => {
  try {
    return typeof __MYCLINIC_BUILD__ !== 'undefined' ? __MYCLINIC_BUILD__ : { id: 'dev', at: null };
  } catch {
    return { id: 'dev', at: null };
  }
})();

/** What changed, newest first. Shown in Settings → What's new. */
export const CHANGELOG = [
  {
    version: '1.8.0', date: '2026-11-03', schema: 6,
    highlights: [
      'Medicine master: the drug field autocompletes brands, molecules and symptoms, and fills the dose, frequency, duration and food relation for you.',
      'Typing is never blocked — an unknown drug is saved exactly as written.',
      'Safety checks on every prescription: the same molecule twice, two drugs of the same class, curated interactions, and the patient\'s recorded allergies.',
      'High-severity findings must be acknowledged before saving, and the acknowledgement is stored on the prescription.',
      'Schedule H1 drugs raise a register notice instead of a block.',
      'Prescriptions are numbered RX/26-27/0001 — their own series, independent of invoices — and print with each drug\'s molecule.',
      'Fixed the consultation dialog stealing the cursor whenever typing paused.',
    ],
  },
  {
    version: '1.7.0', date: '2026-11-03', schema: 5,
    highlights: [
      'UPI collection: every unpaid invoice carries a scannable QR with the exact balance, on screen and on paper.',
      'One payment sheet everywhere — billing, invoice and patient chart — with part payments and a payment reference.',
      'Invoice and prescription documents rebuilt to print as clean A4 pages, with a proper header, amount in words and a payment block.',
      'Consultation → bill → collect is now one continuous flow.',
    ],
  },
  {
    version: '1.6.0', date: '2026-11-03', schema: 4,
    highlights: [
      'supabase/schema.sql is now the single source of truth: one file creates a new database and upgrades an old one in place.',
      'The database reports its own schema version, so the app can say exactly what needs updating.',
    ],
  },
  {
    version: '1.5.0', date: '2026-11-03', schema: 4,
    highlights: [
      'Upload a square and a wide clinic logo; both appear on prescriptions, invoices and the sidebar.',
      'Logos are resized in the browser before saving, so they print offline and stay small.',
      'Turn logos off per clinic for letterhead that already carries them.',
      'One brand kit feeds documents today and WhatsApp or email later — same name, colour and logo.',
      'Fixed the allergy line printing as a bare colon on every prescription.',
    ],
  },
  {
    version: '1.4.0', date: '2026-11-03', schema: 3,
    highlights: [
      'Appointment scheduling rebuilt: a per-doctor day board where a 30-minute visit occupies 30 minutes, not two separate cells.',
      'Week view shows load per doctor per day — open slots, booked counts and utilisation in one glance.',
      'The booking sheet blocks interval-accurate clashes, groups slots by morning/afternoon/evening and offers the next free slot.',
      'Cancel or no-show is undoable from the day view; nothing leaves the board without a way back.',
      'Free-slot and utilisation figures now come from one shared scheduling engine (11 new unit tests).',
    ],
  },
  {
    version: '1.3.0', date: '2026-11-03', schema: 3,
    highlights: [
      'Subscription licensing: 14-day trial, monthly or yearly plans, 7-day grace, read-only fallback.',
      'Seat limits per plan enforced by a Postgres trigger, not just the UI.',
      'Subscription screen: plan changes, payment recording, seat meters and an export of the terms.',
      'Solo → Growth → Multi-clinic, with proration-free upgrades and 20% off yearly.',
    ],
  },
  {
    version: '1.2.1', date: '2026-11-02', schema: 2,
    highlights: [
      'Node 26 LTS with npm 12.2.1 pinned via .nvmrc, .node-version and packageManager.',
      'Supabase connection self-test on the setup page: URL, key safety, REST reachability and schema drift.',
      'GitHub Pages deploy hardened: Node 26 build, configuration report and a bundle-ready commit.',
    ],
  },
  {
    version: '1.2.0', date: '2026-11-02', schema: 2,
    highlights: [
      'Offline-first: work without internet, changes sync automatically with conflict handling.',
      'Role matrix enforced in the database — owner, doctor and front desk each see only what they run.',
      'Seven accent colours, each with a tuned light and dark palette.',
      'Prescription directions in ten Indian languages, with a print-ready slip.',
      'Security hardening from the Cloudflare-format audit (RLS, tokens, cache scoping).',
    ],
  },
  {
    version: '1.1.0', date: '2026-11-02', schema: 1,
    highlights: [
      'Walk-in token queue with daily per-doctor numbering and a waiting-room display.',
      'GitHub Pages deployment with relative-base builds and a readiness check.',
      'Installable PWA with an update bar and offline shell.',
    ],
  },
  {
    version: '1.0.0', date: '2026-10-30', schema: 1,
    highlights: ['Appointments, patient charts, consultations, billing, follow-ups, reports and team.'],
  },
];

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Check the database's reported schema version against what this build needs.
 * The server function `app_schema_version()` returns an integer.
 */
export function schemaStatus(serverVersion) {
  if (serverVersion == null) return { state: 'unknown', server: null, client: SCHEMA_VERSION };
  const diff = compareVersions(serverVersion, SCHEMA_VERSION);
  if (diff === 0) return { state: 'match', server: serverVersion, client: SCHEMA_VERSION };
  if (diff < 0) return { state: 'server-behind', server: serverVersion, client: SCHEMA_VERSION };
  return { state: 'client-behind', server: serverVersion, client: SCHEMA_VERSION };
}

export const BUILD_LABEL = BUILD.at
  ? `${BUILD.id} · ${new Date(BUILD.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
  : BUILD.id;
