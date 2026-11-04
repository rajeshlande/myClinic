/**
 * Breakpoints and the marketing page's link furniture.
 *
 * Kept as plain data and pure functions so the phone/tablet/desktop rules can
 * be tested in Node, and so the layout a screen gets is decided in one place
 * instead of by a dozen scattered media queries.
 */

/** One column, tabs instead of stacked plans, collapsed feature list. */
export const PHONE_MAX = 640;
/** Nav folds into a menu, hero stacks, cards go two-up. */
export const TABLET_MAX = 900;

export const LAYOUTS = ['phone', 'tablet', 'desktop'];

/**
 * @param {number} width viewport width in CSS pixels
 * @returns {'phone'|'tablet'|'desktop'}
 */
export function layoutFor(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'desktop';
  if (w <= PHONE_MAX) return 'phone';
  if (w <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

/** True only on the narrowest layout — the one that collapses content. */
export const isCompact = (layout) => layout === 'phone';

/** The nav links only fit once the menu has room; below that they live in it. */
export const usesMenu = (layout) => layout !== 'desktop';

/**
 * Footer columns. `href` scrolls within the page, `to` is an app route.
 * Ordered by what a visitor is most likely to want first.
 */
export const FOOTER_GROUPS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'How it works', href: '#workflow' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Security', href: '#security' },
    ],
  },
  {
    title: 'Try it',
    // The demo workspace is reached from the footer's one "Open Demo" button, not
    // from a list of links — a second entry point dilutes the pitch and drops a
    // visitor into sample data when they meant to read pricing.
    links: [
      { label: 'Patient booking page', to: '/book/sunrise-multispecialty' },
      { label: 'Deployment guide', to: '/setup' },
    ],
  },
  {
    title: 'Clinic',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create a clinic', to: '/signup' },
    ],
  },
];

/** Every footer link in one flat list — used by the tests and by search engines. */
export function footerLinks(groups = FOOTER_GROUPS) {
  return groups.flatMap((group) => group.links.map((link) => ({ ...link, group: group.title })));
}
