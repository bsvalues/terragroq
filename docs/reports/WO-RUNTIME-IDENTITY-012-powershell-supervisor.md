# WO-RUNTIME-IDENTITY-012 - PowerShell Supervisor

The strict native supervisor checks disabled state before authentication,
locking, checkpoints, polling, or child work. Enabled operation uses serialized
bounded polling and capped exponential recovery. Child execution is deferred
to its dedicated adapter Work Order.

Live disabled result: `NATIVE_RUNTIME_STATUS=DISABLED`.
