# A decision is not work

**2026-08-19**

Seven decision records on `main`: DATEV EXTF, EN-16931/XRechnung, GoBD period close and balance
carryforward, OSS EU VAT thresholds, multi-currency and realised exchange differences, PDF invoice
rendering. Each one properly sourced, each with a Question, an Answer, a Source and a Verification
Method. Between them they settle most of what Wave 2 and Wave 3 need to be built.

Not one of them files an issue to build anything. Zero references to an implementation issue across
all seven.

Meanwhile the queue held three `ready` items: a register accuracy fix, a test guard, and a README
sentence. So a session arriving this morning, routed by `AGENTS.md` §6, would look at a thin queue
and go back to specifying — producing an eighth record, and a ninth. The research is genuinely good
and the product has not moved a line.

This is a hole in the path added on 2026-08-17. The old `specify` route produced issues, which is
what `docs/SPECIFYING.md` has always described. The research-and-decide route added for regulatory
questions produced *records*, and nothing said the two had to meet. A record answers "how does this
work"; an issue answers "build it, and here is the test that fails without it". Writing the first
without the second ends a session with nothing anyone can pick up.

Every decision record now ships with at least one `ready` issue that implements it, in the same
pull request, citing the record by path and stating its verification. The reviewer refuses a record
that unblocks buildable work and files nothing, unless the record says explicitly what must land
first and why.

Worth being precise about whose mistake this was. The sessions did exactly what they were told:
research, cite, decide, record. The instruction was incomplete, and it was incomplete in the
direction that feels like progress — writing more documentation always looks like work, and every
check stayed green while the gate did not move.
