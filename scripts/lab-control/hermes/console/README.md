# HERMES appliance Console

This is the standalone read-only HERMES appliance surface, distinct from WilliamOS. It binds only to `127.0.0.1:3210`, serves its existing interface and assets, and exposes `GET` and `HEAD /api/status` for local observation. Other methods are refused. It does not redirect to WilliamOS.

The collector publishes the shared appliance status packet. Missing authenticated appliance transaction and decision inputs are explicitly unavailable; an empty action array is not owner clearance. Doctrine freshness is independent of conformance. Recent native alerts remain visible for 48 hours after recovery; domain facts identify their source observation time, and backup generation is separate from restore proof.

The host setting cannot broaden binding. Existing environment variables may select the status packet path or local port. No task control or write actions are exposed.
