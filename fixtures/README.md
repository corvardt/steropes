# Fixtures

`strikes.jsonl` is 3,738 deduplicated strike records harvested from the
[Blitzortung](https://www.blitzortung.org/) network with `npm run harvest`. It
is kept in the repository so the measurements in the README can be re-run
against the same sample that produced them.

The records are Blitzortung's, not this project's, and the MIT licence on this
repository does not cover them. They stay under Blitzortung's own terms: private
and non-commercial use only. Nothing here grants any right to them, and
redistributing this file carries those terms with it.

Regenerate rather than reuse if you need a fresh sample:

```sh
npm run harvest 300 > fixtures/new.jsonl
```
