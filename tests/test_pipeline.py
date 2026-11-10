import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import data as D  # noqa: E402
from pipeline.alb import (Instance, check_assignment, lb1_stations, lb2_stations, lb_cycle,  # noqa: E402
                          order_strength, parse_in2, station_loads)
from pipeline.heuristic import positional_weights, rpw_salbp1  # noqa: E402
from pipeline.montecarlo import sample_task_times, simulate  # noqa: E402
from pipeline.solve import solve_robust, solve_salbp1, solve_salbp2  # noqa: E402

HAVE_DATA = (D.DEFAULT_DIR / "s1993" / "precedence graphs" / "JACKSON.IN2").exists()
needs_data = pytest.mark.skipif(not HAVE_DATA, reason="run pipeline/fetch_data.py first")

# The benchmark files are downloaded by pipeline/fetch_data.py and never committed, so the
# always-on hand calculations use TOY, an original 9-task line written for these tests.
# Jackson (1956, in Scholl 1993) is checked against its published values from the downloaded file.
TOY_T = [5, 3, 4, 6, 2, 4, 3, 5, 4]
TOY_ARCS = [(1, 2), (1, 3), (2, 4), (3, 5), (4, 6), (5, 6), (5, 7), (6, 8), (7, 8), (8, 9)]
TOY_PLAN = [1, 2, 1, 2, 3, 3, 3, 4, 4]          # S1 {1,3}  S2 {2,4}  S3 {5,6,7}  S4 {8,9}


@pytest.fixture
def toy():
    return Instance("Toy", TOY_T, TOY_ARCS)


@pytest.fixture
def jackson():
    if not HAVE_DATA:
        pytest.skip("run pipeline/fetch_data.py first")
    return parse_in2(D.DEFAULT_DIR / "s1993" / "precedence graphs" / "JACKSON.IN2", "Jackson")


# ---------------------------------------------------------------- hand calculation (toy line)

def test_toy_hand_bounds(toy):
    assert toy.tsum == 36
    assert lb1_stations(toy, 9) == 4               # ceil(36/9)
    assert lb2_stations(toy, 9) == 3               # tasks > 4.5: t1=5, t4=6, t8=5; none equal 4.5
    assert lb2_stations(toy, 8) == 3 + 2           # tasks > 4: three; tasks = 4: t3, t6, t9 -> ceil(3/2)


def test_toy_hand_balance_matches_solver(toy):
    # hand-built: S1 {1,3} = 9, S2 {2,4} = 9, S3 {5,6,7} = 9, S4 {8,9} = 9 -> meets LB1, so optimal
    assert check_assignment(toy, TOY_PLAN, 9) == []
    assert station_loads(toy, TOY_PLAN) == [9, 9, 9, 9]
    res = solve_salbp1(toy, 9, time_limit=5)
    assert res["m"] == 4 and res["proven"]
    assert check_assignment(toy, res["station"], 9) == []


@pytest.mark.parametrize("c,m_star", [(9, 4), (12, 3), (18, 2)])
def test_toy_optima_meet_capacity_bound(toy, c, m_star):
    res = solve_salbp1(toy, c, time_limit=5)
    assert res["m"] == m_star == lb1_stations(toy, c)


def test_order_strength_toy(toy):
    # transitive closure: 1 precedes 8 tasks, 2 -> 4, 3 -> 5, 4 -> 3, 5 -> 4, 6 -> 2, 7 -> 2, 8 -> 1 = 29 pairs of 36
    assert order_strength(toy) == pytest.approx(29 / 36)


def test_positional_weight_hand(toy):
    pw = positional_weights(toy)
    assert pw[0] == 36                             # task 1 precedes every other task
    assert pw[1] == 3 + 6 + 4 + 5 + 4              # 2 -> 4 -> 6 -> 8 -> 9
    assert pw[8] == 4


def test_rpw_feasible(toy):
    st = rpw_salbp1(toy, 10)
    assert check_assignment(toy, st, 10) == []
    assert max(st) >= 4


def test_salbp2_small(toy):
    res = solve_salbp2(toy, 4, time_limit=5)
    assert res["c"] == 9 == lb_cycle(toy, 4)       # the hand plan meets ceil(36/4)
    assert solve_salbp2(toy, 3, time_limit=5)["c"] == 12


# ---------------------------------------------------------------- Monte Carlo

