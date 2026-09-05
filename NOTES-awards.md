# Notes for the README — awards, news, draft board

The awards pass, the paper and the draft board carried a set of faults that a
reader could catch and the harness could not. The largest was structural: **a
draft class could not win a national defensive award.** The unseen field —
every returning rotation player in Division I — has no rating vector, so its
defensive score was re-derived from event rates, and the two halves were not on
the same scale. The composite term of a prospect's defensive score runs mean
-1.7 with a maximum of +2.2 (three bounded composites cannot go far); the
rate-derived stand-in ran mean +0.4 with a maximum of +8.9, and the stat model
hands a filler event rates it never hands a prospect (6.0 blocks a game against
a prospect maximum of 2.9). That was a systematic two-point gift to four
thousand players plus a tail four times as long, and over fifteen classes the
Naismith DPOY, the NABC DPOY and the Lefty Driesell went to the field **45 times
out of 45**. The field is now held to the envelope the model produces for the
players it rates in full: each defensive rate and the defensive rating are
capped at the class's own maximum, and the rate-derived term is mapped onto the
mean and spread of the real one. Ordering inside the field is untouched — a
better defender is still a better defender — only the scale it is compared on.
Over forty seeds the class now wins a national defensive trophy in **15 of 40
classes** and takes some national defensive honor in **33 of 40**, and the field
still wins most of them, which is right: it is thirty times the population.

Three stories were printing things the model did not believe. The "sweeps the
hardware" article filtered on `/Player of the Year/`, which is a rule about the
words and not about the trophies — "WCC Player of the Year" matches it — so it
fired in fifteen classes of fifteen and in nine of them the man it crowned held
no national trophy at all ("took 1 national honors"), in a paper that was
simultaneously running the field-honors story naming whoever actually won. It
now reads the named national trophies from `js/awards.js`, demands two of them
before it says "sweeps", pluralizes, and stands down when a returning player
took one. The conference-player-of-the-year story required an NCAA player, since
a prospect in prep ball holds an award of the same shape and the template was
rendering "Prep / Postgrad" as a clickable team. And the mock-draft and
stock-movement stories were reading a board the draft-day events had already
reordered: `boardRank` and `stockMove` were assigned after the events ran, so a
late reach who moved up 22 places on the night printed as "has climbed 22 spots
from his preseason ranking", and eight of fifty-nine events had a rise story
sitting on a faller's number with the scouting note's Board line saying "down 3"
underneath it. The ranking is now assigned on the pre-event board — which is
what a mock draft is — and where a man was actually taken is a separate
`draftSlot` that the draft-night stories and the note read. Each event's
sentence is also measured from the board slot rather than from the half-shuffled
intermediate position, which was off by one to three spots against the rank
printed beside it.

Smaller corrections around the honors: a pro MVP is now on his league's first
team (it was an `if/else`, so the one certain first-teamer in each league was
the only man left off it — 40 of them); a league whose own honors list opens
with a player of the year no longer also mints an MVP for the same season (nine
classes in fifteen had a man holding both); the domestic cup runs only for
leagues that are actually professional, ending the "Division II Cup Winner" and
"Prep / Postgrad Cup Winner"; a "newcomer" has to have arrived from somewhere,
so the walk-on who won a scholarship is no longer All-Conference Newcomer at the
school he never left; and the conference player-of-the-year races lost to the
field are recorded rather than silently dropped, so the paper can say which
returning senior beat the class to the A-10.

The prose fixes are mostly one helper each. `Text` gained `ordinal()` — "1th
season" and "3th game" were shipping — and its fault sweep now reads lowercase
words after an article (that is how "a old-school disciplinarian coach" got out)
and flags a bad ordinal, so neither can come back. The coaching-philosophy
labels are model keys, and "neutral" is the do-nothing archetype: it was
printing as "He is a neutral coach". They are mapped to readable adjectives now
and the article in front of them goes through `Text`. An overtime body said the
overtimes twice because the score text already carries "(3OT)". Four templates
asserted history the tool does not simulate — eleven straight losses to ranked
teams, a first bid in a programme's history, a decade without a second weekend —
and now say what the model actually selected on. And the pre-draft calendar
exists: everything past the bracket used to be clamped to "March", so 171
articles a run — the lottery, the combine, the pro days, the draft itself —
were filed from the wrong month.

Against staleness, the thin template tails were the problem: three draft-day
headlines covered four events a class ("The pick that made the room gasp" ran 23
times) and the "new No. 1" body had exactly one template for 26 articles. The
draft headlines are now keyed to what happened to the man — a slide, a workout
riser, a trade-up, a reach — with six each, and the poll story reads the poll's
own history ("had been No. 2 a week ago", "after three weeks"). The most-repeated
headline template fell from 23 to 17 occurrences (1.4% to 1.0% of articles).
`statBlurb`, which every scouting note opens on, had four branches and a
fallback, so 53% of players got the identical true-shooting sentence; it now has
seventeen shapes — the offensive glass, a real three-point season, assists
against turnovers, free-throw volume, minutes, low usage and high efficiency —
and the most common covers 12%. The quote pool reads the trait layer for the
first time (a scout who has actually read the file talks about the motor, the
medical or the release), and the paragraph the beat writers file has six
openings rather than one.

Eight new kinds run off facts the model already had and nothing printed: the
Final Four Most Outstanding Player and the all-tournament team (the award was
assigned and never mentioned), a career-milestone story off the earlier seasons,
a conference player of the week off the game log, a coaching-record story, a
transfer facing the school he left, the conference player-of-the-year race the
class lost, a return from a long injury, and a prospect at a small programme
beating a ranked team on his own. Over fifteen classes they fired 5, 11, 13, 7,
11, 10, 12 and 3 times respectively. Finally the draft board reads two things it
did not: a prospect's draft age — taken from his class year, because most source
files carry 19 for everybody — so a senior and a freshman with the same ratings
no longer tie; and only the honors a scout cares about, since 46% of an award
list is team trophies and finalist tiers and a reserve on the national champion
was collecting three or four points of draft stock for other people's rings.
