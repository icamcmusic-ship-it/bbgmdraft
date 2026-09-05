# Notes for the README — the build and trait layer

A size anomaly used to change a prospect's height, re-solve his ratings and keep
the build he already had, and every build in the table is gated on a height
band. Measured over thirty classes, five of the six physical outliers ended
outside their own build's gate: a Shot-Blocking Anchor (min hgt 76) at 5'8", a
Movement Shooter (max 56) at 7'4". The label in the table and the rating vector
beside it were describing different players, and everything downstream that
reads the build — the potential model, the role-usage term, the trait gates —
was looking at a build that prospect could not have had. The anomaly now redraws
the archetype when the new height puts the old one out of band, from the same
pool and with the same weights the build phase used; a build the user locked is
left alone. Zero of the outliers in twenty-four classes are off-band now.

Two silent NaN paths are closed. A source file whose last ratings row carried no
`ovr` or `pot` made the ovr-to-potential gap NaN, and that NaN reached
`ratings.pot`, `draft.pot` and the displayed potential of every player in the
class — `validateLeagueFile` checked the fifteen rating keys and had never
checked those two. Overall is now recomputed from the ratings when it is
missing, potential defaults to ten points of room, and the load warns that the
gap those players were meant to carry is gone. Separately, a non-numeric
`archetypeDiversity` (a string out of a URL or localStorage) turned every
archetype weight into NaN, and the weighted draw then handed back the first
eligible build — every player in the class came out Balanced, with no error
anywhere. It is coerced now.

The normalizer that makes a build ovr-neutral used to reverse the sign of small
authored boosts: Matchup-Zone Defender's `stre +4` became -2.25, Wing Stopper's
`+6` became 0, Point-of-Attack Menace's `+6` became -0.25. The editor's tooltip
reads the authored vector, so the one place a user can see what a build is FOR
disagreed with what the solver did to it. The subtraction now runs in passes: a
rating authored positive is floored at zero rather than pushed through it, the
ovr the floor leaves unspent comes out of the ratings the build did not author
positive, and it repeats until the vector is neutral again. Sign flips across
the whole table went from four to zero, the worst residual push is 0.10 against
a 0.35 tolerance, and the usage-composite protection the normalizer already had
is untouched.

Three things about the class pool were not what the label said. The pool size
was a lie by two to four every class — the rare slot, the three guaranteed
centre builds and the height-band probes were all added on TOP of the number,
so "19 builds per class" realized 20-23 and the one flavor whose whole identity
is a small pool (three-and-D only, which asks for 8) got 10-12. The guarantees
now come out of the budget, and the pool is exactly the size asked for; the
default moved from 19 to 21 so the realized size is what it always was. The rare
slot filtered on the authored weight and so read straight past a build the user
had zeroed — one made the pool in 23 of 40 classes, spending the slot meant for
a rare build on one that had been switched off; it filters on the effective
weight now, and 0 of 40. And the guaranteed slots ignored the pool memory
entirely, because a guarantee is not a weighted draw: Shot-Blocking Anchor sat
in 28-31 of 60 consecutive pools at every memory setting. The guarantees now
rotate away from the last class's builds, and consecutive-class pool overlap
fell from 0.10/0.08/0.06 to 0.09/0.05/0.03 at memory 0/0.6/1.

Variety, measured over 2,100 players in thirty classes. A build with no height
gate is eligible for everybody, so once it made the pool it owned the class:
Athletic Freak turned up 50 times and Raw Project 43, while a gated build that
made a pool drew 0 of its 47 eligible players. A class now counts its own draws
and halves a build's weight past six of them — the largest single build count
fell to 40 — and inside the top ten a build already used up there is quartered
per use, which took classes with a duplicated build in the top five from 12 in
30 to 5. Five builds were never drawn at all across those thirty classes; three
are now. On the trait side, four heavy rows were taking the one-per-group rule
as a clear run at every player: "clean medical" landed on 10.1% of all
prospects, two and a half times the median trait. Capping the drawn weight at
1.6 takes that to 7.3% and the max/median ratio from 2.52 to 1.76. Drawing the
group first and the trait inside it was the other candidate and measured worse —
rebounding has four traits and three are height-gated, so a flat group draw
handed "chases his own miss" one draw in twelve and 307 appearances. Flavors can
now tilt the trait groups as well as the build mix (`traits: {group: mult}` on
nine of the twenty-nine): the year everybody got hurt goes from 21% of the class
carrying a medical trait to 40%.

Traits had prerequisites about height and class year and none at all about the
build's own shape, so "genuinely strong" was drawable on nineteen builds
authoring stre -8 or worse (Toughness Question at -22), "explosive first step"
on thirty-eight with spd -8 or worse, "chronic knee" on Iron Man, and
"maxed-out frame" on a senior built as a Frame to Fill Out. They are gated on
the authored offsets and on the build's injury multiplier now, and the
undocumented `minInj`/`maxInj` fields are written down in the header where the
rest of the prerequisites are.

Finally, four smaller things. `solveToOvr` and `ovrRange` read only the KEYS of
the pinned vector and never its values, so asking for tp 100 came back with tp
45 for every caller that had not already written the pin into the base. Pinning
all fifteen ratings replaced the class's target overall with whatever those
ratings came to, and said nothing; it reports now. The room-scaling that keeps a
build's negative offsets off the 1 floor only ever bit at specialization 1,
where it was measured — at 3 the cut is three times the size and the room is the
same, and 6.2% of a class's ratings sat on exactly 1, a vector with no shape
left in it. The scaling now carries the whole cut and the solver's downward
shift eases onto the floor over its last ten points instead of driving through
it; the floor share at specialization 3 is 1.9% and at 1 it is 0.09%, and 35% of
a 70-man class's ratings move by an average of 1.2 points. Two guard builds were
tagged in a way their own gates contradicted (Sharpshooter runs to 6'8" and
Slasher to 6'9", and neither could be reached by a wing-leaning flavor); both
carry `wing` now.

One thing was left for the UI: `archetypePool` was clamped at 60 against a
145-build table, so the documented "a size at or above the table turns the pool
off" could not be said. The clamp is the table size now, but the slider in
index.html still stops at 40.
