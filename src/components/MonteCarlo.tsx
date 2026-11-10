import { useEffect, useRef, useState } from 'react';
import type { Line, MCStat, Summary } from '../data';
import { HIST_HI, HIST_LO, cvKeys, fmt, unitsPerDay } from '../data';
import { easeOut, useReducedMotion, useSeenOnce, useTween, useWidth } from '../hooks';
import { useTip } from './Tip';

export function MonteCarlo({ line, summary, cv, setCv }: { line: Line; summary: Summary; cv: string; setCv: (k: string) => void }) {
  const a = summary.assumptions;
  const keys = cvKeys(line.mc.det);
  const robust = line.mc.robust?.[cv];
  const [plan, setPlan] = useState<'exact' | 'robust'>('exact');
  const usePlan = plan === 'robust' && robust ? 'robust' : 'exact';
  const stat: MCStat = usePlan === 'robust' ? robust!.eval : line.mc.det[cv];
  const ref: MCStat | null = usePlan === 'robust' ? robust!.eval_det : null;

  const reduce = useReducedMotion();
  const [prog, tween] = useTween(1600, easeOut, reduce, 0);
  const [seenRef, seen] = useSeenOnce<HTMLDivElement>();
  const ran = useRef(false);
  const run = () => {
    ran.current = true;
    tween(0, 1);
  };
  useEffect(() => {
    if (seen && !ran.current) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const planned = unitsPerDay(a.takt_s, a.hours_per_day);
  const kept = stat.throughput_ratio;
  const done = prog >= 0.999;

  return (
    <figure className="fig" ref={seenRef}>
      <div className="fig-controls">
        <div className="seg-ctl" role="radiogroup" aria-label="Task-time variation (coefficient of variation)">
          <span className="seg-ctl-label">task-time CV</span>
          {keys.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={k === cv}
              className="seg-btn"
              onClick={() => {
                setCv(k);
                run();
              }}
            >
              {Math.round(Number(k) * 100)}%
            </button>
          ))}
        </div>
        <button className="btn btn-run" onClick={run}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="btn-ico">
            <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
          </svg>
          Run {fmt.int(a.mc_cycles)} cycles
        </button>
      </div>

      <div className="mc-grid">
        <Histogram stat={stat} refStat={ref} prog={prog} />
        <div className="readout" aria-live="polite">
          <div className="readout-row">
            <span className="readout-k">cycles simulated</span>
            <span className="readout-v mono">{fmt.int(prog * a.mc_cycles)}</span>
          </div>
          <div className="readout-big" style={{ opacity: done ? 1 : 0.35 }}>
            <span className="big mono">{fmt.pct(kept)}</span>
            <span className="readout-k">of planned output kept</span>
          </div>
          <div className="readout-row">
            <span className="readout-k">units/day at a 6-min takt</span>
            <span className="readout-v mono">
              {fmt.int(planned * kept)} <small>of {fmt.int(planned)}</small>
            </span>
          </div>
          <div className="readout-row">
            <span className="readout-k">95th-percentile cycle</span>
            <span className="readout-v mono">{fmt.signedPct(100 * (stat.p95_cycle / stat.det_cycle - 1))}</span>
          </div>
          <div className="plan-switch">
            <span className="readout-k">plan under test</span>
            <div className="seg-ctl" role="radiogroup" aria-label="Plan under test">
              <button role="radio" aria-checked={usePlan === 'exact'} className="seg-btn" onClick={() => setPlan('exact')}>
                exact
              </button>
              <button
                role="radio"
                aria-checked={usePlan === 'robust'}
                className="seg-btn"
                disabled={!robust}
                onClick={() => {
                  setPlan('robust');
                  run();
                }}
              >
                variation-aware
              </button>
            </div>
            <p className="micro">
              {robust
                ? usePlan === 'robust'
                  ? `Re-balanced on ${a.robust_scenarios} sampled scenarios, scored on fresh cycles: ${fmt.signedPct(robust.gain_pct)} output vs the exact plan (${fmt.pct(robust.eval_det.throughput_ratio)}).`
                  : `A variation-aware re-balance exists for this line at this CV.`
                : Number(cv) === 0
                  ? 'Pick a CV above zero to compare a variation-aware plan.'
                  : line.n > 120
                    ? 'Variation-aware re-balance was run for lines up to 120 tasks only.'
                    : 'Variation-aware re-balance was run at CV 10%, 20% and 30%.'}
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}

function Histogram({ stat, refStat, prog }: { stat: MCStat; refStat: MCStat | null; prog: number }) {
  const tip = useTip();
  const [, w] = useWidth<HTMLDivElement>(tip.wrap);
  const H = 280,
    padL = 12,
    padR = 12,
    padT = 30,
    padB = 34;
  const plotW = Math.max(200, w - padL - padR);
  const plotH = H - padT - padB;
  const nb = stat.hist.length;
  const bwid = plotW / nb;
  const max = Math.max(...stat.hist, ...(refStat?.hist ?? []));
  const x = (r: number) => padL + ((r - HIST_LO) / (HIST_HI - HIST_LO)) * plotW;
  const total = stat.hist.reduce((s, v) => s + v, 0);
  const meanR = stat.mean_cycle / stat.det_cycle;
  const done = prog >= 0.999;
  const ticks = [1, 1.2, 1.4, 1.6, 1.8];

  return (
    <div ref={tip.wrap} className="plot">
      {w > 0 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Distribution of simulated cycle times relative to plan. Mean ${fmt.signedPct(100 * (meanR - 1))}.`}>
          <text x={padL} y={14} className="axis-label">
            cycles per bin · actual cycle vs planned
          </text>
          <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} className="axis" />
          {refStat &&
            refStat.hist.map((v, i) => {
              const h = (v / max) * plotH * prog;
              return h > 0.3 ? (
                <rect key={`r${i}`} x={padL + i * bwid + 1} y={padT + plotH - h} width={bwid - 2} height={h} className="bar-ref" />
              ) : null;
            })}
          {stat.hist.map((v, i) => {
            const h = (v / max) * plotH * prog;
            const lo = HIST_LO + (i * (HIST_HI - HIST_LO)) / nb;
            const hi = lo + (HIST_HI - HIST_LO) / nb;
            return (
              <g
                key={i}
                onPointerEnter={(e) =>
                  tip.show(
                    e,
                    <>
                      <b>
                        {i === nb - 1 ? `≥ ${fmt.pct(lo, 1)}` : `${fmt.pct(lo, 1)} – ${fmt.pct(hi, 1)}`} of plan
                      </b>
                      <span>{fmt.int(v)} cycles</span>
                      <span>{fmt.pct(v / total)} of all</span>
                    </>,
                  )
                }
                onPointerLeave={tip.hide}
              >
                <rect x={padL + i * bwid} y={padT} width={bwid} height={plotH} fill="transparent" />
                {h > 0.3 && <rect x={padL + i * bwid + 1} y={padT + plotH - h} width={Math.max(1, bwid - 2)} height={h} rx={Math.min(2, bwid / 4)} className="bar" />}
              </g>
            );
          })}
          <rect x={x(1) - 3} y={padT - 6} width={6} height={plotH + 6} className="hazard hazard-v" />
          <text x={x(1) + 8} y={padT + 4} className="takt-label">
            plan
          </text>
          {done && meanR > 1.002 && (
            <g className="fade-in">
              <line x1={x(meanR)} x2={x(meanR)} y1={padT + 14} y2={padT + plotH} className="mean-line" />
              <text x={x(meanR) + 6} y={padT + 24} className="mean-label">
                mean {fmt.signedPct(100 * (meanR - 1))}
              </text>
            </g>
          )}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={H - padB + 20} className="tick" textAnchor="middle">
              {t === 1 ? '100%' : `${fmt.signedPct(100 * (t - 1), 0)}`}
            </text>
          ))}
        </svg>
      )}
      {tip.el}
    </div>
  );
}
