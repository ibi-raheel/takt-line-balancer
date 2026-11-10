"""Exact SALBP-1 / SALBP-2 models and a sample-average robust re-balance in OR-Tools CP-SAT.

Decision variables: x[i,k] = 1 if task i is assigned to station k, only for k inside the
task's feasible window [E_i, L_i] (derived from head/tail times), which shrinks the model.

  assignment:  sum_k x[i,k] = 1                                   for every task i
  capacity:    sum_i t_i x[i,k] <= c                               for every station k
  precedence:  s_i <= s_j,  s_i = sum_k k x[i,k]                   for every arc (i, j)

SALBP-1: c given, minimise the number of used stations m (m >= s_i for all i).
SALBP-2: m given, minimise c.
Robust:  m given, scenarios t_i^(s) of task times; minimise (1/S) sum_s max_k load_k^(s),
         i.e. the sample average of the bottleneck station time on a paced line.
"""
from __future__ import annotations

import math
import time

import numpy as np
from ortools.sat.python import cp_model

from .alb import Instance, head_tail_times, lb_cycle, lb_stations
from .heuristic import hoffmann_salbp1, rpw_salbp1, rpw_salbp2


def _windows_c(inst: Instance, c: int, m_ub: int):
    head, tail = head_tail_times(inst)
    return [(max(1, math.ceil(h / c)), min(m_ub, m_ub + 1 - math.ceil(tl / c))) for h, tl in zip(head, tail)]


def _base_model(inst: Instance, windows):
    mdl = cp_model.CpModel()
    x, s = {}, []
    for i, (e, l) in enumerate(windows):
        if e > l:
            return None, None, None
        vars_i = []
        for k in range(e, l + 1):
            x[i, k] = mdl.NewBoolVar(f"x{i}_{k}")
            vars_i.append((k, x[i, k]))
        mdl.AddExactlyOne(v for _, v in vars_i)
        si = mdl.NewIntVar(e, l, f"s{i}")
        mdl.Add(si == sum(k * v for k, v in vars_i))
        s.append(si)
    for a, b in inst.arcs:
        mdl.Add(s[a - 1] <= s[b - 1])
    return mdl, x, s


def _solver(time_limit: float, workers: int, seed: int = 0):
    sv = cp_model.CpSolver()
    sv.parameters.max_time_in_seconds = time_limit
    sv.parameters.num_search_workers = workers
    sv.parameters.random_seed = seed
    return sv


def feasible_assignment(inst: Instance, c: int, m: int, time_limit: float, workers: int = 1,
                        hint: list[int] | None = None):
    """Is there an assignment to at most m stations with cycle c?  Windows use m and c, so
    they are as tight as possible.  Returns ("feasible", station) | ("infeasible", None) |
    ("unknown", None)."""
    windows = _windows_c(inst, c, m)
    if any(e > l for e, l in windows):
        return "infeasible", None
    mdl, x, s = _base_model(inst, windows)
    for k in range(1, m + 1):
        terms = [inst.times[i] * x[i, k] for i in range(inst.n) if (i, k) in x]
        if terms:
            mdl.Add(sum(terms) <= c)
    if hint:
        for i, si in enumerate(s):
            if windows[i][0] <= hint[i] <= windows[i][1]:
                mdl.AddHint(si, hint[i])
    sv = _solver(time_limit, workers)
    st = sv.Solve(mdl)
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return "feasible", [int(sv.Value(si)) for si in s]
    if st == cp_model.INFEASIBLE:
        return "infeasible", None
    return "unknown", None


def solve_salbp1(inst: Instance, c: int, time_limit: float = 10.0, workers: int = 1) -> dict:
    """Minimum number of stations for cycle time c.

    LB = max(LB1, LB2); UB = best of RPW and Hoffmann (forward/backward).  If LB < UB, a
    CP-SAT feasibility check at m = UB - 1, UB - 2, ... (windows tightened for each m) improves
    the solution until a check is infeasible (proves optimality) or time runs out.
    """
    t_end = time.time() + time_limit
    cands = [rpw_salbp1(inst, c), hoffmann_salbp1(inst, c)]
    best = min(cands, key=max)
    best_m = max(best)
    proven_lb = lb_stations(inst, c)
    source = "rpw" if best is cands[0] else "hoffmann"
    while proven_lb < best_m:
        left = t_end - time.time()
        if left <= 0.05:
            break
        status, st = feasible_assignment(inst, c, best_m - 1, left, workers, best)
        if status == "feasible":
            best, best_m, source = st, max(st), "cp-sat"
        elif status == "infeasible":
            proven_lb = best_m
        else:
            break
    return {"m": best_m, "lb": min(proven_lb, best_m), "proven": proven_lb >= best_m,
            "station": best, "source": source}


