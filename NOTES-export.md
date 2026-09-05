# README notes — import, validate, export, merge

The file a class is written into is the only part of this tool the game ever
sees, and an audit of that path found nine ways a file could come out of here
saying something the tool did not mean. The worst of them killed the run: every
random stream and every editor lock is keyed off `Engine.playerKey`, which
returned the pid whenever the pid was a number, so two rows carrying the same
pid shared one key — the same build, the same college, the same lock — and the
draft-day stream handed the second man events the first had already consumed,
where `applyDraftEvents` died with "ev.say is not a function". `validateLeagueFile`
had only warned about it. The key is now unique for the second and later
occurrence of a pid (`4`, `4#2`), and unchanged for a well-formed file, so a
class that was fine before keys exactly as it always did.

Two things were wrong about what the file said. It dropped `version` from any
source that lacked one, and BBGM reads a versionless file as a pre-versioning
save: `augmentPartialPlayer` then recomputes every ratings row's `hgt` from the
player's listed height and rewrites the ratings season and draft year, so a
class solved to the exact rating arrived in the game as a different class.
Everything written here now carries `LEAGUE_DATABASE_VERSION` (73), stated once
in `js/bbgm.js` and stamped by both export routes and by the sample class. And
the tool's own height map was a 66-to-90 span where BBGM's `heightToRating.ts`
is 66-to-93. Every height derived from a rating was therefore short, and short
by more the taller the player: across 560 prospects in files with no listed
height the mean listed height moved from 6'5.5" to 6'6.9", the largest single
correction was three inches, and the number of seven-footers went from 42 to
102 — which is the population the archetype gates actually care about. The three
places in the build phase that converted inches back into rating points used the
same wrong span and now read one shared constant.

A class exported for a draft the league has not reached yet was dated to the
wrong year throughout. `result.season` is the file's `startingSeason` — the
season the league was in — and for BBGM's own year-ahead exports (startingSeason
2026, `draft.year` 2027 on every player) the export stamped 2026 on the ratings
row, on every honor, on every college stats row and on `born.year`, so a
prospect's final college season was labelled the year before the draft he was in.
The merge already read the year off the players; the export does now too, and
shifts every season it writes by the difference.

Three fixes are about not saying more than the tool knows. The class file did
not force `tid: -2`, and BBGM's draft import filters the uploaded file to
UNDRAFTED before it reads anything else — a class pulled out of a league export
by hand carried its rows' team tids and imported as zero players, with no error
on either side. Numeric strings passed validation (`Number.isFinite(Number(v))`
checked the value and then kept the raw object) and exported as `ovr: null`;
every rating key, season, fuzz, `born.year`, `draft.year`, `hgt` and `weight` is
now coerced with `Number()` where it is read and where it is written. And
`hgt: -5`, `hgt: 120` and `weight: 0` all exported verbatim, because the only
test on any of them was whether they were numbers: heights outside 58-96 inches,
weights outside 120-400 and ratings outside 0-100 are warned about and clamped
where they are read. The validator still never edits the file it is handed.

The league merge overlaid the whole exported player onto the league's
(`Object.assign({}, target, p)`), and a draft-class file is not a complete
player: a file from an older run wrote its stale `value`, `contract`, `born`,
`hgt`, `weight`, `injury`, `face` and `relatives` over the league's current
ones, so a prospect the user had already edited in-game silently reverted. Only
what this tool actually produces goes on top of him now — college, the class
season's ratings row, `draft.ovr/pot/skills`, the note, awards, injuries, stats,
mood traits and jersey number, with height and weight only when the tool
rewrote them.

Four smaller gaps: a file carrying a single `name` instead of `firstName` /
`lastName` exported with neither and showed a nameless player, and is split on
the way through; nobody wrote `injury`, so a prospect arrived with whatever
BBGM rolled; `born.loc` and the seeded face the tool draws on its own pages were
never written, so the man you scouted and the man in the game were different
people; and `college` for a prospect abroad held the LEAGUE — "LNB Pro A" — under
a heading BBGM prints as College. The club is already drawn, and the club is
what goes in the field; a club-to-league table takes him back to the right
competition when the same file is loaded again. That last step is exact for
every club that plays in one league and only nearly exact for the 44 that play
in two — a club name alone cannot say whether a Barcelona prospect was reached
through the EuroLeague or the ACB, so about one prospect abroad in ten comes
back in the neighbouring competition.

On the data side, the conference table had been drifting between two seasons at
once; it is now stated as, and consistent with, 2027-28 — UC Davis in the
Mountain West, Louisiana Tech in the Sun Belt, New Haven in the NEC and St.
Francis (PA), Division II since 2026, out. Eleven reverse aliases were added, so
a modded file that says "Dixie State", "UMKC", "IPFW", "College of Charleston",
"Central Florida", "Southern Mississippi", "Miami", "UConn", "Mississippi" or
"Penn" lands on the right program instead of falling out of the database
entirely. Seven programs got their real abbreviations, where the initials
generator had confidently produced IC, MO, II, WG, GC, TAC and SPS for UIC,
M-OH, IUI, UWG, GCU, TAMUCC and SPU. The EuroCup listed two clubs twice under
two names apiece, four clubs were named differently in their domestic league and
in the continental table (and the pro-league sim matches a club by name), six
relegated or defunct sides were still playing, and four notable ones were
missing. `EURO_HINTS` did not match "United Kingdom" — which is the string BBGM
itself writes — so a British prospect got a flat 1.0 on every destination
abroad, and sixteen of its entries were duplicates.

Finally the synthetic returners, who fill out every roster the class plays
against: 28 first names by 28 last ones is 784 combinations for about 3,200
players a season, so every name in the pool was used four times over and the
honors page read like a family reunion. They were also entirely American, in a
sport whose rosters are not. The pools are now 180 by 209 — 37,620 combinations
— with the range of origins a Division I roster actually holds, and the coach
first names, which were one generation of Anglo names, carry another hundred.
The "International class" preset had the same shape of problem: it named twelve
destinations, and the twenty-four leagues added to the table since kept their
ordinary weights while those twelve were boosted around them, so the preset
whose whole purpose is to send a class abroad was quietly holding back most of
the world. It names all thirty-six now.
