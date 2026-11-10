import { useMemo } from 'react';
import type { Summary } from '../data';
import { fmt } from '../data';
import { useWidth } from '../hooks';
import { useTip } from './Tip';

// deterministic jitter so the plot is stable between renders
function jitter(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

export function Predictor({ summary }: { summary: Summary }) {
  const ml = summary.ml;
  const tip = useTip();
  const [, w] = useWidth<HTMLDivElement>(tip.wrap);
  const H = 320,
    padL = 40,
    padR = 14,
    padT = 30,
    padB = 40;
  const plotW = Math.max(200, w - padL - padR);
  const plotH = H - padT - padB;
  const gaps = useMemo(() => [...new Set(ml.points.map((p) => p.gap))].sort((a, b) => a - b), [ml.points]);
  const xMax = gaps[gaps.length - 1] + 0.6;
  const yMin = -0.5,
    yMax = Math.ceil(Math.max(...ml.points.map((p) => p.pred))) + 1;
  const x = (v: number) => padL + ((v + 0.6) / (xMax + 0.6)) * plotW;
  const y = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const counts = ml.gap_counts;

  const pts = useMemo(
    () =>
      ml.points.map((p) => ({
        ...p,
        jx: jitter(p.id) * 0.82,
        ok: p.pred >= 0.5 === p.gap >= 1,
      })),
    [ml.points],
  );
  const misses = pts.filter((p) => !p.ok).length;

  return (
    <div ref={tip.wrap} className="plot">
      {w > 0 && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Predicted versus actual extra stations for ${ml.n_instances} unseen-family instances. ${misses} wrong hard/easy calls.`}>
          <text x={padL} y={14} className="axis-label">
            predicted extra stations
          </text>
          {Array.from({ length: yMax + 1 }, (_, v) => v).map((v) => (
            <g key={v}>
              <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} className="grid" />
              <text x={padL - 8} y={y(v) + 4} className="tick" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {/* perfect-prediction diagonal */}
          <line x1={x(-0.5)} y1={y(-0.5)} x2={x(yMax)} y2={y(yMax)} className="diag" />
          {/* flag threshold */}
          <rect x={padL} y={y(0.5) - 2} width={plotW} height={4} className="hazard" />
          <text x={padL + plotW} y={y(0.5) - 8} className="takt-label" textAnchor="end">
            flag as hard above 0.5
          </text>
          {pts.map((p) => (
            <circle
              key={p.id}
              cx={x(p.gap + p.jx)}
              cy={y(p.pred)}
              r={2.8}
              className={p.ok ? 'dot' : 'dot dot-miss'}
              onPointerEnter={(e) =>
                tip.show(
                  e,
                  <>
                    <b>{p.ok ? 'Correct call' : 'Wrong call'}</b>
                    <span>actual extra stations {p.gap}</span>
                    <span>predicted {fmt.num(p.pred)}</span>
                    <span>n = {p.id.match(/n=(\d+)/)?.[1] ?? '?'} tasks</span>
                  </>,
                )
              }
              onPointerLeave={tip.hide}
            />
          ))}
          {gaps.map((gp) => (
            <g key={gp}>
              <text x={x(gp)} y={H - padB + 18} className="tick" textAnchor="middle">
                {gp}
              </text>
              <text x={x(gp)} y={H - padB + 32} className="tick tick-sub" textAnchor="middle">
                {counts[String(gp)]}
              </text>
            </g>
          ))}
        </svg>
      )}
      <div className="plot-foot">
        <span>actual extra stations (top row) · instances (bottom row)</span>
        <span>
          <i className="sw sw-dot" /> correct hard/easy call <i className="sw sw-miss" /> wrong call ({misses})
        </span>
      </div>
      {tip.el}
    </div>
  );
}

export function Scoreboard({ summary }: { summary: Summary }) {
  const cv = summary.ml.cv;
  const rows = [
    { name: 'Trained model', sub: 'gradient boosting, 15 graph features', hit: cv.hit_rate, mae: cv.mae, main: true },
    { name: 'Counting rule', sub: 'max(LB1, LB2) − LB1', hit: cv.hit_rate_lb2_rule, mae: cv.mae_lb2_rule, main: false },
    { name: 'Average', sub: 'predict the training mean', hit: cv.hit_rate_baseline, mae: cv.mae_mean_baseline, main: false },
  ];
  const maeMax = Math.max(...rows.map((r) => r.mae));
  return (
    <table className="score">
      <caption className="sr-only">Model versus baselines on generator families the model never saw</caption>
      <thead>
        <tr>
          <th scope="col">method</th>
          <th scope="col">hard/easy called right</th>
          <th scope="col">mean error, stations</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className={r.main ? 'is-main' : ''}>
            <th scope="row">
              <span className="score-name">{r.name}</span>
              <span className="score-sub">{r.sub}</span>
            </th>
            <td>
              <span className="meter">
                <span className="meter-fill" style={{ transform: `scaleX(${r.hit})` }} />
              </span>
              <span className="mono">{fmt.pct(r.hit)}</span>
            </td>
            <td>
              <span className="meter">
                <span className="meter-fill" style={{ transform: `scaleX(${r.mae / maeMax})` }} />
              </span>
              <span className="mono">{fmt.num(r.mae)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
