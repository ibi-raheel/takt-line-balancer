import { useEffect, useRef, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(ref: React.RefObject<T> = useRef<T>(null)): [React.RefObject<T>, number] {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Fires once when the element first comes into view. */
export function useSeenOnce<T extends HTMLElement>(rootMargin = '-20% 0px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen];
}

/** Animate a 0..1 value with rAF. Returns [value, start]. */
export function useTween(duration: number, ease: (t: number) => number, reduce: boolean, initial = 1) {
  const [v, setV] = useState(initial);
  const raf = useRef(0);
  const start = (from = 0, to = 1, onDone?: () => void) => {
    cancelAnimationFrame(raf.current);
    if (reduce) {
      setV(to);
      onDone?.();
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setV(from + (to - from) * ease(p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else onDone?.();
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return [v, start, setV] as const;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
