'use client';

import { useEffect } from 'react';

const SKIP_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'file',
  'button',
  'submit',
  'reset',
  'image',
  'color',
  'hidden',
]);

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if ((target as HTMLInputElement).disabled) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((target as HTMLInputElement).type || 'text').toLowerCase();
    return !SKIP_INPUT_TYPES.has(type);
  }
  return target.isContentEditable;
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      parent.scrollHeight > parent.clientHeight + 2
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function scrollElementAboveKeyboard(el: HTMLElement) {
  if (!el.isConnected || document.activeElement !== el) return;

  const vv = window.visualViewport;
  const vpTop = vv ? vv.offsetTop : 0;
  const vpHeight = vv ? vv.height : window.innerHeight;
  const vpBottom = vpTop + vpHeight;

  let safeTop = vpTop + 12;
  const inModal = Boolean(
    el.closest(
      '[role="dialog"], [role="alertdialog"], [data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"]'
    )
  );
  if (!inModal) {
    const stickyHeader = document.querySelector('header.sticky, header.fixed');
    if (stickyHeader instanceof HTMLElement) {
      const hRect = stickyHeader.getBoundingClientRect();
      if (hRect.height > 0 && hRect.height < 100 && hRect.bottom > safeTop && hRect.top <= vpTop + 8) {
        safeTop = Math.max(safeTop, hRect.bottom + 8);
      }
    }
  }

  const safeBottom = Math.max(safeTop + 40, vpBottom - 16);
  const rect = el.getBoundingClientRect();

  if (rect.bottom <= safeBottom && rect.top >= safeTop) {
    return;
  }

  const computeDelta = (r: DOMRect): number => {
    if (r.bottom > safeBottom) {
      const neededDown = r.bottom - safeBottom + 16;
      const maxDownWithoutClippingTop = Math.max(0, r.top - safeTop - 12);
      return Math.min(neededDown, maxDownWithoutClippingTop || neededDown);
    }
    if (r.top < safeTop) {
      return -(safeTop - r.top + 12);
    }
    return 0;
  };

  const scrollParent = findScrollableAncestor(el);
  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const visibleTop = Math.max(safeTop, parentRect.top + 8);
    const visibleBottom = Math.min(safeBottom, parentRect.bottom - 8);
    let innerDelta = 0;
    if (rect.bottom > visibleBottom) {
      const neededDown = rect.bottom - visibleBottom + 16;
      const maxDown = Math.max(0, rect.top - visibleTop - 12);
      innerDelta = Math.min(neededDown, maxDown || neededDown);
    } else if (rect.top < visibleTop) {
      innerDelta = -(visibleTop - rect.top + 12);
    }
    if (Math.abs(innerDelta) > 2) {
      scrollParent.scrollBy({ top: innerDelta, behavior: 'smooth' });
    }
  }

  const afterRect = el.getBoundingClientRect();
  if (afterRect.bottom > safeBottom || afterRect.top < safeTop) {
    const docDelta = computeDelta(afterRect);
    if (Math.abs(docDelta) > 2) {
      window.scrollBy({ top: docDelta, behavior: 'smooth' });
    }
  }
}

export function ViewportKeyboardObserver() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;
    let maxHeight = Math.max(window.innerHeight, window.visualViewport?.height || 0);
    let lastWidth = window.innerWidth;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimers: ReturnType<typeof setTimeout>[] = [];

    const clearSettleTimers = () => {
      for (const id of settleTimers) clearTimeout(id);
      settleTimers = [];
    };

    const updateViewportVars = () => {
      const currentWidth = window.innerWidth;
      if (Math.abs(currentWidth - lastWidth) > 80) {
        lastWidth = currentWidth;
        maxHeight = Math.max(window.innerHeight, window.visualViewport?.height || 0);
      } else {
        maxHeight = Math.max(maxHeight, window.innerHeight, window.visualViewport?.height || 0);
      }

      const vv = window.visualViewport;
      const vvh = vv ? Math.round(vv.height) : window.innerHeight;
      const vvOffsetTop = vv ? Math.round(vv.offsetTop) : 0;
      const keyboardInset = vv
        ? Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)))
        : 0;
      const activeEl = document.activeElement;
      const editableFocused = isEditableElement(activeEl);
      const isTouchOrNarrow =
        window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 1024;
      const shrankFromBaseline = maxHeight > 0 && vvh < maxHeight - 120;

      const keyboardOpen =
        (isTouchOrNarrow && editableFocused && (keyboardInset > 90 || shrankFromBaseline)) ||
        keyboardInset > 150;

      if (keyboardOpen || vvOffsetTop > 0) {
        root.style.setProperty('--vvh', `${vvh}px`);
        root.style.setProperty('--vv-offset-top', `${vvOffsetTop}px`);
        root.style.setProperty('--keyboard-inset', keyboardInset > 60 ? `${keyboardInset}px` : '0px');
      } else {
        root.style.removeProperty('--vvh');
        root.style.removeProperty('--vv-offset-top');
        root.style.removeProperty('--keyboard-inset');
      }

      if (keyboardOpen) {
        root.dataset.keyboardOpen = 'true';
        if (isEditableElement(activeEl)) {
          requestAnimationFrame(() => scrollElementAboveKeyboard(activeEl));
        }
      } else {
        delete root.dataset.keyboardOpen;
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      const target = e.target;
      if (!isEditableElement(target)) return;

      clearSettleTimers();
      updateViewportVars();

      const isTouchOrNarrow =
        window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 1024;
      if (isTouchOrNarrow) {
        settleTimers.push(
          setTimeout(() => {
            updateViewportVars();
            scrollElementAboveKeyboard(target);
          }, 150),
          setTimeout(() => {
            updateViewportVars();
            scrollElementAboveKeyboard(target);
          }, 380)
        );
      }
    };

    const handleFocusOut = () => {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        updateViewportVars();
      }, 120);
    };

    updateViewportVars();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', updateViewportVars);
    vv?.addEventListener('scroll', updateViewportVars);
    window.addEventListener('resize', updateViewportVars);
    window.addEventListener('orientationchange', updateViewportVars);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);

    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      clearSettleTimers();
      vv?.removeEventListener('resize', updateViewportVars);
      vv?.removeEventListener('scroll', updateViewportVars);
      window.removeEventListener('resize', updateViewportVars);
      window.removeEventListener('orientationchange', updateViewportVars);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vv-offset-top');
      root.style.removeProperty('--keyboard-inset');
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
