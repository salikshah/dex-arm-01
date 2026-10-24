# MuJoCo drop benchmark — 2026-10-24T08:26:01.137Z

Protocol: 100 randomised releases, seed 7,
500 Hz, open-hand release from 180 mm, 500 ms settle, 600 ms finger closure,
400 ms hold. Success = object still inside the finger envelope
(110 mm), above 850 mm, and slipping less than
30 mm while held. Simulated collision proxy only, not hardware.
Force sensing is not reported: the WASM contact-force binding returns zeros
for this model, so the table reports closure-time object acceleration instead.

## Summary

| Metric | Value |
| :--- | :--- |
| Episodes | 100 |
| Successes | 47 |
| Success rate | 47.0 % (95 % CI 37.5–56.7 %) |
| Median hold radius (successful) | 66.1 mm |
| Closure impact p50 / p90 / max | 16.06 / 135.01 / 163.4 g |
| Contacts observed (max) | 21 |
| Success with lateral offset ≤ 4 mm | 29/35 |
| Success with lateral offset > 4 mm | 18/65 |
| Failed: left the envelope | 53 |
| Failed: reached the floor | 53 |
| Failed: slipped while held | 48 |

Failure modes are not exclusive: an object that escapes usually also reaches the
floor. Percentages are out of all 100 episodes.

## Worst eight episodes

| # | radius mm | length mm | mass kg | friction | drop dx mm | hold r (m) | slip (m) | result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| 1 | 35.6 | 43.8 | 0.34 | 0.91 | -5.8 | 1.014 | 0.132 | fail |
| 2 | 39.2 | 48.3 | 0.25 | 0.73 | -5.0 | 0.902 | 0.641 | fail |
| 3 | 33.6 | 55.6 | 0.26 | 0.99 | -7.4 | 1.035 | 0.134 | fail |
| 4 | 31.9 | 44.7 | 0.34 | 0.93 | -10.2 | 0.995 | 0.234 | fail |
| 6 | 39.9 | 40.6 | 0.24 | 0.73 | -1.8 | 0.728 | 0.764 | fail |
| 8 | 38.4 | 51.0 | 0.28 | 0.73 | -8.7 | 1.059 | 0.140 | fail |
| 11 | 31.4 | 48.5 | 0.36 | 1.00 | 11.1 | 0.863 | 0.803 | fail |
| 13 | 36.2 | 45.2 | 0.38 | 0.82 | 6.1 | 1.130 | 0.184 | fail |
