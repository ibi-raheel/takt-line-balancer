import { useEffect, useMemo, useState } from 'react';
import type { Line, Summary } from './data';
import { FEATURE_LABEL, fmt, median, rpwGapPct } from './data';
import { Network } from './components/Network';
import { Yamazumi } from './components/Yamazumi';
import { MonteCarlo } from './components/MonteCarlo';
import { Predictor, Scoreboard } from './components/Predictor';
import { TaktDrag } from './components/TaktDrag';
import { Validation } from './components/Validation';

const STEPS = [
  { id: 'line', title: 'The line' },
  { id: 'balance', title: 'Exact balance' },
  { id: 'variation', title: 'Task times vary' },
  { id: 'predict', title: 'Flag hard lines' },
  { id: 'throughput', title: 'Throughput' },
  { id: 'proof', title: 'How we know' },
  { id: 'solution', title: 'The solution' },
];

const DEFAULT_LINE = 'Lutz1';

function LinePicker({ lines, value, onChange, id }: { lines: Line[]; value: string; onChange: (g: string) => void; id: string }) {
  return (
    <div className="picker">
      <label htmlFor={id}>Benchmark line</label>
      <div className="picker-box">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {lines.map((l) => (
            <option key={l.graph} value={l.graph}>
              {l.graph} · {l.n} tasks
            </option>
          ))}
        </select>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
    </div>
  );
}

function Details({ children, label = 'Show details' }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="details">
      <summary>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        {label}
      </summary>
      <div className="details-body">{children}</div>
    </details>
  );
}

function Step({ i, id, title, lede, children }: { i: number; id: string; title: string; lede: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="step" id={id} aria-labelledby={`${id}-h`} data-step={i}>
      <div className="step-tape" aria-hidden="true" />
      <header className="step-head">
        <span className="step-no mono" aria-hidden="true">
          {i + 1}
        </span>
        <h2 id={`${id}-h`}>{title}</h2>
      </header>
      <p className="lede">{lede}</p>
      {children}
    </section>
  );
}

