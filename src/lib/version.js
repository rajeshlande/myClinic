/**
 * Version management.
 *
 * Three numbers that must not be confused:
 *   app    — the product version shown to users (major.minor.patch)
 *   schema — the Supabase migration this build expects (drives upgrade prompts)
 *   build  — injected at build time (commit + timestamp) for support
 */

export const APP_VERSION = '1.11.8';
export const SCHEMA_VERSION = 10;

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
    version: '1.11.8', date: '2026-11-04', schema: 10,
    highlights: [
      'The marketing page has one way into the demo: the footer button, "Open Demo". The hero, the closing band, the plan cards and the footer link list no longer drop a visitor into sample data — they lead to plans, sign up or the deployment guide.',
      'The hero now offers a single call to action instead of three, and the closing band talks about the clinic\'s morning rather than the demo clinic.',
      'Every reference to the reference project myClinic grew out of is gone from the repository, including the third-party notices, which now credit only the packages the app actually ships.',
    ],
  },
  {
    version: '1.11.7', date: '2026-11-04', schema: 10,
    highlights: [
      'A yearly subscription now behaves like one. The licence view dropped the billing interval and the payment reference, so a clinic paying yearly was shown as monthly, quoted the monthly price, renewed for a single month instead of twelve, and lost the UPI reference it had just recorded.',
      'A payment now buys the term the clinic is actually on. The Monthly/Yearly toggle inside the plan dialog only previews prices — it can no longer shorten a yearly renewal because you happened to be browsing monthly.',
      'Recording a payment in the demo workspace used to add a hard-coded 30 days whatever the plan; it now adds the term you paid for, calendar-correct, matching the database.',
      'The sidebar no longer offers "Manage subscription" to a doctor or a front desk seat, which could not open it since the role split. They see the plan and its status, and who to ask.',
      'Paise are shown as paise: a yearly price reads ₹23,990.40, not ₹23,990.4.',
      'The README is rebuilt as a proper project front page — what the app is, the role table, plans, local setup, database, tests, deployment, troubleshooting and where the deeper docs live.',
    ],
  },
  {
    version: '1.11.6', date: '2026-11-04', schema: 10,
    highlights: [
      'The clinic now keeps the two halves of the work apart, exactly as the Team page has always described them: the doctor owns the chart, the front desk owns the till, the owner owns both. Until now the app said that and the database did not — anyone holding a seat could read it all.',
      'A doctor no longer sees Billing, the Billing tab on a patient, or the ability to raise an invoice from a consultation. "Save & bill" is gone from the consultation form; the visit is saved and the front desk bills it.',
      'Front desk no longer opens Consultations, Follow-ups or any consultation note. It keeps registration, the diary, billing, payments, reports and the day close.',
      'The money and clinical numbers each role still needs keep working: the front desk\'s dashboard, reports and day close count visits from the appointments that actually happened instead of reporting a quiet clinic, and a doctor\'s dashboard keeps its footfall while the collected/outstanding figures give way to the queue.',
      'Reports is now open to the front desk (it was the one row the Team page promised and the app refused), with money panels for the desk and clinical panels for the doctor.',
      'Schema 10 puts the same line in Postgres. The invoice policies drop the doctor seat and the consultation policy drops the front-desk seat, so the API refuses what the screens no longer offer — a hidden button is not the only thing standing between a role and the wrong half of the clinic.',
    ],
  },
  {
    version: '1.11.5', date: '2026-11-05', schema: 9,
    highlights: [
      'The booking link works the moment a clinic is created. A new clinic used to be provisioned with no public address at all, so the link Settings handed over — and every poster, WhatsApp message and Google listing carrying it — opened a page that said no clinic is published at this address.',
      'Settings now shows the link the database actually answers on, and only that one. Copy and Open are disabled until a link exists, instead of silently offering the sample clinic\'s address.',
      'Clearing the link name no longer empties the address: it falls back to the clinic\'s name. A name another clinic already holds gets a free one (-1) instead of a failed save.',
      'Changing the link name says so until you save — "patients stay on /book/old-name until you save" — so you never hand out a link that has not gone live yet.',
      'The public booking page no longer waits for the staff workspace to load: it renders on its own, so a patient on a slow phone sees the clinic instead of "Opening your clinic…".',
      'Schema 9 fills in an address for every existing clinic, including one saved with capitals or punctuation, and blocks anything that cannot be put in a URL.',
    ],
  },
  {
    version: '1.11.1', date: '2026-11-04', schema: 8,
    highlights: [
      'Inviting a front-desk seat or another doctor now works end to end: the invitation carries the name, role, specialty and qualification, and the seat is granted the first time the person signs in with that email.',
      'A new "Pending invitations" list shows who is waiting, how many days the offer has left, and gives you the link to send — or lets you withdraw it.',
      'An invited person is no longer sent to set up a clinic of their own. Their seat is claimed on first sign-in, and if that is refused (a full plan, a withdrawn invitation) the reason is shown on the next screen instead of being swallowed.',
      'In the demo, inviting a doctor used to create a half-built person — named after their email, no hours, ₹0 fees — and demoted you from owner to doctor. It now creates a complete seat and keeps you the owner.',
    ],
  },
  {
    version: '1.11.0', date: '2026-11-04', schema: 8,
    highlights: [
      'Public booking: every clinic gets a page at /#/book/<clinic> that a patient can open without an account — pick a doctor, pick a free slot, leave a name and a number, get a reference.',
      'Slots come from the same engine the front desk uses, so an online booking and a walk-in can never disagree about what is free. The database refuses the same slot twice.',
      'A booking is a normal appointment: it lands on the calendar with source “Booked online”, creates or matches the patient card by phone, and shows up in the token queue like any other.',
      'Patients cancel themselves with their reference — the slot returns to the diary immediately and the record stays. Reports gain “Where the diary comes from”.',
      'Settings → Clinic gains the booking link, the on/off switch, how far ahead the diary opens, and the note patients see.',
    ],
  },
  {
    version: '1.10.1', date: '2026-11-04', schema: 7,
    highlights: [
      'The landing page now advertises day close and the reminder queue, so the two things a solo clinic buys this for are visible before signing in.',
    ],
  },
  {
    version: '1.10.0', date: '2026-11-04', schema: 7,
    highlights: [
      'Day close: one screen with the money that came in, split by how it was paid, against the cash you count in the drawer — with the difference written down before you close.',
      'Closing the day stores a snapshot, so the sheet you printed at 9pm still matches tomorrow after new invoices arrive. Reopen it to amend, never to overwrite silently.',
      'Missed charges are found for you: a patient seen but never billed, a bill still open from today, and dues that have been owed longer than a week.',
      'A reminder queue drafts one privacy-safe message per patient — tomorrow\'s appointments, recalls that are due, and balances older than a week — with copy, WhatsApp and a send log.',
      'The send log records what actually happened (copied, opened, sent, skipped) so the same patient is never messaged twice for the same thing.',
      'Your quiet hours and reminder lead time from Settings are respected: drafts made overnight are waiting for the morning.',
    ],
  },
  {
    version: '1.9.0', date: '2026-11-04', schema: 6,
    highlights: [
      'Phones get their own layout: the appointment day board becomes an agenda, lists read down instead of across, and the consultation sheet fills the screen with its actions pinned at the bottom.',
      'KPI tiles sit two to a row, so the dashboard is a screen and a half instead of four screens.',
      'Long registers page themselves — 12 rows at a time on a phone — instead of scrolling through 200 invoices.',
      'Nothing tappable is smaller than a thumb, and text fields use a 16px font so iOS stops zooming the page on focus.',
      'Wide report tables scroll inside their card instead of crushing every column.',
    ],
  },
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
