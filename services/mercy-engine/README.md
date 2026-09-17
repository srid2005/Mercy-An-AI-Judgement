# mercy-engine (planned)

The judge. Polls `/api/evidence` from every other service (using
`x-mercy-key`), maintains the running guilt-probability score shown to the
player, and issues the final verdict.

- Not player-facing directly -- `desktop-shell` displays its output.
- Needs read access to every other service's evidence endpoint, so it must
  come up after them in `docker-compose.yml`.
- Scoring model TBD: simplest first pass is a weighted rule set per
  evidence `type`/`involves`, not real ML, since the "judgement" is
  narrative-scripted (82% -> 91% -> 93% -> 3%) rather than actually inferred.

Not implemented yet.
