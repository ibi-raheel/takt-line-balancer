"""Ranked positional weight (Helgeson & Birnie 1961) baseline.

Positional weight PW_i = t_i + sum of times of all (transitive) successors of i.
Station-oriented: open a station, repeatedly add the available task (all predecessors
assigned, fits in remaining time) with the highest PW; when none fits, open the next station.
"""
from __future__ import annotations

import networkx as nx

from .alb import Instance, lb_cycle


def positional_weights(inst: Instance) -> list[int]:
    g = inst.graph()
    t = inst.times
    return [t[v - 1] + sum(t[u - 1] for u in nx.descendants(g, v)) for v in range(1, inst.n + 1)]


def rpw_salbp1(inst: Instance, c: int) -> list[int]:
    """Return station (1-based) per task for cycle time c."""
    if max(inst.times) > c:
        raise ValueError("cycle time below largest task time")
    g = inst.graph()
    pw = positional_weights(inst)
    station = [0] * inst.n
    npred = {v: g.in_degree(v) for v in g.nodes}
    avail = {v for v in g.nodes if npred[v] == 0}
    k, rem, done = 1, c, 0
    while done < inst.n:
        fit = [v for v in avail if inst.times[v - 1] <= rem]
        if not fit:
            k, rem = k + 1, c
            continue
        v = max(fit, key=lambda u: (pw[u - 1], inst.times[u - 1], -u))
        station[v - 1] = k
        rem -= inst.times[v - 1]
        avail.remove(v)
        done += 1
        for w in g.successors(v):
            npred[w] -= 1
            if npred[w] == 0:
                avail.add(w)
    return station


def rpw_salbp2(inst: Instance, m: int) -> tuple[int, list[int]]:
    """Smallest c for which RPW needs <= m stations (search upward from the lower bound)."""
    c = lb_cycle(inst, m)
    while True:
        st = rpw_salbp1(inst, c)
        if max(st) <= m:
            return c, st
        c += 1


# ---------------------------------------------------------------------------------------
# Hoffmann (1963) maximum-load station filling, forward and backward.
# Each station is filled with the feasible task subset of largest total time, found by a
# depth-first enumeration in increasing task label (labels are topological, so any subset
# taken in label order respects precedence).  A node limit keeps it bounded.

def _relabel_topological(inst: Instance):
    g = inst.graph()
    order = list(nx.lexicographical_topological_sort(g))
    return order


def _hoffmann_pass(n, times, succ, npred0, c, node_limit):
    npred = dict(npred0)
    assigned = [0] * (n + 1)
    avail = {v for v in range(1, n + 1) if npred[v] == 0}
    k = 0
    left = n
    while left:
        k += 1
        best = [0, []]
        nodes = [0]

        def rec(av, rem, chosen, load, last):
            nodes[0] += 1
            if load > best[0]:
                best[0], best[1] = load, list(chosen)
            if rem == 0 or nodes[0] > node_limit:
                return
            for v in sorted(av):
                if v <= last or times[v] > rem:
                    continue
                newly = []
                for w in succ[v]:
                    npred[w] -= 1
                    if npred[w] == 0:
                        newly.append(w)
                chosen.append(v)
                rec((av - {v}) | set(newly), rem - times[v], chosen, load + times[v], v)
                chosen.pop()
                for w in succ[v]:
                    npred[w] += 1
                if best[0] == c or nodes[0] > node_limit:
                    return

        rec(avail, c, [], 0, 0)
        for v in best[1]:
            assigned[v] = k
            avail.discard(v)
            left -= 1
            for w in succ[v]:
                npred[w] -= 1
                if npred[w] == 0:
                    avail.add(w)
    return assigned[1:]


def hoffmann_salbp1(inst: Instance, c: int, node_limit: int = 3000) -> list[int]:
    """Best of forward and backward Hoffmann passes; returns station per task (1-based)."""
    if max(inst.times) > c:
        raise ValueError("cycle time below largest task time")
    g = inst.graph()
    order = _relabel_topological(inst)            # position -> original task
    pos = {v: i + 1 for i, v in enumerate(order)}
    n = inst.n
    best = None
    for direction in ("fwd", "bwd"):
        h = g if direction == "fwd" else g.reverse(copy=True)
        topo = order if direction == "fwd" else order[::-1]
        lab = {v: i + 1 for i, v in enumerate(topo)}
        times = {lab[v]: inst.times[v - 1] for v in g.nodes}
        succ = {lab[v]: [lab[w] for w in h.successors(v)] for v in g.nodes}
        npred = {lab[v]: h.in_degree(v) for v in g.nodes}
        st_lab = _hoffmann_pass(n, times, succ, npred, c, node_limit)
        m = max(st_lab)
        st = [0] * n
        for v in g.nodes:
            s = st_lab[lab[v] - 1]
            st[v - 1] = s if direction == "fwd" else m + 1 - s
        if best is None or max(st) < max(best):
            best = st
    del pos
    return best
