// Types and small derivations over the pipeline's shipped JSON (public/data/*.json).
// Nothing here changes a number: it only selects, counts and formats.

export type MCStat = {
  det_cycle: number;
  mean_cycle: number;
  p50_cycle: number;
  p95_cycle: number;
  throughput_ratio: number;
  block_share: number[];
  hist: number[];
};

export type Robust = {
  station: number[];
  proven: boolean;
  cap: number;
  eval: MCStat;
  eval_det: MCStat;
  gain_pct: number;
};

export type BizPoint = { factor: number; c: number; takt_s: number; m: number; lb: number; proven: boolean };

export type Line = {
  graph: string;
  n: number;
  tsum: number;
  order_strength: number;
  n_arcs: number; // count of precedence links (the links themselves are not shipped)
  t_max: number; // longest task time (individual task times are not shipped)
  c: number;
  c_lb: number;
  c_bound: number;
  proven: boolean;
  c_published: number | null;
  c_rpw: number;
  efficiency: number;
  efficiency_rpw: number;
  station: number[];
  loads: number[];
  station_rpw: number[];
  loads_rpw: number[];
  mc: {
    graph: string;
    det: Record<string, MCStat>;
    rpw: Record<string, MCStat>;
    robust?: Record<string, Robust>;
  };
  biz: BizPoint[];
};

export type Salbp1Row = {
  graph: string;
  c: number;
  m_star: number | null;
  m_text: string;
  n: number;
  m: number;
  lb: number;
  proven: boolean;
  m_rpw: number;
  lb1: number;
  secs: number;
};

export type Summary = {
  assumptions: {
    stations: number;
    takt_s: number;
    hours_per_day: number;
    cv_grid: number[];
    robust_cvs: number[];
    mc_cycles: number;
    robust_scenarios: number;
    robust_cap: number;
  };
  salbp1: {
    instances: number;
    with_published_optimum: number;
    match: number;
    below_published: number;
    proven: number;
    rpw_extra_stations: number;
    rpw_suboptimal: number;
    rows: Salbp1Row[];
  };
  ml: {
    n_instances: number;
    n_families: number;
    features: string[];
    target: string;
    gap_counts: Record<string, number>;
    cv: {
      mae: number;
      mae_mean_baseline: number;
      hit_rate: number;
      hit_rate_baseline: number;
      mae_lb2_rule: number;
      hit_rate_lb2_rule: number;
    };
    importance: [string, number][];
    points: { id: string; gap: number; pred: number; family: string }[];
    ood: {
      n: number;
      mae: number;
      mae_mean_baseline: number;
      gap_counts: Record<string, number>;
      points: { graph: string; c: number; gap: number; pred: number }[];
    };
  };
};

export async function loadData(): Promise<{ lines: Line[]; summary: Summary }> {
  const base = import.meta.env.BASE_URL;
  const [lines, summary] = await Promise.all([
    fetch(`${base}data/lines.json`).then((r) => {
      if (!r.ok) throw new Error(`lines.json: HTTP ${r.status}`);
      return r.json() as Promise<Line[]>;
    }),
    fetch(`${base}data/summary.json`).then((r) => {
      if (!r.ok) throw new Error(`summary.json: HTTP ${r.status}`);
      return r.json() as Promise<Summary>;
    }),
  ]);
  return { lines, summary };
}

/** CV keys exactly as the pipeline wrote them, sorted numerically. */
export function cvKeys(rec: Record<string, unknown>): string[] {
  return Object.keys(rec).sort((a, b) => Number(a) - Number(b));
}

/** Histogram bins: C / planned cycle, clipped to [0.9, 1.9), 40 bins (pipeline/montecarlo.py). */
export const HIST_LO = 0.9;
export const HIST_HI = 1.9;

export const rpwGapPct = (l: Line) => (100 * (l.c_rpw - l.c)) / l.c;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const unitsPerDay = (taktS: number, hours: number) => (hours * 3600) / taktS;

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-US'),
  pct: (v: number, d = 1) => `${(100 * v).toFixed(d)}%`,
  signedPct: (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`,
  num: (v: number, d = 2) => v.toFixed(d),
  min: (s: number) => `${(s / 60).toFixed(1)} min`,
};

export const FEATURE_LABEL: Record<string, string> = {
  n: 'number of tasks',
  order_strength: 'order strength',
  t_over_c_mean: 'mean task time / takt',
  t_over_c_max: 'longest task / takt',
  t_cv: 'task-time spread (CV)',
  share_big_tasks: 'share of tasks above half the takt',
  share_third_tasks: 'share of tasks above a third of the takt',
  load_ratio: 'load ratio (sum of times / takt)',
  lb1_slack: 'slack in the capacity bound',
  tasks_per_station: 'tasks per station',
  arcs_per_task: 'arcs per task',
  max_degree: 'largest fan-in or fan-out',
  share_sources: 'share of start tasks',
  share_sinks: 'share of end tasks',
  chain_depth_share: 'longest chain / tasks',
};
