import { useEffect, useMemo, useState } from 'react';
import type { Line, Summary } from '../data';
import { fmt, unitsPerDay } from '../data';
import { useWidth } from '../hooks';

export function TaktDrag({ line, summary, cv }: { line: Line; summary: Summary; cv: string }) {
  const a = summary.assumptions;
  // distinct cycle times only (short takts can clamp to the longest task)
  const pts = useMemo(() => {
    const seen = new Set<number>();
    return line.biz.filter((b) => (seen.has(b.c) ? false : (seen.add(b.c), true)));
  }, [line]);
  const baseIdx = Math.max(0, pts.findIndex((p) => Math.abs(p.takt_s - a.takt_s) < 1e-6));
  const [idx, setIdx] = useState(baseIdx);
  useEffect(() => setIdx(baseIdx), [line, baseIdx]);
  const p = pts[Math.min(idx, pts.length - 1)];
  const clamped = line.biz.length !== pts.length;
  const util = line.tsum / (p.m * p.c);
  const upd = unitsPerDay(p.takt_s, a.hours_per_day);
  const kept = line.mc.det[cv]?.throughput_ratio ?? 1;
  const atBase = Math.abs(p.takt_s - a.takt_s) < 1e-6;

  return (
    <figure className="fig">
      <div className="takt-slider">
        <label htmlFor="takt" className="seg-ctl-label">
          takt time
        </label>
        <input
          id="takt"
          type="range"
          min={pts[0].takt_s}
          max={pts[pts.length - 1].takt_s}
          step={1}
          value={p.takt_s}
          onChange={(e) => {
            const v = Number(e.target.value);
            let best = 0;
            pts.forEach((q, i) => Math.abs(q.takt_s - v) < Math.abs(pts[best].takt_s - v) && (best = i));
            setIdx(best);
          }}
          aria-valuetext={`${fmt.min(p.takt_s)}, ${p.m} stations`}
        />
        <span className="takt-val mono">{fmt.min(p.takt_s)}</span>
      </div>

      <StationRow m={p.m} util={util} />

      <div className="takt-read">
        <span className="big mono">{p.m}</span>
        <span className="takt-read-txt">
          <b>stations needed</b>
          <span className="readout-k">
            {p.proven ? 'proven minimum' : `best found, bound ${p.lb}`} · {fmt.int(upd)} units/day planned at {a.hours_per_day} h/day ·{' '}
            {fmt.pct(util, 0)} average utilisation
          </span>
        </span>
      </div>
      <p className="micro">
        {atBase
          ? `At this takt the variation test applies: at ${Math.round(Number(cv) * 100)}% task-time CV the plan delivers about ${fmt.int(upd * kept)} units/day.`
          : 'The variation test was run at the 6-minute base takt; drag back to it to see the expected output.'}
        {clamped && ' Shorter takts are not shown: the longest task already sets the shortest feasible cycle.'}
      </p>
      <StairChart pts={pts} sel={idx} onPick={setIdx} />
    </figure>
  );
}

function StationRow({ m, util }: { m: number; util: number }) {
  const max = 18;
  return (
    <div className="stations" role="img" aria-label={`${m} stations`}>
      {Array.from({ length: Math.max(m, 1) }, (_, i) => (
        <div key={i} className="station" style={{ ['--i' as string]: i }}>
          <span className="station-fill" style={{ transform: `scaleY(${Math.min(1, util)})` }} />
          <span className="station-n mono">{i + 1}</span>
        </div>
      ))}
      {m > max && <span className="micro">+{m - max}</span>}
    </div>
  );
}

function StairChart({ pts, sel, onPick }: { pts: Line['biz']; sel: number; onPick: (i: number) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const H = 200,
    padL = 34,
    padR = 16,
    padT = 26,
    padB = 30;
  const plotW = Math.max(200, w - padL - padR);
  const plotH = H - padT - padB;
  const xs = pts.map((p) => p.takt_s / 60);
  const x0 = Math.min(...xs) * 0.95,
    x1 = Math.max(...xs) * 1.03;
  const mMax = Math.max(...pts.map((p) => p.m)) + 3;
  const x = (v: number) => padL + ((v - x0) / (x1 - x0)) * plotW;
  const y = (v: number) => padT + plotH - (v / mMax) * plotH;
  const step = Math.max(1, Math.ceil(mMax / 5));
  const ticks = Array.from({ length: Math.floor(mMax / step) + 1 }, (_, i) => i * step);
  let d = '';
  pts.forEach((p, i) => {
    const px = x(xs[i]),
      py = y(p.m);
    d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
  });
  return (
    <div ref={ref} className="plot">
      {w > 0 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Stations needed versus takt time">
          <text x={padL} y={14} className="axis-label">
            stations needed vs takt (minutes)
          </text>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} className="grid" />
              <text x={padL - 8} y={y(v) + 4} className="tick" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {Array.from({ length: Math.floor(x1) - Math.ceil(x0) + 1 }, (_, k) => Math.ceil(x0) + k).map((m) => (
            <text key={m} x={x(m)} y={H - padB + 18} className="tick" textAnchor="middle">
              {m}
            </text>
          ))}
          <path d={d} className="stair" />
          {pts.map((p, i) => (
            <g key={i} onClick={() => onPick(i)} style={{ cursor: 'pointer' }}>
              <circle cx={x(xs[i])} cy={y(p.m)} r={12} fill="transparent" />
              <circle cx={x(xs[i])} cy={y(p.m)} r={i === sel ? 6 : 4} className={i === sel ? 'stair-dot is-sel' : 'stair-dot'} />
              {i === sel && (
                <text
                  x={x(xs[i]) + (x(xs[i]) < padL + plotW * 0.6 ? 12 : -12)}
                  y={y(p.m) - 10}
                  className="takt-label"
                  textAnchor={x(xs[i]) < padL + plotW * 0.6 ? 'start' : 'end'}
                >
                  {p.m} @ {xs[i].toFixed(1)} min
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
