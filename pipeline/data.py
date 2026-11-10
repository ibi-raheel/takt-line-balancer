"""Load the downloaded benchmark files (see fetch_data.py). Raw files are never committed."""
from __future__ import annotations

import os
from pathlib import Path

from .alb import Instance, parse_alb, parse_in2

DEFAULT_DIR = Path(os.environ.get("SALBP_DATA", Path.home() / "Developer/job-hunt-builds/_downloads/salbp"))


def _norm(s: str) -> str:
    return s.strip().lower().replace("-", "").replace(" ", "")


def _xlsx_rows(path: Path, sheet: str):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    for r in wb[sheet].iter_rows(values_only=True):
        yield r


def scholl_graphs(data_dir: Path = DEFAULT_DIR) -> dict[str, Instance]:
    """25 precedence graphs keyed by the name used in the published tables."""
    xl = data_dir / "s1993" / "SALBP data sets.xlsx"
    gdir = data_dir / "s1993" / "precedence graphs"
    out, started = {}, False
    for r in _xlsx_rows(xl, "Precedence graphs"):
        if r[0] == "File name":
            started = True
            continue
        if started and r[0] and str(r[0]).upper().endswith(".IN2"):
            name = str(r[1]).strip()
            inst = parse_in2(gdir / str(r[0]).strip(), name)
            inst.meta["published"] = {"n": int(str(r[2]).strip()), "tsum": int(str(r[5]).strip()),
                                      "os_pct": float(str(r[6]).strip())}
            out[name] = inst
    return out


def scholl_salbp1(data_dir: Path = DEFAULT_DIR) -> list[dict]:
    """269 SALBP-1 instances: graph, c, published m* (None if still open) and bounds."""
    xl = data_dir / "s1993" / "SALBP data sets.xlsx"
    rows, started = [], False
    for r in _xlsx_rows(xl, "SALBP-1 data set"):
        if r[0] == "Precedence graph":
            started = True
            continue
        if started and r[0] and isinstance(r[1], (int, float)):
            m = r[2] if isinstance(r[2], (int, float)) else None
            rows.append({"graph": str(r[0]).strip(), "c": int(r[1]), "m_star": int(m) if m else None,
                         "m_text": str(r[2])})
    return rows


def scholl_salbp2(data_dir: Path = DEFAULT_DIR) -> list[dict]:
    xl = data_dir / "s1993" / "SALBP data sets.xlsx"
    rows, started = [], False
    for r in _xlsx_rows(xl, "SALBP-2 data sets"):
        if r[0] == "Precedence graph":
            started = True
            continue
        if started and r[0] and isinstance(r[1], (int, float)):
            c = r[2] if isinstance(r[2], (int, float)) else None
            rows.append({"graph": str(r[0]).strip(), "m": int(r[1]), "c_star": int(c) if c else None,
                         "c_text": str(r[2])})
    return rows


def match_graph(graphs: dict[str, Instance], name: str) -> Instance:
    key = _norm(name)
    for k, v in graphs.items():
        if _norm(k) == key:
            return v
    raise KeyError(name)


def otto_instances(data_dir: Path = DEFAULT_DIR) -> list[tuple[Instance, dict]]:
    """Otto, Otto & Scholl (2013) n=20 and n=50 SALBP-1 instances with published optima."""
    out = []
    specs = [("n20", "small data set_n=20", "Details of the small data set (n=20).xlsx", 1),
             ("n50", "medium data set_n=50", "Details of the medium data set (n=50 and n=50permuted).xlsx", 2)]
    for sub, folder, xlname, fcol in specs:
        hdr = None
        for r in _xlsx_rows(data_dir / "o2013" / xlname, "Summary"):
            if r and r[0] == "<No>":
                hdr = [str(h).strip() if h else "" for h in r]
                continue
            if hdr is None or not r or r[fcol] is None:
                continue
            rec = dict(zip(hdr, r))
            fname = str(rec["<Filename>"]).strip()
            path = data_dir / "o2013" / sub / folder / f"{fname}.alb"
            if not path.exists() or rec.get("<Optimum found? --> 1 for \"Yes\">") != 1:
                continue
            inst = parse_alb(path)
            meta = {"set": sub, "structure": rec["<Graph structure>"], "os_target": rec["<Desired OS>"],
                    "time_dist": rec["<Times distribution>"], "m_star": int(rec["<No of stations in optimum>"]),
                    "trickiness": rec["<Trickiness category>"]}
            out.append((inst, meta))
    return out
