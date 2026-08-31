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
		// How strongly each class picks up a flavour of its own (guard-heavy,
		// big-heavy, defensive, shooting-rich, …). 0 = every class has the same
		// archetype mix, 2 = a class is unmistakably one thing.
		classFlavor: 1.0,
		/* How many specialist builds one class may contain, before height
		   coverage tops the pool up. 0 turns the pool off, which restores the
		   pre-2026 behaviour of one of everything in every class. */
		archetypePool: 14,
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

		/* --- exploring a seed's neighbourhood -------------------------------

		   One seed produced exactly one class, which is the whole point of the
		   RNG design and also its cost: a user who found a seed they liked
		   could keep it or throw it away, and nothing in between. There was no
		   way to say "this class, but roll the players again".

		   `variation` salts the PER-PLAYER streams and leaves the class-level
		   ones alone. At 0 nothing changes and a seed reproduces exactly what
		   it always did, so every shareable link ever made still resolves. At
		   1, 2, 3… the flavour, the build pool, the class curve and the
		   environment jitter are identical — the class is still "the year of
		   the stretch bigs, weak at the top" — while every individual player's
		   build, school, class year, recruiting and potential are drawn afresh.
		   Same shape, different sixty-eight men. */
		variation: 0,

		/* Ask for a particular class flavour instead of drawing one.

		   pickFlavor drew from a weighted table and applied the result, and the
		   only ways to ask for a guard-heavy class were to set classFlavor to 2
		   and reroll until one came up, or to edit archetype weights by hand.
		   A flavour is the single most visible thing about a class and it was
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

		// --- the season's own story ----------------------------------------
		/* How often the map of college basketball changes. Conference STRENGTH
		   already drifted from year to year; membership never did, so the one
		   constant in a tool built to make every run different was the single
		   most consequential thing that happens to college basketball in real
		   life. A realignment moves two to five of the best programmes in
		   weaker leagues into a conference that is raiding. 0 turns it off. */
		realignmentRate: 0.35,
		/* How many blue bloods have a down year, beyond the ordinary
		   programme-strength roll. "The year three blue bloods all went down"
		   is a season nobody forgets and nothing could ask for it. */
		bluebloodDownYears: 0,
		/* How far the mid-majors are lifted, in programme-strength points. */
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
		// Destination weights for players whose college is blank. Each is
		// further scaled by where the player was born (see Colleges.regions).
		leagueWeights: null,   // null = each league's built-in default weight

		// --- class years and how a prospect got here ------------------------
		// BBGM draft classes are nearly all age 19, so class year has to be
		// rolled rather than read off the birthday. This is the share of the
		// class that stayed one year; the rest spread across the other three.
		freshmanShare: 46,
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
		noteLines: ["team", "stats", "shooting", "signature", "awards"],

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
		   the older behaviour: a backward-scaled copy of the draft-year line,
		   which reads fine and is not a season. */
		priorSeasons: "simulate",   // "simulate" | "reconstruct"

		// --- postseason ---------------------------------------------------
		upsetFactor: 1.0,      // 0 = chalk, 2 = madness
		// How far into the national field the honours reach. Kept separate
		// from the two things it used to silently also control.
		awardStrictness: 1.0,
		// Conference honours are their own dial: 32 conferences hand out far
		// more hardware than the national voters do, and wanting a realistic
		// number of one is not wanting fewer of the other.
		confAwardStrictness: 1.0,
		// The bar a prospect abroad has to clear for a pro-league honour.
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
		"Loaded class": { classQuality: 2, eliteCount: 4, potBias: 1 },
		"Weak class": { classQuality: -2, eliteCount: 0, potBias: -1, ovrMode: "curve" },
		"Top heavy": { classDepth: -2, eliteCount: 3, ovrMode: "curve" },
		"Deep, no stars": { classDepth: 2, eliteCount: 0, ovrMode: "curve" },
		"Specialist league": { specialization: 1.8, archetypeDiversity: 95, buildNoise: 7, classFlavor: 1.6 },
		"Guard-heavy class": { classFlavor: 2, archetypeDiversity: 92 },
		"Transfer-portal era": { transferShare: 62, freshmanShare: 32 },
		"International class": {
			leagueWeights: {
				"EuroLeague": 40, "Liga ACB": 22, "EuroCup": 20,
				"Adriatic League": 18, "LNB Pro A": 18,
				"Basketball Bundesliga": 16, "Chinese CBA": 10,
				"NBA G League": 8, "NBL": 14, "NBL1": 4,
				"Overtime Elite": 3, "NBA Academy": 8,
			},
		},
		"Vanilla builds": { specialization: 0.2, archetypeDiversity: 20 },
		"One-and-done era": { freshmanShare: 78 },
		"Veteran-heavy class": { freshmanShare: 16 },
		"2015 scoring drought": { era: "2009-2021", pace: 64, efficiencyEnv: -1 },
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

	function make(overrides) {
		const cfg = Object.assign({}, DEFAULTS, overrides || {});
		/* Copy every container the UI can write into, so a preset or a URL
		   payload can never be mutated in place by the editor that displays it.

		   noteLines was copied and archetypeWeights was not, even though the
		   archetype-frequency editor writes straight into
		   state.cfg.archetypeWeights: editing a weight after loading a preset
		   (or a shared link) rewrote the preset itself, silently and
		   permanently. leagueWeights is rebuilt below, but from an object the
		   caller still owns. */
		cfg.noteLines = (cfg.noteLines || DEFAULTS.noteLines).slice();
		// Deep-copied for the same reason noteLines is: the pool memory is a
		// container the UI writes into between runs.
		cfg.recentPools = Array.isArray(cfg.recentPools)
			? cfg.recentPools.filter(Array.isArray).map((a) => a.slice())
			: null;
		cfg.archetypeWeights = Object.assign({}, cfg.archetypeWeights || {});
		// Destination weights: start from the built-ins, apply anything the
		// caller set, then fold in the three legacy sliders so old presets and
		// old shareable links still mean what they meant.
		const lw = Object.assign(defaultLeagueWeights(), cfg.leagueWeights || {});
		const legacy = {
			wEuroLeague: "EuroLeague", wGLeague: "NBA G League", wNBL: "NBL",
		};
		for (const key of Object.keys(legacy)) {
			if (Number.isFinite(cfg[key])) lw[legacy[key]] = cfg[key];
		}
		cfg.leagueWeights = lw;
		return cfg;
	}

	global.Config = { DEFAULTS, PRESETS, make, defaultLeagueWeights };
})(typeof window !== "undefined" ? window : self);
