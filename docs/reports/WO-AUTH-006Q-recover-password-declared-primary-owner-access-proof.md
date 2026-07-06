# WO-AUTH-006Q — Recover Password For Declared Primary / Verify Owner Access

## Result

BLOCKED_SECRET_EXPOSURE_ROTATION_REQUIRED

## Primary Identity

`bsvalues@gmail.com`

## Finding

The 006Q browser proof attempt must not be accepted. During browser
verification, the automation snapshot exposed the password field value in tool
output.

The exposed value is intentionally not repeated in this report.

## Required Action

The Primary password used during this attempt must be treated as compromised and
rotated through the controlled local `/setup` Primary credential recovery gate
before any owner access proof can be accepted.

After rotation, route verification must avoid snapshots or artifacts that can
capture password fields. Verification should use only safe visible route state
after the owner has completed sign-in.

## Owner Access

- Setup credential gate reachable: yes
- Primary email fixed to declared identity: yes
- Credential recovery/provisioning succeeded: not accepted as proof
- Sign-in route: reached
- Successful login: not verified
- Post-login destination: not verified
- `/operator` reachable after login: not verified
- Primary/Home reachable after login: not verified
- Protected route reachable after login: not verified
- `/sign-up` remains closed: not rechecked in this blocked attempt
- Owner locked out: unknown

## Safety

- Public signup reintroduced: false
- Password printed: true
- Password hash printed: false
- Token printed: false
- Cookie printed: false
- Session value printed: false
- Database URL printed: false
- Credential committed: false
- Deploy performed: false
- Vercel changed: false
- Production write performed: false
- Hermes/MCP/autonomy activated: false

## Next Required Gate

`WO-AUTH-006R — Rotate Exposed Primary Credential / Safe Owner Access Proof`

The next proof must rotate the exposed password first, then verify owner access
without capturing password fields, cookies, tokens, sessions, or screenshots
containing credential input values.
