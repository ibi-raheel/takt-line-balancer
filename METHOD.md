# Method

How the pipeline balances a paced 10-station assembly line, checks itself against published
optima, stress-tests the plan under task-time variation, and predicts which lines will be hard.
Every number below is produced by `pipeline/run_all.py` and stored in `public/data/*.json`, which holds derived results only; the benchmark files themselves are downloaded by `pipeline/fetch_data.py` and never committed.

## Research question

When a product change forces a rebalance of a paced 10-station line, what is the best balance, and how much of the planned output survives once task times vary?

Measured answer (sections 5 and 6): an exact solve beat the ranked-positional-weight heuristic on 15 of 20 lines (median +1.56% cycle across all 20, worst +3.87%); at a 20% task-time CV the exact plan kept a median 87% of planned output; a variation-aware rebalance helped out of sample on 6 of 17 lines (up to +7.1%) and hurt on 6. The decision recipe built on these results is in [SOLUTION.md](SOLUTION.md).

## 1. Data

| Set | Content | Use |
|-----|---------|-----|
| Scholl (1993) benchmark, incl. Talbot, Patterson & Gehrlein (1986) and Hoffmann (1990, 1992) | 25 precedence graphs from real products (7 to 297 tasks), 269 SALBP-1 instances, 302 SALBP-2 instances, published optima | Balancing, validation |
| Otto, Otto & Scholl (2013) SALBP-1 benchmark, n = 20 and n = 50 | 1,050 generated instances; 855 with a published, proven optimum | Training the hard-line predictor |

Source: <https://assembly-line-balancing.de> (published for research use; no licence text is stated).
Raw files are not redistributed: `pipeline/fetch_data.py` downloads them into a separate folder.

Time units in the benchmarks are abstract. To talk in units per day, the exact 10-station
cycle of each line is scaled to a **6-minute takt** and the line runs **16 h/day** (2 x 8 h).
Both are labelled assumptions, not data.

## 2. Model

Tasks `i = 1..n` with times `t_i`, direct precedence arcs `(i, j)`, stations `k = 1..m`,
cycle time `c`. Binary `x_ik = 1` if task `i` is done at station `k`; station index `s_i = sum_k k x_ik`.

```
sum_k x_ik = 1                       every task assigned once
sum_i t_i x_ik <= c                  station load within the cycle
s_i <= s_j                           for every arc (i, j)
```

- **SALBP-1**: `c` given, minimise the number of stations `m`.
- **SALBP-2**: `m = 10` given, minimise `c`.

Station windows shrink the model. With head time `H_i = t_i + sum of all predecessors` and tail
time `T_i = t_i + sum of all successors`, task `i` can only sit in stations
`E_i = ceil(H_i / c) .. L_i = m + 1 - ceil(T_i / c)`. Variables outside the window are never created.

Bounds:

```
LB1 = ceil(sum t / c)                                 (capacity)
LB2 = #{t_i > c/2} + ceil(#{t_i = c/2} / 2)           (counting; Johnson 1988)
c_LB(m) = max(t_max, ceil(sum t / m))                 (SALBP-2)
```

Solution procedure:

1. Upper bound from the better of two heuristics: ranked positional weight (Helgeson & Birnie
   1961; `PW_i = t_i + sum of successors`, fill each station by highest PW) and Hoffmann (1963)
   maximum-load filling (each station gets the feasible subset with the largest total time,
   found by depth-first enumeration in topological label order, node limit 3,000), forward and backward.
2. If `LB < UB`: OR-Tools CP-SAT feasibility checks at `m = UB - 1, UB - 2, ...` with windows
   tightened for that `m`. "Infeasible" proves the current `UB` optimal. Budget 6 s per instance, 1 thread.
3. SALBP-2: first a feasibility check at `c = c_LB`; if that fails, CP-SAT minimises `c`
   seeded with the RPW plan. Budget 60 s per line.

## 3. Variation stress test

The benchmarks give one time per task. Real station times vary; how much is not in any public
dataset, so the coefficient of variation `v` is a **user assumption**, swept from 0 to 0.30.

```
T_i ~ LogNormal,  sigma^2 = ln(1 + v^2),  mu_i = ln t_i - sigma^2 / 2    =>  E[T_i] = t_i, CV = v
S_k = sum_{i in k} T_i                     station time in one cycle
C   = max_k S_k                            paced, unbuffered line: everyone waits for the slowest
output kept = c_plan / E[C]
```

10,000 simulated cycles per line and CV. The station that sets `C` is counted to give the
blocking share per station.

**Robust re-balance.** Sample-average approximation: draw 60 scenarios of task times, minimise
`(1/60) sum_s max_k S_k^(s)` in CP-SAT, with the mean-time station load capped at 1.03 x the
deterministic optimum (25 s budget, lines up to 120 tasks). Both plans are then scored on the same
fresh 10,000 cycles that the optimiser never saw.

## 4. Hard-line predictor

Target: `gap = m* - LB1`, the stations a line needs beyond the capacity bound. A line with
`gap > 0` cannot be balanced at the "sum of times / takt" headcount, and planners find out late.

Features (computable from a task list before any balancing): number of tasks, order strength
`OS = |transitive closure| / (n(n-1)/2)`, mean and max `t/c`, task-time CV, share of tasks above
`c/2` and `c/3`, load ratio `sum t / c`, LB1 slack `ceil(sum t/c) - sum t/c`, tasks per station,
arcs per task, max degree, source and sink shares, longest chain / n.

