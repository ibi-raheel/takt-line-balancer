"""Monte Carlo of a paced (synchronous, unbuffered) line under task-time variation.

Task i time per cycle: T_i ~ LogNormal with E[T_i] = t_i and CV = v (same v for every task):
    sigma^2 = ln(1 + v^2),   mu_i = ln(t_i) - sigma^2 / 2
Station k time:   S_k = sum_{i in k} T_i
Paced line: every station waits for the slowest, so the realised cycle is
    C = max_k S_k
and the line output rate is 1 / E[C].  At v = 0, C equals the deterministic bottleneck load.
"""
from __future__ import annotations

import numpy as np


def sample_task_times(times, cv: float, n_cycles: int, rng: np.random.Generator) -> np.ndarray:
    t = np.asarray(times, dtype=float)
    if cv <= 0:
        return np.broadcast_to(t, (n_cycles, t.size)).copy()
    s2 = np.log1p(cv * cv)
    mu = np.log(t) - s2 / 2
    return rng.lognormal(mean=mu, sigma=np.sqrt(s2), size=(n_cycles, t.size))


def station_matrix(station, m: int) -> np.ndarray:
    """(n, m) 0/1 matrix mapping tasks to stations."""
    A = np.zeros((len(station), m))
    A[np.arange(len(station)), np.asarray(station) - 1] = 1.0
    return A


def simulate(times, station, m: int, cv: float, n_cycles: int = 10_000, seed: int = 7,
             samples: np.ndarray | None = None) -> dict:
    rng = np.random.default_rng(seed)
    T = samples if samples is not None else sample_task_times(times, cv, n_cycles, rng)
    S = T @ station_matrix(station, m)            # (cycles, m)
    C = S.max(axis=1)
    block = np.bincount(S.argmax(axis=1), minlength=m) / len(C)
    det = float((np.asarray(times, float) @ station_matrix(station, m)).max())
    return {
        "det_cycle": det,
        "mean_cycle": float(C.mean()),
        "p50_cycle": float(np.percentile(C, 50)),
        "p95_cycle": float(np.percentile(C, 95)),
        "throughput_ratio": det / float(C.mean()),   # realised / planned output
        "block_share": block.tolist(),
        "hist": np.histogram(np.clip(C / det, 0.9, 1.8999), bins=40, range=(0.9, 1.9))[0].tolist(),
    }
