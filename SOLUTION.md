# Solution: the 10-station rebalance recipe

**Research question.** When a product change forces a rebalance of a paced 10-station line, what is the best balance, and how much of the planned output survives once task times vary?

**Measured answer.** An exact solver beat the textbook heuristic on 15 of 20 published benchmark lines, by up to 3.9% on cycle time. Even the exact plan kept a median 87% of its output at 20% task-time variation (about 140 of 160 units a day). A variation-aware rebalance won back up to 7%, but only on 6 of 17 lines (4 by more than 0.5%), so it has to pass a test on unseen cycles before anyone moves a fixture.

All numbers come from `public/data/lines.json` and `summary.json`; how they are produced and validated is in [METHOD.md](METHOD.md). The data is the public Scholl (1993) and Otto et al. (2013) benchmark, not any company's line.

## The recipe

| # | Step | Why (measured) |
|---|------|----------------|
| 1 | **Solve it exactly.** Don't stop at the heuristic. | Ranked positional weight had a longer cycle on 15 of 20 lines at 10 stations (median +1.6% across all 20, worst +3.9%), and needed extra stations on 102 of 269 SALBP-1 instances. |
| 2 | **Quote the realistic rate, not the planned one.** Run the plan through 10,000 cycles with your time-study spread and put "output kept" into the capital case. | At 20% CV the median line kept 87% of planned output (range 80.9% to 92.8% across 20 lines). |
| 3 | **Fix the station that sets the pace most often.** | The blocking share ranks stations. Example: Mitchell at 20% CV, station 8 sets the pace in 24% of cycles, station 3 in 21%, station 1 in 20%. |
| 4 | **Rebalance for variation only if it wins on cycles it never saw.** | Out of sample at 20% CV it was better on 6 of 17 lines (up to +7.1%; 4 by more than 0.5%), worse on 6 (worst -0.5%), equal on 5. |
| 5 | **Pre-gate check (optional).** Before the time study, score the new variant's task list for "will need more stations than sum of times / takt". | Right 94.5% of the time on generator families the model never saw (85.5% for the counting rule, 62.9% for the mean). Trust the flag only on graphs inside the 20 to 50-task training range: on the larger classic graphs the error rises to 1.05 stations. |

## Decision rules

| Question | Rule | Threshold from the results |
|----------|------|----------------------------|
| Is the current (heuristic) balance good enough? | Rebalance if the exact cycle is shorter. | Any gap > 0; it was there on 15 of 20 lines, median +1.6% across all 20, worst +3.9%. |
| What rate goes into the capital case? | Planned units/day x output kept at the measured CV. | 87% at 20% CV is the benchmark median; use the line's own number. |
| Which station first? | Highest blocking share at the measured CV. | The top station: 24% of cycles on Mitchell; 19% on Kilbridge (station 4). |
| Adopt the variation-aware plan? | ADOPT only if its out-of-sample gain is > 0.5%; else KEEP the exact plan. | The gain is +7.1% at best and negative on 6 of 17 lines, so it is never assumed. Gains under 0.5% can flip sign between runs because CP-SAT stops on a time limit: Kilbridge scored +0.18% in the shipped run and -0.04% in the example below. |
| Will the next variant need an extra station? | Model flag if predicted extra stations >= 0.5. | Trust the flag on graphs inside the 20 to 50-task training range; above that, solve. |

## The tool

```bash
python -I pipeline/rebalance.py tasks.IN2 --stations 10 --cv 0.20 [--takt-s 360] [--hours 16] \
    [--target-takt C] [--no-robust] [--json out.json]
```

- **Input:** a task list in the benchmark's `.IN2` format: line 1 = number of tasks, then one task time per line, then `i,j` precedence pairs (optional `-1,-1` end mark). `.alb` also works. A time-study export with task times in seconds maps straight onto it.
- **Output** (short table, full detail with `--json`):
  - **plan:** minimum cycle for the given stations, proven flag and bound, station per task, station loads, efficiency.
  - **heuristic:** ranked positional weight cycle and the % it leaves on the table.
  - **realistic rate:** output kept, p95 cycle, units/day planned vs expected.
  - **fix first:** stations ranked by blocking share, with their tasks.
  - **robust:** `ADOPT variation-aware plan (+x% on unseen cycles)` or `KEEP exact plan`.
  - **stations for takt** (with `--target-takt`): exact station count vs the sum/takt rule, plus the hard-line flag.
- Without `--takt-s`, task times are read as seconds and the takt is the exact cycle. With it, the exact cycle is scaled to that takt, as the pipeline does for the 6-minute assumption.
- It is a thin wrapper: every step calls the existing pipeline (`solve.py`, `montecarlo.py`, `alb.py`) with the same settings and seeds as `run_all.py`, so on a benchmark line it reproduces the shipped results. `tests/test_rebalance.py` checks Kilbridge (cycle 56 vs 57, loads, 84.7% kept) and Mitchell (+7.10% robust gain, ADOPT, fix-first 8, 3, 1).
- The hard-line flag needs `cache/ml_model.joblib`, written by `python -I pipeline/run_all.py --stage ml`.

Example on a 45-task benchmark line (`python -I pipeline/rebalance.py KILBRID.IN2 --stations 10 --cv 0.20 --takt-s 360`):

```
KILBRID: 45 tasks, 10 stations, task-time CV 20%
  exact plan      cycle 56 (proven), efficiency 98.6%
  station loads   [56, 55, 53, 55, 56, 56, 55, 54, 56, 56]
  heuristic       cycle 57 (+1.79% left on the table)
  realistic rate  keeps 84.7% of output, p95 cycle 497 s -> 160 planned vs 135 expected units/day
  fix first       S4 19%, S5 17%, S6 10%  (share of cycles each station sets the pace)
  robust          KEEP exact plan (variation-aware -0.04% on unseen cycles)
```

## Week 1 on a real line

So far this runs on public benchmark lines. On a real line, week 1 would be:

| Day | Work |
|-----|------|
| 1 | Take one 10-station line. Turn its routing and standard work into the input: tasks, precedence, mean time per task. Pull the time-study spread per task. Check that the tool reproduces the line's current balance and cycle. |
| 2 | Run the exact rebalance against today's balance. Sit with the line's process engineer and add the constraints the model ignores (zoning, fixtures and tooling, ergonomics) as fixed or forbidden station assignments. |
| 3 | Replace the assumed 20% CV with measured per-task variation. Run the realistic-rate check and validate it against the line's real hourly output log. This is the test that decides whether to trust it. |
| 4 | Produce the fix-first station queue. Run the variation-aware plan, scored only on held-out cycles. Run the hard-line check on the next variant's draft task list ahead of its phase-gate. |
| 5 | Hand over this recipe filled in for that line: the recommended balance, units/day planned vs expected for the capital case, the station to fix first, and adopt/keep on the robust plan. Review with the team. |

## Caveats

- Task-time variation is one assumed CV for every task, independent. Per-task CVs from time studies are the first extension (`sample_task_times` takes one scalar today).
- The line is paced with no buffers: the worst case. Buffers would recover part of the loss.
- 160 units/day comes from a 6-minute takt and 16 h/day, both assumptions.
- No zoning, tooling, ergonomic or walking constraints in the balancing model.
