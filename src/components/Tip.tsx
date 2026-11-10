import { useCallback, useRef, useState } from 'react';

export type TipState = { x: number; y: number; body: React.ReactNode } | null;

/** A tooltip positioned inside a `position: relative` wrapper. */
export function useTip() {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState>(null);
  const show = useCallback((e: React.PointerEvent | React.FocusEvent, body: React.ReactNode) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    let x: number, y: number;
    if ('clientX' in e) {
      x = e.clientX - box.left;
      y = e.clientY - box.top;
    } else {
      const r = (e.target as Element).getBoundingClientRect();
      x = r.left + r.width / 2 - box.left;
      y = r.top - box.top;
    }
    setTip({ x, y, body });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const el = tip ? (
    <div
      className="tip"
      role="status"
      style={{ left: tip.x, top: tip.y }}
      data-side={(() => {
        const cw = wrap.current?.clientWidth ?? 1;
        return tip.x > cw * 0.62 ? 'r' : tip.x < cw * 0.38 ? 'l' : 'c';
      })()}
    >
      {tip.body}
    </div>
  ) : null;
  return { wrap, show, hide, el };
}
