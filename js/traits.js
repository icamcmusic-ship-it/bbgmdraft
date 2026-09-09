/* THE TRAIT LAYER.

   An archetype is a SHAPE — what a player's rating vector looks like, and
   therefore what his box score looks like. A trait is everything a scout
   writes down that is not a shape: how long his arms are, whether he plays
   hard, whether he can finish with his left hand, whether the knee is a
   question. The tool had 121 builds, 29 flavors, 32 anomalies, 5 draft
   events, 20 coach styles and 6 star-returner kinds, and none of that
   vocabulary. A note could say a prospect was a Rim Protector at 6'11" and
   could not say he had a seven-foot-four wingspan, which is the first thing
   any human being would have written about him.

   Traits are ORTHOGONAL to builds, which is the whole argument for them: 131
   builds and a trait table multiply rather than add. A Rim Protector with a
   plus-seven wingspan and a Rim Protector with short arms and a great motor
   are two different prospects drawn from one row of the archetype table.

   What a trait can do, in order of how much of it there is:

     - a NOTE LINE. One clause in the scouting sentence, which is what a
       trait is mostly for.
     - an ADJECTIVE the news can use.
     - a BBGM `moodTraits` letter on export. BBGM's four are F (fame), L
       (loyalty), $ (money) and W (winning), and until now the tool wrote
       none of them, so an imported class arrived with whatever BBGM
       happened to roll. A leader gets L, a competitor gets W, a player
       who has been told he is a lottery pick since he was fifteen gets F.
     - a numeric EFFECT, for the handful that the simulation can actually
       express: volatility (night-to-night spread in the game log), the
       offensive/defensive rebound split, the injury roll.

   A trait that does none of those is not in the table. "A specialization you
   cannot see is a label" is the archetype table's standard and it applies
   here with more force, because a trait is cheaper to add and therefore
   easier to add carelessly.

   PREREQUISITES. Every trait states what has to be true of a player before it
   can be drawn: a height band, a class year, build tags he must or must not
   carry. A seven-footer is not "shifty"; a freshman is not "a fifth-year
   professional in a college gym"; a Sharpshooter is not "a non-shooter with
   a broken release". The gates are what make the draw read as a scouting
   report rather than as a shuffle. */
