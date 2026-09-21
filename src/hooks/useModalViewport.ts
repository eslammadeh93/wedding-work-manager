import { useLayoutEffect, useRef } from 'react';

let lockCount = 0;
let restorePage: (() => void) | undefined;

/** A fixed body also locks Safari, where overflow:hidden alone is insufficient. */
function lockPageScroll() {
  if (lockCount++ === 0) {
    const { body, documentElement } = document;
    const x = window.scrollX;
    const y = window.scrollY;
    const properties = ['position', 'top', 'left', 'right', 'width', 'overflow'] as const;
    const previous = properties.map((property) => body.style[property]);
    const rootOverflow = documentElement.style.overflow;
    Object.assign(body.style, { position: 'fixed', top: `${-y}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' });
    documentElement.style.overflow = 'hidden';
    restorePage = () => {
      properties.forEach((property, index) => { body.style[property] = previous[index]; });
      documentElement.style.overflow = rootOverflow;
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
    };
  }
  return () => {
    if (--lockCount === 0) { restorePage?.(); restorePage = undefined; }
  };
}

/** Tracks the visible area above the keyboard without re-rendering the form. */
export function useModalViewport(active: boolean, mediaQuery?: string) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const media = mediaQuery ? window.matchMedia(mediaQuery) : null;
    let unlock: (() => void) | undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewport = window.visualViewport;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.setProperty('--modal-height', `${viewport?.height ?? window.innerHeight}px`);
        overlay.style.setProperty('--modal-top', `${viewport?.offsetTop ?? 0}px`);
      }
    };
    const scheduleUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
    const syncLock = () => {
      if (!media || media.matches) { unlock ??= lockPageScroll(); }
      else { unlock?.(); unlock = undefined; }
      update();
    };
    syncLock();
    media?.addEventListener('change', syncLock);
    window.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('scroll', scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      media?.removeEventListener('change', syncLock);
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleUpdate);
      unlock?.();
    };
  }, [active, mediaQuery]);
  return overlayRef;
}