def test_mc_cv_zero_reproduces_deterministic(toy):
    r = simulate(toy.times, TOY_PLAN, 4, 0.0, 1000)
    assert r["mean_cycle"] == r["det_cycle"] == 9
    assert r["throughput_ratio"] == 1.0


def test_lognormal_mean_and_cv():
    rng = np.random.default_rng(0)
    T = sample_task_times([10.0, 40.0], 0.2, 200_000, rng)
    assert T.mean(axis=0) == pytest.approx([10, 40], rel=0.005)
    assert (T.std(axis=0) / T.mean(axis=0)) == pytest.approx([0.2, 0.2], rel=0.02)


def test_mc_variation_lowers_throughput(toy):
    r = simulate(toy.times, TOY_PLAN, 4, 0.2, 20_000)
    assert r["throughput_ratio"] < 1.0
    assert sum(r["block_share"]) == pytest.approx(1.0)


def test_robust_cv_zero_keeps_optimum(toy):
    sc = sample_task_times(toy.times, 0.0, 5, np.random.default_rng(0))
    res = solve_robust(toy, 4, sc, TOY_PLAN, c_cap=9, time_limit=5)
    assert max(station_loads(toy, res["station"])) == 9


# ---------------------------------------------------------------- Jackson, from the downloaded file

def test_jackson_hand_bounds(jackson):
    assert jackson.n == 11 and jackson.tsum == 46
    assert lb1_stations(jackson, 10) == 5          # ceil(46/10)
    assert lb2_stations(jackson, 10) == 3 + 2      # three tasks above c/2, three at c/2 pair up


def test_jackson_hand_balance_matches_solver(jackson):
    # hand-built: S1 {1,2,6} = 10, S2 {5,8} = 7, S3 {3,10} = 10, S4 {4,7} = 10, S5 {9,11} = 9
    hand = [1, 1, 3, 4, 2, 1, 4, 2, 5, 3, 5]
    assert check_assignment(jackson, hand, 10) == []
    assert station_loads(jackson, hand) == [10, 7, 10, 10, 9]
    res = solve_salbp1(jackson, 10, time_limit=5)
    assert res["m"] == 5 and res["proven"]


@pytest.mark.parametrize("c,m_star", [(7, 8), (9, 6), (10, 5), (13, 4), (14, 4), (21, 3)])
def test_jackson_published_optima(jackson, c, m_star):
    res = solve_salbp1(jackson, c, time_limit=5)
    assert res["m"] == m_star
    assert check_assignment(jackson, res["station"], c) == []


def test_order_strength_jackson(jackson):
    assert order_strength(jackson) == pytest.approx(0.5818, abs=1e-4)   # published 58.18 %


def test_positional_weight_jackson(jackson):
    pw = positional_weights(jackson)
    assert pw[0] == 46                             # task 1 precedes every other task
    assert pw[1] == 19
    assert pw[10] == 4


# ---------------------------------------------------------------- real benchmark files

@needs_data
def test_parse_matches_published_table():
    G = D.scholl_graphs()
    assert len(G) == 25
    for name, g in G.items():
        assert g.n == g.meta["published"]["n"], name
        assert g.tsum == g.meta["published"]["tsum"], name
        g.graph()   # acyclic


@needs_data
def test_order_strength_matches_published():
    for name, g in D.scholl_graphs().items():
        if g.n <= 120:
            assert 100 * order_strength(g) == pytest.approx(g.meta["published"]["os_pct"], abs=0.02), name


CACHE = ROOT / "cache" / "salbp1.json"


@pytest.mark.skipif(not CACHE.exists(), reason="pipeline not run")
def test_all_salbp1_match_published():
    rows = json.loads(CACHE.read_text())
    assert len(rows) == 269
    for r in rows:
        if r["m_star"] is not None:
            assert r["m"] >= r["lb"]
            assert r["m"] >= r["m_star"], r           # never beats a published optimum
            assert r["lb"] <= r["m_star"], r          # our bound never exceeds it
            if r["proven"]:
                assert r["m"] == r["m_star"], r


@pytest.mark.skipif(not (ROOT / "cache" / "salbp2.json").exists(), reason="pipeline not run")
def test_salbp2_matches_published_at_m10():
    rows = json.loads((ROOT / "cache" / "salbp2.json").read_text())
    for r in rows:
        if r["c_star_published"] is not None and r["proven"]:
            assert r["c"] == r["c_star_published"], r
        assert r["c"] <= r["c_rpw"]
