import { useEffect, useState } from 'react';
import { layoutFor } from './responsive.mjs';

const initial = () => (typeof window === 'undefined' ? 'desktop' : layoutFor(window.innerWidth));

/**
 * The current layout bucket, kept in sync with the viewport.
 *
 * Resize work is coalesced into one frame so a dragged window does not
 * re-render the page on every pixel.
 */
export function useLayout() {
  const [layout, setLayout] = useState(initial);

  useEffect(() => {
    let frame = 0;
    const measure = () => setLayout(layoutFor(window.innerWidth));
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    measure();
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return layout;
}
