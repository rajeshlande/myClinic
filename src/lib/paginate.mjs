/**
 * Pagination for a printed prescription.
 *
 * A prescription is a document, and a document has pages: every page carries the
 * clinic's identity at the bottom, the first page carries the letterhead and the
 * patient, the last one carries the investigations, the advice and the signature.
 *
 * Chrome cannot repeat a running footer by itself — a fixed element prints on
 * every page but is emitted at the head of each page's content stream, which puts
 * it above the letterhead — so the pages are laid out here, in the app, and the
 * stylesheet only has to make each block start on a fresh sheet. That also means
 * the footer sits at the bottom of the page whatever is above it, and "Page 2 of
 * 3" is a number we know rather than one we hope for.
 */

/**
 * How many medicine rows each page gets. Deliberately conservative: a row can
 * wrap to three lines (a long brand, the generic underneath, and directions in
 * two languages), and a page that overflows prints its footer in the wrong place.
 */
export const ROWS_PER_PAGE = { first: 8, middle: 12, last: 9 };

export function paginateRows(rows, { first, middle, last } = ROWS_PER_PAGE) {
  const queue = Array.isArray(rows) ? [...rows] : [];
  if (!queue.length) return [[]];
  // Two pages: split them evenly instead of filling the first and orphaning a
  // single row on the second with the signature underneath it.
  if (queue.length > first && queue.length <= first + last) {
    const head = Math.ceil(queue.length / 2);
    return [queue.slice(0, head), queue.slice(head)];
  }
  const pages = [queue.splice(0, first)];
  while (queue.length) {
    // Whatever is left fits with the closing blocks (investigations, advice,
    // signature), so it becomes the last page instead of a nearly empty one.
    if (queue.length <= last) {
      pages.push(queue.splice(0, queue.length));
      break;
    }
    pages.push(queue.splice(0, middle));
  }
  // The last page also carries the investigations, the advice and the signature, so
  // it must not take a full page of rows: borrow rows back from it while the page
  // before has room, and split it when it does not.
  const cap = (i) => (i === 0 ? first : middle);
  while (pages.length > 1 && pages[pages.length - 1].length > last) {
    const previous = pages.length - 2;
    if (pages[previous].length >= cap(previous)) {
      pages.push(pages[pages.length - 1].splice(last));
      break;
    }
    pages[pages.length - 1].unshift(pages[previous].pop());
  }

  // A final page with one or two rows under a whole closing block reads like a
  // mistake; pull rows back from the page before it until it has four.
  while (
    pages.length > 2
    && pages[pages.length - 1].length < 4
    && pages[pages.length - 2].length > 4
  ) {
    pages[pages.length - 1].unshift(pages[pages.length - 2].pop());
  }
  return pages;
}

/** 1-based index of the row on its own page, and the row's number in the document. */
export function pageOffsets(pages) {
  let seen = 0;
  return pages.map((rows) => {
    const offset = seen;
    seen += rows.length;
    return offset;
  });
}
