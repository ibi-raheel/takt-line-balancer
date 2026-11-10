"""Run the full pipeline and export static JSON for the web page.

usage: python -I pipeline/run_all.py [--data DIR] [--stage all|salbp1|salbp2|mc|ml|biz|export]
Intermediate results are cached in cache/*.json so stages can be re-run independently.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from pipeline import data as D  # noqa: E402
from pipeline.alb import features, lb1_stations, lb_stations, lb_cycle, order_strength, station_loads, check_assignment  # noqa: E402
from pipeline.heuristic import rpw_salbp1, rpw_salbp2  # noqa: E402
from pipeline.montecarlo import sample_task_times, simulate  # noqa: E402
from pipeline.solve import solve_robust, solve_salbp1, solve_salbp2  # noqa: E402

CACHE = ROOT / "cache"
OUT = ROOT / "public" / "data"
M = 10                       # stations on the target line
TAKT_S = 360.0               # assumption: the 10-station optimum is scaled to a 6-minute takt
HOURS_PER_DAY = 16.0         # assumption: 2 shifts x 8 h of paced production
CVS = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
ROBUST_CVS = [0.10, 0.20, 0.30]
WORKERS = 2

_G = None


def graphs():
    global _G
    if _G is None:
        _G = D.scholl_graphs(D.DEFAULT_DIR)
    return _G


def save(name, obj):
    CACHE.mkdir(exist_ok=True)
    (CACHE / f"{name}.json").write_text(json.dumps(obj, indent=1))


def load(name):
    return json.loads((CACHE / f"{name}.json").read_text())


# ------------------------------------------------------------------ SALBP-1 validation

def _salbp1_job(row):
    inst = D.match_graph(graphs(), row["graph"])
    t0 = time.time()
    res = solve_salbp1(inst, row["c"], time_limit=6.0, workers=1)
    assert not check_assignment(inst, res["station"], row["c"])
    rpw = max(rpw_salbp1(inst, row["c"]))
    return {**row, "n": inst.n, "m": res["m"], "lb": res["lb"], "proven": res["proven"],
            "m_rpw": rpw, "lb1": lb1_stations(inst, row["c"]), "secs": round(time.time() - t0, 3)}


def _resumable(name, job, items, key):
    """Run job over items in a pool, appending each result to cache/<name>.jsonl (resumable)."""
    CACHE.mkdir(exist_ok=True)
    part = CACHE / f"{name}.jsonl"
    done = {}
    if part.exists():
        for ln in part.read_text().splitlines():
            r = json.loads(ln)
            done[key(r)] = r
    todo = [it for it in items if key(it) not in done]
    with Pool(WORKERS) as p, part.open("a") as fh:
        for r in p.imap_unordered(job, todo, chunksize=1):
            done[key(r)] = r
            fh.write(json.dumps(r) + "\n")
            fh.flush()
            print(f"  {name} {len(done)}/{len(items)} {key(r)}", flush=True)
    return [done[key(it)] for it in items]


def stage_salbp1():
    rows = D.scholl_salbp1(D.DEFAULT_DIR)
    out = _resumable("salbp1", _salbp1_job, rows, lambda r: f"{r['graph']}|{r['c']}")
    save("salbp1", out)
    known = [r for r in out if r["m_star"] is not None]
    match = sum(r["m"] == r["m_star"] for r in known)
    print(f"SALBP-1: {match}/{len(known)} match published m*, proven {sum(r['proven'] for r in out)}/{len(out)}")


# ------------------------------------------------------------------ SALBP-2 at m = 10

def eligible():
    return [k for k, g in graphs().items() if g.n >= 2 * M]


def _salbp2_job(name):
    inst = graphs()[name]
    t0 = time.time()
    res = solve_salbp2(inst, M, time_limit=60.0, workers=1)
    assert not check_assignment(inst, res["station"], res["c"])
    c_rpw, st_rpw = rpw_salbp2(inst, M)
    return {"graph": name, "n": inst.n, "tsum": inst.tsum, "c": res["c"], "lb": res["lb"],
            "proven": res["proven"], "station": res["station"], "c_rpw": c_rpw, "station_rpw": st_rpw,
            "c_lb": lb_cycle(inst, M), "secs": round(time.time() - t0, 2)}


def lambda_salbp2(item):
    return _salbp2_job(item["graph"])


def stage_salbp2():
    names = eligible()
    out = _resumable("salbp2", lambda_salbp2, [{"graph": n} for n in names], lambda r: r["graph"])
    pub = {(D._norm(r["graph"]), r["m"]): r for r in D.scholl_salbp2(D.DEFAULT_DIR)}
    for r in out:
        ref = pub.get((D._norm(r["graph"]), M))
        r["c_star_published"] = ref["c_star"] if ref else None
    save("salbp2", out)
    for r in out:
        print(f"{r['graph']:10s} n={r['n']:3d} c*={r['c']} lb={r['lb']} pub={r['c_star_published']} rpw={r['c_rpw']} {r['secs']}s")


# ------------------------------------------------------------------ Monte Carlo + robust

def _mc_job(r):
    inst = graphs()[r["graph"]]
    res = {"graph": r["graph"], "det": {}, "rpw": {}, "robust": {}}
    for cv in CVS:
        res["det"][str(cv)] = simulate(inst.times, r["station"], M, cv, 10_000, seed=11)
        res["rpw"][str(cv)] = simulate(inst.times, r["station_rpw"], M, cv, 10_000, seed=11)
    if inst.n <= 120:
        cap = int(math.floor(r["c"] * 1.03))
        for cv in ROBUST_CVS:
            rng = np.random.default_rng(1000 + int(cv * 100))
            train = sample_task_times(inst.times, cv, 60, rng)        # in-sample scenarios
            rob = solve_robust(inst, M, train, r["station"], c_cap=cap, time_limit=25.0, workers=1)
            st = rob["station"]
            assert not check_assignment(inst, st, cap)
            # out-of-sample evaluation on the same fresh 10k cycles for both plans
            ev_rob = simulate(inst.times, st, M, cv, 10_000, seed=99)
            ev_det = simulate(inst.times, r["station"], M, cv, 10_000, seed=99)
            res["robust"][str(cv)] = {"station": st, "proven": rob["proven"], "cap": cap,
                                      "eval": ev_rob, "eval_det": ev_det,
                                      "gain_pct": 100 * (ev_det["mean_cycle"] / ev_rob["mean_cycle"] - 1)}
    return res


def stage_mc():
    s2 = load("salbp2")
    out = _resumable("mc", _mc_job, s2, lambda r: r["graph"])
    save("mc", out)
    for r in out:
        d = r["det"]
        rb = {k: round(v["gain_pct"], 2) for k, v in r["robust"].items()}
        print(f"{r['graph']:10s} ratio cv.1={d['0.1']['throughput_ratio']:.3f} cv.3={d['0.3']['throughput_ratio']:.3f} robust gain {rb}")


# ------------------------------------------------------------------ hard-line predictor

def stage_ml():
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.inspection import permutation_importance
    from sklearn.model_selection import GroupKFold

    rows = []
    for inst, meta in D.otto_instances(D.DEFAULT_DIR):
        f = features(inst, inst.cycle)
        rows.append({"id": inst.name, **meta, **f, "gap": meta["m_star"] - f["lb1"],
                     "lb_rule": lb_stations(inst, inst.cycle) - f["lb1"]})
    feat = ["n", "order_strength", "t_over_c_mean", "t_over_c_max", "t_cv", "share_big_tasks",
            "share_third_tasks", "load_ratio", "lb1_slack", "tasks_per_station", "arcs_per_task",
            "max_degree", "share_sources", "share_sinks", "chain_depth_share"]
    X = np.array([[r[k] for k in feat] for r in rows], float)
    y = np.array([r["gap"] for r in rows], float)
    fam = [f"{r['structure']}|{r['os_target']}|{r['time_dist']}" for r in rows]
    fam_ids = {f: i for i, f in enumerate(sorted(set(fam)))}
    groups = np.array([fam_ids[f] for f in fam])

    oof = np.zeros_like(y)
    base = np.zeros_like(y)
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        mdl = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05,
                                        subsample=0.8, random_state=0)
        mdl.fit(X[tr], y[tr])
        oof[te] = mdl.predict(X[te])
        base[te] = y[tr].mean()
    mae = float(np.abs(oof - y).mean())
    mae_base = float(np.abs(base - y).mean())
    hit = float(((oof >= 0.5) == (y >= 1)).mean())
    hit_base = float(((base >= 0.5) == (y >= 1)).mean())
    rule = np.array([r["lb_rule"] for r in rows], float)     # hand rule: max(LB1, LB2) - LB1
    mae_rule = float(np.abs(rule - y).mean())
    hit_rule = float(((rule >= 0.5) == (y >= 1)).mean())

    final = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05,
                                      subsample=0.8, random_state=0).fit(X, y)
    pi = permutation_importance(final, X, y, n_repeats=10, random_state=0, n_jobs=1)
    imp = sorted(zip(feat, pi.importances_mean.tolist()), key=lambda t: -t[1])

    # out-of-distribution: the 269 classic instances (real industrial graphs, larger n)
    s1 = load("salbp1")
    ood = []
    for r in s1:
        if r["m_star"] is None:
            continue
        inst = D.match_graph(graphs(), r["graph"])
        f = features(inst, r["c"])
        p = float(final.predict(np.array([[f[k] for k in feat]]))[0])
        ood.append({"graph": r["graph"], "c": r["c"], "gap": r["m_star"] - f["lb1"], "pred": p})
    og = np.array([o["gap"] for o in ood], float)
    op = np.array([o["pred"] for o in ood], float)
    ml = {
        "n_instances": len(rows), "n_families": len(fam_ids), "features": feat,
        "target": "m* - ceil(sum t / c)",
        "gap_counts": {str(int(k)): int(v) for k, v in zip(*np.unique(y, return_counts=True))},
        "cv": {"mae": mae, "mae_mean_baseline": mae_base, "hit_rate": hit, "hit_rate_baseline": hit_base,
               "mae_lb2_rule": mae_rule, "hit_rate_lb2_rule": hit_rule},
        "importance": imp,
        "points": [{"id": r["id"], "gap": int(r["gap"]), "pred": float(p), "family": f}
                   for r, p, f in zip(rows, oof, fam)],
        "ood": {"n": len(ood), "mae": float(np.abs(op - og).mean()),
                "mae_mean_baseline": float(np.abs(y.mean() - og).mean()),
                "gap_counts": {str(int(k)): int(v) for k, v in zip(*np.unique(og, return_counts=True))},
                "points": ood},
    }
    save("ml", ml)
    import joblib
    joblib.dump({"model": final, "features": feat}, CACHE / "ml_model.joblib")   # for pipeline/rebalance.py
    print(f"ML: n={len(rows)} families={len(fam_ids)} MAE {mae:.3f} vs baseline {mae_base:.3f}; "
          f"gap>0 hit {hit:.3f} vs {hit_base:.3f}; LB2 rule MAE {mae_rule:.3f} hit {hit_rule:.3f}; OOD MAE {ml['ood']['mae']:.3f} vs {ml['ood']['mae_mean_baseline']:.3f}")
    print("importance:", [(k, round(v, 3)) for k, v in imp[:6]])


# ------------------------------------------------------------------ business case curve

FACTORS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0]


def _biz_job(r):
    inst = graphs()[r["graph"]]
    pts = []
    for f in FACTORS:
        c = max(max(inst.times), int(round(r["c"] * f)))
        res = solve_salbp1(inst, c, time_limit=4.0, workers=1)
        pts.append({"factor": f, "c": c, "takt_s": TAKT_S * c / r["c"], "m": res["m"], "lb": res["lb"],
                    "proven": res["proven"]})
    return {"graph": r["graph"], "points": pts}


def stage_biz():
    s2 = load("salbp2")
    out = _resumable("biz", _biz_job, s2, lambda r: r["graph"])
    save("biz", out)


# ------------------------------------------------------------------ export

def stage_export():
    G = graphs()
    s1, s2, mc, ml, biz = load("salbp1"), load("salbp2"), load("mc"), load("ml"), load("biz")
    mc_by = {r["graph"]: r for r in mc}
    biz_by = {r["graph"]: r for r in biz}
    lines = []
    for r in s2:
        inst = G[r["graph"]]
        loads = station_loads(inst, r["station"]) + [0] * (M - max(r["station"]))
        loads_rpw = station_loads(inst, r["station_rpw"]) + [0] * (M - max(r["station_rpw"]))
        lines.append({
            "graph": r["graph"], "n": inst.n, "tsum": inst.tsum, "order_strength": order_strength(inst),
            # Derived counts only: raw task times and precedence arcs are never shipped (no licence).
            "n_arcs": len(inst.arcs), "t_max": max(inst.times),
            "c": r["c"], "c_lb": r["c_lb"], "c_bound": r["lb"], "proven": r["proven"],
            "c_published": r["c_star_published"], "c_rpw": r["c_rpw"],
            "efficiency": inst.tsum / (M * r["c"]), "efficiency_rpw": inst.tsum / (M * r["c_rpw"]),
            "station": r["station"], "loads": loads, "station_rpw": r["station_rpw"], "loads_rpw": loads_rpw,
            "mc": mc_by[r["graph"]], "biz": biz_by[r["graph"]]["points"],
        })
    known = [r for r in s1 if r["m_star"] is not None]
    summary = {
        "assumptions": {"stations": M, "takt_s": TAKT_S, "hours_per_day": HOURS_PER_DAY,
                        "cv_grid": CVS, "robust_cvs": ROBUST_CVS, "mc_cycles": 10_000,
                        "robust_scenarios": 60, "robust_cap": 1.03},
        "salbp1": {
            "instances": len(s1), "with_published_optimum": len(known),
            "match": sum(r["m"] == r["m_star"] for r in known),
            "below_published": sum(r["m"] < r["m_star"] for r in known),
            "proven": sum(r["proven"] for r in s1),
            "rpw_extra_stations": sum(r["m_rpw"] - r["m"] for r in s1),
            "rpw_suboptimal": sum(r["m_rpw"] > r["m"] for r in s1),
            "rows": s1,
        },
        "ml": ml,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "lines.json").write_text(json.dumps(lines, separators=(",", ":")))
    (OUT / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))
    print("exported", len(lines), "lines")


STAGES = {"salbp1": stage_salbp1, "salbp2": stage_salbp2, "mc": stage_mc, "ml": stage_ml,
          "biz": stage_biz, "export": stage_export}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all")
    a = ap.parse_args()
    order = list(STAGES) if a.stage == "all" else a.stage.split(",")
    for s in order:
        t0 = time.time()
        STAGES[s]()
        print(f"[{s}] {time.time() - t0:.1f}s", flush=True)
