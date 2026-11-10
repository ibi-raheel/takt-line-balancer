import { useMemo } from 'react';
import type { Line } from '../data';
import { fmt, rpwGapPct } from '../data';
import { useWidth } from '../hooks';
import { useTip } from './Tip';

type Plan = { name: string; sub: string; station: number[]; loads: number[]; cycle: number; tone: 'exact' | 'heur' };

function niceTicks(max: number, count = 4) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

function Stack({ plan, yMax, cStar }: { plan: Plan; yMax: number; cStar: number }) {
  const tip = useTip();
  const [, w] = useWidth<HTMLDivElement>(tip.wrap);
  const H = w > 0 && w < 420 ? 250 : 300;
  const padL = 46,
    padR = 12,
    padT = 34,
    padB = 30;
  const plotW = Math.max(120, w - padL - padR);
  const plotH = H - padT - padB;
  const band = plotW / 10;
  const bw = Math.min(24, band * 0.62);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const ticks = niceTicks(yMax * 0.98);

  const stacks = useMemo(() => {
    const per: number[][] = Array.from({ length: 10 }, () => []);
    plan.station.forEach((s, i) => per[s - 1].push(i));
    return per;
  }, [plan.station]);

  const worst = plan.loads.indexOf(Math.max(...plan.loads));

  return (
    <div className="yama">
      <div className="yama-head">
        <span className={`yama-key key-${plan.tone}`} aria-hidden="true" />
        <span className="yama-name">{plan.name}</span>
        <span className="yama-sub">{plan.sub}</span>
      </div>
      <div ref={tip.wrap} className="plot">
        {w > 0 && (
          <svg
            width={w}
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            role="img"
            aria-label={`${plan.name}: station loads ${plan.loads.map(fmt.int).join(', ')}; cycle ${fmt.int(plan.cycle)}.`}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} className="grid" />
                <text x={padL - 8} y={y(v) + 4} className="tick" textAnchor="end">
                  {fmt.int(v)}
                </text>
              </g>
            ))}
            {stacks.map((ids, k) => {
              const cx = padL + band * k + band / 2;
              let acc = 0;
              return (
                <g
                  key={k}
                  onPointerEnter={(e) =>
                    tip.show(
                      e,
                      <>
                        <b>Station {k + 1}</b>
                        <span>load {fmt.int(plan.loads[k])}</span>
                        <span>{ids.length} tasks</span>
                        <span>{fmt.pct(plan.loads[k] / cStar)} of the exact cycle</span>
                      </>,
                    )
                  }
                  onPointerLeave={tip.hide}
                >
                  <rect x={cx - band / 2} y={padT - 6} width={band} height={plotH + 6} fill="transparent" />
                  {ids.map((id, j) => {
                    const t = plan.loads[k] / ids.length; // equal share: task times are not shipped
                    const y0 = y(acc);
                    const y1 = y(acc + t);
                    acc += t;
                    const gap = y0 - y1 > 3 ? 1 : 0;
                    const over = acc > cStar ? Math.max(0, y(cStar) - y1) : 0;
                    return (
                      <g key={id}>
                        <rect
                          x={cx - bw / 2}
                          y={y1 + gap}
                          width={bw}
                          height={Math.max(0.5, y0 - y1 - gap * 2)}
                          className={`seg seg-${plan.tone} ${j % 2 ? 'seg-alt' : ''}`}
                        />
                        {over > 0.5 && (
                          <rect x={cx - bw / 2} y={y1 + gap} width={bw} height={Math.min(over, y0 - y1 - gap * 2)} className="seg-over" />
                        )}
                      </g>
                    );
                  })}
                  <text x={cx} y={H - padB + 18} className="tick" textAnchor="middle">
                    {k + 1}
                  </text>
                </g>
              );
            })}
            {/* takt line: hazard tape at the exact cycle */}
            <g className="takt">
              <rect x={padL - 4} y={y(cStar) - 3} width={plotW + 8} height={6} className="hazard" />
              {/* Label sits above the tape, never on the stacks. When the heuristic's red cycle line is
                  just above the tape, it shares that row (red label left, this one right), and is left
                  out where the plot is too narrow for both: the exact chart already names the tape. */}
              {(() => {
                const crowded = plan.cycle > cStar && y(cStar) - y(plan.cycle) < 22;
                if (crowded && plotW < 330) return null;
                return (
                  <text x={padL + plotW} y={crowded ? y(plan.cycle) - 8 : y(cStar) - 10} className="takt-label" textAnchor="end">
                    exact cycle {fmt.int(cStar)}
                  </text>
                );
              })()}
            </g>
            {plan.cycle > cStar && (
              <g>
                <line x1={padL} x2={padL + plotW} y1={y(plan.cycle)} y2={y(plan.cycle)} className="cycle-line" />
                <text x={padL} y={y(plan.cycle) - 8} className="over-label">
                  station {worst + 1}: {fmt.int(plan.cycle)} (+{fmt.int(plan.cycle - cStar)})
                </text>
              </g>
            )}
            <text x={padL} y={14} className="axis-label">
              station load (task time)
            </text>
          </svg>
        )}
        {tip.el}
      </div>
    </div>
  );
}

export function Yamazumi({ line }: { line: Line }) {
  const yMax = Math.max(line.c_rpw, ...line.loads, ...line.loads_rpw) * 1.2;
  const gap = rpwGapPct(line);
  const plans: Plan[] = [
    {
      name: 'Exact balance',
      sub: `integer program · cycle ${fmt.int(line.c)}${line.proven ? ' · proven optimal' : ' · best found'}`,
      station: line.station,
      loads: line.loads,
      cycle: line.c,
      tone: 'exact',
    },
    {
      name: 'Textbook heuristic',
      sub: `ranked positional weight · cycle ${fmt.int(line.c_rpw)}${gap > 0 ? ` · ${fmt.signedPct(gap, 2)}` : ' · same'}`,
      station: line.station_rpw,
      loads: line.loads_rpw,
      cycle: line.c_rpw,
      tone: 'heur',
    },
  ];
  return (
    <figure className="fig">
      <div className="yama-pair">
        {plans.map((p) => (
          <Stack key={p.name} plan={p} yMax={yMax} cStar={line.c} />
        ))}
      </div>
      <figcaption className="legend">
        <span>
          <i className="sw sw-hazard" /> exact cycle: the slowest station of the exact plan
        </span>
        <span>
          <i className="sw sw-over" /> work above it
        </span>
        <span>one block = one task, drawn as an equal share of its station&rsquo;s load</span>
      </figcaption>
    </figure>
  );
}
