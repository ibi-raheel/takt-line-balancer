import { useMemo, useState } from 'react';
import type { Line } from '../data';
import { fmt } from '../data';
import { easeInOut, useReducedMotion, useTween, useWidth } from '../hooks';
import { useTip } from './Tip';

type Layout = { x: number[]; y: number[] };

/**
 * The line as tasks and stations. Ships only derived data: each task's station in the exact plan
 * and the station loads. Raw task times and precedence links are not redistributed, so every dot
 * is the same size and no links are drawn.
 */
export function Network({ line }: { line: Line }) {
  const tip = useTip();
  const [, w] = useWidth<HTMLDivElement>(tip.wrap);
  const reduce = useReducedMotion();
  const [p, tween] = useTween(900, easeInOut, reduce, 0);
  const [mode, setMode] = useState<'order' | 'stations'>('order');
  const [hover, setHover] = useState<number | null>(null);

  const vertical = w > 0 && w < 600;
  const geo = useMemo(() => {
    const W = Math.max(w, 300);
    const n = line.n;
    const perStation = Array.from({ length: 10 }, () => [] as number[]);
    for (let i = 0; i < n; i++) perStation[line.station[i] - 1].push(i);
    const maxPer = Math.max(...perStation.map((s) => s.length));
    const R = Math.max(5, Math.ceil(maxPer / 3), Math.ceil(Math.sqrt(n / 2.5))); // slots across the flow

    let H: number, alongLen: number, acrossLen: number, a0: number, b0: number;
    const pad = 18;
    const label = 30; // lane label band (top on desktop, left on mobile)
    if (!vertical) {
      const rowGap = Math.min(30, Math.max(16, 520 / R));
      acrossLen = R * rowGap;
      H = acrossLen + label + pad * 2;
      alongLen = W - pad * 2;
      a0 = pad;
      b0 = label + pad;
    } else {
      acrossLen = W - pad - label - 8;
      const maxColsV = Math.ceil(maxPer / R);
      alongLen = Math.max(10 * 36, 10 * (maxColsV + 1) * 14);
      H = alongLen + pad * 2;
      a0 = pad;
      b0 = label + 8;
    }
    const acrossGap = acrossLen / R;
    // task list: rows in task-number order, as few rows as fit at ~24 px spacing
    const perRow = Math.max(1, Math.floor(alongLen / 24));
    const oRows = Math.min(R, Math.ceil(n / perRow));
    const oCols = Math.ceil(n / oRows);
    const colGap = alongLen / oCols;
    const laneLen = alongLen / 10;
    const maxCols = Math.ceil(maxPer / R);
    const r = Math.max(2.2, Math.min(7, acrossGap * 0.34, colGap * 0.36, (laneLen / (maxCols + 1)) * 0.36));

    const toXY = (along: number, across: number): [number, number] =>
      vertical ? [b0 + across, a0 + along] : [a0 + along, b0 + across];

    const order1: Layout = { x: [], y: [] };
    const lanes: Layout = { x: [], y: [] };
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / oCols);
      const [x, y] = toXY(((i % oCols) + 0.5) * colGap, acrossLen / 2 + (row - (oRows - 1) / 2) * acrossGap);
      order1.x[i] = x;
      order1.y[i] = y;
    }
    perStation.forEach((ids, k) => {
      const cols = Math.max(1, Math.ceil(ids.length / R));
      ids.forEach((id, idx) => {
        const col = Math.floor(idx / R);
        const inCol = Math.min(R, ids.length - col * R);
        const row = idx % R;
        const [x, y] = toXY(
          k * laneLen + ((col + 1) * laneLen) / (cols + 1),
          acrossLen / 2 + (row - (inCol - 1) / 2) * acrossGap,
        );
        lanes.x[id] = x;
        lanes.y[id] = y;
      });
    });
    const lanesRect = Array.from({ length: 10 }, (_, k) => {
      const [x, y] = toXY(k * laneLen, 0);
      return vertical
        ? { x: x - 4, y: y + 2, w: acrossLen + 8, h: laneLen - 4 }
        : { x: x + 2, y: y - 6, w: laneLen - 4, h: acrossLen + 12 };
    });
    // station load against the exact cycle: the floor fill rises (desktop) or grows right (mobile)
    const loadRect = lanesRect.map((b, k) => {
      const f = Math.min(1, line.loads[k] / line.c);
      return vertical ? { ...b, w: b.w * f } : { ...b, y: b.y + b.h * (1 - f), h: b.h * f };
    });
    return { W, H, order1, lanes, lanesRect, loadRect, r, vertical, perStation };
  }, [w, line, vertical]);

  const toggle = () => {
    const next = mode === 'order' ? 'stations' : 'order';
    setMode(next);
    tween(p, next === 'stations' ? 1 : 0);
  };
  const X = (i: number) => geo.order1.x[i] + (geo.lanes.x[i] - geo.order1.x[i]) * p;
  const Y = (i: number) => geo.order1.y[i] + (geo.lanes.y[i] - geo.order1.y[i]) * p;
  const hoverSt = hover === null ? null : line.station[hover];

  return (
    <figure className="fig">
      <div className="fig-controls">
        <button className="btn" onClick={toggle} aria-pressed={mode === 'stations'}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="btn-ico">
            {mode === 'order' ? (
              <path d="M2 3h3v10H2zM6.5 3h3v10h-3zM11 3h3v10h-3z" fill="currentColor" />
            ) : (
              <path d="M2 8h4M10 4h4M10 12h4M6 8l4-4M6 8l4 4" stroke="currentColor" strokeWidth="1.6" fill="none" />
            )}
          </svg>
          {mode === 'order' ? 'Drop tasks into the 10 stations' : 'Back to the task list'}
        </button>
        <span className="fig-note">
          {fmt.int(line.n)} tasks · {fmt.int(line.n_arcs)} precedence links · dot = one task
          {p > 0.5 ? ' · fill = station load vs cycle' : ''}
        </span>
      </div>
      <div ref={tip.wrap} className="plot plot-net">
        {w > 0 && (
          <svg
            width={geo.W}
            height={geo.H}
            viewBox={`0 0 ${geo.W} ${geo.H}`}
            role="img"
            aria-label={`${line.graph}: ${line.n} tasks${
              p > 0.5 ? ', grouped into the 10 stations of the exact balance, each filled to its load against the cycle' : ' in task order'
            }.`}
          >
            <g className="lanes" style={{ opacity: p }}>
              {geo.lanesRect.map((r, i) => (
                <g key={i}>
                  <TapeBox {...r} />
                  <rect
                    x={geo.loadRect[i].x}
                    y={geo.loadRect[i].y}
                    width={geo.loadRect[i].w}
                    height={geo.loadRect[i].h}
                    className="lane-load"
                  />
                  <text
                    className="lane-label"
                    x={geo.vertical ? 4 : r.x + r.w / 2}
                    y={geo.vertical ? r.y + r.h / 2 + 4 : 18}
                    textAnchor={geo.vertical ? 'start' : 'middle'}
                  >
                    S{i + 1}
                  </text>
                </g>
              ))}
            </g>
            <g>
              {line.station.map((st, i) => (
                <circle
                  key={i}
                  cx={X(i)}
                  cy={Y(i)}
                  r={geo.r}
                  className="node"
                  data-st={p > 0.5 ? (st % 2 ? 'a' : 'b') : undefined}
                  style={{ opacity: hoverSt !== null && st !== hoverSt ? 0.3 : 1 }}
                  onPointerEnter={(e) => {
                    setHover(i);
                    tip.show(
                      e,
                      <>
                        <b>Task {i + 1}</b>
                        <span>station {st} in the exact plan</span>
                        <span>
                          {geo.perStation[st - 1].length} tasks · load {fmt.int(line.loads[st - 1])}
                        </span>
                      </>,
                    );
                  }}
                  onPointerLeave={() => {
                    setHover(null);
                    tip.hide();
                  }}
                />
              ))}
            </g>
          </svg>
        )}
        {tip.el}
      </div>
    </figure>
  );
}

/** A floor-tape cell outline: corner L-marks only. */
export function TapeBox({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const c = Math.min(12, w / 3, h / 3);
  const d = `M${x},${y + c}V${y}H${x + c} M${x + w - c},${y}H${x + w}V${y + c} M${x + w},${y + h - c}V${y + h}H${x + w - c} M${x + c},${y + h}H${x}V${y + h - c}`;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="lane-floor" />
      <path d={d} className="tape-corner" />
    </>
  );
}
