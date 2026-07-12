# WO-RUNTIME-IDENTITY-011 - Native Runtime Directory Contract

The native root permits only control, state, audit, workspace, and locks.
Initialization refuses reparse points, unexpected ownership, and broadly
writable ACLs. No secrets directory or credential material is stored.

Live result: `PASS_NATIVE_DIRECTORY` under the expected non-elevated account.
