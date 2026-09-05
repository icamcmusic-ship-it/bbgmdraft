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
		   size the class always had — the label just now says it. */
		archetypePool: 21,
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
		   turns over 40-60 of the 368 programs a year, which is what Division
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
		// Destination weights for players whose college is blank. Each is
		// further scaled by where the player was born (see Colleges.regions).
		leagueWeights: null,   // null = each league's built-in default weight

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

		// --- postseason ---------------------------------------------------
		upsetFactor: 1.0,      // 0 = chalk, 2 = madness
		// How far into the national field the honors reach. Kept separate
		// from the two things it used to silently also control.
		awardStrictness: 1.0,
		// Conference honors are their own dial: 32 conferences hand out far
		// more hardware than the national voters do, and wanting a realistic
		// number of one is not wanting fewer of the other.
		confAwardStrictness: 1.0,
		// The bar a prospect abroad has to clear for a pro-league honor.
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
		"Blue-blood freshman wave": { freshmanShare: 46, eliteCount: 3 },
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
		"archetypeDiversity", "pace", "buildNoise", "variation",
		"coachTurnover", "realignmentMemory", "starReturners", "portalRate",
		"recruitMomentum",
		"flavorReach", "wEuroLeague", "wGLeague", "wNBL",
	]);
	function isCount(key) { return COUNTS.has(key); }

	global.Config = { DEFAULTS, PRESETS, make, defaultLeagueWeights, COUNTS, isCount };
})(typeof window !== "undefined" ? window : self);
