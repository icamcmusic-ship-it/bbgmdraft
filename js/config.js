/* Default configuration + presets for the draft class generator. */
(function (global) {
	"use strict";

	const DEFAULTS = {
		seed: "",

		// --- class shape -------------------------------------------------
		ovrMode: "preserve",   // "preserve" = never inflate, "curve" = rebuild the class curve
		classQuality: 0,       // -3 (historically bad) .. +3 (loaded)
		classDepth: 0,         // -3 (top heavy) .. +3 (deep)
		eliteCount: 2,         // prospects given a genuine star ceiling
		potBias: 0,            // -3 .. +3 shift on potential
		potSpread: 6,          // sd of the ovr -> pot gap

		// --- builds ------------------------------------------------------
		specialization: 1.0,   // 0 = keep BBGM's samey builds, 2 = extreme specialists
		archetypeDiversity: 85,// 0-100, how often a non-balanced archetype is used
		buildNoise: 5,         // per-rating random jitter (rating points)
		varySize: false,       // let hgt/weight drift with the archetype
		/* THE IMPORTED HEIGHT IS THE PLAYER'S HEIGHT.

		   A prospect's hgt rating comes from the file he was imported from, and
		   it is the one number in his vector a user can check against something
		   outside the tool: the man is listed at 6'7" and the rating says 6'7".
		   Two draws could move it anyway — the size drift above, and the
		   "physical outlier" anomaly, which grows or shrinks somebody by half a
		   foot — and both are keyed off the RNG, so every reroll redrew them.
		   The cost is specific rather than aesthetic: a reroll is for looking at
		   a class again, and a class whose heights move underneath it is a class
		   whose archetype gates, positions and rebounding all moved too, so
		   "reroll until I like the top five" kept handing back a different five
		   men rather than the same five drawn again.

		   On (the default), the hgt rating and the listed height are pinned to
		   what the file said for EVERY player, and no reroll, variation, size
		   drift or anomaly can move either. A height the user sets BY HAND on a
		   player still moves it, because that is not a draw — it is the user
		   saying how tall the man is.

		   Off restores the old behavior, for anyone who wants the heights to be
		   part of what a reroll redraws. */
		lockHeights: true,
		// How strongly each class picks up a flavor of its own (guard-heavy,
		// big-heavy, defensive, shooting-rich, …). 0 = every class has the same
		// archetype mix, 2 = a class is unmistakably one thing.
		classFlavor: 1.0,
		/* How many specialist builds one class may contain, before height
		   coverage tops the pool up. 0 turns the pool off, which restores the
		   pre-2026 behavior of one of everything in every class.

		   Raised from 14 when the table grew past 117 builds: per-class
		   coverage had quietly fallen from 23% of the table to 12%, and
		   measured over 20 classes five builds never appeared at all. 17 was
		   a deliberate target, not a maximization — consecutive classes
		   should share a build or two, the way real drafts repeat archetypes.

		   19 keeps that same target as the table grew again, to 145: the
		   figure that matters is the SHARE of the table one class draws
		   (17/131 and 19/145 are both about 13%), and holding the pool fixed
		   while the table grows is how per-class coverage quietly fell the
		   first time. Measured over 20 classes, 17 left fourteen builds
		   unseen and 19 leaves eleven.

		   Raised from 19 when pickClassPool stopped adding its guaranteed
		   slots on TOP of this number: 19 realized 20-23 before, so 21 is the
		   size the class always had — the label just now says it.

		   AND RAISED AGAIN, for the reason this comment exists to prevent: the
		   table grew, the pool did not, and per-class coverage fell from the
		   13% this paragraph sets as the target to less than half of it —
		   while a comment saying not to do that sat directly above the number.

		   THE NUMBER BELOW IS CHECKED AGAINST THE TABLE. Every figure in the
		   paragraphs above is history and is allowed to be stale; this one
		   line is the live claim, and tools/test.js reads it, divides by
		   ARCHETYPES.length and fails when the share drifts outside 11-15%.
		   Which is the point — the prose had already drifted once, saying 355
		   against a table of 361, in the very comment written to stop exactly
		   that. A sentence nothing reads is a sentence that goes stale.

		   the table is 385 builds today */
		archetypePool: 46,
		/* How many forced anomalies a class gets: a five-star bust, an
		   unranked recruit who turns into a lottery pick, a 24-year-old JUCO,
		   a 7'4" project, the coach's son, the man whose season ended in
		   February. Cheap, memorable, and the reason to reroll. 0 turns them
		   off.

		   Raised from 3 when the pool went from seven kinds to twenty-three:
		   drawing three from seven meant two consecutive classes shared an
		   anomaly about four times in five, so the one feature most worth
		   rerolling for was the one that went stale fastest. */
		surpriseBudget: 4,
		/* How injury-prone this season is. Drawn before a game is played, so it
		   moves records and resumes and not only the note text. */
		injuryRate: 1,

		/* --- exploring a seed's neighborhood -------------------------------

		   One seed produced exactly one class, which is the whole point of the
		   RNG design and also its cost: a user who found a seed they liked
		   could keep it or throw it away, and nothing in between. There was no
		   way to say "this class, but roll the players again".

		   `variation` salts the PER-PLAYER streams and leaves the class-level
		   ones alone. At 0 nothing changes and a seed reproduces exactly what
		   it always did, so every shareable link ever made still resolves. At
		   1, 2, 3… the flavor, the build pool, the class curve and the
		   environment jitter are identical — the class is still "the year of
		   the stretch bigs, weak at the top" — while every individual player's
		   build, school, class year, recruiting and potential are drawn afresh.
		   Same shape, different sixty-eight men. */
		variation: 0,

		/* HOW OFTEN A CLASS DRAWS TWO FLAVORS INSTEAD OF ONE.

		   The season already draws two or three storylines and stacks them;
		   the flavor layer, which is older, drew exactly one. The asymmetry
		   is an accident of the order they were written in, and it costs the
		   whole point of a flavor — "guard-heavy" and "the year everybody got
		   hurt" are both things a class is remembered as, and a class can
		   obviously be both. Sixty-six flavors drawn one at a time is
		   sixty-six kinds of year; drawn two at a time it is thousands.

		   0 is the default and a complete no-op, down to the RNG stream: the
		   second draw is on its own child, so a seed that never blends is the
		   class it always was. A flavor asked for by name is never blended —
		   naming one is a decision, and mixing something else into it quietly
		   is the opposite of honouring it. See blendFlavor in js/ratings.js. */
		flavorBlend: 0,

		/* Ask for a particular class flavor instead of drawing one.

		   pickFlavor drew from a weighted table and applied the result, and the
		   only ways to ask for a guard-heavy class were to set classFlavor to 2
		   and reroll until one came up, or to edit archetype weights by hand.
		   A flavor is the single most visible thing about a class and it was
		   the one thing the user had no say in. Empty = draw one, as before;
		   otherwise the name of a CLASS_FLAVORS entry. */
		flavorHint: "",

		/* How hard a build that appeared in the last few classes is pushed out
		   of this one.

		   pickClassPool draws without replacement, so a 14-build pool holds at
		   most one of each archetype — but it draws by weight, and the heaviest
		   builds win nearly every time. Measured, Combo Guard made the pool in
		   about 78% of classes and 3&D Wing, Rim Runner and Slasher were not
		   far behind, so consecutive classes shared their common builds almost
		   always. Rarity compression helps and cannot fix it: the ordering is
		   the point of the weights.

		   So the pool remembers. A build that was in one of the last few pools
		   has its weight divided down for this one, which costs it its place to
		   the next build in line rather than banning it — the ordering survives
		   and the repetition does not. 0 turns the memory off. */
		poolMemory: 0.6,
		/* How many previous classes the memory reaches back over. Supplied by
		   the caller (the UI keeps it across rerolls and persists it); the
		   engine never writes it. */
		recentPools: null,
		/* The same memory for the class FLAVOR, which had none — see
		   flavorMemoryFactor in js/ratings.js. Sixty-six flavors and one draw
		   a class repeats far sooner than a pool of forty-six builds does,
		   and the pool is the one that had a dial. Null `recentFlavors` is an
		   exact no-op, so the default here changes nothing until the caller
		   starts supplying the ring. */
		flavorMemory: 0.6,
		/* The last few classes' flavor names, newest first. Supplied by the
		   caller exactly as `recentPools` is; the engine never writes it. */
		recentFlavors: null,
		/* The class year, transfer path and college a SHARED universe already
		   drew for each player key, so replaying it reproduces the same men
		   rather than the same seeds. Supplied by the caller (importUniverse);
		   the engine reads it in assignClassYears and never writes it. */
		biography: null,

		/* --- the world -----------------------------------------------------

		   These four decide how much the SIDELINE and the roster around the
		   class change from one season to the next. Alone in a single-class
		   run they are flavor; in a universe they are what makes a decade of
		   play feel like a decade. */
		/* Universe mode. `false` runs each loaded file as its own world (and
		   the Timeline view has nothing to show); `true` runs every loaded
		   file as one continuous chain, oldest season first, with each season
		   handing conference map, program levels, coaches, star returners and
		   build-pool memory to the next — and every other tab then shows THAT
		   world rather than a fresh re-simulation of the same file. It used to
		   be a button on a tab, which is exactly why the tabs disagreed with
		   it. */
		universe: false,
		/* Head-coaching turnover, as a percentage of the built-in rates. 100
		   turns over 40-60 of the 364 programs a year, which is what Division
		   I does; 0 freezes every sideline; 200 is a bloodbath. */
		coachTurnover: 100,
		/* How strongly a universe remembers last season's conference map. 100
		   means a program that moved stays moved (realignment accumulates);
		   0 means every season redraws the map from the base alignment, which
		   is the pre-universe behaviour. */
		realignmentMemory: 100,
		/* Roughly how many named non-prospect stars the country carries, as a
		   percentage of the built-in rate. These are the men a prospect loses
		   an award to; without them the class wins everything by default. */
		starReturners: 100,
		/* How much of a program's returning rotation left through the portal
		   between seasons, as a percentage. Only meaningful in a universe,
		   where there is a previous season to leave. */
		portalRate: 100,
		/* RECRUITING MOMENTUM. How strongly last season's programs recruit
		   this season's blank-college prospects, as a percentage. 0 restores
		   the pre-universe draw (region-weighted destinations only, with no
		   memory of who won anything); 100 sends every one of them to a
		   domestic program weighted by level, banners and last season's title.
		   Only meaningful in a universe: it reads the carry-over, and a single
		   class file has none. See assignCollege in js/engine.js. */
		recruitMomentum: 55,

		// --- the season's own story ----------------------------------------
		/* How often the map of college basketball changes. Conference STRENGTH
		   already drifted from year to year; membership never did, so the one
		   constant in a tool built to make every run different was the single
		   most consequential thing that happens to college basketball in real
		   life. A realignment moves two to five of the best programs in
		   weaker leagues into a conference that is raiding. 0 turns it off. */
		realignmentRate: 0.35,
		/* How many blue bloods have a down year, beyond the ordinary
		   program-strength roll. "The year three blue bloods all went down"
		   is a season nobody forgets and nothing could ask for it. */
		bluebloodDownYears: 0,
		/* How far the mid-majors are lifted, in program-strength points. */
		midMajorLift: 0,
		/* How much a team's season wanders around its own rating.

		   Every game used to be an independent draw, so a season had a trend
		   (see `form` in js/teams.js) and no shape: no five-game run that put a
		   bubble team in the field, no 2-8 stretch after the best player went
		   down. 0 restores that; 1 gives a team on a run about two and a half
		   rating points, which moves a bubble and does not move a bracket. */
		teamMomentum: 1,

		// --- blank colleges ----------------------------------------------
		// Legacy headline sliders. They still work (and old shareable links
		// still decode) but they are folded into leagueWeights below, which is
		// the single source of truth now that there are twenty-four destinations
		// rather than three.
		wEuroLeague: null,
		wGLeague: null,
		wNBL: null,
		pDII: 0.02,            // rare DII NCAA conversion
		/* THE DESTINATION MODEL (see destinationPool in js/engine.js).
		   collegeSource: "blanks" fills in only the colleges the file left
		   blank (what the tool always did); "respect" leaves them blank —
		   he did not play; "rewrite" redraws EVERY prospect's college or
		   league, overwriting what the file said. Rewrite is destructive to
		   the file's data and the panel says so.
		   talentCoupling: 0-2, how strongly a prospect's rating pulls him
		   toward a high-prestige program or a strong league. 0 is the old
		   talent-blind draw.
		   birthplaceWeight: 0-2, how strongly where he was born overrides
		   that. 1 is the league table as written. */
		collegeSource: "blanks",
		talentCoupling: 0,
		birthplaceWeight: 1,
		// Destination weights for players whose college is blank. Each is
		// further scaled by where the player was born (see Colleges.regions).
		leagueWeights: null,   // null = each league's built-in default weight

		/* HOW MANY ANOMALIES ARE DRAWN BEYOND THE ONES THE CLASS KEEPS.

		   The anomalies are the single most rerolled-for thing in the tool and
		   they were the one decision the user had no say in at all: four kinds
		   were drawn and applied, and the only way to influence the result was
		   to throw the whole class away. Above zero this draws that many EXTRA
		   candidates and `anomalyPicks` says which of them the class gets, so
		   "a five-star bust and a February injury, not the walk-on" is
		   expressible. 0 is exactly the behaviour that was always here, down
		   to the order the kinds are applied in. See assignSurprises. */
		anomalyChoices: 0,
		/* Which of the shortlist to keep, by kind name. Written by the UI;
		   the engine reads it and never writes it. Empty or unset means the
		   first `surpriseBudget` of them, which is what an unanswered
		   shortlist should do. */
		anomalyPicks: null,

		/* HOW FAR FROM THE MIDDLE THIS WORLD SITS.

		   Five separate controls answer one underlying question — anomalies
		   per class, flavor strength, whether the season draws storylines,
		   March upsets, build noise — and a user who wants "give me a strange
		   year" had to find all five and agree with themselves about what
		   strange means. This is that question as one dial.

		   It follows the same rule a flavor does: it moves a setting only
		   while that setting is still at its default, so it never overrules a
		   decision somebody made. 0 is the default and a complete no-op, which
		   is what keeps every existing seed and every shareable link resolving
		   to the class it always did. */
		weirdness: 0,

		/* How hard a class avoids the anomalies the last few classes used.
		   Thirty-two kinds and four draws a class is not enough separation on
		   its own: the same eight or ten turned up in most classes. 0 draws
		   with no memory; 1 makes a kind used last class about three times
		   less likely; 3 nearly rules it out. Mirrors "Avoid repeating recent
		   builds", which does the same job one layer up. */
		anomalyMemory: 1,
		/* How far a class flavor reaches into settings the user has CHANGED.

		   A flavor bends settings still sitting at their default and never
		   overrules a decision the user made — which is the right principle
		   and does mean that a user who has customized the exact settings a
		   flavor wants to move gets a flavor that does less. This is the
		   escape hatch: at 0 the principle is absolute (the old behaviour); at
		   100 a flavor moves every setting it wants to. In between it moves a
		   random subset, and only partway, so an injury-year flavor can still
		   be an injury year on a config somebody has been playing with. */
		flavorReach: 0,
		/* HOW MANY YEARS TO RUN PAST THE LAST CLASS FILE.

		   A universe stops at its newest file, which is where the carry-over
		   gets interesting: program levels have drifted, realignment has
		   accumulated, banners have piled up, and none of that has had time to
		   become a history. `extrapolateGap` already invents a whole season
		   out of the carry alone — a champion off program level, an AP No. 1,
		   a player of the year off the named returners — and flags every row,
		   and the only way to reach it was to leave a hole in your file list.

		   0 keeps the chain ending where the files do. Above that, the rows are
		   pushed onto the timeline, feed the records book and the news desk,
		   and are never fed back into the chain's tail: loading a real class
		   file later still extends the world from the last season that was
		   actually played. See runUniverse in js/app.js. */
		extrapolateYears: 0,
		/* Whether the unplayed years INSIDE a chain — a hole in the file list —
		   are extrapolated the same way. On by default, and separate, because a
		   gap is a fact about the files and the years past the end are a
		   choice. */
		extrapolateGaps: true,

		/* Whether a class draws two or three macro STORYLINES for its season
		   on top of the class flavor — a dominant No. 1, a wide-open year, a
		   mid-major surge, a scandal, a superteam that flops. The flavor
		   system does this for the CLASS; nothing did it for the SEASON, so
		   every season had the same shape whatever kind of class played it. */
		narrative: true,
		/* How much a coach's style wanders from season to season. A style is a
		   fixed enum, so every "four-out" team in the country produced an
		   identical shot chart and produced it again next year. */
		styleDrift: 1,

		// --- class years and how a prospect got here ------------------------
		// BBGM draft classes are nearly all age 19, so class year has to be
		// rolled rather than read off the birthday. This is the share of the
		// class that stayed one year; the rest spread across the other three.
		/* 46 produced a measured 46-48% freshmen, and a real 60-70 man draft
		   class is 30-35%: one-and-done is the story of the top ten picks, not
		   of the class. The draw tilts steeply with board rank (pFresh scales
		   by 1.75 - 1.45*rank), so the setting and the outcome agree to about
		   a point — 32 measures 33%. "One-and-done era" still carries 78 for
		   anyone who wants the old shape and more. */
		freshmanShare: 32,
		// Modern college basketball is a transfer league. This is the share of
		// upperclassmen who arrived from somewhere else — a mid-major jump, a
		// JUCO year, a fifth-year transfer.
		transferShare: 34,
		// Share of the class that took a redshirt year, and the share that
		// reclassified up (or down) a year out of high school.
		redshirtShare: 8,
		reclassShare: 7,

		// Per-archetype rarity overrides, {name: weight}. Empty = use the
		// built-in weights.
		archetypeWeights: null,

		// --- notes -----------------------------------------------------------
		/* "traits" is on by default: the trait layer's whole point is that a
		   scouting note can say what a scout would say, and a line nobody
		   turns on says nothing. See js/traits.js. */
		noteLines: ["summary", "team", "traits", "stats", "shooting", "signature", "awards"],
		/* How many scouting traits a prospect carries, roughly. 0 turns the
		   layer off, which is what a user who wants a plain statline note
		   wants; the effects (night-to-night volatility, the offensive glass,
		   the medical file) go with it. */
		traitCount: 3,

		// --- college season ----------------------------------------------
		// Which era's empirical anchors the stat model targets. See the header
		// of js/calibration.js: the tool was originally fitted to a 2009-2021
		// dataset that contains the lowest-scoring season since 1952, and
		// reproduced it faithfully, which is why every line read low for a
		// class meant to represent this year.
		era: "modern",
		pace: 68,              // team possessions per 40 minutes
		scoringEnv: 0,         // -3 (grind) .. +3 (track meet)
		// Efficiency, as distinct from possessions. pace and scoringEnv are
		// both possession dials — moving scoringEnv from -3 to +3 changed team
		// points 66 -> 75 and left true shooting at 0.572 in every single
		// configuration — so there was no way at all to ask for a class that
		// scores its points more (or less) efficiently.
		efficiencyEnv: 0,      // -3 (bricks) .. +3 (everything falls)
		statNoise: 1.0,        // 0 = deterministic from ratings, 2 = wild
		/* How a prospect's earlier college seasons are produced.

		   "simulate" runs each of them through the same stat model the draft
		   year goes through — the player at the ratings he had then, with that
		   year's class year, in a rotation rebuilt around him. "reconstruct" is
		   the older behavior: a backward-scaled copy of the draft-year line,
		   which reads fine and is not a season. */
		priorSeasons: "simulate",   // "simulate" | "reconstruct"
		/* Which model sets the exported pot. "tool" is this workshop's own
		   gap model; "bbgm" is BBGM's potEstimator, which is what the game
		   itself will show after the first preseason re-estimate. */
		potModel: "tool",           // "tool" | "bbgm"
		/* When on, a build whose tags promise a BBGM skill badge (shooting
		   -> 3, athletic -> A, rebounding -> R) leans its solve toward the
		   badge's cutoff at the same overall. Off keeps every output as it was. */
		signatureSkills: false,

		// --- postseason ---------------------------------------------------
		upsetFactor: 1.0,      // 0 = chalk, 2 = madness
		// How far into the national field the honors reach. Kept separate
		// from the two things it used to silently also control.
		awardStrictness: 1.0,
		// Conference honors are their own dial: 32 conferences hand out far
		// more hardware than the national voters do, and wanting a realistic
		// number of one is not wanting fewer of the other.
		// Independent of awardStrictness by design (it does not follow the
		// main dial); only a config built without make() falls back to it.
		confAwardStrictness: 1.0,
		// The bar a prospect abroad has to clear for a pro-league honor.
		// Also independent of the main dial.
		proAwardStrictness: 1.0,
		/* How far the voters stray from the arithmetic. 0 hands every trophy to
		   whoever the production model ranks first, which is a list nobody
		   needs to look at twice; 1 is the electorate the model was written
		   with; higher produces genuine splits and the occasional snub. It also
		   scales the season's voter mood — see NATIONAL_POY in js/awards.js. */
		awardNoise: 1.0,

		/* How many things happen between the last game and the draft. The mock
		   board was a single ordered list — every prospect exactly where his
		   season put him — and a draft with nothing between the season and the
		   pick is a ranking, not a draft. See DRAFT_EVENTS in js/engine.js.
		   0 restores the plain ranking. */
		draftEvents: 4,
		/* How many things happen DURING the season, as against to a team's
		   rating. The season was one pass — build, play, sort — so a schedule
		   was a list of scores with no top-ten upset in it and no coach fired
		   in January. Every event is read off results that were already
		   simulated, so none of them can contradict a box score. See
		   midSeasonEvents in js/teams.js. 0 turns them off. */
		seasonEvents: 7,
	};

	const PRESETS = {
		default: {},
		"Loaded class": { classQuality: 2, eliteCount: 4, potBias: 1, ovrMode: "curve" },
		"Weak class": { classQuality: -2, eliteCount: 0, potBias: -1, ovrMode: "curve" },
		"Top heavy": { classDepth: -2, eliteCount: 3, ovrMode: "curve" },
		"Deep, no stars": { classDepth: 2, eliteCount: 0, ovrMode: "curve" },
		"Specialist league": { specialization: 1.8, archetypeDiversity: 95, buildNoise: 7, classFlavor: 1.6 },
		"Guard-heavy class": { classFlavor: 2, archetypeDiversity: 92 },
		"Transfer-portal era": { transferShare: 62, freshmanShare: 26 },
		"International class": {
			/* EVERY league, not twelve of them. This named the twelve
			   destinations the table held when the preset was written, and
			   assignCollege falls back to a league's DEFAULT weight for any
			   name the object omits — so the twenty-four leagues added since
			   (Italy, Lithuania, Turkey, Greece, Israel, the BAL, Japan,
			   Brazil, Korea, the PBA, Argentina and the rest) sat at their
			   ordinary weight while the twelve were boosted around them. The
			   preset that exists to send a class abroad was quietly holding
			   back the leagues most of the world plays in. Every entry is
			   the table's own weight, scaled: 2.2x abroad, 0.35x for the
			   American paths. */
			leagueWeights: {
				"EuroLeague": 57, "NBA G League": 11, "Liga ACB": 22, "NBL": 26,
				"Chinese CBA": 13, "LNB Pro A": 20, "EuroCup": 20,
				"Basketball Bundesliga": 18, "Adriatic League": 18, "NBL1": 9,
				"Overtime Elite": 2, "NBA Academy": 9, "Basketball Champions League": 15,
				"Turkish BSL": 13, "Greek Basket League": 11, "Israeli Premier League": 11,
				"Japan B.League": 9, "Brazil NBB": 9, "Basketball Africa League": 9,
				"CEBL": 7, "Prep / Postgrad": 1, "NAIA": 1, "Did not play": 1,
				"Italian LBA": 13, "Lithuanian LKL": 9, "VTB United League": 9,
				"Polish PLK": 7, "BNXT League": 7, "Korean KBL": 7, "Philippine PBA": 4,
				"Argentine Liga Nacional": 7, "Mexican LNBP": 4, "Puerto Rico BSN": 4,
				"New Zealand NBL": 4, "JUCO": 1, "DIII NCAA": 1,
			},
		},
		"Vanilla builds": { specialization: 0.2, archetypeDiversity: 20 },
		"One-and-done era": { freshmanShare: 78 },
		/* eliteCount only acts on a rebuilt curve; without ovrMode it was a
		   dimmed slider the preset moved and the class ignored. */
		"Blue-blood freshman wave": { freshmanShare: 46, eliteCount: 3, ovrMode: "curve" },
		"Veteran-heavy class": { freshmanShare: 16 },
		"2015 scoring drought": { era: "2009-2021", pace: 64, efficiencyEnv: -1 },
		/* Two flavors and a louder world, for somebody who wants the tool to
		   surprise them rather than to reproduce something. */
		"A strange year": { weirdness: 2, flavorBlend: 0.8, anomalyChoices: 4 },
		"Chalk March": { upsetFactor: 0.35 },
		"Total madness": { upsetFactor: 1.9 },
	};

	/* Built-in destination weights, read from the league table so there is one
	   place to change them. */
	function defaultLeagueWeights() {
		const out = {};
		const NN = (global.Colleges && global.Colleges.NON_NCAA) || {};
		for (const name of Object.keys(NN)) {
			if (name === "DII NCAA") continue;   // has its own probability dial
			out[name] = NN[name].w;
		}
		return out;
	}

	/* THE BAND A WEIGHT EDITOR OFFERS.

	   Both weight tables are edited through a number input with a declared
	   min and max — 0 to 100 a destination, 0 to 8 a build — and both are
	   also written straight out of a URL payload, a saved preset and an
	   imported settings JSON, where nothing checked them at all. A NaN, a
	   negative or a 1e9 reached the engine verbatim: it survives all three
	   (rng.weighted floors at zero and Colleges.leagueWeight ignores a
	   non-finite override), so nothing corrupts — and the panel then
	   displayed a number its own control cannot express, which is the same
	   "the tool is describing a class other than the one in front of you"
	   fault the scalar clamp below exists to close. */
	const LEAGUE_WEIGHT_MAX = 100;
	const ARCH_WEIGHT_MAX = 8;
	function weightMap(src, hi) {
		const out = {};
		if (!src || typeof src !== "object" || Array.isArray(src)) return out;
		for (const k of Object.keys(src)) {
			const v = Number(src[k]);
			// A broken value is dropped rather than floored: an entry that is
			// not a number is an entry that says nothing, and the built-in
			// weight behind it is a better answer than zero.
			if (!Number.isFinite(v)) continue;
			out[k] = v < 0 ? 0 : v > hi ? hi : v;
		}
		return out;
	}

	/* The settings that are a choice from a list, and the list. Each is a
	   function because two of the lists live in files that load after this
	   one; a list that is not loaded yet (null) is not checked. `era` is
	   checked against every era the table knows, fitted or not — the harness
	   runs an unfitted era by name on purpose; the panel narrows it further. */
	const CHOICES = {
		ovrMode: () => ["preserve", "curve"],
		priorSeasons: () => ["simulate", "reconstruct"],
		potModel: () => ["tool", "bbgm"],
		collegeSource: () => ["blanks", "respect", "rewrite"],
		era: () => (global.Calibration && global.Calibration.ERAS
			? Object.keys(global.Calibration.ERAS) : null),
		flavorHint: () => (global.RatingsBuilder && global.RatingsBuilder.CLASS_FLAVORS
			? [""].concat(global.RatingsBuilder.CLASS_FLAVORS.map((f) => f.name)) : null),
	};

	function make(overrides) {
		const src = overrides && typeof overrides === "object" && !Array.isArray(overrides)
			? overrides : {};
		const cfg = Object.assign({}, DEFAULTS, src);
		/* Copy every container the UI can write into, so a preset or a URL
		   payload can never be mutated in place by the editor that displays it.

		   noteLines was copied and archetypeWeights was not, even though the
		   archetype-frequency editor writes straight into
		   state.cfg.archetypeWeights: editing a weight after loading a preset
		   (or a shared link) rewrote the preset itself, silently and
		   permanently. leagueWeights is rebuilt below, but from an object the
		   caller still owns. */
		/* AND THE CONTAINERS GO THROUGH THE SAME DOOR.

		   The clamp below covers every SCALAR setting, for the reason its own
		   comment gives: a shareable link, a saved preset and an imported
		   settings JSON can carry anything, and a value the panel cannot show
		   is a value the panel cannot honestly display. Three settings are not
		   scalars and were left out of that argument entirely — `noteLines`,
		   `leagueWeights` and `archetypeWeights` — and they arrive through
		   exactly the same three doors.

		   `noteLines` is the one that bites: a payload carrying the string
		   "stats" instead of ["stats"] was `.slice()`d (a string has one) and
		   stored as a string, so cfg.noteLines was a note template that is not
		   a list. buildNote survives it by checking Array.isArray and falling
		   back, which means the note template silently reverted to the default
		   and the panel went on painting the tick boxes the payload asked for.
		   A non-array is a broken value like a NaN pace, and goes back to the
		   default the same way. */
		/* Known keys only, once the engine that names them is loaded: an
		   unknown line is a tick box the panel cannot show and a note line
		   buildNote silently skips. */
		const known = global.Engine && Array.isArray(global.Engine.NOTE_LINES)
			? new Set(global.Engine.NOTE_LINES.map((x) => x[0])) : null;
		cfg.noteLines = (Array.isArray(cfg.noteLines) ? cfg.noteLines : DEFAULTS.noteLines)
			.filter((k) => typeof k === "string" && (!known || known.has(k)))
			.filter((k, i, a) => a.indexOf(k) === i);
		if (!cfg.noteLines.length) cfg.noteLines = DEFAULTS.noteLines.slice();
		/* THE TEXT CHOICES AND THE SWITCHES go through the same door as the
		   numbers. A link carrying `"era": "bogus"` was stored verbatim, and
		   the pace hint then read the anchors of an era that does not exist
		   and threw inside the first paint — before a single control was
		   bound, and persisted, so a reload failed the same way. */
		for (const key of Object.keys(CHOICES)) {
			const allowed = CHOICES[key]();
			if (allowed && allowed.indexOf(cfg[key]) === -1) cfg[key] = DEFAULTS[key];
		}
		for (const key of Object.keys(DEFAULTS)) {
			if (typeof DEFAULTS[key] !== "boolean") continue;
			const v = cfg[key];
			cfg[key] = typeof v === "boolean" ? v
				: v === "false" || v === "0" || v === 0 ? false
				: v === "true" || v === "1" || v === 1 ? true
				: DEFAULTS[key];
		}
		/* The three legacy destination sliders arrive as strings from an old
		   link ("50"), and Number.isFinite("50") is false, so the fold below
		   skipped them and the setting silently did nothing. */
		for (const key of ["wEuroLeague", "wGLeague", "wNBL"]) {
			if (typeof cfg[key] === "string" && cfg[key].trim() !== "" &&
				Number.isFinite(Number(cfg[key]))) cfg[key] = Number(cfg[key]);
		}
		// Deep-copied for the same reason noteLines is: the pool memory is a
		// container the UI writes into between runs.
		cfg.recentPools = Array.isArray(cfg.recentPools)
			? cfg.recentPools.filter(Array.isArray).map((a) => a.slice())
			: null;
		cfg.archetypeWeights = weightMap(cfg.archetypeWeights, ARCH_WEIGHT_MAX);
		// Destination weights: start from the built-ins, apply anything the
		// caller set, then fold in the three legacy sliders so old presets and
		// old shareable links still mean what they meant.
		/* The caller's table is cleaned BEFORE it is laid over the built-ins,
		   so a broken entry falls back to the league's own default weight
		   rather than removing the league from the table altogether — which
		   would also make untouchedLeagueWeights report a hand-edited table
		   on the strength of a NaN somebody never typed. */
		const lw = Object.assign(defaultLeagueWeights(),
			weightMap(cfg.leagueWeights, LEAGUE_WEIGHT_MAX));
		const legacy = {
			wEuroLeague: "EuroLeague", wGLeague: "NBA G League", wNBL: "NBL",
		};
		for (const key of Object.keys(legacy)) {
			if (Number.isFinite(cfg[key])) lw[legacy[key]] = cfg[key];
		}
		cfg.leagueWeights = weightMap(lw, LEAGUE_WEIGHT_MAX);   // the legacy fold, too
		/* AND THE BANDS ARE ENFORCED HERE, at the front door.

		   CLAMP was a table the engine consulted at a dozen read sites and
		   the review test read against index.html; nothing applied it to a
		   whole config. The sliders cannot produce an illegal value, so the
		   panel never needed it — but a shareable link, a saved preset, an
		   imported settings JSON and a hand-edited URL all arrive here, and
		   they can carry anything. Clamping once, in the one function every
		   one of those paths goes through, is the difference between the
		   panel describing the class you are looking at and merely describing
		   the class you asked for.

		   To the band the CONTROL offers (sliderRange), not the wider band
		   behind it, for the same reason: a value the interface cannot show
		   is a value the interface cannot honestly display. Non-finite values
		   fall back to the default rather than to a bound — NaN is a broken
		   file, not a big number — and a key with no declared band is left
		   exactly as it arrived. */
		for (const key of Object.keys(CLAMP)) {
			if (cfg[key] === undefined) continue;
			/* `null` is NOT missing. Object.assign treats an explicit null as
			   a value and writes it straight over the default, so a preset or
			   a settings JSON carrying `"pace": null` used to hand the engine
			   a null pace — and every arithmetic on it produced NaN quietly,
			   which is the failure this whole block exists to make impossible.
			   It is a broken value like any other and goes back to the
			   default. */
			if (cfg[key] === null) { cfg[key] = DEFAULTS[key]; continue; }
			const band = sliderRange(key);
			const v = Number(cfg[key]);
			if (!Number.isFinite(v)) { cfg[key] = DEFAULTS[key]; continue; }
			// A count arrives whole: eliteCount 2.5 is not a class anybody
			// can build, and classCurve read it as half a third star.
			const w = isCount(key) ? Math.round(v) : v;
			cfg[key] = w < band.min ? band.min : w > band.max ? band.max : w;
		}
		return cfg;
	}

	/* WHICH SETTINGS ARE COUNTS.

	   A flavor or a narrative interpolates between a setting's current value
	   and the one it wants, and the result has to stay a legal value: an
	   eliteCount of 1.5 is not a class anybody can build. The old test was
	   `Number.isInteger(default) && Number.isInteger(bend)`, which is a
	   question about two particular numbers rather than about the setting —
	   and it got `injuryRate` wrong, because its default is 1 and one flavor
	   bends it to 2 while the dial itself runs in steps of 0.05. Interpolating
	   1.15 toward 2 gave 1.575 and the guard rounded it to 2, so a flavor at
	   full reach took the setting over completely rather than meeting the user
	   half way.

	   So the set is declared. A setting in it is rounded; everything else is
	   left alone, whatever its default happens to look like. */
	const COUNTS = new Set([
		"eliteCount", "bluebloodDownYears", "midMajorLift", "seasonEvents",
		"draftEvents", "archetypePool", "surpriseBudget", "traitCount",
		"freshmanShare", "transferShare", "redshirtShare", "reclassShare",
		/* buildNoise is NOT here: its slider runs in steps of 0.5, so
		   rounding it to a whole number was the injuryRate mistake again
		   (a flavor bending 5 toward 7 landed on 6 rather than 5.5). */
		"archetypeDiversity", "pace", "variation", "anomalyChoices",
		"coachTurnover", "realignmentMemory", "starReturners", "portalRate",
		"recruitMomentum",
		"flavorReach", "wEuroLeague", "wGLeague", "wNBL",
	]);
	function isCount(key) { return COUNTS.has(key); }

	/* WHAT THE ENGINE WILL ACCEPT, AND WHAT THE PANEL OFFERS.

	   These had drifted apart, quietly and in both directions. The engine
	   names its pace band once — PACE_MIN 55, PACE_MAX 82 — expressly so that
	   the two halves of a run cannot describe different games, and the slider
	   offered 58 to 80, so the top of the declared band was unreachable from
	   the interface at all. `injuryRate` clamps to 3 and stopped at 2;
	   `surpriseBudget` clamps to 10 and stopped at 6. Each was defensible
	   alone, and together they are how the build-pool slider came to be unable
	   to reach its own off switch the last time somebody looked.

	   So the clamp is declared HERE, the engine reads it instead of writing
	   its own literals, and tools/tests/review.js reads every slider's min and
	   max off index.html and fails when a control cannot reach the range
	   behind it. `floor`/`ceil` record a deliberate difference with the reason
	   for it — the pace slider's floor is three points above the band's,
	   because the class-environment jitter is meant to be able to produce a
	   season slower than the slowest thing a user can dial. */
	const CLAMP = {
		pace: { lo: 55, hi: 82, floor: 58,
			floorWhy: "the class jitter floors at 55 so a slow season can be " +
				"slower than the slowest thing a user can ask for" },
		injuryRate: { lo: 0, hi: 3 },
		surpriseBudget: { lo: 0, hi: 10 },
		draftEvents: { lo: 0, hi: 8 },
		anomalyMemory: { lo: 0, hi: 3 },
		talentCoupling: { lo: 0, hi: 2 },
		birthplaceWeight: { lo: 0, hi: 2 },
		efficiencyEnv: { lo: -3, hi: 3 },
		pDII: { lo: 0, hi: 1, ceil: 0.15,
			ceilWhy: "a DII conversion is meant to be rare; the engine's own " +
				"clamp is only a nonsense guard" },
		flavorReach: { lo: 0, hi: 100 },
		recruitMomentum: { lo: 0, hi: 100 },
		flavorMemory: { lo: 0, hi: 1 },
		/* THE THREE LEGACY DESTINATION SLIDERS.

		   They are in COUNTS, they are folded into `leagueWeights` by make()
		   and by a flavor's bend, and they were the one settings path with no
		   declared band at all — so a link carrying wEuroLeague: 1e9 sent
		   every prospect abroad to one league while the destination editor
		   displayed the built-in weight beside it. The band is the one that
		   editor's own number inputs offer (0-100), because that is where the
		   value ends up. No slider on the page carries these names, so
		   tools/tests/review.js skips them; make() does not. */
		wEuroLeague: { lo: 0, hi: 100 },
		wGLeague: { lo: 0, hi: 100 },
		wNBL: { lo: 0, hi: 100 },

		/* THE OTHER THIRTY-EIGHT.

		   The eleven above are the ones the engine happened to clamp at a
		   read site, and the table was written to make those read sites agree
		   with their sliders. That left a gap at the OTHER entrance: a
		   shareable link, a saved preset and an imported settings JSON all go
		   through `make` below, and nothing between them and the engine said
		   what a legal value was. A link carrying `specialization: 50` ran at
		   50 while the panel displayed 2.5, which is the tool lying about the
		   class in front of you — the one thing a shareable link exists not
		   to do. (Nothing corrupts: eight such values were run and all of
		   them produced finite ratings and finite box scores. The fault is
		   silence, not damage.)

		   Every band here is the band its own control already offers, so
		   declaring them changes nothing a user can reach from the interface
		   and tools/tests/review.js — which reads every slider's min and max
		   off index.html and fails on a disagreement — now covers the whole
		   panel instead of a fifth of it. A deliberate difference between a
		   control and its band still goes in `floor`/`ceil` with a reason,
		   the way `pace` and `pDII` do. */
		classQuality: { lo: -3, hi: 3 },
		classDepth: { lo: -3, hi: 3 },
		eliteCount: { lo: 0, hi: 8 },
		potBias: { lo: -3, hi: 3 },
		potSpread: { lo: 0, hi: 16 },
		specialization: { lo: 0, hi: 2.5 },
		archetypeDiversity: { lo: 0, hi: 100 },
		buildNoise: { lo: 0, hi: 14 },
		classFlavor: { lo: 0, hi: 2 },
		flavorBlend: { lo: 0, hi: 1 },
		/* The ceiling is the build table's size, read lazily: config.js
		   loads before ratings.js, and a literal here went stale once. */
		archetypePool: { lo: 0, get hi() {
			return global.RatingsBuilder ? global.RatingsBuilder.ARCHETYPES.length : 385;
		} },
		weirdness: { lo: -2, hi: 3 },
		anomalyChoices: { lo: 0, hi: 8 },
		traitCount: { lo: 0, hi: 6 },
		variation: { lo: 0, hi: 12 },
		poolMemory: { lo: 0, hi: 1 },
		freshmanShare: { lo: 0, hi: 100 },
		transferShare: { lo: 0, hi: 90 },
		redshirtShare: { lo: 0, hi: 30 },
		reclassShare: { lo: 0, hi: 30 },
		coachTurnover: { lo: 0, hi: 200 },
		realignmentMemory: { lo: 0, hi: 100 },
		starReturners: { lo: 0, hi: 300 },
		portalRate: { lo: 0, hi: 300 },
		extrapolateYears: { lo: 0, hi: 20 },
		scoringEnv: { lo: -3, hi: 3 },
		statNoise: { lo: 0, hi: 2.5 },
		upsetFactor: { lo: 0, hi: 2 },
		realignmentRate: { lo: 0, hi: 1 },
		bluebloodDownYears: { lo: 0, hi: 6 },
		midMajorLift: { lo: 0, hi: 12 },
		teamMomentum: { lo: 0, hi: 2.5 },
		styleDrift: { lo: 0, hi: 3 },
		seasonEvents: { lo: 0, hi: 14 },
		awardStrictness: { lo: 0.4, hi: 2 },
		confAwardStrictness: { lo: 0.4, hi: 2 },
		proAwardStrictness: { lo: 0.4, hi: 2 },
		awardNoise: { lo: 0, hi: 3 },
	};
	/* The value a slider is allowed to reach, which is the clamp unless a
	   deliberate floor or ceiling narrows it. */
	function sliderRange(key) {
		const c = CLAMP[key];
		if (!c) return null;
		return { min: Number.isFinite(c.floor) ? c.floor : c.lo,
			max: Number.isFinite(c.ceil) ? c.ceil : c.hi };
	}

	global.Config = { DEFAULTS, PRESETS, make, defaultLeagueWeights, COUNTS, isCount,
		CLAMP, sliderRange, LEAGUE_WEIGHT_MAX, ARCH_WEIGHT_MAX };
})(typeof window !== "undefined" ? window : self);