export function App({ lines, summary }: { lines: Line[]; summary: Summary }) {
  const [graph, setGraph] = useState(() => (lines.some((l) => l.graph === DEFAULT_LINE) ? DEFAULT_LINE : lines[0].graph));
  const line = lines.find((l) => l.graph === graph)!;
  const [cv, setCv] = useState('0.2');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const els = STEPS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const gaps = lines.map(rpwGapPct);
  const longer = gaps.filter((g) => g > 1e-9).length;
  const gap = rpwGapPct(line);
  const kept = line.mc.det[cv].throughput_ratio;
  const ml = summary.ml;
  const ood = ml.ood.points.filter((p) => p.graph.toLowerCase() === line.graph.toLowerCase());
  const flagged = ood.filter((p) => p.pred >= 0.5).length;
  const actuallyHard = ood.filter((p) => p.gap >= 1).length;
  const s1 = summary.salbp1;
  const blocking = line.mc.det[cv].block_share;
  const robust20 = lines.flatMap((l) => (l.mc.robust?.['0.2'] ? [l.mc.robust['0.2'].gain_pct] : []));
  const sortedLines = useMemo(() => [...lines].sort((a, b) => rpwGapPct(b) - rpwGapPct(a)), [lines]);

  return (
    <div className="shell">
      <svg width="0" height="0" className="defs" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="hz" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
            <rect width="7" height="14" fill="#F2C100" />
            <rect x="7" width="7" height="14" fill="#17191B" />
          </pattern>
          <pattern id="over" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#F3D9D5" />
            <rect width="2.4" height="5" fill="#B8322A" />
          </pattern>
        </defs>
      </svg>
      <div className="mobile-bar" aria-hidden="false">
        <div className="mobile-bar-row">
          <span className="mobile-step">
            <span className="mono">{active + 1}/{STEPS.length}</span> {STEPS[active].title}
          </span>
          <LinePicker lines={lines} value={graph} onChange={setGraph} id="line-m" />
        </div>
        <div className="progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${(active + 1) / STEPS.length})` }} />
        </div>
      </div>

      <aside className="rail" aria-label="Steps">
        <div className="rail-inner">
          <p className="rail-title">Takt Line Balancer</p>
          <LinePicker lines={lines} value={graph} onChange={setGraph} id="line-d" />
          <ol className="rail-steps">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={i === active ? 'step' : undefined} data-done={i < active || undefined}>
                  <span className="rail-no mono">{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <main className="main">
        <header className="hero">
          <h1>Takt Line Balancer</h1>
          <p className="hero-q">
            A product change forces a rebalance of a paced 10&#8209;station line. What&rsquo;s the best balance, and how much of the
            plan will it really make?
          </p>
          <p className="hero-lede hero-answer">
            <span><b>Exact balance:</b> beats the textbook heuristic on 15 of 20 published lines, by up to 3.9%.</span>
            <span>
              <b>Reality check:</b> at 20% task-time variation the exact plan keeps a median 87% of its output, about 140 of
              160 units a day.
            </span>
            <span>Rebalancing for variation wins back up to 7%, but only on lines where it passes a test on unseen cycles.</span>
          </p>
          <a className="hero-cta" href="#solution">
            The solution: 4-step recipe + tool <span aria-hidden="true">&rarr;</span>
          </a>
          <p className="hero-meta mono">
            {lines.length} real benchmark lines · 10 stations · {fmt.int(summary.assumptions.mc_cycles)} simulated cycles per
            line · {fmt.int(ml.n_instances)} training instances
          </p>
        </header>

        <Step
          i={0}
          id="line"
          title="A line of tasks with precedence"
          lede={
            <>
              <b>{line.graph}</b> has {line.n} tasks, each with a fixed time, and {line.n_arcs} links that say which task
              must finish before another can start. The job: split them into 10 stations without breaking a link.
            </>
          }
        >
          <Network line={line} />
          <Details>
            <table className="facts">
              <tbody>
                <tr><th>Tasks</th><td className="mono">{line.n}</td></tr>
                <tr><th>Precedence links</th><td className="mono">{line.n_arcs}</td></tr>
                <tr><th>Sum of task times</th><td className="mono">{fmt.int(line.tsum)}</td></tr>
                <tr><th>Longest task</th><td className="mono">{fmt.int(line.t_max)}</td></tr>
                <tr><th>Order strength (share of task pairs fixed by precedence)</th><td className="mono">{fmt.pct(line.order_strength)}</td></tr>
              </tbody>
            </table>
            <p className="micro">
              Time units are those of the published benchmark. Layout: tasks in number order; after dropping, each column is
              one station of the exact plan, filled to its load against the cycle. Only derived results ship with this demo,
              so individual task times and links are not drawn.
            </p>
          </Details>
        </Step>

        <Step
          i={1}
          id="balance"
          title="The exact balance vs a heuristic"
          lede={
            gap > 0 ? (
              <>
                An integer program finds the shortest cycle any 10-station split can reach: <b className="mono">{fmt.int(line.c)}</b>.
                The textbook heuristic stops at <b className="mono">{fmt.int(line.c_rpw)}</b>, {fmt.signedPct(gap, 2)} slower on every
                unit.
              </>
            ) : (
              <>
                An integer program finds the shortest cycle any 10-station split can reach: <b className="mono">{fmt.int(line.c)}</b>.
                On this line the textbook heuristic happens to match it; on {longer} of {lines.length} lines it does not.
              </>
            )
          }
        >
          <Yamazumi line={line} />
          <Details>
            <p className="micro">
              Across all {lines.length} lines the heuristic cycle is longer on {longer}, median {fmt.signedPct(median(gaps), 2)}, worst{' '}
              {fmt.signedPct(Math.max(...gaps), 2)}. Efficiency = sum of times / (10 × cycle).
            </p>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="num">Tasks</th>
                    <th className="num">Exact</th>
                    <th className="num">Heuristic</th>
                    <th className="num">Gap</th>
                    <th className="num">Efficiency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLines.map((l) => (
                    <tr key={l.graph} className={l.graph === line.graph ? 'is-sel' : ''}>
                      <td>{l.graph}</td>
                      <td className="num mono">{l.n}</td>
                      <td className="num mono">{fmt.int(l.c)}</td>
                      <td className="num mono">{fmt.int(l.c_rpw)}</td>
                      <td className="num mono">{fmt.signedPct(rpwGapPct(l), 2)}</td>
                      <td className="num mono">{fmt.pct(l.efficiency)}</td>
                      <td>{l.proven ? 'proven' : 'best found'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="micro">
              Method: OR-Tools CP-SAT with station windows from head and tail times; heuristic = ranked positional weight
              (each station filled by the task with the most work behind it). Budget 60 s per line.
            </p>
          </Details>
        </Step>

        <Step
          i={2}
          id="variation"
          title="What happens when task times vary"
          lede={
            <>
              The plan assumes every task takes its listed time. With real spread, each cycle waits for its slowest station: at{' '}
              {Math.round(Number(cv) * 100)}% variation this line keeps <b className="mono">{fmt.pct(kept)}</b> of planned output.
            </>
          }
        >
          <MonteCarlo line={line} summary={summary} cv={cv} setCv={setCv} />
          <Details>
            <p className="micro">How often each station set the pace (exact plan, CV {Math.round(Number(cv) * 100)}%):</p>
            <div className="block-bars" role="img" aria-label="Share of cycles each station was the slowest">
              {blocking.map((b, i) => (
                <div key={i} className="block-bar">
                  <span className="block-fill" style={{ transform: `scaleY(${b})` }} />
                  <span className="mono block-lbl">{i + 1}</span>
                  <span className="mono block-val">{b >= 0.005 ? fmt.pct(b, 0) : ''}</span>
                </div>
              ))}
            </div>
            <ul className="caveats">
              <li>Task times drawn from a lognormal with the listed mean and one coefficient of variation for every task, independent. That CV is an assumption: no public dataset records it.</li>
              <li>Paced line with no buffers: the worst case. Buffers would recover part of the loss.</li>
              <li>Units/day use a 6-minute takt and 16 h/day to translate ratios; both are assumptions, not data.</li>
              <li>
                The variation-aware plan is scored on fresh cycles it never saw. Across {robust20.length} lines at 20% CV it helps on{' '}
                {robust20.filter((g) => g > 0).length}, hurts on {robust20.filter((g) => g < 0).length} and ties on{' '}
                {robust20.filter((g) => g === 0).length}, so it should only be adopted after a check like this.
              </li>
            </ul>
          </Details>
        </Step>

        <Step
          i={3}
          id="predict"
          title="AI flags hard lines before you solve"
          lede={
            <>
              A trained model reads a task list and predicts how many stations it will need beyond sum of times ÷ takt. On
              families of lines it never saw, it calls hard vs easy right <b className="mono">{fmt.pct(ml.cv.hit_rate)}</b> of the
              time; the counting rule planners use gets {fmt.pct(ml.cv.hit_rate_lb2_rule)}.
            </>
          }
        >
          <div className="ai-grid">
            <Predictor summary={summary} />
            <div className="ai-side">
              <Scoreboard summary={summary} />
              {ood.length > 0 && (
                <p className="ai-line">
                  On the {ood.length} published instances of <b>{line.graph}</b>, the model flags <b className="mono">{flagged}</b> as
                  hard; <b className="mono">{actuallyHard}</b> actually are.
                </p>
              )}
              <p className="micro">
                Honest limit: on the larger classic lines (up to 297 tasks, outside its training range) the mean error rises to{' '}
                {fmt.num(ml.ood.mae)} stations, against {fmt.num(ml.ood.mae_mean_baseline)} for the average.
              </p>
            </div>
          </div>
          <Details>
            <p className="micro">
              Gradient boosting (300 trees, depth 3) on {fmt.int(ml.n_instances)} generated instances with proven optima. Scored with
              5-fold cross-validation grouped by generator family ({ml.n_families} families), so every score is on structures the
              model never trained on. Most useful features:
            </p>
            <div className="imp">
              {ml.importance.slice(0, 6).map(([k, v]) => (
                <div key={k} className="imp-row">
                  <span className="imp-k">{FEATURE_LABEL[k] ?? k}</span>
                  <span className="meter">
                    <span className="meter-fill" style={{ transform: `scaleX(${v / ml.importance[0][1]})` }} />
                  </span>
                  <span className="mono">{fmt.pct(v, 0)}</span>
                </div>
              ))}
            </div>
            {ood.length > 0 && (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="num">Cycle</th>
                      <th className="num">Predicted extra</th>
                      <th className="num">Actual extra</th>
                      <th>Call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ood.map((p) => (
                      <tr key={p.c}>
                        <td className="num mono">{fmt.int(p.c)}</td>
                        <td className="num mono">{fmt.num(p.pred)}</td>
                        <td className="num mono">{p.gap}</td>
                        <td>{p.pred >= 0.5 === p.gap >= 1 ? 'right' : 'wrong'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Details>
        </Step>

        <Step
          i={4}
          id="throughput"
          title="What it means for throughput"
          lede={
            <>
              Drag the takt. A slower takt needs fewer stations, a faster one more; every count is an exact solve, so a target
              rate turns straight into a station count.
            </>
          }
        >
          <TaktDrag line={line} summary={summary} cv={cv} />
        </Step>

        <Step
          i={5}
          id="proof"
          title="How we know"
          lede={
            <>
              The solver was checked against every published optimum first: <b className="mono">{s1.match}</b> of{' '}
              {s1.with_published_optimum} matched, none beaten, {s1.proven} proven optimal by its own bounds.
            </>
          }
        >
          <Validation summary={summary} lines={lines} />
          <Details label="Limitations">
            <ul className="caveats">
              <li>One CV for every task, independent; real lines have task-specific, correlated variation and learning.</li>
              <li>The balancing model ignores zoning, tooling, ergonomics and walking, which a real balance must respect.</li>
              <li>A few seconds of CP-SAT does not prove every large instance; unproven results are marked "best found".</li>
              <li>The predictor is trained on generated lines of 20 and 50 tasks; accuracy drops on larger real graphs.</li>
            </ul>
          </Details>
        </Step>

        <Step
          i={6}
          id="solution"
          title="The solution"
          lede={<>A rebalance recipe and a one-command tool that gives the decision, not just the chart.</>}
        >
          <ol className="recipe">
            <li><span><b>Solve exactly.</b> The heuristic leaves up to 3.9% on the table.</span></li>
            <li><span><b>Quote the realistic rate.</b> Stress-test with your task-time spread.</span></li>
            <li><span><b>Fix the station</b> that sets the pace most often.</span></li>
            <li><span><b>Adopt a variation-aware plan</b> only if it wins on unseen cycles.</span></li>
          </ol>
          <figure className="cmd">
            <pre className="mono">
              <code>
                <span className="cmd-prompt" aria-hidden="true">$ </span>python -I pipeline/rebalance.py tasks.IN2 --stations 10 --cv 0.20
              </code>
            </pre>
            <figcaption className="mono">
              <span aria-hidden="true">&rarr; </span>exact plan · units/day planned vs expected · fix-first station · adopt / keep
            </figcaption>
          </figure>
          <p className="micro">
            Measured on public benchmark lines. Validating it on a real line takes one task list, its time studies and a week.
          </p>
        </Step>

        <footer className="foot">
          <div className="foot-tape" aria-hidden="true" />
          <p>
            Data: Scholl (1993) assembly line balancing benchmark, including graphs from Talbot, Patterson &amp; Gehrlein (1986)
            and Hoffmann (1990, 1992); SALBPGen instances by Otto, Otto &amp; Scholl (2013). Published for research use at{' '}
            <a href="https://assembly-line-balancing.de">assembly-line-balancing.de</a>; no licence text is stated. Task-time variation, the 6-minute takt and 16 h/day are
            labelled assumptions.
          </p>
          <p>Every number on this page is precomputed by the pipeline in <a href="https://github.com/ibi-raheel/takt-line-balancer">this repository</a> (Python, OR-Tools, scikit-learn) and shipped as static data; nothing is computed live.</p>
          <p className="foot-more">
            More work at <a href="https://ibiraheel.com">ibiraheel.com</a>
          </p>
          <p className="foot-src mono">
            <a href="https://github.com/ibi-raheel/takt-line-balancer">Source on GitHub</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
