# A bad minute is not a lost capability

**2026-08-17**

`lane-doctor` opened #52 — "an autonomous lane has lost a capability" — on the strength of a 503
from GitHub's comment endpoint and a 500 from the Jules API. Both were transient. Sixty seconds
later the same probes returned 201 and 200.

The check was right that something failed and wrong about what it meant. A 5xx or a dead socket is
the service having a bad minute; a 401, 403 or 404 is a capability that has actually been taken
away. They need opposite responses — wait, versus go and fix the token — and reporting them
identically is how a daily check earns a reputation for crying wolf. That matters more than usual
here, because the repository's own rule is that a workflow red for a reason nobody can act on
trains everyone to ignore red, and this check is designed to keep one issue open until a human
acts on it.

Over a fortnight unattended, with GitHub as unreliable as it was today, the old behaviour would
have left a permanent alarming issue that meant nothing — and buried a real credential failure
inside it.

So a 5xx now reports **could not test** and does not count as broken. Only a definite refusal does.
The bar is deliberately conservative: an inconclusive check is never treated as a pass in the other
direction either, so a genuinely revoked token still shows up the first time it is refused.
