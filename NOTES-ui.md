# UI audit — what was wrong and what changed

This pass drove the running page rather than reading it: the sample class loaded
through the “Try a sample class” button, every tab screenshotted at 1400×900 and
390×844 in both the light and the dark palette, and then the verbs exercised one
by one — reroll, undo, redo, re-apply, pin and compare, the editor's locks and
its three ↻ buttons, “Reroll just him”, search, the range filters, the sort
stack, the column picker, the keyboard shortcuts, the settings search and its
only-what-I-changed toggle, the randomizer scopes and padlocks, presets, the
Link round trip, the seed pill and its history, the CSV lock import, all nine
export routes, batch mode with its progress and its cancel, universe mode over
two sample files, back and forward navigation on the player, team and box-score
pages, and the phone card layout. Almost all of it worked, and the run raised
no console error or warning anywhere. What it did find was in the chrome — the
header, the dialog and the palettes — which is the part nothing was reading.

The copy-link button ate its own icon. `copyText` flashes “Copied ✓” on the
button and then restores a label the CALL SITE passes; the header's button is
the 🔗 glyph and the call site passed the word “Link”, so one click replaced the
icon with a word for the rest of the session, and the wider button reflowed the
toolbar. It now puts back the label the button actually had. Beside it, the
header's flex spacer had a height of its own: the header wraps at 1400px as soon
as the seed history appears and “Undo …” grows a label, and a wrapped
`flex: 1` item becomes an empty band — a measured 96px of nothing between the
two toolbar rows. The spacer collapses now, and the undo label, which is written
from the action it will undo, is capped at 17ch so it cannot re-wrap the bar
mid-session.

Two of the three dark palettes failed WCAG on the most-pressed button in the
tool. White on `#4da3ff` is 2.63:1; Export JSON and the selected randomizer chip
both wore it. A `--on-accent` token per palette makes that dark text on the
light-blue accents (6.7:1) and leaves the light themes as they were. The same
sweep turned up three tokens that no palette has ever defined — `--ok`,
`--warn` and `--win`, read by the phase-cost hints and the poll movement column,
which meant those rules painted one light-theme hex in every theme (3.19:1 and
3.30:1 on white; a dark green on a dark panel) — plus `--upset-bg2` and
`--upset-bg3`, so a dark bracket drew its heaviest upsets in the light theme's
browns. All of them now read tokens the palettes set. `tools/tests/ui.js` is a
new static check that fails on any `var(--x)` the stylesheet never defines,
because a `var()` with a fallback is valid CSS that renders in silence and that
is exactly how those five survived.

The bracket scrolled the whole page sideways on a phone. `.regionbox` sized
itself to the full 814px bracket inside a 366px column, so the March Madness tab
made the document 826px wide at a 390px viewport: every other tab then sat in a
half-width column with the rest of the screen blank. The regions are capped to
their column now and the bracket scrolls inside its own box, which is what
`.bracket { overflow-x: auto }` was always for. In the export dialog, the
five-column table of BBGM import routes was 200px wider than the 560px dialog,
so the two columns that answer “does this keep my awards” sat off the right edge
behind a scrollbar nobody looks for inside a dialog; it wraps to a fixed layout
now.

Two small verbs earned their place. Every note card carries its own Copy button
— “Copy all notes” wrote seventy of them into the clipboard, which is the wrong
verb for pasting one prospect into a forum post — and every export now names the
file it wrote: `download()` records the name and the statuses that used to read
“Season exported.” read “Wrote season_249663942.csv — …”, which is the only
confirmation a browser that saves silently to a download folder ever gives.

Measured, on the 70-man sample class: a reroll is 647ms end to end (median of
five, busy indicator up throughout), a re-apply 98ms, and a batch of six 3.5s
on the worker. Tab renders are 13–45ms except the AP poll (143ms), the game log
(110ms) and the bracket (251ms); the bracket is the one worth a second look if
the tab switching ever feels heavy. `tools/uismoke.js` grew twelve checks over
the chrome — the copy button's label, the wrapped header, the phone bracket, the
accent contrast in all three dark themes, the dialog's route table, the per-note
copy and the named export.
