"""One-command rebalance decision for a paced line.

usage: python -I pipeline/rebalance.py tasks.IN2 --stations 10 --cv 0.20
           [--takt-s 360] [--hours 16] [--target-takt C] [--no-robust] [--json out.json]

Input: a task list in .IN2 format (n, one task time per line, "i,j" precedence pairs,
optional "-1,-1") or .alb. Output: the exact plan, what the heuristic leaves on the table,
the realistic rate under task-time variation, the station to fix first, and whether a
variation-aware plan is worth adopting.

No new algorithms: every step calls the existing pipeline with the settings run_all.py uses,
so on a benchmark line the output reproduces public/data/lines.json.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from pipeline.alb import Instance, check_assignment, features, lb1_stations, parse_alb, parse_in2, station_loads  # noqa: E402
from pipeline.montecarlo import sample_task_times, simulate  # noqa: E402
from pipeline.solve import solve_robust, solve_salbp1, solve_salbp2  # noqa: E402

MODEL = ROOT / "cache" / "ml_model.joblib"     # written by run_all.py --stage ml
ADOPT_MIN_PCT = 0.5   # smaller gains can flip sign between runs (CP-SAT stops on a time limit)


def load_tasks(path: str | Path) -> Instance:
    p = Path(path)
    return parse_alb(p) if p.suffix.lower() == ".alb" else parse_in2(p)


def rebalance(inst: Instance, m: int = 10, cv: float = 0.20, takt_s: float | None = None,
              hours: float = 16.0, robust: bool = True, target_c: int | None = None,
              n_cycles: int = 10_000) -> dict:
    # 1. exact plan (same budget as run_all.stage_salbp2)
    sol = solve_salbp2(inst, m, time_limit=60.0, workers=1)
    c, station = sol["c"], sol["station"]
    assert not check_assignment(inst, station, c)
    loads = station_loads(inst, station) + [0] * (m - max(station))
    out = {
        "line": inst.name, "tasks": inst.n, "stations": m, "cv": cv,
        "plan": {"cycle": c, "bound": sol["lb"], "proven": sol["proven"], "station": station,
                 "loads": loads, "efficiency": inst.tsum / (m * c)},
        "heuristic": {"cycle": sol["c_rpw"], "left_on_table_pct": 100 * (sol["c_rpw"] / c - 1)},
    }

    # 2. realistic rate (same seed as run_all._mc_job)
    det = simulate(inst.times, station, m, cv, n_cycles, seed=11)
    takt = takt_s if takt_s else float(c)          # without --takt-s, task times are seconds
    planned = hours * 3600 / takt
    out["rate"] = {"output_kept": det["throughput_ratio"], "takt_s": takt,
                   "p95_cycle_s": det["p95_cycle"] / c * takt,
                   "units_day_planned": planned, "units_day_expected": planned * det["throughput_ratio"]}

    # 3. fix first: stations ranked by how often they set the pace
    share = det["block_share"]
    order = [k for k in np.argsort(share)[::-1] if share[k] > 0]
    out["fix_first"] = [{"station": int(k) + 1, "pace_share": share[k],
                         "tasks": [i + 1 for i, s in enumerate(station) if s == k + 1]} for k in order]

    # 4. variation-aware plan, scored on fresh cycles it never saw
    if robust and inst.n <= 120 and cv > 0:
        rng = np.random.default_rng(1000 + int(cv * 100))
        train = sample_task_times(inst.times, cv, 60, rng)
        cap = int(math.floor(c * 1.03))
        rob = solve_robust(inst, m, train, station, c_cap=cap, time_limit=25.0, workers=1)
        ev_rob = simulate(inst.times, rob["station"], m, cv, n_cycles, seed=99)
        ev_det = simulate(inst.times, station, m, cv, n_cycles, seed=99)
        gain = 100 * (ev_det["mean_cycle"] / ev_rob["mean_cycle"] - 1)
        out["robust"] = {"gain_pct": gain, "kept_exact": ev_det["throughput_ratio"],
                         "kept_robust": ev_det["det_cycle"] / ev_rob["mean_cycle"],
                         "station": rob["station"], "decision": "ADOPT" if gain > ADOPT_MIN_PCT else "KEEP"}

    # 5. optional: stations for a target cycle, plus the hard-line prediction
    if target_c:
        s1 = solve_salbp1(inst, target_c, time_limit=4.0, workers=1)
        res = {"cycle": target_c, "stations": s1["m"], "proven": s1["proven"],
               "lb1": lb1_stations(inst, target_c)}
        if MODEL.exists():
            import joblib
            bundle = joblib.load(MODEL)
            f = features(inst, target_c)
            pred = float(bundle["model"].predict(np.array([[f[k] for k in bundle["features"]]]))[0])
            res["predicted_extra"] = pred
            res["predicted_hard"] = pred >= 0.5
        out["stations_for_takt"] = res
    return out


def _print(r: dict) -> None:
    p, h, q = r["plan"], r["heuristic"], r["rate"]
    print(f"{r['line']}: {r['tasks']} tasks, {r['stations']} stations, task-time CV {r['cv']:.0%}")
    print(f"  exact plan      cycle {p['cycle']} ({'proven' if p['proven'] else 'best found, bound ' + str(p['bound'])}),"
          f" efficiency {p['efficiency']:.1%}")
    print(f"  station loads   {p['loads']}")
    print(f"  heuristic       cycle {h['cycle']} ({h['left_on_table_pct']:+.2f}% left on the table)")
    print(f"  realistic rate  keeps {q['output_kept']:.1%} of output, p95 cycle {q['p95_cycle_s']:.0f} s"
          f" -> {q['units_day_planned']:.0f} planned vs {q['units_day_expected']:.0f} expected units/day")
    top = ", ".join(f"S{f['station']} {f['pace_share']:.0%}" for f in r["fix_first"][:3])
    print(f"  fix first       {top}  (share of cycles each station sets the pace)")
    if "robust" in r:
        b = r["robust"]
        verdict = (f"ADOPT variation-aware plan ({b['gain_pct']:+.2f}% on unseen cycles)" if b["decision"] == "ADOPT"
                   else f"KEEP exact plan (variation-aware {b['gain_pct']:+.2f}% on unseen cycles)")
        print(f"  robust          {verdict}")
    if "stations_for_takt" in r:
        s = r["stations_for_takt"]
        hard = f", model says {'hard' if s['predicted_hard'] else 'easy'} ({s['predicted_extra']:+.2f})" if "predicted_extra" in s else ""
        print(f"  target cycle    {s['cycle']} -> {s['stations']} stations (sum/takt rule {s['lb1']}){hard}")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Exact rebalance + realistic-rate decision for a paced line.")
    ap.add_argument("tasks", help=".IN2 or .alb task list")
    ap.add_argument("--stations", type=int, default=10)
    ap.add_argument("--cv", type=float, default=0.20, help="task-time coefficient of variation")
    ap.add_argument("--takt-s", type=float, default=None, help="planned takt in seconds (default: cycle, times in s)")
    ap.add_argument("--hours", type=float, default=16.0, help="paced hours per day")
    ap.add_argument("--target-takt", type=int, default=None, help="cycle (task-time units) for a station count")
    ap.add_argument("--no-robust", action="store_true")
    ap.add_argument("--json", default=None, help="write the full result here")
    a = ap.parse_args(argv)
    r = rebalance(load_tasks(a.tasks), a.stations, a.cv, a.takt_s, a.hours, not a.no_robust, a.target_takt)
    _print(r)
    if a.json:
        Path(a.json).write_text(json.dumps(r, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))


if __name__ == "__main__":
    main()
