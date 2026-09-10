# 19 — Placement Efficiency Score Inputs

This document does not freeze a scoring formula; IF-06 selects the exact implementation after IF-00/IF-05 evidence. It freezes the required dimensions.

After hard gates pass, candidate comparison must be able to consider:

- measured task quality/reliability;
- expected compute time;
- queue delay;
- model cold/warm load cost;
- context transfer bytes/time;
- artifact/data transfer bytes/time;
- cache transfer/recompute cost;
- node/link freshness;
- locality and authoritative-data location;
- monetary cost;
- failure/recovery probability;
- opportunity cost of occupying a scarce accelerator;
- energy/thermal pressure when measured and material.

Scoring must not reward a remote accelerator for high raw tokens/sec if end-to-end accepted-outcome time is worse after movement/load/recovery costs.

Every consequential selected candidate must retain an inspectable rationale and the measurements it used.
