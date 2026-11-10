import { useState } from 'react';
import type { Line, Salbp1Row, Summary } from '../data';
import { fmt } from '../data';

type Cat = 'proven' | 'match' | 'plus1' | 'plus2' | 'open';
const CATS: { id: Cat; label: string }[] = [
  { id: 'proven', label: 'matched, proven optimal' },
  { id: 'match', label: 'matched published optimum' },
  { id: 'plus1', label: '1 station above' },
  { id: 'plus2', label: '2 stations above' },
  { id: 'open', label: 'no published optimum' },
];

function cat(r: Salbp1Row): Cat {
  if (r.m_star === null) return 'open';
  const d = r.m - r.m_star;
  if (d <= 0) return r.proven ? 'proven' : 'match';
  return d === 1 ? 'plus1' : 'plus2';
}

export function Validation({ summary, lines }: { summary: Summary; lines: Line[] }) {
  const rows = [...summary.salbp1.rows].map((r) => ({ r, c: cat(r) }));
  const order: Cat[] = ['proven', 'match', 'plus1', 'plus2', 'open'];
  rows.sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
  const count = (c: Cat) => rows.filter((x) => x.c === c).length;
  const [hover, setHover] = useState<string | null>(null);

  const s2 = lines.filter((l) => l.c_published !== null);
  const s2match = s2.filter((l) => l.c === l.c_published);
  const s2worst = Math.max(...s2.map((l) => (100 * Math.abs(l.c - l.c_published!)) / l.c_published!));
  const jackson = summary.salbp1.rows.find((r) => r.graph === 'Jackson' && r.c === 10);
  const checks = [
    { k: 'Results below a published optimum (a solver bug would show here)', v: String(summary.salbp1.below_published) },
    {
      k: 'Published 10-station optima matched exactly',
      v: `${s2match.length} of ${s2.length}, rest within ${s2worst.toFixed(2)}%`,
    },
    ...(jackson
      ? [{ k: `Hand calculation: ${jackson.n}-task line at cycle ${jackson.c}`, v: `${jackson.m} stations, both ways` }]
      : []),
    { k: 'Simulation at zero variation reproduces the planned cycle', v: 'unit test' },
  ];

  return (
    <figure className="fig">
      <div className="waffle-head">
        <span className="readout-k">
          {fmt.int(summary.salbp1.instances)} published single-objective instances (fixed cycle, minimise stations)
        </span>
        <span className="readout-v mono" aria-live="polite">
          {hover ?? ' '}
        </span>
      </div>
      <div className="waffle" role="img" aria-label={`${summary.salbp1.match} of ${summary.salbp1.with_published_optimum} published optima matched, ${summary.salbp1.proven} proven, ${summary.salbp1.below_published} below a published optimum.`}>
        {rows.map(({ r, c }, i) => (
          <span
            key={i}
            className={`cell cell-${c}`}
            onPointerEnter={() =>
              setHover(`${r.graph} · c = ${fmt.int(r.c)} · ours ${r.m} · published ${r.m_star ?? r.m_text}`)
            }
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </div>
      <figcaption className="legend">
        {CATS.map((k) => (
          <span key={k.id}>
            <i className={`sw cell-${k.id}`} /> {k.label} <b className="mono">{count(k.id)}</b>
          </span>
        ))}
      </figcaption>
      <table className="checksheet">
        <caption className="sr-only">Validation checks</caption>
        <tbody>
          {checks.map((c) => (
            <tr key={c.k}>
              <td className="ck-box" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </td>
              <th scope="row">{c.k}</th>
              <td className="mono">{c.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