(function (global) {
	"use strict";

	const { clamp } = global.BBGMRng;

	/* Groups exist so the drawer can take at most one trait from each: a
	   player with three different opinions about his wingspan is not a
	   scouting report. */
	const GROUPS = [
		"frame", "athleticism", "motor", "character", "finishing", "shooting",
		"passing", "defense", "rebounding", "medical", "background", "role",
	];

	/* `needs` fields, all optional:
	     minHgt / maxHgt   the BBGM hgt rating band
	     tags              every one of these build tags is required
	     anyTag            at least one of these
	     notTag            none of these
	     years             the class years it can apply to
	     minOvr / maxOvr
	     transfer          true if the player must be a transfer
	     off               the BUILD's authored offsets, [lo, hi] per rating
	                       and either side null — "his build has to be at
	                       least this good at this" (see RAW_OFFSETS)
	     minInj / maxInj   the build's own injury multiplier (`inj` in the
	                       archetype table, 1 when it has none). A durability
	                       build sits at 0.45 and an injury-prone one at 2.0,
	                       so maxInj gates the clean-file traits away from the
	                       fragile builds and minInj the medical-history ones
	                       away from the iron men.
	   `eff` fields, all optional:
	     vol               multiplier on night-to-night spread (see gameLog)
	     orbBias           shifts the offensive/defensive rebound split
	     inj               multiplier on the injury roll
	   `mood` is a BBGM moodTraits letter. */
	const TRAITS = [
		// --------------------------------------------------------- frame
		{ name: "plus wingspan", group: "frame", w: 2.4,
			note: "a wingspan that measures several inches past his height",
			adj: "long-armed", eff: { orbBias: 0.04 } },
		{ name: "short arms", group: "frame", w: 1.0,
			note: "arms that measure short for his position, which shows at the rim",
			adj: "short-armed", eff: { orbBias: -0.03 } },
		{ name: "elite standing reach", group: "frame", w: 1.2, needs: { minHgt: 58 },
			note: "a standing reach that puts him at the rim without leaving the floor",
			adj: "high-shouldered" },
		{ name: "room to fill out", group: "frame", w: 2.6, needs: { years: ["Freshman", "Sophomore"] },
			note: "a frame that will carry another twenty pounds",
			adj: "wiry" },
		{ name: "maxed-out frame", group: "frame", w: 1.4, needs: { years: ["Senior", "Graduate"], off: { stre: [-10, null] } },
			note: "a body that is not going to change much from here",
			adj: "physically finished" },
		{ name: "narrow-shouldered", group: "frame", w: 1.1,
			note: "narrow shoulders that make contact a problem he has to solve some other way",
			adj: "slight" },
		/* The physical traits are gated on the BUILD's own offsets, not only
		   on height and class year. "Genuinely strong" was drawable on 19
		   builds that author stre -8 or worse (Toughness Question at -22),
		   "explosive first step" on 38 with spd -8 or worse, and so on down —
		   a scouting line that the rating vector beside it flatly denies. */
		{ name: "genuinely strong", group: "frame", w: 1.6, needs: { off: { stre: [-4, null] } },
			note: "the kind of strength that decides where he gets to catch it",
			adj: "powerful" },

		// ---------------------------------------------------- athleticism
		{ name: "explosive first step", group: "athleticism", w: 2.0, needs: { maxHgt: 62, off: { spd: [-4, null] } },
			note: "a first step that gets him past his man without a screen",
			adj: "explosive" },
		{ name: "two-foot leaper", group: "athleticism", w: 1.6, needs: { off: { jmp: [-6, null] } },
			note: "a two-foot leaper who needs a gather but goes very high off it",
			adj: "bouncy" },
		{ name: "quick off one foot", group: "athleticism", w: 1.6, needs: { off: { jmp: [-6, null] } },
			note: "a one-foot leaper in traffic, which is the useful kind",
			adj: "springy" },
		{ name: "lateral quickness", group: "athleticism", w: 1.8, needs: { off: { spd: [-4, null] } },
			note: "lateral quickness that is better than his straight-line speed",
			adj: "quick-footed" },
		{ name: "straight-line only", group: "athleticism", w: 1.3,
			note: "straight-line speed that does not survive a change of direction",
			adj: "north-south" },
		{ name: "heavy-footed", group: "athleticism", w: 1.2, needs: { minHgt: 55, off: { spd: [null, 6] } },
			note: "feet that are a step slow on the perimeter and will be tested there",
			adj: "ground-bound" },
		{ name: "plays above the rim", group: "athleticism", w: 1.4, needs: { anyTag: ["athletic"] },
			note: "a vertical that makes the lob a real option rather than a highlight",
			adj: "vertical" },

		// ----------------------------------------------------------- motor
		{ name: "relentless motor", group: "motor", w: 2.2, needs: { off: { endu: [-8, null] } },
			note: "a motor that does not stop, which shows up in the possessions nobody counts",
			adj: "relentless", mood: "W" },
		{ name: "motor questions", group: "motor", w: 1.4,
			note: "stretches where the effort comes and goes",
			adj: "streaky-effort", eff: { vol: 1.22 } },
		{ name: "plays every possession", group: "motor", w: 1.5, needs: { off: { endu: [-8, null] } },
			note: "a habit of finishing every possession, on both ends",
			adj: "conscientious", mood: "W" },
		{ name: "conditioning questions", group: "motor", w: 1.0, needs: { off: { endu: [null, 8] } },
			note: "conditioning that becomes a factor in the second half",
			adj: "winded" },

		// ------------------------------------------------------- character
		{ name: "natural leader", group: "character", w: 1.5, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "the voice in the huddle, which the staff will tell you about first",
			adj: "vocal", mood: "L" },
		{ name: "fierce competitor", group: "character", w: 2.0,
			note: "a competitiveness that occasionally has to be managed",
			adj: "combative", mood: "W" },
		{ name: "supremely coachable", group: "character", w: 1.8,
			note: "a player who takes coaching and applies it inside a week",
			adj: "coachable", mood: "L" },
		{ name: "stubborn", group: "character", w: 1.0, mood: "$",
			note: "a stubborn streak about his own shot selection",
			adj: "headstrong" },
		{ name: "plays up to competition", group: "character", w: 1.4,
			note: "his best games against the best opponents, which is the split that matters",
			adj: "big-game", eff: { vol: 1.15 } },
		{ name: "shrinks in the big ones", group: "character", w: 0.9,
			note: "numbers that fall away against ranked opponents",
			adj: "inconsistent", eff: { vol: 1.2 } },
		{ name: "highly recruited since fifteen", group: "character", w: 1.2,
			note: "a player who has been told he was a professional since he was fifteen",
			adj: "hyped", mood: "F" },
		{ name: "chip on the shoulder", group: "character", w: 1.6,
			note: "a chip about being under-recruited that has not worn off",
			adj: "driven", mood: "W" },
		{ name: "quiet professional", group: "character", w: 1.4,
			note: "a professional temperament that never asks for anything",
			adj: "unflappable", mood: "L" },
		{ name: "focus lapses", group: "character", w: 1.0,
			note: "concentration that goes for four or five possessions at a time",
			adj: "distractible", eff: { vol: 1.18 } },

		// ------------------------------------------------------- finishing
		{ name: "off-hand finisher", group: "finishing", w: 1.6, needs: { maxHgt: 68 },
			note: "the ability to finish with his off hand, which almost nobody at this level has",
			adj: "ambidextrous" },
		{ name: "right hand only", group: "finishing", w: 1.5, needs: { maxHgt: 68 },
			note: "a right hand he goes to every single time, which better defenders will take away",
			adj: "one-handed" },
		{ name: "elite floater", group: "finishing", w: 1.4, needs: { maxHgt: 56 },
			note: "a floater he can get to over anybody",
			adj: "crafty" },
		{ name: "finishes through contact", group: "finishing", w: 1.7,
			note: "a willingness to go through the chest rather than around it",
			adj: "physical" },
		{ name: "avoids contact", group: "finishing", w: 1.1,
			note: "a tendency to fade away from contact at the rim",
			adj: "soft-finishing" },
		{ name: "no counter to the drive", group: "finishing", w: 1.2, needs: { maxHgt: 60 },
			note: "one move to the rim and nothing after it",
			adj: "one-dimensional" },

		// -------------------------------------------------------- shooting
		{ name: "quick release", group: "shooting", w: 1.8, needs: { anyTag: ["shooting", "scoring"], off: { tp: [-6, null] } },
			note: "a release quick enough that a closeout does not reach it",
			adj: "quick-triggered" },
		{ name: "slow, high release", group: "shooting", w: 1.2, needs: { off: { tp: [-8, null] } },
			note: "a slow release he gets away because of his height and will not at the next level",
			adj: "deliberate" },
		{ name: "two-motion jumper", group: "shooting", w: 1.3, needs: { off: { tp: [-8, null] } },
			note: "a two-motion jumper that works standing still and not off the move",
			adj: "mechanical" },
		{ name: "step-back in his bag", group: "shooting", w: 1.2, needs: { maxHgt: 60, anyTag: ["scoring", "shooting"], off: { tp: [-6, null] } },
			note: "a step-back he can get to whenever the possession stalls",
			adj: "shot-creating" },
		{ name: "catch-and-shoot only", group: "shooting", w: 1.5, needs: { off: { tp: [-4, null] } },
			note: "a jumper that lives entirely on the catch",
			adj: "spot-up" },
		{ name: "NBA range already", group: "shooting", w: 1.1, needs: { anyTag: ["shooting"], off: { tp: [2, null] } },
			note: "range that already extends well past the college line",
			adj: "deep-range" },
		{ name: "broken free-throw stroke", group: "shooting", w: 0.9, needs: { minHgt: 60, off: { ft: [null, 2] } },
			note: "a free-throw stroke that has not been fixed in three years of trying",
			adj: "non-shooting" },

		// --------------------------------------------------------- passing
		{ name: "reads the second defender", group: "passing", w: 1.5, needs: { anyTag: ["playmaking"] },
			note: "the read most college guards do not make: the second defender, not the first",
			adj: "advanced" },
		{ name: "outlet passer", group: "passing", w: 1.1, needs: { minHgt: 55 },
			note: "an outlet pass that starts the break off his own defensive rebound",
			adj: "quick-outletting" },
		{ name: "post entry passer", group: "passing", w: 1.0, needs: { maxHgt: 60 },
			note: "the rare guard who can actually feed a post",
			adj: "unselfish" },
		{ name: "tunnel vision", group: "passing", w: 1.3, needs: { notTag: ["playmaking"] },
			note: "a habit of deciding what he is doing before he catches it",
			adj: "score-first" },
		{ name: "live-dribble turnovers", group: "passing", w: 1.2,
			note: "turnovers that come off the dribble rather than off the pass, which is the worse kind",
			adj: "loose" },

		// --------------------------------------------------------- defense
		{ name: "navigates screens", group: "defense", w: 1.5, needs: { maxHgt: 62 },
			note: "the ability to get over a screen rather than under it",
			adj: "connected" },
		{ name: "drop-coverage only", group: "defense", w: 1.4, needs: { minHgt: 58, off: { spd: [null, 6] } },
			note: "a big who can play drop and cannot play anything else",
			adj: "conservative" },
		{ name: "switchable one through four", group: "defense", w: 1.2, needs: { minHgt: 40, maxHgt: 76 },
			note: "the size and feet to switch across four positions",
			adj: "switchable" },
		{ name: "closeout discipline", group: "defense", w: 1.3,
			note: "closeouts that arrive under control, which is a coached habit and a rare one",
			adj: "disciplined" },
		{ name: "gambles for steals", group: "defense", w: 1.4, needs: { anyTag: ["defense", "athletic"] },
			note: "a gambler in the passing lanes whose team pays for the misses",
			adj: "risk-taking" },
		{ name: "takes charges", group: "defense", w: 1.0,
			note: "a willingness to stand in front of somebody bigger and take the contact",
			adj: "sacrificing", mood: "W" },
		{ name: "loses his man off the ball", group: "defense", w: 1.3,
			note: "off-ball attention that comes and goes",
			adj: "ball-watching" },
		{ name: "transition defense questions", group: "defense", w: 1.1,
			note: "a habit of watching his own shot rather than getting back",
			adj: "slow-retreating" },

		// ------------------------------------------------------- rebounding
		{ name: "boxes out", group: "rebounding", w: 1.4, needs: { minHgt: 48 },
			note: "a genuine box-out habit, which is the least glamorous thing on this list",
			adj: "fundamental", eff: { orbBias: -0.05 } },
		{ name: "chases his own miss", group: "rebounding", w: 1.5, needs: { off: { reb: [-6, null] } },
			note: "an instinct for his own miss that produces second chances nobody schemed",
			adj: "opportunistic", eff: { orbBias: 0.08 } },
		{ name: "rebounds out of area", group: "rebounding", w: 1.2, needs: { minHgt: 52 },
			note: "the range to get to a rebound two men away from him",
			adj: "rangy", eff: { orbBias: 0.03 } },
		{ name: "gets moved under the rim", group: "rebounding", w: 1.1, needs: { minHgt: 55 },
			note: "a base that stronger fives move at will",
			adj: "movable", eff: { orbBias: -0.04 } },

		// --------------------------------------------------------- medical
		{ name: "clean medical", group: "medical", w: 2.6, needs: { maxInj: 1.4 },
			note: "a clean file, which is worth saying out loud",
			adj: "durable", eff: { inj: 0.85 } },
		{ name: "prior surgery", group: "medical", w: 1.2, needs: { minInj: 0.7 },
			note: "a surgery in his file that teams will want their own doctors to read",
			adj: "reconstructed", eff: { inj: 1.25 } },
		{ name: "chronic knee", group: "medical", w: 0.8, needs: { minInj: 0.7 },
			note: "a knee that is managed rather than fixed",
			adj: "managed", eff: { inj: 1.5 } },
		{ name: "ankle history", group: "medical", w: 1.1, needs: { minInj: 0.7 },
			note: "ankles that have cost him games in each of the last two seasons",
			adj: "brittle", eff: { inj: 1.3 } },
		{ name: "has not missed a game", group: "medical", w: 1.6, needs: { years: ["Junior", "Senior", "Graduate"], maxInj: 1.4 },
			note: "a career without a missed game in it",
			adj: "available", eff: { inj: 0.7 } },

		// ------------------------------------------------------ background
		{ name: "young for his class", group: "background", w: 1.3, needs: { years: ["Freshman", "Sophomore"] },
			note: "a late birthday that makes him young for everything he has done",
			adj: "young", mood: "F" },
		{ name: "old for his class", group: "background", w: 1.1,
			note: "an age that flatters the production a little",
			adj: "experienced" },
		{ name: "family in the sport", group: "background", w: 1.0,
			note: "a family that has done this before, which shows in the parts nobody teaches",
			adj: "well-schooled" },
		{ name: "played four sports", group: "background", w: 0.9,
			note: "a multi-sport background and a body that reflects it",
			adj: "athletic" },
		{ name: "a long way from home", group: "background", w: 1.2,
			note: "a school two time zones from where he grew up",
			adj: "far-flung" },
		{ name: "stayed home", group: "background", w: 1.4,
			note: "a hometown school and a building full of people who have watched him since he was twelve",
			adj: "local", mood: "L" },
		{ name: "came up through the prep circuit", group: "background", w: 1.3,
			note: "a prep-school year that everybody involved describes as the making of him",
			adj: "prep-schooled" },
		{ name: "learned the game late", group: "background", w: 1.0, needs: { anyTag: ["raw", "athletic"] },
			note: "a player who picked up a basketball at fifteen and is still catching up",
			adj: "unpolished" },

		// ------------------------------------------------------------ role
		{ name: "sixth man", group: "role", w: 1.3,
			note: "a bench role he has taken to rather than argued with",
			adj: "instant-offence", mood: "L" },
		{ name: "wants it late", group: "role", w: 1.4, needs: { anyTag: ["scoring", "shooting"] },
			note: "the man his team goes to with the game on it",
			adj: "clutch", mood: "W", eff: { vol: 1.1 } },
		{ name: "positional versatility", group: "role", w: 1.4,
			note: "three positions he can play and none he is obviously best at",
			adj: "positionless" },
		{ name: "one position only", group: "role", w: 1.2,
			note: "one position, played well, with nothing behind it",
			adj: "specialised" },
		{ name: "system-dependent", group: "role", w: 1.2,
			note: "production that is hard to separate from the offence he plays in",
			adj: "system-reliant" },
		{ name: "would start anywhere", group: "role", w: 0.9, needs: { minOvr: 45 },
			note: "a player who would start for any programme in the country",
			adj: "high-floor" },
		/* --- a hundred and fifty more ---------------------------------------

		   Seventy-seven traits over twelve groups is six or seven rows per
		   group, and the one-per-group rule means a player draws at most one
		   of each: measured over a class, the frame clause was one of six
		   sentences and the medical clause one of five. Two prospects with the
		   same build and the same two groups drawn therefore read as the same
		   note about a third of the time, which is the exact fault the layer
		   was built to fix, one level down.

		   Every row below states its prerequisites on the same terms as the
		   ones above it — a height band, a class year, the BUILD's own
		   authored offsets, the build's injury multiplier — so the note stays
		   a scouting report rather than a shuffle. A trait that contradicts
		   the rating vector printed beside it is worse than no trait. */

		// --------------------------------------------------------- frame
		{ name: "broad-shouldered already", group: "frame", w: 1.5, needs: { off: { stre: [-2, null] } },
			note: "shoulders that are already a professional's, whatever the rest of him does",
			adj: "broad" },
		{ name: "long torso, short legs", group: "frame", w: 0.9,
			note: "a build that leaves him lower to the floor than his height suggests",
			adj: "low-slung" },
		{ name: "high hips", group: "frame", w: 1.0, needs: { minHgt: 50 },
			note: "high hips that make him slower to change direction than his feet are",
			adj: "stiff-hipped" },
		{ name: "huge hands", group: "frame", w: 1.1,
			note: "hands big enough that he catches everything thrown near him",
			adj: "sure-handed" },
		{ name: "small hands", group: "frame", w: 0.8,
			note: "hands that show up on the film every time he tries to palm one",
			adj: "small-handed" },
		{ name: "carries weight badly", group: "frame", w: 1.0, needs: { off: { endu: [null, 6] } },
			note: "a body that carries its weight in the wrong places and shows it late",
			adj: "heavy" },
		{ name: "already at his ceiling physically", group: "frame", w: 1.2, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "a frame three years of a college weight room has finished with",
			adj: "developed" },
		{ name: "seven-foot wingspan at six-five", group: "frame", w: 0.8, needs: { minHgt: 38, maxHgt: 56 },
			note: "a wingspan that measures seven feet on a six-five frame",
			adj: "freakishly long" },
		{ name: "shorter than listed", group: "frame", w: 1.2,
			note: "a measurement at the combine that came back two inches under the programme's",
			adj: "over-listed" },
		{ name: "taller than listed", group: "frame", w: 0.7,
			note: "a measurement that came back over what he has been listed at for three years",
			adj: "under-listed" },
		{ name: "thin ankles and wrists", group: "frame", w: 0.9, needs: { minInj: 0.7 },
			note: "the joints of a much smaller player, which is a durability question",
			adj: "fine-boned" },
		{ name: "put on twenty pounds", group: "frame", w: 1.3, needs: { years: ["Sophomore", "Junior", "Senior", "Graduate"] },
			note: "twenty pounds added since he arrived, and none of it in the wrong place",
			adj: "filled-out" },
		{ name: "still growing", group: "frame", w: 0.9, needs: { years: ["Freshman", "Sophomore"], anyTag: ["raw"] },
			note: "a body that has not stopped growing and a game that has not caught up",
			adj: "growing" },

		// ---------------------------------------------------- athleticism
		{ name: "elite deceleration", group: "athleticism", w: 1.2, needs: { off: { spd: [-6, null] } },
			note: "the ability to stop, which is rarer at this level than the ability to go",
			adj: "controlled" },
		{ name: "second-jump quickness", group: "athleticism", w: 1.5, needs: { off: { jmp: [-4, null] } },
			note: "a second jump that arrives before anybody else's first",
			adj: "twitchy" },
		{ name: "slow off the floor", group: "athleticism", w: 1.2, needs: { off: { jmp: [null, 8] } },
			note: "a jump that needs two steps of runway he will not get at the next level",
			adj: "flat-footed" },
		{ name: "runs the floor every possession", group: "athleticism", w: 1.4, needs: { off: { endu: [-6, null] } },
			note: "a habit of beating everybody down the floor, which is a conditioning statement",
			adj: "fast-breaking" },
		{ name: "top-end speed only", group: "athleticism", w: 1.0, needs: { off: { spd: [-2, null] } },
			note: "genuine top-end speed and nothing in the first two steps",
			adj: "long-striding" },
		{ name: "plays below the rim", group: "athleticism", w: 1.3, needs: { off: { jmp: [null, 6] } },
			note: "a game played entirely below the rim, by necessity rather than by choice",
			adj: "earthbound" },
		{ name: "fluid hips", group: "athleticism", w: 1.3, needs: { maxHgt: 70 },
			note: "hips fluid enough to turn and run with a guard",
			adj: "loose-hipped" },
		{ name: "recovery athleticism", group: "athleticism", w: 1.2, needs: { anyTag: ["defense", "athletic"] },
			note: "the recovery speed to be beaten and still contest it",
			adj: "recovering" },
		{ name: "old-man athleticism", group: "athleticism", w: 1.0, needs: { years: ["Senior", "Graduate"] },
			note: "an athlete who has learned to play without being one any more",
			adj: "cerebral" },
		{ name: "jumps off two on the move", group: "athleticism", w: 1.1, needs: { off: { jmp: [-4, null], spd: [-8, null] } },
			note: "the rare gather that keeps its height at full speed",
			adj: "coordinated" },
		{ name: "recovering from a growth spurt", group: "athleticism", w: 0.8, needs: { years: ["Freshman", "Sophomore"], anyTag: ["raw"] },
			note: "the coordination of a player whose body outgrew him a year ago",
			adj: "gangly" },
		{ name: "combine athlete", group: "athleticism", w: 1.0, needs: { anyTag: ["athletic"] },
			note: "the testing numbers of a first-round pick and the film of a second-rounder",
			adj: "testing-friendly" },

		// ----------------------------------------------------------- motor
		{ name: "sprints back on defense", group: "motor", w: 1.4, needs: { off: { endu: [-6, null] } },
			note: "the first man back on every miss, which nobody is asked to do twice",
			adj: "hard-running", mood: "W" },
		{ name: "goes through the motions in blowouts", group: "motor", w: 1.0,
			note: "possessions off when the game is decided, which the film shows and the box score does not",
			adj: "coasting", eff: { vol: 1.12 } },
		{ name: "practices the way he plays", group: "motor", w: 1.3,
			note: "a practice habit the staff will bring up before the scouting report does",
			adj: "professional", mood: "L" },
		{ name: "dives for everything", group: "motor", w: 1.2, needs: { off: { endu: [-10, null] } },
			note: "a willingness to hit the floor that has already cost him a wrist once",
			adj: "reckless", eff: { inj: 1.15 } },
		{ name: "needs the ball to stay engaged", group: "motor", w: 1.3, needs: { anyTag: ["scoring", "playmaking"] },
			note: "an interest in the game that follows the ball",
			adj: "ball-dependent", eff: { vol: 1.16 } },
		{ name: "second-half player", group: "motor", w: 1.1,
			note: "a player whose best twenty minutes are always the second twenty",
			adj: "slow-starting", eff: { vol: 1.14 } },
		{ name: "never comes out", group: "motor", w: 1.2, needs: { off: { endu: [-4, null] }, maxInj: 1.2 },
			note: "a minutes total his coach has stopped apologising for",
			adj: "ever-present", mood: "W" },
		{ name: "hunts the offensive glass unasked", group: "motor", w: 1.2, needs: { off: { reb: [-8, null] } },
			note: "a crash to the offensive glass nobody in the huddle called for",
			adj: "crashing", eff: { orbBias: 0.06 } },
		{ name: "talks on defense", group: "motor", w: 1.3,
			note: "a voice on the defensive end that makes four other players better",
			adj: "communicative", mood: "L" },
		{ name: "fades in March", group: "motor", w: 0.85,
			note: "a body of work that thins out in the last month of the season",
			adj: "fading", eff: { vol: 1.15 } },
		{ name: "first in the gym", group: "motor", w: 1.2,
			note: "a work ethic every staff member volunteers without being asked",
			adj: "diligent", mood: "W" },
		{ name: "argues every call", group: "motor", w: 0.9,
			note: "a running conversation with the officials that costs his team possessions",
			adj: "demonstrative", eff: { vol: 1.1 } },

		// ------------------------------------------------------- character
		{ name: "played through a broken hand", group: "character", w: 0.9, needs: { minInj: 0.7 },
			note: "a month of tape on a hand that should have been in a cast",
			adj: "uncomplaining", mood: "W" },
		{ name: "asked to be guarded by the best", group: "character", w: 1.2, needs: { anyTag: ["defense"] },
			note: "a request to take the other team's best player that the staff granted",
			adj: "willing", mood: "W" },
		{ name: "carries the programme", group: "character", w: 1.0, needs: { minOvr: 48, years: ["Junior", "Senior", "Graduate"] },
			note: "the man everything at the programme has been arranged around for two years",
			adj: "load-bearing", mood: "F" },
		{ name: "a coach on the floor", group: "character", w: 1.3, needs: { off: { oiq: [-4, null] } },
			note: "the kind of feel that makes the huddle quieter rather than louder",
			adj: "assured", mood: "L" },
		{ name: "took a demotion without a word", group: "character", w: 1.0,
			note: "a starting job lost in December and a role accepted in January",
			adj: "selfless", mood: "L" },
		{ name: "transferred after a fallout", group: "character", w: 1.0, needs: { transfer: true },
			note: "a departure everybody involved describes carefully",
			adj: "guarded", mood: "$" },
		{ name: "publicly wants the ball more", group: "character", w: 0.9, needs: { anyTag: ["scoring"] },
			note: "an opinion about his own usage that he has shared with a microphone",
			adj: "outspoken", mood: "$" },
		{ name: "the last one off the floor", group: "character", w: 1.2,
			note: "a habit of staying an hour after everybody else has gone",
			adj: "dedicated", mood: "W" },
		{ name: "reads the game two passes ahead", group: "character", w: 1.1, needs: { off: { oiq: [-2, null] } },
			note: "an anticipation that arrives before the play does",
			adj: "anticipatory" },
		{ name: "rattled by a hostile building", group: "character", w: 0.9,
			note: "road numbers that fall away in the loudest buildings",
			adj: "road-shy", eff: { vol: 1.2 } },
		{ name: "unbothered by anything", group: "character", w: 1.2,
			note: "a temperament nothing in a college gym has yet reached",
			adj: "imperturbable", eff: { vol: 0.9 } },
		{ name: "grew up watching his brother do this", group: "character", w: 0.9,
			note: "a second son who has watched the whole process happen once already",
			adj: "prepared", mood: "L" },
		{ name: "wants to be paid like a star", group: "character", w: 0.9, needs: { minOvr: 45 },
			note: "a representative who has been clear about what he expects",
			adj: "well-advised", mood: "$" },

		// ------------------------------------------------------- finishing
		{ name: "euro-step in traffic", group: "finishing", w: 1.2, needs: { maxHgt: 62, off: { drb: [-6, null] } },
			note: "a euro-step he gets to in traffic rather than in transition",
			adj: "elusive" },
		{ name: "finishes over both shoulders", group: "finishing", w: 1.1, needs: { minHgt: 54, off: { ins: [-4, null] } },
			note: "a right and a left shoulder in the post, which is two moves more than most",
			adj: "two-sided" },
		{ name: "no touch inside ten feet", group: "finishing", w: 1.2, needs: { off: { ins: [null, 8] } },
			note: "a complete absence of touch inside ten feet",
			adj: "touchless" },
		{ name: "lives at the rim", group: "finishing", w: 1.4, needs: { off: { dnk: [-4, null] } },
			note: "a shot chart that is a cluster at the rim and almost nothing else",
			adj: "rim-bound" },
		{ name: "finishes above the square", group: "finishing", w: 1.2, needs: { off: { jmp: [-4, null] } },
			note: "a catch radius at the rim that turns bad passes into dunks",
			adj: "high-catching" },
		{ name: "gathers too early", group: "finishing", w: 1.0,
			note: "a gather a beat early that gives the help time to arrive",
			adj: "predictable" },
		{ name: "reverse layup specialist", group: "finishing", w: 0.9, needs: { maxHgt: 64 },
			note: "an ability to get to the other side of the rim that keeps him upright",
			adj: "shifty" },
		{ name: "cannot finish through a second body", group: "finishing", w: 1.2, needs: { off: { stre: [null, 6] } },
			note: "a finishing profile that collapses the moment a second defender arrives",
			adj: "contact-averse" },
		{ name: "seeks the foul rather than the shot", group: "finishing", w: 1.1, needs: { off: { ft: [-4, null] } },
			note: "a hunt for contact that the officials have not always rewarded",
			adj: "foul-hunting" },
		{ name: "soft hands in the pocket", group: "finishing", w: 1.1, needs: { minHgt: 50 },
			note: "hands soft enough to catch the pocket pass and finish in one motion",
			adj: "soft-handed" },
		{ name: "dunks everything or nothing", group: "finishing", w: 1.0, needs: { off: { dnk: [-2, null] } },
			note: "a rim attack with a dunk and no fallback under it",
			adj: "all-or-nothing", eff: { vol: 1.12 } },
		{ name: "off-balance finisher", group: "finishing", w: 0.9, needs: { maxHgt: 62 },
			note: "a comfort finishing off the wrong foot that cannot really be coached",
			adj: "improvisational" },

		// -------------------------------------------------------- shooting
		{ name: "shoots it off either foot", group: "shooting", w: 1.1, needs: { off: { tp: [-4, null] } },
			note: "a jumper that does not care which foot he lands on",
			adj: "balanced" },
		{ name: "one-legged runner", group: "shooting", w: 1.0, needs: { maxHgt: 60, off: { fg: [-6, null] } },
			note: "a one-legged runner from fifteen feet that nobody has ever blocked",
			adj: "unorthodox" },
		{ name: "the form is broken but it goes in", group: "shooting", w: 1.0, needs: { off: { tp: [-6, null] } },
			note: "mechanics that no coach would teach and a percentage nobody argues with",
			adj: "self-taught" },
		{ name: "free-throw shooter first", group: "shooting", w: 1.2, needs: { off: { ft: [-2, null] } },
			note: "a free-throw line that is the most reliable thing about him",
			adj: "automatic" },
		{ name: "hesitant to let it go", group: "shooting", w: 1.1,
			note: "an open three he passes up more often than he takes",
			adj: "reluctant" },
		{ name: "shoots better off the dribble than the catch", group: "shooting", w: 0.9, needs: { anyTag: ["scoring"], off: { fg: [-4, null] } },
			note: "the wrong way round: better contested off the dribble than open on the catch",
			adj: "rhythmic" },
		{ name: "range comes and goes", group: "shooting", w: 1.2, needs: { off: { tp: [-8, null] } },
			note: "a stroke that is a weapon for three weeks and gone for three more",
			adj: "streaky", eff: { vol: 1.24 } },
		{ name: "flat trajectory", group: "shooting", w: 1.0,
			note: "a flat ball that a longer closeout will start reaching",
			adj: "line-drive" },
		{ name: "shoots it from the logo", group: "shooting", w: 0.8, needs: { anyTag: ["shooting"], off: { tp: [2, null] } },
			note: "a willingness to shoot from five feet past where he should",
			adj: "limitless", eff: { vol: 1.15 } },
		{ name: "midrange only", group: "shooting", w: 1.0, needs: { off: { fg: [-2, null], tp: [null, 8] } },
			note: "a shot profile built entirely between the paint and the arc",
			adj: "old-fashioned" },
		{ name: "guarded shooter", group: "shooting", w: 1.1, needs: { off: { tp: [-2, null] } },
			note: "a reputation that means he has not seen an open catch since November",
			adj: "closely-watched" },
		{ name: "left-handed release", group: "shooting", w: 1.0,
			note: "a left-handed stroke that scouting reports keep forgetting to mention",
			adj: "left-handed" },
		{ name: "shoots better tired", group: "shooting", w: 0.7, needs: { off: { endu: [-6, null] } },
			note: "a late-game percentage that goes up rather than down",
			adj: "unfazed" },

		// --------------------------------------------------------- passing
		{ name: "throws it ahead", group: "passing", w: 1.3, needs: { off: { pss: [-6, null] } },
			note: "a habit of throwing it ahead rather than dribbling into the break",
			adj: "advancing" },
		{ name: "one-handed live-dribble passer", group: "passing", w: 1.1, needs: { anyTag: ["playmaking"], off: { drb: [-4, null] } },
			note: "the ability to pass off a live dribble with either hand",
			adj: "dexterous" },
		{ name: "great passer, bad decisions", group: "passing", w: 1.2, needs: { anyTag: ["playmaking"] },
			note: "the passes are professional; the decisions about when to throw them are not",
			adj: "adventurous", eff: { vol: 1.14 } },
		{ name: "does not see the weak side", group: "passing", w: 1.2, needs: { off: { oiq: [null, 8] } },
			note: "a field of vision that stops at the middle of the floor",
			adj: "near-sighted" },
		{ name: "hits the roller", group: "passing", w: 1.3, needs: { off: { pss: [-6, null] } },
			note: "the pocket pass to a rolling big, on time, most nights",
			adj: "connective" },
		{ name: "passes out of the post", group: "passing", w: 1.0, needs: { minHgt: 56 },
			note: "the willingness to give it up out of a double rather than shoot through it",
			adj: "generous" },
		{ name: "telegraphs the skip", group: "passing", w: 1.0,
			note: "a skip pass the whole gym can see coming, including the help",
			adj: "readable" },
		{ name: "assist numbers flatter him", group: "passing", w: 1.1, needs: { anyTag: ["playmaking"] },
			note: "an assist total that says more about who he plays with than about him",
			adj: "well-served" },
		{ name: "no turnovers, no risk either", group: "passing", w: 1.2,
			note: "a turnover rate that is low because nothing he throws is difficult",
			adj: "risk-averse" },
		{ name: "passes ahead of the cut", group: "passing", w: 1.0, needs: { off: { oiq: [-4, null] } },
			note: "a pass that arrives where the cutter is going rather than where he is",
			adj: "timely" },
		{ name: "the best passer on the floor", group: "passing", w: 0.9, needs: { anyTag: ["playmaking"], off: { pss: [4, null] } },
			note: "the best passer in most buildings he walks into",
			adj: "gifted" },
		{ name: "dribbles the air out of it", group: "passing", w: 1.2, needs: { notTag: ["playmaking"] },
			note: "possessions that end four seconds after they should have moved",
			adj: "ball-stopping" },

		// --------------------------------------------------------- defense
		{ name: "guards two through four", group: "defense", w: 1.3, needs: { minHgt: 44, maxHgt: 72 },
			note: "three positions he can guard without the scheme changing",
			adj: "multi-positional" },
		{ name: "cannot guard a ball screen", group: "defense", w: 1.2, needs: { off: { diq: [null, 8] } },
			note: "a ball screen he has not yet found an answer to, over or under",
			adj: "screened" },
		{ name: "verticality without fouling", group: "defense", w: 1.2, needs: { minHgt: 56, off: { diq: [-4, null] } },
			note: "a habit of going straight up, which is why he is never in foul trouble",
			adj: "vertical-contesting" },
		{ name: "reaches instead of sliding", group: "defense", w: 1.2,
			note: "hands where his feet should be, which is two fouls a half",
			adj: "grabby" },
		{ name: "digs at the post", group: "defense", w: 1.0, needs: { maxHgt: 64 },
			note: "a willingness to leave his man and dig at a post-up",
			adj: "helping" },
		{ name: "blows up the handoff", group: "defense", w: 1.0, needs: { off: { diq: [-6, null] } },
			note: "an ability to kill a handoff before it happens",
			adj: "disruptive" },
		{ name: "rotates a half-second late", group: "defense", w: 1.2,
			note: "rotations that arrive, but always half a second after they were needed",
			adj: "late-rotating" },
		{ name: "hunted in every scouting report", group: "defense", w: 1.1, needs: { off: { diq: [null, 4] } },
			note: "a defender every opposing staff has circled by January",
			adj: "targeted" },
		{ name: "elite at the point of attack", group: "defense", w: 1.1, needs: { maxHgt: 58, off: { diq: [-2, null] } },
			note: "pressure at the point of attack that changes what an offence can call",
			adj: "pressuring" },
		{ name: "does not foul", group: "defense", w: 1.2, needs: { off: { diq: [-8, null] } },
			note: "a foul rate low enough that he has never fouled out",
			adj: "clean" },
		{ name: "two-nine steals a game and four blow-bys", group: "defense", w: 1.0, needs: { anyTag: ["defense", "athletic"] },
			note: "the steal total of a great defender and the film of an average one",
			adj: "gambling", eff: { vol: 1.12 } },
		{ name: "big-to-big helper", group: "defense", w: 0.9, needs: { minHgt: 58 },
			note: "the low-man rotation, on time, which is the least visible job on the floor",
			adj: "rotational" },
		{ name: "cannot be posted", group: "defense", w: 1.0, needs: { off: { stre: [-4, null] } },
			note: "a base that nothing at this level has moved off the block",
			adj: "immovable" },

		// ------------------------------------------------------- rebounding
		{ name: "rebounds in traffic", group: "rebounding", w: 1.3, needs: { off: { reb: [-4, null], stre: [-8, null] } },
			note: "a rebounder in a crowd rather than in space, which is the harder kind",
			adj: "strong-handed", eff: { orbBias: 0.03 } },
		{ name: "tips it to himself", group: "rebounding", w: 1.0, needs: { off: { reb: [-6, null] } },
			note: "a tip-out habit that turns one rebound into two chances",
			adj: "quick-tipping", eff: { orbBias: 0.05 } },
		{ name: "leaks out early", group: "rebounding", w: 1.1,
			note: "a break he starts before the rebound is secured, which costs as often as it pays",
			adj: "leaking", eff: { orbBias: -0.06 } },
		{ name: "rebounds only in his area", group: "rebounding", w: 1.2, needs: { minHgt: 50 },
			note: "a rebounder who gets everything within an arm's length and nothing outside it",
			adj: "stationary", eff: { orbBias: -0.02 } },
		{ name: "guard who rebounds like a four", group: "rebounding", w: 0.9, needs: { maxHgt: 46, off: { reb: [-4, null] } },
			note: "a guard whose rebounding numbers belong to somebody eight inches taller",
			adj: "glass-crashing", eff: { orbBias: 0.04 } },
		{ name: "outmuscled on the defensive glass", group: "rebounding", w: 1.1, needs: { off: { stre: [null, 4] } },
			note: "a defensive glass he gets pushed off in the last ten minutes",
			adj: "outmuscled", eff: { orbBias: -0.05 } },
		{ name: "two hands, every time", group: "rebounding", w: 1.2,
			note: "a two-handed rebounder, which sounds like nothing until you watch one who is not",
			adj: "secure" },
		{ name: "swipes at it", group: "rebounding", w: 0.9,
			note: "a one-handed swipe at contested rebounds that turns them into loose balls",
			adj: "careless", eff: { orbBias: -0.03 } },
		{ name: "hits the offensive glass from the corner", group: "rebounding", w: 1.0, needs: { maxHgt: 66 },
			note: "a crash from the weak-side corner that nobody boxes out",
			adj: "sneaky", eff: { orbBias: 0.07 } },
		{ name: "boxes out for somebody else", group: "rebounding", w: 1.0, needs: { minHgt: 52 },
			note: "a box-out habit that shows up in his team's numbers and not in his",
			adj: "team-first", eff: { orbBias: -0.04 } },
		{ name: "rebounding is his whole case", group: "rebounding", w: 0.9, needs: { anyTag: ["rebounding"], off: { reb: [6, null] } },
			note: "a professional case that rests entirely on the glass",
			adj: "one-skilled" },
		{ name: "chases the long rebound", group: "rebounding", w: 1.0,
			note: "an instinct for where a missed three is going before it is missed",
			adj: "well-positioned", eff: { orbBias: 0.03 } },

		// --------------------------------------------------------- medical
		{ name: "stress reaction in the foot", group: "medical", w: 0.9, needs: { minInj: 0.7 },
			note: "a foot that cost him six weeks and will be looked at very closely",
			adj: "foot-flagged", eff: { inj: 1.4 } },
		{ name: "shoulder that comes out", group: "medical", w: 0.8, needs: { minInj: 0.7 },
			note: "a shoulder that has come out twice and been put back both times",
			adj: "unstable", eff: { inj: 1.3 } },
		{ name: "concussion history", group: "medical", w: 0.7, needs: { minInj: 0.7 },
			note: "two documented concussions and a protocol he has been through",
			adj: "protocol-flagged", eff: { inj: 1.2 } },
		{ name: "played the season on a torn ligament", group: "medical", w: 0.6, needs: { minInj: 0.9 },
			note: "a whole season played on something that has since been repaired",
			adj: "post-operative", eff: { inj: 1.45 }, mood: "W" },
		{ name: "cleared without conditions", group: "medical", w: 1.6, needs: { maxInj: 1.3 },
			note: "a file every team's doctor has signed off without a note attached",
			adj: "cleared", eff: { inj: 0.8 } },
		{ name: "back spasms", group: "medical", w: 0.8, needs: { minInj: 0.8 },
			note: "a back that has taken games off him in each of two seasons",
			adj: "back-flagged", eff: { inj: 1.35 } },
		{ name: "grew out of an injury-prone stretch", group: "medical", w: 1.0, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "two bad years early and two clean ones since",
			adj: "recovered", eff: { inj: 0.95 } },
		{ name: "heavy minutes with no maintenance days", group: "medical", w: 1.2, needs: { maxInj: 1.3, off: { endu: [-6, null] } },
			note: "a season of heavy minutes with not one maintenance day in it",
			adj: "unbreakable", eff: { inj: 0.75 } },
		{ name: "wears a knee brace", group: "medical", w: 1.0, needs: { minInj: 0.7 },
			note: "a brace he has worn since high school and does not intend to take off",
			adj: "braced", eff: { inj: 1.1 } },
		{ name: "hand injury that changed his shot", group: "medical", w: 0.7, needs: { minInj: 0.7 },
			note: "a hand injury the shooting numbers can be dated from",
			adj: "hand-flagged", eff: { inj: 1.15 } },
		{ name: "conditioned like a professional already", group: "medical", w: 1.1, needs: { maxInj: 1.2, off: { endu: [-4, null] } },
			note: "a body-fat number and a conditioning file that are already professional",
			adj: "well-conditioned", eff: { inj: 0.85 } },
		{ name: "missed a season entirely", group: "medical", w: 0.7, needs: { minInj: 0.9, years: ["Junior", "Senior", "Graduate"] },
			note: "a full season lost that everybody has been careful about since",
			adj: "returning", eff: { inj: 1.3 } },

		// ------------------------------------------------------ background
		{ name: "third school in four years", group: "background", w: 1.0, needs: { transfer: true },
			note: "a third programme in four years, each one a level he was chasing",
			adj: "well-travelled", mood: "$" },
		{ name: "junior-college route", group: "background", w: 1.1, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "two years of junior college that nobody at the high-major level watched",
			adj: "late-found" },
		{ name: "came out of a national programme", group: "background", w: 1.2,
			note: "a high-school programme that sends somebody to this level every year",
			adj: "well-coached", mood: "F" },
		{ name: "grew up abroad", group: "background", w: 1.1,
			note: "a first fifteen years of basketball played under different rules",
			adj: "foreign-trained" },
		{ name: "went to the same school as his father", group: "background", w: 0.8,
			note: "a jersey his father wore, which the building has not forgotten",
			adj: "legacy", mood: "L" },
		{ name: "recruited as a quarterback", group: "background", w: 0.7, needs: { anyTag: ["athletic", "raw"] },
			note: "football offers he turned down late, and a body that still says so",
			adj: "cross-sport" },
		{ name: "reclassified up a year", group: "background", w: 0.9, needs: { years: ["Freshman", "Sophomore"] },
			note: "a year skipped to get here, which explains the age and some of the rest",
			adj: "reclassified", mood: "F" },
		{ name: "walked on", group: "background", w: 1.0,
			note: "a roster spot that started as a walk-on's and is now a starter's",
			adj: "self-made", mood: "W" },
		{ name: "sat behind an all-conference player", group: "background", w: 1.2, needs: { years: ["Junior", "Senior", "Graduate"] },
			note: "two years spent behind somebody who never came out",
			adj: "patient", mood: "L" },
		{ name: "one scholarship offer", group: "background", w: 1.1,
			note: "one offer, taken in November, from a staff that has been proved right",
			adj: "under-recruited", mood: "W" },
		{ name: "top-five recruit out of high school", group: "background", w: 0.8, needs: { minOvr: 42 },
			note: "a recruiting ranking that has followed him into every building",
			adj: "blue-chip", mood: "F" },
		{ name: "prep-school reclass year", group: "background", w: 1.0,
			note: "a post-graduate year that everybody agrees was worth taking",
			adj: "post-grad" },
		{ name: "changed positions in high school", group: "background", w: 1.1, needs: { anyTag: ["raw"] },
			note: "a position he has only played for three years",
			adj: "converted" },

		// ------------------------------------------------------------ role
		{ name: "closes games he does not start", group: "role", w: 1.2,
			note: "a starter's last five minutes and a reserve's first thirty",
			adj: "closing", mood: "W" },
		{ name: "the defensive stopper role", group: "role", w: 1.2, needs: { anyTag: ["defense"] },
			note: "one job, given to him every night, that the box score does not record",
			adj: "assignment-taking" },
		{ name: "usage will not survive a level up", group: "role", w: 1.3, needs: { anyTag: ["scoring"] },
			note: "a share of the offence that no professional team will hand him",
			adj: "over-used" },
		{ name: "needs a system built for him", group: "role", w: 1.0, needs: { minOvr: 45 },
			note: "a player a staff builds around rather than fits in",
			adj: "system-defining", mood: "$" },
		{ name: "any of five roles", group: "role", w: 1.2,
			note: "five different jobs he has done competently and none he owns",
			adj: "multi-purpose" },
		{ name: "spot minutes only", group: "role", w: 1.1, needs: { maxOvr: 45 },
			note: "a role that is nine minutes when the match-up asks for him",
			adj: "situational" },
		{ name: "the release valve", group: "role", w: 1.0, needs: { anyTag: ["shooting", "playmaking"] },
			note: "the man the offence finds when the first two options are gone",
			adj: "outlet-like" },
		{ name: "starts because somebody got hurt", group: "role", w: 1.1,
			note: "a starting job that arrived in December through somebody else's knee",
			adj: "opportunity-taking" },
		{ name: "plays the four out of necessity", group: "role", w: 1.1, needs: { minHgt: 44, maxHgt: 68 },
			note: "a position he is playing because the roster has nobody else for it",
			adj: "out-of-position" },
		{ name: "asked to do too much", group: "role", w: 1.2, needs: { anyTag: ["scoring", "playmaking"] },
			note: "a role that would flatter nobody, on a roster with nothing else in it",
			adj: "overburdened", eff: { vol: 1.14 } },
		{ name: "asked to do almost nothing", group: "role", w: 1.2, needs: { maxOvr: 50 },
			note: "a role so narrow that a scout has to project the rest of him",
			adj: "under-used" },
		{ name: "the sixth starter", group: "role", w: 1.3,
			note: "a bench role in name and starter's minutes in fact",
			adj: "first-off-the-bench", mood: "L" },
		{ name: "his team's only shooter", group: "role", w: 1.0, needs: { anyTag: ["shooting"] },
			note: "the only man on his roster who can shoot, which the numbers have to be read against",
			adj: "solitary" },
	];

	/* Volatility by build. The archetype table's `vol` field is authored on
	   the handful of builds that ARE a volatility statement; everything else
	   is drawn around 1 with a spread, so two players of the same build are
	   still not identical. Traits multiply on top. */
	const VOL_SPREAD = 0.06;

	/* The heaviest weight a trait can be drawn at. See assign. */
	const W_CAP = 1.6;

	function matches(t, p) {
		const n = t.needs;
		if (!n) return true;
		const hgt = p.newRatings ? p.newRatings.hgt : 45;
		if (Number.isFinite(n.minHgt) && hgt < n.minHgt) return false;
		if (Number.isFinite(n.maxHgt) && hgt > n.maxHgt) return false;
		if (Number.isFinite(n.minOvr) && (p.newOvr || 0) < n.minOvr) return false;
		if (Number.isFinite(n.maxOvr) && (p.newOvr || 0) > n.maxOvr) return false;
		if (n.years) {
			const cy = String(p.classYear || "").replace(/^Redshirt /, "");
			if (n.years.indexOf(cy) === -1) return false;
		}
		if (n.transfer && !p.transfer) return false;
		/* Against the build's own offsets: a step-back on a Rim Runner, a
		   broken free-throw stroke on a Stretch Five, a relentless motor on
		   a Low-Motor Talent — about one player in fifty carried a trait his
		   build contradicted. [lo, hi], either side null. */
		if (n.off) {
			const RB = global.RatingsBuilder;
			const o = (RB && RB.RAW_OFFSETS && RB.RAW_OFFSETS[p.archetype]) || {};
			for (const k of Object.keys(n.off)) {
				const v = o[k] || 0;
				const [lo, hi] = n.off[k];
				if (lo !== null && lo !== undefined && v < lo) return false;
				if (hi !== null && hi !== undefined && v > hi) return false;
			}
		}
		if (Number.isFinite(n.maxInj) || Number.isFinite(n.minInj)) {
			const a = archOf(p);
			const inj = a && Number.isFinite(a.inj) ? a.inj : 1;
			if (Number.isFinite(n.maxInj) && inj > n.maxInj) return false;
			if (Number.isFinite(n.minInj) && inj < n.minInj) return false;
		}
		const tags = tagsOf(p);
		if (n.tags && !n.tags.every((x) => tags.indexOf(x) !== -1)) return false;
		if (n.anyTag && !n.anyTag.some((x) => tags.indexOf(x) !== -1)) return false;
		if (n.notTag && n.notTag.some((x) => tags.indexOf(x) !== -1)) return false;
		return true;
	}

	function tagsOf(p) {
		const RB = global.RatingsBuilder;
		if (!RB || !p.archetype) return [];
		const a = RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0];
		return (a && a.t) || [];
	}

	function archOf(p) {
		const RB = global.RatingsBuilder;
		if (!RB || !p.archetype) return null;
		return RB.ARCHETYPES.filter((x) => x.name === p.archetype)[0] || null;
	}

	/* Draw a player's traits.

	   Two to four of them, one per group at most, weighted by rarity and
	   gated by the prerequisites. Drawn off the player's own key so a trait
	   survives a re-run, a slider move and a re-apply — the same contract
	   every other per-player fact keeps.

	   `cfg.traitCount` scales how many are drawn; 0 turns the layer off
	   entirely, which is what a user who wants a plain note wants. */
	/* Per-flavor group tilt. A flavor already bends which BUILDS a class is
	   made of and said nothing at all about its traits, so "the year everybody
	   got hurt" produced a class whose medical files were exactly as clean as
	   any other year's. `traits: { group: multiplier }` on a CLASS_FLAVORS row
	   is read here and multiplies that group's chance of being drawn from. */
	function groupTilt(flavor, group) {
		const t = flavor && flavor.traits;
		return t && Number.isFinite(t[group]) && t[group] > 0 ? t[group] : 1;
	}

	function assign(p, rng, cfg, flavor) {
		const want = clamp(
			cfg && Number.isFinite(cfg.traitCount) ? cfg.traitCount : 3, 0, 6);
		const arch = archOf(p);
		/* Volatility first, because it is a property of the player whether or
		   not any trait touches it. The build's own `vol` is the anchor. */
		let vol = (arch && Number.isFinite(arch.vol) ? arch.vol : 1) *
			(1 + rng.normal(0, VOL_SPREAD));
		const out = [];
		if (want > 0) {
			const usedGroups = {};
			let pool = TRAITS.filter((t) => matches(t, p));
			const n = Math.max(1, Math.round(want + rng.uniform(-0.9, 0.9)));
			for (let i = 0; i < n && pool.length; i++) {
				/* The authored weight, capped.

				   The one-per-group rule gives every heavy row a clear run at
				   every player, and four of them were heavy enough to take it:
				   over 2,100 prospects "clean medical" (w 2.6) landed on 10.1%
				   of the class against a median trait's 4.0%, and the same
				   three or four clauses opened most of the notes in the file.
				   Drawing the GROUP first and the trait inside it was the
				   other candidate and measured WORSE (spread 0.51 -> 0.53):
				   rebounding has four traits and three are gated on height, so
				   a flat group draw handed "chases his own miss" one draw in
				   twelve. A cap leaves the ordering alone and only stops the
				   top of it running away.

				   The flavor's group tilt (see groupTilt) multiplies here. */
				const pick = rng.weighted(pool, (t) =>
					Math.min(t.w, W_CAP) * groupTilt(flavor, t.group));
				out.push(pick);
				usedGroups[pick.group] = 1;
				pool = pool.filter((t) => !usedGroups[t.group]);
			}
		}
		const eff = { vol: 1, orbBias: 0, inj: 1 };
		for (const t of out) {
			if (!t.eff) continue;
			if (Number.isFinite(t.eff.vol)) eff.vol *= t.eff.vol;
			if (Number.isFinite(t.eff.orbBias)) eff.orbBias += t.eff.orbBias;
			if (Number.isFinite(t.eff.inj)) eff.inj *= t.eff.inj;
		}
		vol = clamp(vol * eff.vol, 0.7, 1.6);
		return {
			traits: out,
			names: out.map((t) => t.name),
			volatility: vol,
			orbBias: clamp(eff.orbBias, -0.12, 0.12),
			injuryMult: clamp(eff.inj, 0.5, 2.0),
			/* BBGM's four mood traits, deduplicated. An empty list is written
			   as no field at all rather than as an empty array, so a file that
			   never had moodTraits does not acquire one. */
			mood: [...new Set(out.map((t) => t.mood).filter(Boolean))],
		};
	}

	/* The note clause. Two traits at most in one sentence, because a scouting
	   note is a sentence and not a list. */
	function noteClause(traits) {
		const list = (traits || []).filter((t) => t.note).slice(0, 2);
		if (!list.length) return null;
		if (list.length === 1) return list[0].note;
		return list[0].note + ", and " + list[1].note;
	}

	/* One adjective the news layer can put in front of a name. */
	function adjective(traits) {
		const list = (traits || []).filter((t) => t.adj);
		return list.length ? list[0].adj : null;
	}

	global.Traits = {
		TRAITS, GROUPS, assign, matches, noteClause, adjective, tagsOf, VOL_SPREAD,
	};
})(typeof window !== "undefined" ? window : self);