Model: scikit-learn gradient boosting (300 trees, depth 3, learning rate 0.05, subsample 0.8).
Scored with 5-fold **grouped** cross-validation, where a group is a generator family
(graph structure x order strength x time distribution, 21 families), so the model is always
tested on families it never saw. Baselines: predicting the training-fold mean, and the hand
rule `max(LB1, LB2) - LB1`. A final model trained on all 855 instances is also scored on the 268
classic instances (larger, real-product graphs) as an out-of-distribution check.

## 5. Validation

| Check | Result |
|-------|--------|
| Hand calculation, original 9-task toy line (sum t = 36) at c = 9 | LB1 = ceil(36/9) = 4, LB2 = 3. Hand balance S1 {1,3}, S2 {2,4}, S3 {5,6,7}, S4 {8,9}, every load 9, meets LB1; solver returns 4 stations, proven; SALBP-2 at m = 4 gives c = 9. Runs without the benchmark files. |
| Hand calculation, Jackson (11 tasks, sum t = 46) at c = 10 | LB1 = ceil(46/10) = 5, LB2 = 3 + ceil(3/2) = 5. Hand balance S1 {1,2,6} = 10, S2 {5,8} = 7, S3 {3,10} = 10, S4 {4,7} = 10, S5 {9,11} = 9 is feasible; solver returns 5 stations, proven. |
| Jackson published optima, c = 7, 9, 10, 13, 14, 21 | 8, 6, 5, 4, 4, 3 stations: all match |
| Parser vs published graph table | n and sum t match for all 25 graphs; order strength matches to 0.02 points for all 22 graphs up to 120 tasks |
| SALBP-1, 269 published instances | 213 of 268 with a known optimum matched exactly; 188 proven optimal by our own bounds; **none below** a published optimum; the other 55 are 1 (50) or 2 (5) stations above, 49 of them on Barthol2, Scholl and Warnecke (the largest or hardest graphs), 6 on Lutz2, Arcus2, Tonge and Wee-Mag, all within a 6 s budget |
| SALBP-2 at m = 10, 20 lines with at least 20 tasks | 17 proven optimal; 13 of 15 published optima matched exactly; the other two within 0.07 % (Arcus1 7,585 vs 7,580; Arcus2 15,042 vs 15,040); Scholl (297 tasks) within 2 units of its bound |
| Monte Carlo at CV = 0 | reproduces the deterministic cycle exactly (unit test) |
| Lognormal sampler | mean and CV within 0.5 % and 2 % on 200,000 draws (unit test) |
| ML on unseen families vs baselines | MAE 0.19 stations vs 0.72 (mean) and 0.29 (LB2 rule); gap > 0 called correctly 94.5 % vs 62.9 % and 85.5 % |

29 pytest tests: `python -I -m pytest -q tests`.

## 6. Results

| Measure | Value |
|---------|-------|
| Exact vs RPW heuristic, SALBP-1 (269 instances) | RPW needs extra stations on 102 instances, 128 stations in total |
| Exact vs RPW heuristic, 10 stations (20 lines) | RPW cycle longer on 15 of 20 lines; median +1.56 %, worst +3.87 % |
| 10-station balance efficiency `sum t / (10 c)` | median 99.1 %, lowest 79.0 % (a line whose longest task sets the cycle) |
| Output kept under variation, median of 20 lines (min to max) | CV 0.10: 93.7 % (89.9 to 96.4); CV 0.20: 87.2 % (80.9 to 92.8); CV 0.30: 81.1 % (73.0 to 89.4) |
| Same, in units/day at a 6-min takt, 16 h/day (160 planned) | about 150, 140 and 130 units/day |
| Robust re-balance, out of sample, 17 lines | CV 0.20: better on 6, worse on 6, equal on 5; best +7.1 % output (Mitchell), worst -0.5 % |
| Hard-line predictor, most important features | mean task time / takt, share of tasks above half the takt, load ratio |
| Out-of-distribution, 268 classic instances | MAE 1.05 stations vs 1.50 for the mean baseline |

What this says:

- A plan that is perfect on paper loses about 13 % of its output at a modest 20 % task-time CV,
  because a paced line runs at the speed of the slowest station in every cycle.
- Re-balancing for variation pays off on lines with a few long, variable tasks (up to +7 %),
  and is neutral or slightly negative elsewhere: with 60 scenarios the optimiser can overfit,
  so a robust plan should only be adopted after an out-of-sample check like the one here.
- Whether a new task graph will need more stations than `sum t / takt` is predictable from the
  task list alone, mostly from how large the tasks are relative to the takt.

## 7. Limitations

- Task-time variation is an assumption (one CV for every task, independent tasks). Real lines
  have task-specific and correlated variation, operator learning, and buffers; none are modelled.
- The paced, unbuffered line is the worst case; buffers between stations would recover part of the loss.
- SALBP ignores zoning, tooling, ergonomics and walking, which real balances must respect.
- The 6-minute takt and 16 h/day only translate ratios into units; they are not data.
- CP-SAT within a few seconds does not prove every large instance; the specialised
  branch-and-bound codes in the literature do. Unproven results are flagged as such.
- The ML training set is generated instances (n = 20 and 50); accuracy drops on larger real graphs (section 6).

## References

- Scholl, A. (1993). Data of assembly line balancing problems. TU Darmstadt.
- Talbot, F.B., Patterson, J.H., Gehrlein, W.V. (1986). Management Science 32, 430-454.
- Hoffmann, T.R. (1990). International Journal of Production Research 28, 1807-1815.
- Otto, A., Otto, C., Scholl, A. (2013). SALBPGen. European Journal of Operational Research 228, 33-45.
- Helgeson, W.B., Birnie, D.P. (1961). Assembly line balancing using the ranked positional weight technique. Journal of Industrial Engineering 12, 394-398.
- Hoffmann, T.R. (1963). Assembly line balancing with a precedence matrix. Management Science 9, 551-562.
