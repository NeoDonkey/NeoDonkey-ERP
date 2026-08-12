# Operating model steward

Somebody has to own this folder, or it rots.

This is a small, boring, essential role, usually held part-time by whoever in the company is
best at writing plainly — often the COO, sometimes the controller. Their job is not to decide
what the processes should be; that is the managing director's and each function's. Their job is
to keep the description true: to notice when a process file says something the company stopped
doing eight months ago, to keep the prose readable, and to make sure that a change somebody
asked for on Monday is in the folder by Friday rather than in a chat thread.

In a classical company this role does not exist, and its absence is precisely what produces the
gap between "how we work" and "what the system does". Here there is no gap by construction — the
folder *is* the system — which means a stale folder is not a documentation problem, it is a
production incident.

## Notes
### Responsibilities

- Keep `processes/`, `organisation/`, `locations/`, `information/`, `suppliers/` and
  `management-system/` describing what the company actually does.
- Write proposed changes as readable rules, not as tickets.
- Run the change through the function that owns it and the managing director for approval.
- Keep the prose at the top of every file worth reading — that is the part that makes the
  system explainable to a new joiner, an auditor or a tax adviser.
- Maintain the `NEEDS-GRAMMAR` list: constructs the company needs that the rule language cannot
  yet express, each with the workaround currently in use. This list is the company's honest
  statement of where the model is thinner than reality.
- Chair the annual operating-model review.
- Keep the *Verfahrensdokumentation* in step with the folder.

### Authorized for

Proposing changes to every file in the operating model. Merging them only with the approval of
the function that owns the process and, for anything touching a threshold or an authorisation
boundary, `managing-director`.

This role appears in no `## Authorized by` section of any business process. It changes the
rules; it does not execute them.

### Not authorized for

- Executing any business process.
- Approving their own change to a threshold or an authorisation boundary.
- Removing a `NEEDS-GRAMMAR` marker without either the grammar having gained the construct or
  the requirement having genuinely gone away.

### Reports to

`managing-director`

### Sees

The whole operating model, in every version. Aggregate figures from the reviews, so they can
tell whether a process is being followed. No need for transaction-level access, and by default
they do not have it.
