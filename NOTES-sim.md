# README notes — the season simulation

## A team's points existed three times and none of them agreed

The stat pool summed its rotation to one number, `teamBox` summed the same
lines to a second, and js/teams.js had already played thirty-one games whose
final scores said a third. Over 3,640 team-seasons the box said 73.4 points and
the season the team actually played said 70.6; 1,231 programs differed by more
than five points and the worst was off by twenty-one, which is a box score and a
results page describing two different teams. Worse, everything that is a
DIFFERENCE between the two inherited the gap: net rating, plus/minus, on/off and
both team ratings all read the model's offense against the scoreboard's defense,
so the country netted +3.6 points per hundred possessions on a true margin of
-0.19.

Two things were wrong. The scoreboard multiplied pace by a hardcoded 2.06
whatever era was selected — one number for a modern game anchored at 73.6 points
on 67.4 possessions (2.184 a possession pair) and for 2009-2021 at 70.0 on 68.5
(2.044) — so switching era moved the stat model and left the scoreboard where it
was, and both eras scored about 70. It reads the era's own anchor now. And the
stat pool answered to nothing outside itself; after reconciliation it is scaled
by one factor per team so the rotation's points are the points the team actually
scored. One factor, not a per-player fit: the SHARES are the stat model's answer
and were never in question, only the total. Measured after: the box and the
scoreboard agree to 0.05 points on average, three teams of 2,184 differ by more
than five, the two eras score 75.4 and 70.6 against their own anchors, and the
country's mean net rating is -0.36 against a true margin of -0.19.

## Box plus/minus, and an on/off that reached +295

The exported advanced block was never banded, and it showed. On/off ran from
-217 to +295 points per hundred possessions with a 99th percentile of +117,
against a real college range of +10 to +20 and an extreme near +25.

Three separate faults stacked. The impact term added to a player's plus/minus
was not zero-sum over the rotation — five men are on the floor for every point
of a team's margin, so a term that is positive for good players and negative for
nobody hands the team more margin than it won, and BBGM's on/off reads the
surplus off the off-court minutes, of which a starter has about nine a night.
The term was also on a per-GAME scale in a formula that amplifies by
1/(share × (1-share)) — six times for a thirty-minute starter and seventeen for
a thirty-seven-minute one — so five points a game of impact is fifty points of
on/off. And an earlier season's opponent column was built from the FIELD's
average points rather than from the margin that season was played to, so a prior
year's on/off was measured against a team nobody played. The impact term is now
defined per hundred possessions, bounded there, and centred on the rotation's own
production; the per-night plus/minus noise is recentred so the SEASON number is
exactly the margin he was on the floor for plus his impact; and a prior season
carries its own margin. On/off now runs -18 to +45 with a 99th percentile of
+26, and per-game plus/minus tops out at +24 rather than +30. EWA was also
normalizing every club on the run's nominal forty minutes instead of its own, so
a G League season's value over replacement was out by as much as 1.6 wins; the
other identities were already exact (VORP to 1e-16) and win shares sum to 1.04
times the wins there were.

## Walls, blocks, and where a game is played

A hard ceiling does not remove the players who would have gone past it, it
stacks them on it: 245 lines of 33,617 finished with exactly 3.90 personal
fouls, 639 sat to the decimal on the per-40 rebounding cap and 319 on the
blocked-shot share cap. Every one of those ceilings bends now — above a knee the
curve saturates toward the limit instead of arriving at it — and the largest
group sharing one value in the top decile of any of them is under 0.3%. Blocks
had a second problem: the national leader averaged 5.6 a game against a real
3.6, with 110 lines over 4.5. The exponent that produces the big-versus-guard
separation stays where it was (flattening it to 2.5 dropped the ratio to 3.7 and
failed the band that exists to protect it); instead the share cap was softened to
0.52 and an absolute per-40 ceiling was added, as rebounds and assists already
had. The leader now averages 4.1-4.4 and nothing clears 4.5.

Home games ran from 3 to 27 in a 31-game season, against a real 13 to 19,
because the higher-prestige side always hosted a non-conference game and a
conference game flipped a coin with no return leg. Three rules replace them: a
second meeting is the return leg and is played at the other building, a single
meeting goes to whoever has fewer home dates, and a non-conference game is a
negotiation whose odds come from the prestige gap with about one in seven played
somewhere neutral. Home games now run 8 to 21 and 99% of teams are within a game
of half their conference slate. Conference tournaments no longer cap the field at
twelve — six ACC and Big Ten teams used to finish a season without one — and the
seeding tie-break reads head-to-head and the conference record instead of the
sim's hidden true rating, which decided 1,062 ties over ten seasons.

## The AP electorate was reading the answer key

This file's own header says the poll votes on observables, and three of its six
features read `g.quality`, which js/teams.js stamps on every log row straight off
the opponent's hidden rating. Strength of schedule, quality wins and bad losses
all come off the NET ranking `computeRankings` has already derived from the game
log. A poll recomputed with every `quality` field blanked now keeps 24 of its
top 25; it kept 16 before. Two smaller ones alongside it: a neutral-court game
was counted as a road win, and every filler line in the country carried
`astdRate: NaN` (66,243 of them over twenty classes, exported as null) because
the composite it reads was never defined for a filler.

Conference-tournament games are still excluded from the resume, and that is now
a deliberate choice rather than an oversight: adding them was measured and put
five seeds past twelve seeds 81% of the time against a real 64% and the harness's
78% ceiling. Championship week is played on neutral floors against the rest of
your own league, and folding it into a NET built for a 31-game schedule sharpens
the seed line rather than describing it.

## Twenty seasons that were too alike at the bottom and too chaotic at the top

One volatility of 7 for all 364 programs, plus a 9% chance of a down year drawn
on top, was too much for the top of the sport and not enough for the bottom:
Kentucky missed the tournament in three seasons of twenty while the same program
won a one-bid league in eight to ten of them. That is backwards on both ends, and
for a real reason — a blue blood's floor is structural, and a one-bid league is
two rosters wide. Volatility now runs from 4 at the top of the sport to 10 at the
bottom and a down year is rarer for a program with everything to lose: Kentucky
misses two of twenty, and the most frequent one-bid champion won seven rather
than ten. The preseason ballot was a table — it read reputation and this season's
level, both stable by design, and voted the same program No. 1 in seven seasons
of twenty — so it now carries October's story as well, a draw that moves the
ballot and nothing else. Fifteen different programs are preseason No. 1 over
twenty seasons.

The one target not reached is the final top 25's season-to-season overlap, which
sits at 0.18 against a real 0.45. It is not the programs: setting the level draw
to zero entirely only lifts it to 0.22, because the ceiling is set by a 31-game
schedule with eleven points of per-game margin noise and by the conference drift,
and because twenty seeds of this tool are twenty unrelated universes rather than
twenty consecutive seasons of one.

Finally, a season's mid-season events were a fixed budget of seven, topped up
from a flavor pool, so every season had exactly seven things happen in it and
each KIND of thing happened in twelve to seventeen seasons of twenty. The budget
is a Poisson draw now (the slider is its mean, with a floor of four — a Division
I season is never empty) and the gates on the result-driven kinds were loosened
to match: 5.7 events a season, the most common kind fires in fifteen seasons of
twenty rather than seventeen, and the rest are spread from seven to fourteen
instead of bunched at twelve to sixteen.
