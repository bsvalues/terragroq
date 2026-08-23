# 16 — Whole-Fabric Review Checklist

Before IF-06 automatic placement may activate, reviewers must answer YES with evidence to all applicable items:

- [ ] HERMES, AEGIS, ATLAS and OMEN current identities/roles are proven from canonical/live truth.
- [ ] OMEN is modeled as opportunistic and nonessential.
- [ ] No node role was silently redefined by management-plane reachability.
- [ ] Per-node CPU/RAM/accelerator/runtime capacity is freshness-aware.
- [ ] Material PCIe/host-memory characteristics are measured where they affect placement.
- [ ] Material fabric links are measured rather than assumed from NIC labels.
- [ ] ATLAS data-local operations are preferred over unnecessary bulk corpus movement.
- [ ] AEGIS remains the governed repository/build/test execution location where current authority says so.
- [ ] HERMES remains the resident supervisor rather than becoming a universal execution host.
- [ ] Transfer/startup cost can influence placement after hard gates.
- [ ] PipelinePlan is a placement projection only, not another scheduler.
- [ ] Derived caches can disappear without canonical Thread/work loss.
- [ ] Advanced distributed inference is disabled unless exact runtime/interconnect capability is proven.
- [ ] Hardware recommendations cite measured bottlenecks and alternatives.
- [ ] Whole-fabric stage placement can be inspected after the fact without requiring topology operation during normal use.
