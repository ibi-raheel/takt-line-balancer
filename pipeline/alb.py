"""Assembly line balancing instances: parsing, precedence graph, bounds, features.

Formats:
  .IN2 (Scholl 1993): line 1 = n, next n lines = integer task times,
                      then "i,j" precedence pairs, optional "-1,-1" end mark.
  .alb (Otto et al. 2013): tagged sections <number of tasks>, <cycle time>,
                      <order strength>, <task times>, <precedence relations>, <end>.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx


@dataclass
class Instance:
    name: str
    times: list[int]                      # task times, index 0 = task 1
    arcs: list[tuple[int, int]]           # 1-based direct precedence pairs
    cycle: int | None = None              # given cycle time (SALBP-1), if any
    meta: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.times)

    @property
    def tsum(self) -> int:
        return sum(self.times)

    def graph(self) -> nx.DiGraph:
        g = nx.DiGraph()
        g.add_nodes_from(range(1, self.n + 1))
        g.add_edges_from(self.arcs)
        if not nx.is_directed_acyclic_graph(g):
            raise ValueError(f"{self.name}: precedence graph has a cycle")
        return g


def parse_in2(path: str | Path, name: str | None = None) -> Instance:
    lines = [ln.strip() for ln in Path(path).read_text(errors="replace").splitlines()]
    lines = [ln for ln in lines if ln]
    n = int(lines[0])
    times = [int(x) for x in lines[1:n + 1]]
    arcs = []
    for ln in lines[n + 1:]:
        a, b = (int(x) for x in ln.split(","))
        if a == -1 and b == -1:
            break
        arcs.append((a, b))
    return Instance(name or Path(path).stem, times, arcs)


def parse_alb(path: str | Path) -> Instance:
    sec, data = None, {}
    for raw in Path(path).read_text(errors="replace").splitlines():
        ln = raw.strip()
        if not ln:
            continue
        if ln.startswith("<") and ln.endswith(">"):
            sec = ln.strip("<>")
            data[sec] = []
            continue
        data[sec].append(ln)
    n = int(data["number of tasks"][0])
    times = [0] * n
    for ln in data["task times"]:
        i, t = ln.split()
        times[int(i) - 1] = int(t)
    arcs = [tuple(int(x) for x in ln.split(",")) for ln in data.get("precedence relations", [])]
    cycle = int(data["cycle time"][0])
    os_ = float(data["order strength"][0].replace(",", ".")) if "order strength" in data else None
    return Instance(Path(path).stem, times, arcs, cycle, {"order_strength_file": os_})


# ---------------------------------------------------------------- graph measures

def order_strength(inst: Instance) -> float:
    """OS = |transitive closure arcs| / (n(n-1)/2)  (Scholl 1999 definition)."""
    g = inst.graph()
    tc = nx.transitive_closure_dag(g)
    n = inst.n
    return tc.number_of_edges() / (n * (n - 1) / 2) if n > 1 else 0.0


def head_tail_times(inst: Instance) -> tuple[list[int], list[int]]:
    """For each task: own time + all (transitive) predecessors' times, and + successors'."""
    g = inst.graph()
    t = inst.times
    head, tail = [], []
    for v in range(1, inst.n + 1):
        head.append(t[v - 1] + sum(t[u - 1] for u in nx.ancestors(g, v)))
        tail.append(t[v - 1] + sum(t[u - 1] for u in nx.descendants(g, v)))
    return head, tail


def lb1_stations(inst: Instance, c: int) -> int:
    """Capacity bound: m >= ceil(sum t / c)."""
    return math.ceil(inst.tsum / c)


def lb2_stations(inst: Instance, c: int) -> int:
    """Counting bound (Johnson 1988): tasks > c/2 need their own station; tasks = c/2 pair up."""
    big = sum(1 for x in inst.times if x > c / 2)
    half = sum(1 for x in inst.times if x == c / 2)
    return big + math.ceil(half / 2)


def lb_stations(inst: Instance, c: int) -> int:
    return max(lb1_stations(inst, c), lb2_stations(inst, c))


def lb_cycle(inst: Instance, m: int) -> int:
    """SALBP-2 bound: c >= max(t_max, ceil(sum t / m))."""
    return max(max(inst.times), math.ceil(inst.tsum / m))


def station_window(inst: Instance, c: int, m_ub: int) -> list[tuple[int, int]]:
    """Earliest/latest feasible station (1-based) per task for cycle c and at most m_ub stations."""
    head, tail = head_tail_times(inst)
    return [(math.ceil(h / c), m_ub + 1 - math.ceil(tl / c)) for h, tl in zip(head, tail)]


def features(inst: Instance, c: int) -> dict:
    """Graph and time features for the hard-line predictor (all computable before solving)."""
    import numpy as np

    g = inst.graph()
    t = np.array(inst.times, dtype=float)
    n = inst.n
    indeg = np.array([g.in_degree(v) for v in g.nodes])
    outdeg = np.array([g.out_degree(v) for v in g.nodes])
    ratio = inst.tsum / c
    longest = nx.dag_longest_path_length(g) + 1 if g.number_of_edges() else 1
    return {
        "n": n,
        "order_strength": order_strength(inst),
        "t_over_c_mean": float(t.mean() / c),
        "t_over_c_max": float(t.max() / c),
        "t_cv": float(t.std() / t.mean()),
        "share_big_tasks": float((t > c / 2).mean()),
        "share_third_tasks": float((t > c / 3).mean()),
        "load_ratio": ratio,                         # sum t / c
        "lb1_slack": math.ceil(ratio) - ratio,       # idle capacity forced at LB1, in stations
        "lb1": math.ceil(ratio),
        "tasks_per_station": n / math.ceil(ratio),
        "arcs_per_task": g.number_of_edges() / n,
        "max_degree": int((indeg + outdeg).max()),
        "share_sources": float((indeg == 0).mean()),
        "share_sinks": float((outdeg == 0).mean()),
        "chain_depth_share": longest / n,
    }


def check_assignment(inst: Instance, station: list[int], c: int | None = None) -> list[str]:
    """Return a list of violations (empty = feasible). station[i] is the station of task i+1."""
    errs = []
    for a, b in inst.arcs:
        if station[a - 1] > station[b - 1]:
            errs.append(f"precedence {a}->{b}: station {station[a-1]} > {station[b-1]}")
    if c is not None:
        loads = station_loads(inst, station)
        for k, load in enumerate(loads, 1):
            if load > c:
                errs.append(f"station {k} load {load} > c {c}")
    return errs


def station_loads(inst: Instance, station: list[int]) -> list[int]:
    m = max(station)
    loads = [0] * m
    for i, s in enumerate(station):
        loads[s - 1] += inst.times[i]
    return loads
