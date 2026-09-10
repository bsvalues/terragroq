# Failed elevation lane — terminal handoff

- Execution order: `EO-WILLIAMOS-HERMES-CONTROL-PLANE-RECOVERY-001`
- Terminal result: `HERMES_INGRESS_ELEVATED_TRANSACTION_FAILED exit=240 rollback=PASS checkpoint=RDP_ORIGIN_PROOF`
- Classified post-state: `ROLLED_BACK_AND_OPERATIONAL`
- Preserved failed worktree: `G:\Workbench\HERMES-Appliance-V1`
- Preserved failed head: `71dce46f002b5fd111f8ec72a0151d3fbe716008`
- Sealed elevated launch receipts found: `4` (`SNAPSHOT`, `INSTALL_EXACT_RULES`, and two `RDP_ORIGIN_PROOF` attempts)
- Pending active elevated process: none
- Prior lane relaunched or repaired: no
- `NEW_UAC_LAUNCHES=0`

The failed lane is evidence only. It is not execution authority for this recovery order.
