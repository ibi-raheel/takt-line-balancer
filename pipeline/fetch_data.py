"""Download the public SALBP benchmark data into a folder of its own (not committed).

usage: python -I pipeline/fetch_data.py [DEST]   (default ~/Developer/job-hunt-builds/_downloads/salbp)

Sources (assembly-line-balancing.de, published for research use; no licence text stated):
  Scholl (1993) data sets incl. Talbot et al. (1986), Hoffmann (1990, 1992): SALBP-data-sets.zip
  Otto, Otto & Scholl (2013) SALBP-1 benchmark: SALBP_benchmark.zip
"""
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

BASE = "https://assembly-line-balancing.de/wp-content/uploads/2017/01/"
DEST = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get("SALBP_DATA", Path.home() / "Developer/job-hunt-builds/_downloads/salbp"))


def get(name: str) -> Path:
    DEST.mkdir(parents=True, exist_ok=True)
    out = DEST / name
    if not out.exists():
        print("downloading", name)
        urllib.request.urlretrieve(BASE + name, out)
    return out


def main():
    with zipfile.ZipFile(get("SALBP-data-sets.zip")) as z:
        z.extractall(DEST / "s1993")
    with zipfile.ZipFile(get("SALBP_benchmark.zip")) as z:
        z.extractall(DEST / "o2013")
    for sub, inner in [("n20", "small data set_n=20.zip"), ("n50", "medium data set_n=50.zip")]:
        with zipfile.ZipFile(DEST / "o2013" / inner) as z:
            z.extractall(DEST / "o2013" / sub)
    print("data in", DEST)


if __name__ == "__main__":
    main()