def solve_salbp2(inst: Instance, m: int, time_limit: float = 20.0, workers: int = 1) -> dict:
    """Minimum cycle time for exactly m stations (empty stations allowed)."""
    c_ub, st_ub = rpw_salbp2(inst, m)
    c_lb = lb_cycle(inst, m)
    if c_lb == c_ub:
        return {"c": c_ub, "lb": c_lb, "proven": True, "station": st_ub, "source": "heuristic=bound",
                "c_rpw": c_ub}
    status, st = feasible_assignment(inst, c_lb, m, time_limit / 3, workers, st_ub)
    if status == "feasible":
        return {"c": c_lb, "lb": c_lb, "proven": True, "station": st, "source": "cp-sat (c = LB)",
                "c_rpw": c_ub}
    if status == "infeasible":
        c_lb += 1
    windows = _windows_c(inst, c_ub, m)          # windows valid for every c <= c_ub
    mdl, x, s = _base_model(inst, windows)
    c = mdl.NewIntVar(c_lb, c_ub, "c")
    for k in range(1, m + 1):
        terms = [inst.times[i] * x[i, k] for i in range(inst.n) if (i, k) in x]
        if terms:
            mdl.Add(sum(terms) <= c)
    for i, si in enumerate(s):
        mdl.AddHint(si, st_ub[i])
    mdl.Minimize(c)
    sv = _solver(time_limit, workers)
    status = sv.Solve(mdl)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"c": c_ub, "lb": c_lb, "proven": False, "station": st_ub, "source": "heuristic", "c_rpw": c_ub}
    station = [int(sv.Value(si)) for si in s]
    cval = int(sv.Value(c))
    bound = max(c_lb, int(math.ceil(sv.BestObjectiveBound() - 1e-9)))
    return {"c": cval, "lb": bound, "proven": status == cp_model.OPTIMAL or bound == cval,
            "station": station, "source": "cp-sat", "c_rpw": c_ub, "wall_s": sv.WallTime()}


def solve_robust(inst: Instance, m: int, scenarios: np.ndarray, hint: list[int],
                 c_cap: int | None = None, time_limit: float = 30.0, workers: int = 1,
                 scale: float = 10.0) -> dict:
    """Minimise the sample-average bottleneck time over scenario task times.

    scenarios: array (S, n) of task times. Times are scaled and rounded to integers for CP-SAT.
    c_cap: optional cap on the deterministic (mean-time) station load, keeps the robust plan
           comparable to the deterministic one when variation vanishes.
    """
    S = scenarios.shape[0]
    cap = c_cap if c_cap is not None else int(math.ceil(inst.tsum))
    windows = _windows_c(inst, max(cap, max(inst.times)), m)
    mdl, x, s = _base_model(inst, windows)
    T = np.rint(scenarios * scale).astype(int)
    zmax = int(T.sum(axis=1).max())
    z = [mdl.NewIntVar(0, zmax, f"z{j}") for j in range(S)]
    loads = {}
    for k in range(1, m + 1):
        idx = [i for i in range(inst.n) if (i, k) in x]
        if not idx:
            continue
        mdl.Add(sum(inst.times[i] * x[i, k] for i in idx) <= cap)
        for j in range(S):
            mdl.Add(z[j] >= sum(int(T[j, i]) * x[i, k] for i in idx))
    for i, si in enumerate(s):
        mdl.AddHint(si, hint[i])
    mdl.Minimize(sum(z))
    sv = _solver(time_limit, workers)
    status = sv.Solve(mdl)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"station": hint, "proven": False, "source": "hint"}
    return {"station": [int(sv.Value(si)) for si in s], "proven": status == cp_model.OPTIMAL,
            "objective": sv.ObjectiveValue() / (S * scale), "bound": sv.BestObjectiveBound() / (S * scale),
            "source": "cp-sat", "wall_s": sv.WallTime()}
