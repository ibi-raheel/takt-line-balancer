"""The rebalance tool must reproduce the shipped results (public/data/lines.json) on real lines."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import data as D  # noqa: E402
from pipeline.rebalance import load_tasks, rebalance  # noqa: E402

GDIR = D.DEFAULT_DIR / "s1993" / "precedence graphs"
needs_data = pytest.mark.skipif(not (GDIR / "KILBRID.IN2").exists(), reason="run pipeline/fetch_data.py first")
LINES = {l["graph"]: l for l in json.loads((ROOT / "public" / "data" / "lines.json").read_text())}


@needs_data
def test_kilbridge_matches_shipped_results():
    ref = LINES["Kilbridge"]
    r = rebalance(load_tasks(GDIR / "KILBRID.IN2"), m=10, cv=0.20, takt_s=360, robust=False)
    assert r["plan"]["cycle"] == ref["c"] == 56
    assert r["heuristic"]["cycle"] == ref["c_rpw"] == 57
    assert r["plan"]["loads"] == ref["loads"] == [56, 55, 53, 55, 56, 56, 55, 54, 56, 56]
    kept = ref["mc"]["det"]["0.2"]["throughput_ratio"]
    assert r["rate"]["output_kept"] == pytest.approx(kept, abs=1e-9)
    assert round(kept, 3) == 0.847
    assert r["rate"]["units_day_planned"] == pytest.approx(160.0)
    # fix-first queue is the blocking share, highest first
    assert r["fix_first"][0]["station"] == 1 + max(range(10), key=lambda k: ref["mc"]["det"]["0.2"]["block_share"][k])


@needs_data
def test_mitchell_robust_decision():
    ref = LINES["Mitchell"]["mc"]["robust"]["0.2"]["gain_pct"]          # +7.10 %
    r = rebalance(load_tasks(GDIR / "MITCHELL.IN2"), m=10, cv=0.20, takt_s=360)
    assert r["robust"]["gain_pct"] == pytest.approx(ref, abs=0.5)        # CP-SAT runs on a time limit
    assert r["robust"]["decision"] == "ADOPT"
    assert [f["station"] for f in r["fix_first"][:3]] == [8, 3, 1]
