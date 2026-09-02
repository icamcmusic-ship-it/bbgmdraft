/* The pipeline: league file in, customized league file (plus a whole simulated
   college season) out.

   run() is a thin wrapper over a staged pipeline (see PHASES). Each stage
   declares which settings it depends on, so the UI can re-run only what a
   given slider actually changed: moving "Award strictness" or the note
   template no longer re-simulates 368 programs, 11,000 games and 3,500 stat
   lines to change one line of text. */
(function (global) {
	"use strict";

	const { Rng, clamp } = global.BBGMRng;
	const BB = global.BBGM;
	const C = global.Colleges;
	const RB = global.RatingsBuilder;
	const Text = global.Text;
	const T = global.TeamsSim;
	const S = global.StatsSim;
	const TN = global.Tournament;
	const RK = global.Rankings;
	const AW = global.Awards;
	const CAL = global.Calibration;

	/* Season length per non-NCAA destination. */
	const PRO_GAMES = {
		"EuroLeague": 34, "NBA G League": 48, "Liga ACB": 34, "NBL": 28,
		"Chinese CBA": 46, "LNB Pro A": 34, "EuroCup": 18,
		"Basketball Bundesliga": 34, "Adriatic League": 30, "NBL1": 22,
		"Overtime Elite": 16, "NBA Academy": 20, "DII NCAA": 29,
	};

	/* Round names for a league playoff, so the EuroLeague ends in a Final Four
	   rather than "round 2 of a generic single-elimination playoff". */
	const PLAYOFF_ROUNDS = {
		8: ["Quarterfinals", "Final Four", "Final"],
		4: ["Semifinals", "Final"],
		2: ["Final"],
	};

	const CLASS_YEARS = ["Freshman", "Sophomore", "Junior", "Senior"];

	/* Class year from age alone made 70 out of 70 prospects freshmen: BBGM
	   draft classes are almost entirely age 19, so age carries no signal. That
	   collapsed four award categories into one (National Freshman of the Year
	   was just Player of the Year again).

	   So: use age when the file actually varies it, and otherwise roll years-
	   in-program against the prospect's draft standing — the top of a class
	   really is mostly one-and-done, the back half really is mostly juniors and
	   seniors — with cfg.freshmanShare setting the overall mix. */
	function classYear(age) {
		if (age <= 19) return "Freshman";
		if (age === 20) return "Sophomore";
		if (age === 21) return "Junior";
		return "Senior";
	}

	/* Where a prospect came from, not only how long he has been there.

	   The class-year system used to be one slider and a rank tilt, which in
	   2020s college basketball leaves out the single largest roster mechanic
	   there is. A prospect can now be a transfer (mid-major to high-major, JUCO,
	   or a fifth-year), can have redshirted, and can have reclassified in or out
	   of his original graduating class. None of it changes his ratings — it is
	   biography, and biography is what a scouting note is made of. */
	const TRANSFER_KINDS = [
		{ kind: "mid-major jump", w: 3.0, from: "mid" },
		{ kind: "high-major transfer", w: 2.0, from: "high" },
		{ kind: "JUCO transfer", w: 1.2, from: "juco" },
		{ kind: "fifth-year transfer", w: 1.1, from: "high", fifthYear: true },
		{ kind: "low-major jump", w: 1.4, from: "low" },
		/* Five kinds could not describe a transfer portal that produces all of
		   these every single year. A service academy releases players who
		   cannot commit to the service obligation; a man who signed abroad at
		   eighteen and came back is a recognisable draft-class character; the
		   NAIA-to-D-I jump is the classic late riser; and the walk-on who
		   earned a scholarship is the one the arena stands up for. */
		{ kind: "service academy transfer", w: 0.45, from: "academy" },
		{ kind: "returned from overseas", w: 0.55, from: "overseas" },
		{ kind: "NAIA transfer", w: 0.5, from: "naia" },
		{ kind: "walk-on turned starter", w: 0.5, from: "walkon", sameSchool: true },
		{ kind: "grad transfer", w: 1.0, from: "mid", fifthYear: true },
	];
	const ACADEMIES = ["Army", "Navy", "Air Force", "VMI", "The Citadel", "Merchant Marine"];
	const OVERSEAS_ORIGINS = [
		"Real Madrid's academy", "FC Barcelona's academy", "Ratiopharm Ulm",
		"KK Mega Basket", "Zalgiris Kaunas", "the NBA Global Academy",
		"Overtime Elite", "the Australian NBL's Next Stars",
	];
	const NAIA_ORIGINS = [
		"Indiana Wesleyan", "Talladega", "Georgetown (KY)", "Arizona Christian",
		"Freed-Hardeman", "Ottawa (AZ)", "Bethel (IN)", "Xavier (LA)",
	];

	function assignClassYears(players, cfg, rng, ageIsInformative) {
		const share = clamp(
			(cfg.freshmanShare === undefined ? 46 : cfg.freshmanShare) / 100, 0, 1);
		const transferShare = clamp(
			(cfg.transferShare === undefined ? 34 : cfg.transferShare) / 100, 0, 1);
		const redshirtShare = clamp(
			(cfg.redshirtShare === undefined ? 8 : cfg.redshirtShare) / 100, 0, 1);
		const reclassShare = clamp(
			(cfg.reclassShare === undefined ? 7 : cfg.reclassShare) / 100, 0, 1);
		const order = players.slice().sort((a, b) => b.origOvr - a.origOvr);
		const n = Math.max(1, order.length - 1);
		const lowMajors = [];
		const midMajors = [];
		const highMajors = [];
		for (const name of C.names) {
			const conf = C.CONFERENCES[C.conferenceOf(name)];
			if (!conf) continue;
			(conf.tier === "high" ? highMajors : conf.tier === "mid" ? midMajors : lowMajors)
				.push(name);
		}
		/* Nine schools was the entire junior-college world, so every JUCO
		   transfer in every class came from the same nine names. */
		const JUCO = [
			"Chipola College", "Northwest Florida State", "Salt Lake CC",
			"Hutchinson CC", "Vincennes University", "Indian Hills CC",
			"Ranger College", "South Plains College", "Trinity Valley CC",
			"Odessa College", "Coffeyville CC", "Moberly Area CC",
			"Eastern Florida State", "Northwest Kansas Tech", "Casper College",
			"Western Nebraska CC", "Mineral Area College", "Iowa Western CC",
			"John A. Logan College", "Southeastern CC", "Panola College",
			"Wabash Valley College", "Cochise College", "Barton CC",
			"Snow College", "Southern Idaho", "Tallahassee CC", "Gillette College",
		];

		order.forEach((p, i) => {
			const r = rng.child("class:" + p.key);
			const rank = i / n;                    // 0 = best prospect in the class
			if (ageIsInformative) {
				p.classYear = classYear(p.age);
			} else {
				// Freshman odds fall off steeply down the board.
				const pFresh = clamp(share * (1.75 - 1.45 * rank), 0, 0.96);
				const rest = 1 - pFresh;
				// The remainder splits toward the upperclassmen as rank drops.
				const w = [pFresh, rest * (0.46 - 0.10 * rank), rest * (0.30 + 0.02 * rank),
					rest * (0.24 + 0.08 * rank)];
				const tot = w.reduce((a, b) => a + b, 0);
				let x = r.random() * tot;
				let idx = 0;
				for (; idx < w.length - 1; idx++) {
					x -= w[idx];
					if (x <= 0) break;
				}
				// An age of 19 tells us nothing here (that is why we are rolling),
				// but a genuinely old prospect should not come out a freshman.
				if (p.age >= 21) idx = Math.max(idx, clamp(p.age - 20, 0, 3));
				p.classYear = CLASS_YEARS[clamp(idx, 0, 3)];
			}
			const yearIdx = CLASS_YEARS.indexOf(p.classYear);

			// Reclassification: moving up a year (the common direction — a
			// talented junior graduating early) or, rarely, back.
			p.reclassified = null;
			if (r.random() < reclassShare) {
				p.reclassified = r.random() < 0.78 ? "reclassified up a year"
					: "reclassified back a year";
			}
			// A redshirt only makes sense for someone who has been around.
			p.redshirt = yearIdx >= 1 && r.random() < redshirtShare
				? (r.random() < 0.55 ? "redshirt" : "medical redshirt")
				: null;
			if (p.redshirt) p.classYear = "Redshirt " + p.classYear;

			// Transfers. Freshmen do not transfer; the rest increasingly do.
			p.transfer = null;
			if (yearIdx >= 1 && r.random() < transferShare * (0.55 + 0.55 * yearIdx)) {
				const kind = r.weighted(TRANSFER_KINDS);
				const pool = kind.from === "juco" ? JUCO
					: kind.from === "academy" ? ACADEMIES
					: kind.from === "overseas" ? OVERSEAS_ORIGINS
					: kind.from === "naia" ? NAIA_ORIGINS
					: kind.from === "high" ? highMajors
					: kind.from === "mid" ? midMajors : lowMajors;
				p.transfer = {
					kind: kind.kind,
					// A walk-on did not come from anywhere: he was already here.
					from: kind.sameSchool ? null
						: (pool.length ? r.pick(pool) : "junior college"),
					fifthYear: !!kind.fifthYear,
				};
				if (kind.fifthYear) p.classYear = "Graduate";
			}
		});
	}

	/* Up, sideways or down.

	   A transfer carried a `kind` and a `from`, and the relationship between
	   where he left and where he landed was never looked at — so a man leaving
	   Duke for a mid-major and a man leaving a mid-major for Duke produced the
	   same sentence, when they are close to opposite stories about the same
	   player. One is a prospect who could not get on the floor at the highest
	   level and went to go and play; the other is a mid-major star who earned a
	   move up and now has to prove it against better people. Both are things a
	   scout says out loud, and the model already knew everything needed to tell
	   them apart.

	   `direction` is set on the transfer and the note reads it. A named origin
	   that is not in the college database (a JUCO, an academy, an overseas
	   club, "a Big Ten program") has no prestige to compare and is left
	   undirected rather than guessed at. */
	const TRANSFER_UP = 8;      // prestige points that make a move a step up
	function describeTransfer(p) {
		const t = p.transfer;
		if (!t || !t.from || p.nonNcaa) return;
		const known = (name) => Object.prototype.hasOwnProperty.call(C.COLLEGES, name);
		if (!known(t.from) || !known(p.newCollege)) return;
		const before = C.prestige(t.from);
		const after = C.prestige(p.newCollege);
		t.fromPrestige = before;
		t.toPrestige = after;
		const step = after - before;
		t.direction = step >= TRANSFER_UP ? "up"
			: step <= -TRANSFER_UP ? "down" : "lateral";
		t.story = t.direction === "up"
			? "a step up in level from " + t.from
			: t.direction === "down"
				? "dropped down a level from " + t.from + " to play"
				: "a lateral move from " + t.from;
	}

	function assignCollege(rng, player, cfg) {
		if (player.college && player.college.trim() !== "") return C.canonical(player.college);
		if (rng.chance(clamp(cfg.pDII, 0, 1))) return "DII NCAA";
		const loc = player.born && player.born.loc;
		const weights = cfg.leagueWeights || {};
		const opts = [];
		for (const name of Object.keys(C.NON_NCAA)) {
			if (name === "DII NCAA") continue;
			const w = C.leagueWeight(name, loc, weights[name]);
			if (w > 0) opts.push({ name, w });
		}
		if (!opts.length) return "NBA G League";
		return rng.weighted(opts).name;
	}

	function inchesFromHgtRating(hgtRating) {
		// BBGM height ratings map roughly linearly onto listed height.
		return Math.round(66 + (hgtRating / 100) * 24);
	}

	/* Where a BBGM export can keep the season, in the order worth trying. */
	function findSeason(lf) {
		const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 1900 &&
			Number(v) < 3000 ? Number(v) : null);
		const direct = num(lf.startingSeason) !== null ? num(lf.startingSeason) : num(lf.season);
		if (direct !== null) return direct;
		const ga = lf.gameAttributes;
		if (ga) {
			// Either { season: 2026 } or the array-of-rows form BBGM also writes.
			const rows = Array.isArray(ga) ? ga : Object.keys(ga).map((k) => ({ key: k, value: ga[k] }));
			for (const key of ["season", "startingSeason"]) {
				for (const row of rows) {
					if (!row || row.key !== key) continue;
					const v = row.value && typeof row.value === "object" && "value" in row.value
						? row.value.value : row.value;
					/* The {start, value} history rows BBGM writes. Walk them
					   from the newest backwards rather than reading only the
					   last one: an export whose history array is EMPTY made
					   v[-1] undefined, and an export whose newest row is
					   malformed made v[len-1].value undefined — both of which
					   fell through to the player scan and then reported "this
					   file has no top-level startingSeason" for a file whose
					   gameAttributes carried the season perfectly well one row
					   earlier. */
					let n = null;
					if (Array.isArray(v)) {
						for (let i = v.length - 1; i >= 0 && n === null; i--) {
							const row2 = v[i];
							if (!row2 || typeof row2 !== "object") continue;
							n = num(row2.value);
						}
					} else {
						n = num(v);
					}
					if (n !== null) return n;
				}
			}
		}
		// Last resort: the draft year the players themselves carry.
		for (const p of lf.players || []) {
			const n = num(p && p.draft && p.draft.year);
			if (n !== null) return n;
		}
		return null;
	}

	/* Reject a malformed file with a sentence a human can act on, instead of
	   letting a TypeError out of the middle of the pipeline.

	   Returns {warnings: [...]} — problems that do not stop the run but that
	   the user needs to be told about, chief among them a missing pid. */
	/* Above this, a file is a league export and not a draft class. */
	const MAX_CLASS = 250;

	function validateLeagueFile(leagueFile) {
		if (!leagueFile || typeof leagueFile !== "object") {
			throw new Error("That file is not a BBGM league or draft-class export.");
		}
		if (!Array.isArray(leagueFile.players) || !leagueFile.players.length) {
			throw new Error("No players array in this file (or it is empty).");
		}
		/* The season the class belongs to. BBGM has shipped exports where it is
		   not at the top level — it can sit in gameAttributes (as a plain value
		   or as one of the {start, value} history rows BBGM writes) or as a
		   bare `season` — and a hard throw rejected files that carry it
		   perfectly well, just somewhere else. Look for it before giving up,
		   and only then ask the user. */
		const season = findSeason(leagueFile);
		if (season === null) {
			throw new Error(
				"This file has no startingSeason, so the season the stats belong to " +
				"is unknown. Export the draft class from BBGM again, or add " +
				'"startingSeason": <year> to the file.');
		}
		const seasonRecovered = !Number.isFinite(Number(leagueFile.startingSeason));
		/* The season is REPORTED, not written back.

		   This used to do `leagueFile.startingSeason = season`, quietly editing
		   the caller's object as a side effect of checking it — so a validator
		   left the thing it validated in a different state than it found it,
		   and any caller that revalidated got a different `seasonRecovered`
		   answer the second time. The callers apply it themselves now. */
		const bad = [];
		let missingPid = 0;
		const seenPid = new Set();
		let duplicatePid = 0;
		let draftYearMismatch = 0;
		leagueFile.players.forEach((p, i) => {
			if (p && p.draft && Number.isFinite(Number(p.draft.year)) &&
				Number(p.draft.year) !== season) draftYearMismatch++;
			const who = p && (p.firstName || p.lastName)
				? ((p.firstName || "") + " " + (p.lastName || "")).trim()
				: "player #" + i;
			if (!p || typeof p !== "object") { bad.push("player #" + i + " is not an object"); return; }
			/* Independent checks, not an else-chain: a player broken in both
			   ways used to report one problem, the user fixed it, reloaded,
			   and got a second error for the same row. */
			if (!Array.isArray(p.ratings) || !p.ratings.length) {
				bad.push(who + " has no ratings");
			} else {
				/* A partial ratings block reached exportFile's ratings[last]
				   write and silently produced a player with zeros. */
				const last = p.ratings[p.ratings.length - 1];
				const missing = last && typeof last === "object"
					? BB.RATING_KEYS.filter((k) => !Number.isFinite(Number(last[k])))
					: BB.RATING_KEYS;
				if (missing.length) {
					bad.push(who + " last ratings row is missing " +
						(missing.length === BB.RATING_KEYS.length
							? "every rating key"
							: missing.slice(0, 5).join(", ") +
								(missing.length > 5 ? ", …" : "")));
				}
			}
			if (!p.born || !Number.isFinite(Number(p.born.year))) {
				bad.push(who + " has no born.year");
			}
			/* A file without pids used to collapse the entire generator in
			   silence. Every RNG stream is keyed off it — rng.child("build:" +
			   p.pid), "college:", "class:", "stat:" — so with pid undefined
			   every child key became the identical string and every player drew
			   the identical random sequence: a 70-man class came out with one
			   archetype (all Balanced) and no error, no warning, and no way for
			   the user to know why. state.overrides is keyed by pid too, so
			   every lock collided into one entry.

			   BBGM has shipped exports without pids, so this is a warning and a
			   fallback (the array index becomes the key), not a rejection. */
			if (!Number.isFinite(Number(p.pid))) missingPid++;
			else if (seenPid.has(Number(p.pid))) duplicatePid++;
			else seenPid.add(Number(p.pid));
		});
		if (bad.length) {
			throw new Error("Malformed players (" + bad.length + "): " +
				bad.slice(0, 4).join("; ") + (bad.length > 4 ? "; …" : ""));
		}
		const warnings = [];
		/* How many of these players actually belong to the draft class.

		   Dropping a full BBGM league export (5,000+ players) instead of a
		   draft class rebuilt every player and simulated 368 programs with
		   hundreds of prospects apiece: the tab locked with no progress and no
		   way out, and nothing in here checked the count. The class is the
		   players whose draft year is this season; if that leaves a plausible
		   class, the caller is told it can take that subset instead of the
		   whole file. */
		const inClass = leagueFile.players.filter((p) =>
			p && p.draft && Number(p.draft.year) === Number(season));
		const oversized = leagueFile.players.length > MAX_CLASS;
		if (oversized) {
			warnings.push(leagueFile.players.length + " players in this file — a draft " +
				"class is usually 60-80. This looks like a full league export rather " +
				"than a draft class, and simulating a season for all of them will " +
				"take a very long time." +
				(inClass.length && inClass.length <= MAX_CLASS
					? " " + inClass.length + " of them are drafted in " + season +
						", which is almost certainly the class you meant."
					: ""));
		}
		if (seasonRecovered) {
			warnings.push("This file has no top-level startingSeason. " + season +
				" was read from the file instead (gameAttributes, or the draft year " +
				"on the players). If that is the wrong year, add " +
				'"startingSeason": <year> to the file.');
		}
		if (missingPid) {
			warnings.push(missingPid + " of " + leagueFile.players.length +
				" players have no pid. Their position in the file is used instead, " +
				"so the class generates correctly — but per-player locks and " +
				"shareable links for this file are tied to row order, not to the " +
				"player.");
		}
		if (duplicatePid) {
			warnings.push(duplicatePid + " players share a pid with another player. " +
				"Row order is used to tell them apart.");
		}
		if (draftYearMismatch && !oversized) {
			warnings.push(draftYearMismatch + " of " + leagueFile.players.length +
				" players carry a draft year that is not " + season + ". Ages and " +
				"class years are measured from " + season + " for everyone, so a " +
				"player drafted in another year will read older or younger than " +
				"his own draft class would have made him.");
		}
		return {
			ok: true,
			warnings,
			season,
			seasonRecovered,
			total: leagueFile.players.length,
			oversized,
			// The subset the caller can offer to load instead, when the file is
			// a whole league rather than a class.
			classPids: oversized && inClass.length && inClass.length <= MAX_CLASS
				? inClass.map((p, i) => (Number.isFinite(Number(p.pid)) ? Number(p.pid) : -1 - i))
				: null,
			classCount: inClass.length,
		};
	}

	/* A per-player salt for the RNG streams. `reroll` re-draws ONE prospect:
	   every stream in the generator is keyed off the player's key, so salting
	   his key changes his draw and leaves every other player's stream
	   untouched — which is the difference between "look at this guy again" and
	   "reroll the class and hope the other sixty-nine come back the same". */
	/* The class-wide variation salt. Appended to every PER-PLAYER stream key
	   and to nothing else, so cfg.variation re-rolls the sixty-eight men inside
	   a class whose flavor, build pool, curve and environment are unchanged.

	   Empty at variation 0, which is what keeps every seed and every shareable
	   link ever made resolving to exactly the class it always did. */
	function variationSalt(cfg) {
		const v = Math.round(Number(cfg && cfg.variation) || 0);
		return v > 0 ? "/v" + v : "";
	}

	function rerollSalt(p, axis) {
		const ov = (p && p.override) || {};
		/* Axis-wise rerolls. "Reroll just him" redraws everything about a
		   prospect at once, and the thing you usually want is narrower: this
		   build at a different school, or this school with a different build,
		   or the same player with the stat noise redrawn. Each axis carries its
		   own counter so the streams it does not name are untouched.

		   The whole-player counter still salts every axis, so "reroll him"
		   keeps meaning what it meant. */
		const n = Number(ov.reroll) || 0;
		const a = axis ? Number(ov["reroll_" + axis]) || 0 : 0;
		return (n ? "~" + Math.round(n) : "") + (a ? "@" + axis + Math.round(a) : "");
	}

	/* The override keys that describe a player's SIZE, and therefore the ones
	   that make exportFile write hgt/weight back into a file that did not have
	   them. Declared once so that adding an override key is a decision about
	   this list rather than an accident. */
	const SIZE_OVERRIDE_KEYS = ["hgtInches", "weight"];

	/* The stable per-player key every RNG stream and every lock is derived
	   from. */
	function playerKey(p, idx) {
		return Number.isFinite(Number(p && p.pid)) ? String(p.pid) : "idx" + idx;
	}

	/* ------------------------------------------------------------- phase 1 */

	/* Apply a flavor's config bend to the settings the user has left alone.
	   Compared against Config.DEFAULTS key by key: a value the user moved is
	   theirs and is not touched. */
	/* The three legacy destination sliders. Config.make folds these into
	   `leagueWeights` — which is what assignCollege actually reads — and it does
	   so at make() time, BEFORE a flavor bend runs. So a flavor that set
	   wEuroLeague wrote a number nothing read: measured, the "unusually
	   international" flavor, whose whole purpose is to put more of the class
	   abroad, produced EuroLeague at 11.9% of non-NCAA prospects against 11.9%
	   with no flavor at all. Same for every value it set.

	   Folding them again here fixes that, and only when the user has not
	   touched the destination table themselves — a flavor nudges what the user
	   has not decided and never overrules what they have, which is the rule the
	   rest of this function follows. */
	const LEGACY_LEAGUE = {
		wEuroLeague: "EuroLeague", wGLeague: "NBA G League", wNBL: "NBL",
	};

	function untouchedLeagueWeights(cfg) {
		const built = global.Config.defaultLeagueWeights();
		const have = cfg.leagueWeights || {};
		const keys = Object.keys(built);
		if (Object.keys(have).length !== keys.length) return false;
		return keys.every((k) => have[k] === built[k]);
	}

	function applyFlavorConfig(cfg, flavor) {
		const bend = RB.flavorConfig(flavor);
		if (!bend) return cfg;
		const out = Object.assign({}, cfg);
		const D = global.Config.DEFAULTS;
		/* The bend scales with flavor strength, like the tag multipliers
		   always did. It used to be applied at full size whatever the slider
		   said, so for the narrative flavors whose whole point IS the bend
		   (injury year, blue bloods down, mid-major year…) the slider labeled
		   "how strongly the flavor leans" did essentially nothing: measured,
		   classFlavor 0.1 and classFlavor 2 both returned the identical
		   {injuryRate: 2}. Interpolated from the default toward the authored
		   bend; above 1 it extrapolates mildly (half slope, capped at 1.5x)
		   rather than linearly, because the authored values are already the
		   full-strength statement and 2x "freshmanShare: 68" is 90. */
		const s = flavor && Number.isFinite(flavor.strength) ? flavor.strength : 1;
		const t = s <= 1 ? Math.max(0, s) : Math.min(1.5, 1 + 0.5 * (s - 1));
		let moved = false;
		let league = false;
		for (const k of Object.keys(bend)) {
			if (cfg[k] !== D[k]) continue;
			if (typeof bend[k] === "number" && typeof D[k] === "number") {
				const v = D[k] + (bend[k] - D[k]) * t;
				// A count stays a count: eliteCount 1.5 is not a class anyone
				// can build.
				out[k] = (Number.isInteger(D[k]) && Number.isInteger(bend[k]))
					? Math.round(v) : v;
			} else {
				out[k] = bend[k];
			}
			moved = true;
			if (LEGACY_LEAGUE[k]) league = true;
		}
		if (league && untouchedLeagueWeights(cfg)) {
			const lw = Object.assign({}, out.leagueWeights);
			for (const k of Object.keys(LEGACY_LEAGUE)) {
				if (Number.isFinite(out[k])) lw[LEGACY_LEAGUE[k]] = out[k];
			}
			out.leagueWeights = lw;
		}
		return moved ? out : cfg;
	}

	function phaseBuild(state) {
		const { leagueFile } = state;
		const rng = state.rng;
		const season = leagueFile.startingSeason;

		/* This year's flavor, drawn before anything is built because some
		   flavors bend the class itself and not only its archetype mix.

		   "A weak year", "one-and-done heavy" and "a transfer-portal class" are
		   the things a draft class is actually remembered as, and none of them
		   is expressible as a tilt on archetype weights: they are statements
		   about how good the top of the class is, how old it is, and how it got
		   where it is. So a flavor carries a config bend, applied here.

		   A user's own setting always wins. The bend is applied only to
		   settings still sitting at their default, so a flavor moves what the
		   user has not decided and never overrules what they have. */
		/* The per-player variation salt. Class-level streams below (flavor,
		   pool, classEnv) deliberately do NOT take it: that is what makes
		   variation "the same class, different men" rather than a second seed. */
		const vsalt = variationSalt(state.cfg);
		const flavor = RB.pickFlavor(rng.child("flavor"), state.cfg);
		state.flavor = flavor;
		const cfg = applyFlavorConfig(state.cfg, flavor);

		/* Class-level environment jitter. Every class plays in a slightly
		   different scoring environment — some years run faster, some shoot
		   better, some are noisier — and without jitter those three sliders
		   produce identical environments on every reroll. The jitter is small
		   enough to stay inside the slider's useful range and large enough to
		   make two classes with the same settings feel different. */
		const envRng = rng.child("classEnv");
		const jitteredCfg = Object.assign({}, cfg);
		jitteredCfg.pace = Math.max(55, cfg.pace + envRng.normal(0, 2.5));
		jitteredCfg.efficiencyEnv = clamp(
			(cfg.efficiencyEnv || 0) + envRng.normal(0, 0.6), -3, 3);
		jitteredCfg.statNoise = Math.max(0,
			(Number.isFinite(cfg.statNoise) ? cfg.statNoise : 1) + envRng.normal(0, 0.25));

		state.effectiveCfg = jitteredCfg;
		/* The builds this class is made of. Drawing the pool before the players
		   is what turns "one of everything, every class" into "the year of the
		   stretch bigs" — see pickClassPool. */
		state.archetypePool = RB.pickClassPool(rng.child("pool"), cfg, flavor);

		const raw = leagueFile.players || [];
		const players = raw.map((p, idx) => {
			const r = p.ratings[p.ratings.length - 1];
			// Defensive defaults: files without listed height/weight would
			// otherwise export NaN -> null and produce 0-inch players in BBGM.
			const hgtIn = Number.isFinite(p.hgt)
				? p.hgt
				: inchesFromHgtRating(r.hgt);
			const wt = Number.isFinite(p.weight)
				? p.weight
				: Math.round(140 + hgtIn * 0.9 + (r.stre || 50) * 0.35);
			const key = playerKey(p, idx);
			return {
				src: p,
				idx,
				pid: p.pid,
				key,
				name: ((p.firstName || "") + " " + (p.lastName || "")).trim() ||
					("Prospect " + (p.pid === undefined ? idx : p.pid)),
				born: p.born,
				/* Handedness: about one player in nine shoots left-handed, it
				   is the first thing a scout writes after the height, and
				   nothing in the tool carried it. Drawn per player key so it
				   survives rerolls. */
				hand: rng.child("hand:" + key).random() < 0.11 ? "left" : "right",
				/* Age at the class's own season. It used to prefer each
				   player's draft.year, so in an export whose top-level season
				   and a player's draft year disagreed (a multi-year league
				   subset), two prospects in the same class could have their
				   ages measured from different years. One reference year for
				   the whole class; validateLeagueFile warns when a draft year
				   disagrees with it. */
				age: season - Number(p.born.year),
				draftRound: p.draft && Number.isFinite(p.draft.round) ? p.draft.round : null,
				draftPick: p.draft && Number.isFinite(p.draft.pick) ? p.draft.pick : null,
				origCollege: C.canonical(p.college),
				origRatings: r,
				origOvr: r.ovr,
				origPot: r.pot,
				origPos: r.pos,
				hgtInches: hgtIn,
				weight: wt,
			};
		});
		// Age only tells us anything if the file actually varies it.
		const ages = players.map((p) => p.age);
		const ageMean = ages.reduce((a, b) => a + b, 0) / ages.length;
		const ageSd = Math.sqrt(
			ages.reduce((a, x) => a + (x - ageMean) * (x - ageMean), 0) / ages.length);
		state.classAge = ageMean;
		assignClassYears(players, cfg, rng.child("classyears" + vsalt), ageSd >= 0.75);

		// --- colleges -------------------------------------------------
		// Per-player overrides ("lock this guy at 55 ovr / to Duke / as a Rim
		// Protector") survive rerolls: they are read here, not re-rolled.
		const overrides = (cfg && cfg.overrides) || {};
		const ovOf = (p) => overrides[p.key] || overrides[p.pid] ||
			overrides[String(p.pid)] || {};

		for (const p of players) {
			const ov = ovOf(p);
			p.override = ov;
			// A renamed prospect keeps the new name everywhere, including in
			// the exported file.
			if (ov.name && String(ov.name).trim()) p.name = String(ov.name).trim();
			p.newCollege = ov.college ||
				assignCollege(
					rng.child("college:" + p.key + rerollSalt(p, "school") + vsalt), p.src, cfg);
			p.collegeChanged = p.newCollege !== p.origCollege;
			// Professional (a EuroLeague club) as against amateur (DII, an NBA
			// Academy). The UI tags the two differently and the award bar
			// scales with it.
			p.leaguePro = !!C.NON_NCAA[p.newCollege] && C.NON_NCAA[p.newCollege].pro;
			p.nonNcaa = !!C.NON_NCAA[p.newCollege];
		}
		/* Which WAY a transfer went. Class years (and therefore transfers) are
		   assigned before colleges, so the destination is only known here. */
		for (const p of players) describeTransfer(p);

		// --- ratings ---------------------------------------------------
		const order = players.slice().sort((a, b) => b.origOvr - a.origOvr);
		let curve = null;
		if (cfg.ovrMode === "curve") curve = RB.classCurve(rng, players.length, cfg);

		order.forEach((p, i) => {
			const ov = p.override || {};
			/* `reroll` re-draws ONE prospect. Every stream in the generator is
			   keyed off the player's key, so salting his key changes his draw
			   and leaves every other player's stream untouched — which is the
			   difference between "look at this guy again" and "reroll the class
			   and hope the other sixty-nine come back the same". */
			const prng = rng.child("build:" + p.key + rerollSalt(p, "build") + vsalt);
			const targetOvr = Number.isFinite(ov.ovr)
				? clamp(Math.round(ov.ovr), 0, 100)
				: (curve ? curve[i] : p.origOvr);
			// The raw ovr->pot gap, before any of the potential dials. This is
			// what the college season is simulated off (see talentPot), so
			// moving "Potential bias" never re-simulates a game.
			let gap = Math.max(1, p.origPot - p.origOvr);
			if (curve) gap = prng.truncNormal(17, 7, 2, 45);

			// Size variance happens BEFORE the rebuild so the hgt rating and the
			// listed height stay in sync (they'd otherwise drift up to 3 inches
			// apart and the player would simulate at a different size than
			// listed). ~4.2 rating points per inch on BBGM's mapping.
			p.newHgtInches = p.hgtInches;
			let baseRatings = p.origRatings;
			// A hand-set listed height moves the hgt rating with it, so the
			// player simulates at the size he is listed at.
			if (Number.isFinite(ov.hgtInches)) {
				p.newHgtInches = clamp(Math.round(ov.hgtInches), 58, 96);
				baseRatings = Object.assign({}, p.origRatings, {
					hgt: clamp(Math.round(p.origRatings.hgt +
						(p.newHgtInches - p.hgtInches) * (100 / 24)), 0, 100),
				});
			} else if (cfg.varySize) {
				p.newHgtInches = clamp(
					Math.round(p.hgtInches + prng.normal(0, 1.1)), 64, 92,
				);
				const dIn = p.newHgtInches - p.hgtInches;
				if (dIn !== 0) {
					baseRatings = Object.assign({}, p.origRatings, {
						hgt: clamp(Math.round(p.origRatings.hgt + dIn * (100 / 24)), 0, 100),
					});
				}
			}

			const built = RB.rebuild(
				prng, baseRatings, targetOvr, targetOvr + gap, cfg,
				ov.archetype || null, state.flavor, ov.ratings || null,
				state.archetypePool, i);
			p.newRatings = built.ratings;
			// Validate: every rating key must be a finite number. A NaN or
			// Infinity from a degenerate input or a solver edge case must not
			// propagate into the exported file — clamp to 0 instead.
			for (const k of BB.RATING_KEYS) {
				if (!Number.isFinite(p.newRatings[k])) {
					p.newRatings[k] = 0;
				}
			}
			// The pre-solve base and the pinned vector, so a forced size later
			// in the pipeline can be re-solved to the same overall instead of
			// leaving ovr disagreeing with the ratings beside it.
			// Carried onto the player so the stat model can salt its own stream
			// without knowing anything about overrides.
			p.statSalt = rerollSalt(p, "stats");
			p.buildBase = built.base;
			p.buildCleanBase = built.cleanBase;
			p.buildPinned = ov.ratings || null;
			p.newOvr = built.ovr;
			p.ovrRange = built.ovrRange;
			p.builtPot = built.pot;
			p.baseGap = gap;
			// A locked overall this player's height cannot reach is reported
			// rather than silently approximated.
			p.lockUnreachable = Number.isFinite(ov.ovr) && built.ovr !== targetOvr
				? { asked: targetOvr, got: built.ovr, range: built.ovrRange }
				: null;
			p.newPos = built.pos;
			p.newSkills = built.skills;
			p.archetype = built.archetype;
			p.newWeight = p.weight;
			if (Number.isFinite(ov.weight)) {
				p.newWeight = clamp(Math.round(ov.weight), 120, 400);
			} else if (Number.isFinite(ov.hgtInches)) {
				p.newWeight = clamp(
					Math.round(p.weight + (p.newHgtInches - p.hgtInches) * 5), 120, 400);
			} else if (cfg.varySize) {
				p.newWeight = clamp(
					Math.round(p.weight + (built.ratings.stre - p.origRatings.stre) * 0.55 +
						(p.newHgtInches - p.hgtInches) * 5 + prng.normal(0, 5)), 150, 330,
				);
			}
			/* Talent for the college sim reads the ORIGINAL file's ovr->pot
			   gap, not the displayed potential. Otherwise "Potential bias" —
			   a purely cosmetic dial — would change who plays and who scores,
			   and every move of it would re-simulate the season. */
			p.talentPot = clamp(p.newOvr + clamp(p.origPot - p.origOvr, 0, 40), 0, 100);
			// Provisional potential so anything reading it before the pot phase
			// still sees a sane number.
			p.newPot = clamp(Math.round(targetOvr + gap), p.newOvr, 100);
		});

		state.players = players;
		state.season = season;
		assignRecruiting(players, rng.child("recruiting" + vsalt));
		state.surprises = assignSurprises(players, rng.child("surprises" + vsalt), cfg);
		return state;
	}

	/* ------------------------------------------------------------ surprises */

	/* Every class gets two to four forced anomalies.

	   The class-level knobs were flavor and nothing else, and a class made
	   entirely of things the sliders predict is a class with no story in it:
	   measured over 24 rerolls, the class's mean scoring varied by a standard
	   deviation of 0.45 points and the distinct-archetype count by 2.7. At the
	   aggregate level every class was the same class, so there was nothing to
	   remember one by and no reason to reroll.

	   These are cheap — each is a bend on data the model already carries — and
	   they are the kind of thing a draft class IS remembered for. Each names
	   itself on the player, so the note and the table can say what happened.

	   `apply` runs after ratings, colleges, class years and recruiting, so a
	   surprise can contradict any of them, which is the point. */
	const SURPRISES = [
		{
			name: "five-star bust", w: 2.0,
			label: "a five-star recruit whose game never arrived",
			pick: (p) => !p.nonNcaa && p.recruiting && p.newOvr <= 44,
			apply: (p, r) => {
				p.recruiting.rank = r.int(1, 9);
				p.recruiting.stars = 5;
				p.recruiting.bust = true;
			},
		},
		{
			name: "unranked riser", w: 2.0,
			label: "unranked out of high school",
			pick: (p) => !p.nonNcaa && p.recruiting && p.newOvr >= 48,
			apply: (p, r) => {
				p.recruiting.rank = r.int(240, 320);
				p.recruiting.stars = 2;
				p.recruiting.unranked = true;
			},
		},
		{
			name: "old JUCO scorer", w: 1.4,
			label: "a 24-year-old who took the long road here",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				p.age = 24;
				p.classYear = "Graduate";
				p.transfer = {
					kind: "JUCO transfer",
					from: r.pick(["Chipola College", "Indian Hills CC", "Salt Lake CC",
						"Hutchinson CC", "Odessa College"]),
					fifthYear: true,
				};
				p.oldRoad = true;
			},
		},
		{
			name: "physical outlier", w: 1.6,
			label: "a physical outlier",
			pick: (p) => true,
			apply: (p, r) => {
				const tall = r.random() < 0.66;
				const inches = tall ? r.int(87, 89) : r.int(66, 68);
				/* Height feeds BBGM's overall formula more heavily than any
				   other rating, so moving it means re-solving: changing the
				   vector and leaving ovr alone would put the number in the
				   table at odds with the ratings it was computed from, and the
				   export round-trip test says so. */
				const base = Object.assign({}, p.buildBase || p.newRatings, {
					hgt: clamp(Math.round((p.buildBase || p.newRatings).hgt +
						(inches - p.newHgtInches) * (100 / 24)), 0, 100),
				});
				/* The height change has to reach the jitter-free vector too, or
				   the reported ovr range would go back to describing the
				   player this prospect was before he grew. */
				const cleanBase = p.buildCleanBase
					? Object.assign({}, p.buildCleanBase, { hgt: base.hgt })
					: null;
				const re = RB.resolveTo(base, p.newOvr, p.archetype,
					p.origRatings.fuzz, p.buildPinned, cleanBase);
				p.newHgtInches = inches;
				p.buildBase = re.base;
				p.buildCleanBase = re.cleanBase;
				p.newRatings = re.ratings;
				for (const k of BB.RATING_KEYS) {
					if (!Number.isFinite(p.newRatings[k])) {
						p.newRatings[k] = 0;
					}
				}
				p.newOvr = re.ovr;
				p.newPos = re.pos;
				p.newSkills = re.skills;
				p.ovrRange = re.ovrRange;
				p.newWeight = tall ? r.int(215, 245) : r.int(155, 175);
				p.sizeOutlier = tall ? "tall" : "small";
			},
		},
		{
			name: "reclassified prodigy", w: 1.1,
			label: "the youngest player in the class",
			pick: (p) => !p.nonNcaa && p.classYear === "Freshman" && p.newOvr >= 44,
			apply: (p) => {
				p.age = 17;
				p.reclassified = "reclassified up a year";
				p.prodigy = true;
			},
		},
		{
			name: "lost season", w: 1.2,
			label: "coming back off a lost season",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p) => {
				p.redshirt = "medical redshirt";
				p.lostSeason = true;
			},
		},
		{
			name: "walk-on", w: 0.9,
			label: "a walk-on who ended up a draft pick",
			pick: (p) => !p.nonNcaa && p.recruiting,
			apply: (p) => {
				p.recruiting.rank = 320;
				p.recruiting.stars = 2;
				p.transfer = { kind: "walk-on turned starter", from: null, fifthYear: false };
				p.walkOn = true;
			},
		},

		/* --- and sixteen more ------------------------------------------------

		   Seven kinds against a budget of three meant a reroll drew nearly half
		   the pool every time, so the one feature most worth rerolling for was
		   also the one that went stale fastest: two classes running would share
		   an anomaly more often than not. Twenty-three kinds against a budget
		   of four is a different proposition — the chance that two consecutive
		   classes share one falls from about 4 in 5 to about 1 in 2.

		   Each is still a bend on data the model already carries, and each
		   writes a `backstory` line the note renders, so a class can say what
		   happened rather than only knowing it. */
		{
			name: "coach's son", w: 1.2,
			label: "the coach's son",
			pick: (p) => !p.nonNcaa && p.recruiting,
			apply: (p, r) => {
				p.recruiting.rank = r.int(180, 300);
				p.recruiting.stars = 3;
				p.backstory = "son of the head coach";
			},
		},
		{
			name: "never played high school", w: 1.0,
			label: "never played a high school game",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				p.transfer = {
					kind: "JUCO transfer",
					from: r.pick(["Chipola College", "Northwest Florida State",
						"Indian Hills CC", "Ranger College"]),
					fifthYear: false,
				};
				if (p.recruiting) { p.recruiting.rank = 320; p.recruiting.stars = 2; }
				p.backstory = "did not play organized basketball until junior college";
			},
		},
		{
			name: "converted athlete", w: 1.3,
			label: "a convert from another sport",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				p.backstory = "came to basketball from " + r.pick([
					"college football", "the javelin", "volleyball", "handball",
					"rugby", "track", "swimming", "cricket",
				]) + " three years ago";
			},
		},
		{
			name: "three countries", w: 1.1,
			label: "played in three countries before this one",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				const places = r.shuffle(["Spain", "Serbia", "Australia", "Lithuania",
					"France", "Israel", "Greece", "Turkey", "Canada", "Senegal"]);
				p.backstory = "played in " + places.slice(0, 3).join(", ") +
					" before arriving here";
			},
		},
		{
			name: "eligibility year", w: 1.1,
			label: "sat out a full year for eligibility",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p) => {
				p.redshirt = "sat out a season for eligibility";
				p.backstory = "sat a full year while his transfer waiver was decided";
			},
		},
		{
			name: "twice decommitted", w: 1.2,
			label: "decommitted twice before signing",
			pick: (p) => !p.nonNcaa && p.recruiting,
			apply: (p, r) => {
				p.recruiting.decommits = 2;
				p.backstory = "committed and decommitted twice, signing in " +
					r.pick(["April", "May", "late June"]);
			},
		},
		{
			name: "reclassified down", w: 0.9,
			label: "reclassified back a year and arrived old",
			pick: (p) => !p.nonNcaa && p.classYear === "Freshman",
			apply: (p) => {
				p.age = 20;
				p.reclassified = "reclassified back a year";
				p.backstory = "repeated a year of high school and arrived at twenty";
			},
		},
		{
			name: "boomerang transfer", w: 1.1,
			label: "left, and came back",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				p.transfer = {
					kind: "returned to his original school",
					from: null,
					fifthYear: r.random() < 0.4,
				};
				p.backstory = "transferred out after his freshman year and came back";
			},
		},
		{
			name: "pro sibling", w: 1.0,
			label: "the younger brother of a pro",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				p.backstory = "younger brother of " + r.pick([
					"a ten-year NBA veteran", "a EuroLeague champion",
					"an All-Star", "a two-time G League call-up",
					"a WNBA All-Star",
				]);
			},
		},
		{
			name: "broken hand", w: 1.3,
			label: "missed the whole non-conference schedule",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				p.forcedAvailability = {
					games: r.int(9, 13), kind: "a broken hand", injury: true,
					from: 0, to: 0.34,
				};
				p.backstory = "broke a hand in October and did not play until January";
			},
		},
		{
			name: "february injury", w: 1.2,
			label: "his season ended in February",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				p.forcedAvailability = {
					games: r.int(7, 11), kind: "a season-ending knee injury",
					injury: true, from: 0.72, to: 1,
				};
				p.backstory = "went down in February and did not play again";
			},
		},
		{
			name: "position switch", w: 1.1,
			label: "changed positions on arrival",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				p.backstory = "moved to " + r.pick([
					"point guard", "the wing", "the four", "center",
				]) + " for the first time this season";
			},
		},
		{
			name: "hometown holdout", w: 1.0,
			label: "turned down the blue bloods to stay home",
			pick: (p) => !p.nonNcaa && p.recruiting && C.prestige(p.newCollege) < 55,
			apply: (p, r) => {
				p.recruiting.rank = r.int(12, 40);
				p.recruiting.stars = 4;
				p.backstory = "turned down every blue blood to play twenty minutes from home";
			},
		},
		{
			name: "third school", w: 1.1,
			label: "his third school in five years",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				p.classYear = "Graduate";
				p.transfer = {
					kind: "graduate transfer",
					from: r.pick(["a Big Ten program", "a mid-major", "a JUCO",
						"an Ivy League school", "a Mountain West program"]),
					fifthYear: true,
				};
				p.backstory = "his third school in five years";
			},
		},
		{
			name: "academic redshirt", w: 0.9,
			label: "ineligible as a freshman",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p) => {
				p.redshirt = "academic redshirt";
				p.backstory = "was academically ineligible for his freshman season";
			},
		},
		{
			name: "went pro and came back", w: 1.0,
			label: "turned pro abroad, then came back to college",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				p.age = Math.max(p.age || 21, 21);
				p.transfer = {
					kind: "returned from a professional contract",
					from: r.pick(["Australia's NBL", "the Spanish second division",
						"a Serbian club", "Overtime Elite", "the G League Ignite"]),
					fifthYear: false,
				};
				p.backstory = "signed a professional contract, then came back to college";
			},
		},

		/* --- class-level surprises (task 4.5) --------------------------------
		   Three rare per-class anomalies that give a draft board something to
		   argue about. Each bends a prospect's data in a way the normal
		   pipeline cannot produce. */
		{
			name: "late bloomer surge", w: 0.9,
			label: "a late bloomer who rose from nowhere",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman" && p.newOvr <= 42,
			apply: (p, r) => {
				/* A prospect who was a walk-on-calibre player last year and
				   arrived this year as a genuine draft pick. His recruiting
				   says nobody, his class year says he has been around, and the
				   ovr/pot gap is widened because he is still rising. */
				if (p.recruiting) {
					p.recruiting.rank = r.int(280, 320);
					p.recruiting.stars = 2;
				}
				p.baseGap = Math.max(p.baseGap || 8, r.int(14, 22));
				p.backstory = "averaged 3 points a game last year and arrived this season as a different player";
				p.lateBloomerSurge = true;
			},
		},
		{
			name: "unexpected transfer splash", w: 1.0,
			label: "a transfer who nobody saw coming",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman" && p.newOvr >= 40,
			apply: (p, r) => {
				/* A mid-major transfer who committed in August, after every
				   board had been published, and turned out to be the best
				   player in the conference. */
				const from = r.pick([
					"a Summit League school", "a Southland program",
					"an Ohio Valley school", "a Big South program",
					"a SWAC school", "a Patriot League school",
				]);
				p.transfer = {
					kind: "late portal entry",
					from: from,
					fifthYear: r.random() < 0.4,
				};
				if (p.recruiting) {
					p.recruiting.rank = r.int(200, 300);
					p.recruiting.stars = r.random() < 0.3 ? 3 : 2;
				}
				p.backstory = "entered the portal in August from " + from +
					" and committed the week before classes started";
				p.unexpectedTransfer = true;
			},
		},
		{
			name: "unicorn skillset", w: 0.7,
			label: "an unusual combination of skills",
			pick: (p) => !p.nonNcaa && p.newOvr >= 38,
			apply: (p, r) => {
				/* A prospect with a genuinely unusual build that does not fit
				   any archetype cleanly: a 6'10" player who handles the ball
				   like a guard, or a 6'1" player who blocks shots, or a center
				   who leads the team in assists. The backstory names the
				   combination so the note reads as something a scout would
				   write. */
				const combos = [
					{ desc: "a 6'10\" point guard who led his team in assists", trait: "playmaking big" },
					{ desc: "a center who shot 42% from three on five attempts a game", trait: "shooting big" },
					{ desc: "a 6'1\" guard who averaged 2 blocks a game", trait: "undersized shot-blocker" },
					{ desc: "a wing who averaged a triple-double in conference play", trait: "stat-sheet stuffer" },
					{ desc: "a guard who posted up bigger defenders and shot hook shots", trait: "post-up guard" },
					{ desc: "a seven-footer who ran the break and threw behind-the-back passes", trait: "unicorn big" },
				];
				const combo = r.pick(combos);
				p.backstory = combo.desc;
				p.unicornSkillset = combo.trait;
			},
		},

		/* --- surprises with MECHANICAL effects -------------------------------

		   Of the twenty-three above, three change what happens on the floor —
		   the physical outlier re-solves a height, the broken hand and the
		   February injury set an availability window — and the other twenty are
		   biography applied to data the model already carried. Biography is
		   most of what a scouting note is made of and none of it is wasted, but
		   an anomaly a user rerolls FOR is one that changes the numbers he is
		   looking at, and six of the most recognisable ones were unavailable
		   because the model had no way to say them.

		   Two of the six are absence patterns the availability system could
		   always have expressed and nothing asked it to; the other four needed
		   `statBend`, which is new (see js/stats.js): a per-player bend applied
		   inside the stat line, so the team reconciliation runs over the bent
		   numbers and a man who rebounds more takes the boards off his own
		   teammates rather than conjuring them. */
		{
			name: "suspension", w: 1.2,
			label: "suspended for part of the season",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				/* Deliberately NOT an injury. `injury: false` means the games
				   are scattered rather than a block, and — the part that
				   matters — assignOutages only builds a team rating drop for an
				   injury, so a suspended player's team does not get to plan
				   around him the way it plans around a knee. That is the real
				   difference between the two and it was already in the model,
				   unused. */
				const games = r.int(3, 5);
				p.forcedAvailability = {
					games, kind: "a team suspension", injury: false,
					from: null, to: null,
				};
				p.backstory = "suspended " + games + " games in " +
					r.pick(["December", "January", "February"]) + " for " +
					r.pick([
						"a violation of team rules",
						"a locker-room incident",
						"conduct detrimental to the team",
					]);
			},
		},
		{
			name: "academic investigation", w: 0.9,
			label: "missed the first ten games",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				/* A specific absence SHAPE: a block at the very start and then
				   every game after it. An ordinary injury draw can produce ten
				   missed games anywhere in the season; only a forced window can
				   produce ten at the front, which is what makes this a
				   different thing to evaluate — his team's November record is
				   not his, and his conference numbers are the whole sample. */
				const games = r.int(9, 11);
				p.forcedAvailability = {
					games, kind: "an eligibility investigation", injury: true,
					// SEASON_GAMES, not a hard-coded 32: the schedule is
					// CONF_GAMES + NON_CONF_GAMES, and a window measured against
					// the wrong length does not cover the games it names.
					from: 0, to: games / SEASON_GAMES,
				};
				p.backstory = "sat the first " + games + " games while the " +
					"compliance office worked through his transcript, then " +
					"played every game after it";
				p.eligibilityHold = true;
			},
		},
		{
			name: "mid-season transfer", w: 0.8,
			label: "changed schools in December",
			pick: (p) => !p.nonNcaa && p.classYear !== "Freshman",
			apply: (p, r) => {
				/* The model simulates one season at one school, and this is the
				   honest half of a mid-season move: the games he sat while the
				   waiver was decided, and the biography that says where he came
				   from. What it does NOT do is give him a partial line at the
				   first school — that would need two rosters and two rotations
				   for one player, which is a larger change than this is worth.
				   The note says so rather than implying a full season. */
				const games = r.int(6, 9);
				p.forcedAvailability = {
					games, kind: "a mid-season transfer", injury: true,
					from: 0.12, to: 0.12 + games / SEASON_GAMES,
				};
				p.transfer = {
					kind: "mid-season transfer",
					from: r.pick(["a high-major that had stopped playing him",
						"a mid-major whose coach was fired in November",
						"a program that went into a rebuild at Christmas",
						"a school he had committed to sight unseen"]),
					fifthYear: false,
					midSeason: true,
				};
				p.backstory = "left " + r.pick(["in December", "over the winter break",
					"the week after Christmas"]) + " and sat " + games +
					" games before he was cleared here";
				p.midSeasonMove = true;
			},
		},
		{
			name: "double-double machine", w: 1.0,
			label: "a double-double most nights",
			/* Only for someone who could plausibly do it: a big, or a guard
			   with real playmaking. A 6'2" spot-up shooter with fifteen
			   double-doubles is not an anomaly, it is a broken model.

			   The bend raises the season AVERAGE rather than writing
			   double-doubles into the log. The log is drawn from the average
			   and rescaled back onto it, so forcing a count would put the two
			   in disagreement — which nothing else in this model does. Measured
			   over 120 classes: a mean of 13.9 double-doubles against a 32-game
			   season, median 13, and a genuine tail to 21. That is the label,
			   and the label is what it does rather than what was wished for. */
			pick: (p) => !p.nonNcaa && p.newRatings &&
				(p.newRatings.hgt >= 52 || p.newRatings.pss >= 60),
			apply: (p, r) => {
				const big = p.newRatings.hgt >= 52;
				p.statBend = Object.assign({}, p.statBend,
					big ? { reb: r.uniform(0.45, 0.70) }
						: { ast: r.uniform(0.40, 0.60), reb: r.uniform(0.15, 0.28) });
				p.backstory = big
					? "went for a double-double in more than half his games"
					: "led the conference in assists and rebounded like a forward";
				p.doubleDoubleMachine = true;
			},
		},
		{
			name: "defensive breakout", w: 1.0,
			label: "an unexpected defensive player of the year case",
			pick: (p) => !p.nonNcaa,
			apply: (p, r) => {
				/* The composites are left alone on purpose: what makes this
				   worth putting on a board is a season better than the tools
				   that produced it, which is a judgment the user gets to make
				   rather than one the ratings have already made for them. */
				p.statBend = Object.assign({}, p.statBend,
					{ defense: r.uniform(0.35, 0.60) });
				p.backstory = "was not a defender a year ago and finished the " +
					"season " + r.pick([
						"leading the conference in deflections",
						"as the best help defender in the league",
						"guarding the other team's best player every night",
					]);
				p.defensiveBreakout = true;
			},
		},
		{
			name: "shooting slump", w: 1.1,
			label: "a year-long shooting slump",
			// Has to be somebody the slump is a slump FOR.
			pick: (p) => !p.nonNcaa && p.newRatings && p.newRatings.tp >= 50,
			apply: (p, r) => {
				const drop = r.uniform(0.06, 0.10);
				p.statBend = Object.assign({}, p.statBend, { tpp: -drop });
				p.backstory = "shot " + Math.round(drop * 100) + " points below " +
					"what his jumper says all year — " + r.pick([
						"the form never changed",
						"he never stopped taking them",
						"and made 84% of his free throws",
					]);
				p.shootingSlump = true;
			},
		},
	];

	function assignSurprises(players, rng, cfg) {
		const budget = clamp(
			cfg && cfg.surpriseBudget !== undefined ? cfg.surpriseBudget : 4, 0, 10);
		if (!budget || !players.length) return [];
		const n = Math.max(0, Math.round(rng.uniform(budget - 1, budget + 1)));
		const used = new Set();
		const kinds = SURPRISES.slice();
		const out = [];
		/* Compressed in log space, like archetype rarity: with 32 kinds and
		   ~4 draws, the authored 2.0-weight kinds (five-star bust, unranked
		   riser) turned up in roughly a third of classes — 2-3x the uniform
		   expectation — which made the feature meant to keep classes fresh
		   the first thing to go stale. The ordering survives; the gap does
		   not compound. */
		const compressed = (k) => Math.pow(k.w === undefined ? 1 : k.w, 0.5);
		for (let i = 0; i < n && kinds.length; i++) {
			const kind = rng.weighted(kinds, compressed);
			kinds.splice(kinds.indexOf(kind), 1);
			const options = players.filter((p) => !used.has(p.key) && kind.pick(p));
			if (!options.length) continue;
			const who = options[Math.floor(rng.random() * options.length)];
			used.add(who.key);
			kind.apply(who, rng.child("sp:" + kind.name));
			who.surprise = { name: kind.name, label: kind.label };
			out.push({ name: kind.name, label: kind.label, player: who.name, key: who.key });
		}
		return out;
	}

	/* --------------------------------------------------- recruiting context */

	/* Who a prospect was before he got here. A five-star at Duke and a
	   three-star at Davidson are not the same player even at the same ovr, and
	   the tool knew nothing about the difference: prospects were simply dropped
	   onto whatever school BBGM assigned. */
	function assignRecruiting(players, rng) {
		const ncaa = players.filter((p) => !p.nonNcaa);
		const order = ncaa.slice().sort((a, b) => b.origOvr - a.origOvr);
		const n = Math.max(1, order.length);
		/* Each player's score is drawn independently; the RANK is not. A
		   rank was rounded and clamped straight off the draw, with no
		   collision check, so every class carried more than one "No. 1
		   nationally" recruit — one had two No. 1s and two No. 50s in the
		   same sophomore cohort. A recruiting ranking is a list: within a
		   recruiting class (the high-school class he came out of, which is
		   his class year plus his redshirt year) the noised scores are
		   sorted and each man takes the next free number. */
		const cohorts = {};
		order.forEach((p, i) => {
			const r = rng.child("rec:" + p.key);
			const prestige = C.prestige(p.newCollege);
			// Recruiting rank blends where the player actually is in the class
			// with how good his program is: blue bloods get the blue-chippers.
			const base = (i / n) * 100;
			const pull = (60 - prestige) * 0.28;
			const score = base + pull + r.normal(0, 14);
			const cohort = priorYears(p.classYear) + (p.redshirt ? 1 : 0);
			(cohorts[cohort] = cohorts[cohort] || []).push({ p, score });
		});
		for (const key of Object.keys(cohorts)) {
			const group = cohorts[key].sort((a, b) => a.score - b.score);
			let last = 0;
			for (const { p, score } of group) {
				const rank = Math.max(last + 1, clamp(Math.round(score), 1, 400));
				last = rank;
				const stars = rank <= 8 ? 5 : rank <= 40 ? 4 : rank <= 130 ? 3 : 2;
				p.recruiting = {
					rank,
					stars,
					// A transfer was recruited somewhere else; a freshman was
					// recruited here.
					committed: (p.transfer && p.transfer.from) || p.newCollege,
				};
			}
		}
		// Who the headline signing was at each program, and who shared a class.
		const bySchool = {};
		for (const p of ncaa) (bySchool[p.newCollege] = bySchool[p.newCollege] || []).push(p);
		for (const school of Object.keys(bySchool)) {
			const group = bySchool[school]
				.sort((a, b) => a.recruiting.rank - b.recruiting.rank);
			group.forEach((p, i) => {
				p.recruiting.headliner = i === 0 && group.length > 1;
				p.recruiting.classmates = group.filter((q) => q !== p).map((q) => q.name);
			});
		}
	}

	/* ------------------------------------------------------------- phase 2 */

	/* Who was hurt, and when — drawn BEFORE a game is played.

	   The tool used to invent an injury after the season had been simulated:
	   gameLog picked a contiguous block of games to blank out and rescaled the
	   log to match, so a player who missed fourteen games with a knee had
	   exactly the same effect on his team's record as if he had played every
	   night. The injury was a sentence in the note and nothing else.

	   Drawn here, an absence is a window on the season's own `when` axis, and
	   ratingOn() takes the missing player out of his team for the games inside
	   it — so the team loses games it would have won, the resume the selection
	   committee reads is the resume the injury produced, and the stat model
	   downstream reads the same window instead of inventing a second one.

	   Durations follow the injury. A concussion and a stress reaction drew the
	   same game count out of one uniform table, which is why every absence read
	   the same length whatever it was called. */
	const INJURIES = [
		{ kind: "a sprained ankle", w: 3.0, lo: 1, hi: 5 },
		{ kind: "a hand injury", w: 1.4, lo: 2, hi: 8 },
		{ kind: "a knee sprain", w: 1.6, lo: 4, hi: 14 },
		{ kind: "a stress reaction in his foot", w: 1.0, lo: 6, hi: 18 },
		{ kind: "concussion protocol", w: 1.2, lo: 1, hi: 4 },
		{ kind: "a back strain", w: 1.1, lo: 2, hi: 7 },
		{ kind: "a shoulder injury", w: 1.0, lo: 3, hi: 11 },
		{ kind: "a broken hand", w: 0.7, lo: 8, hi: 20 },
		{ kind: "a high ankle sprain", w: 0.9, lo: 5, hi: 13 },
	];
	const ABSENCES = [
		{ kind: "illness", w: 2.2, lo: 1, hi: 3 },
		{ kind: "a coach's decision", w: 1.3, lo: 1, hi: 3 },
		{ kind: "a minor knock", w: 2.0, lo: 1, hi: 2 },
		{ kind: "a one-game suspension", w: 1.0, lo: 1, hi: 1 },
		{ kind: "load management", w: 0.5, lo: 1, hi: 3 },
		{ kind: "a personal matter", w: 0.8, lo: 1, hi: 4 },
	];
	// A season's worth of `when`, matching the schedule's own axis.
	const SEASON_GAMES = T.CONF_GAMES + T.NON_CONF_GAMES;

	function assignAvailability(players, rng, cfg) {
		const rate = clamp(
			cfg && cfg.injuryRate !== undefined ? cfg.injuryRate : 1, 0, 3);
		for (const p of players) {
			p.availability = null;
			if (p.nonNcaa || p.idleYear) continue;
			/* A forced anomaly beats the roll. `assignSurprises` runs before
			   this, so without the guard "his season ended in February" would
			   have been silently replaced by an ordinary draw. */
			if (p.forcedAvailability) {
				p.availability = Object.assign({}, p.forcedAvailability, {
					games: Math.min(p.forcedAvailability.games, SEASON_GAMES - 5),
				});
				continue;
			}
			const r = rng.child("inj:" + p.key);
			/* The build's own durability (see injuryMultiplier): an
			   Injury-Prone Talent is hurt about twice as often as the class,
			   an Iron Man half as often. It moves the injury roll, not the
			   ordinary absences — a coach's decision is not a knee. */
			const build = RB.injuryMultiplier(p.archetype);
			// The draft-year games-played mean is 33.5 against a ~35-game
			// schedule, so a bit over half a class misses something.
			if (r.random() >= 0.54 * rate * (0.6 + 0.4 * build)) continue;
			const hurt = r.random() < Math.min(0.95, 0.55 * rate * build);
			const table = hurt ? INJURIES : ABSENCES;
			const pickKind = r.weighted(table);
			const games = Math.max(1, Math.round(
				r.uniform(pickKind.lo, pickKind.hi + 0.999)));
			const span = games / SEASON_GAMES;
			// A run of games for an injury; scattered nights for everything
			// else, which is what "illness" and "a coach's decision" are.
			const from = hurt ? r.uniform(0, Math.max(0, 1 - span)) : null;
			p.availability = {
				games: Math.min(games, SEASON_GAMES - 5),
				kind: pickKind.kind,
				injury: hurt,
				from,
				to: hurt ? from + span : null,
			};
		}
	}

	function phaseRegular(state) {
		/* The EFFECTIVE config, which is the one the flavor bent. The
		   narrative flavors ("the year everybody got hurt", "the year the
		   blue bloods fell over") move settings this phase reads —
		   injuryRate, the realignment rate, the down-year count — and reading
		   state.cfg here would have silently discarded every one of them.
		   Safe against the phase cache: the flavor is drawn in the build
		   phase, so anything that changes it re-runs this phase too. */
		const cfg = state.effectiveCfg || state.cfg;
		const rng = state.rng;
		const bySchool = {};
		for (const p of state.players) {
			if (p.nonNcaa) continue;
			(bySchool[p.newCollege] = bySchool[p.newCollege] || []).push(p);
		}
		state.bySchool = bySchool;
		assignAvailability(state.players, rng.child("availability" + variationSalt(state.cfg)), cfg);
		const teams = T.buildPrograms(bySchool, rng.child("programs"), cfg);
		/* buildPrograms returns the season's realignment alongside the teams;
		   lift it off before anything iterates the map. */
		state.realignment = teams.__realignment || [];
		delete teams.__realignment;
		T.applyOutages(teams);
		T.simulateRegularSeason(teams, cfg, rng.child("season"));
		/* Read off the results the season just produced, so nothing here can
		   contradict a box score. See midSeasonEvents. */
		state.seasonEvents = T.midSeasonEvents(teams, rng.child("events"), cfg);
		// Snapshot, so the postseason can be re-run on its own (changing
		// "March upsets" must not re-play November).
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			t.regSnapshot = {
				w: t.w, l: t.l, cw: t.cw, cl: t.cl, games: t.games, sos: t.sos,
				quadWins: t.quadWins, logLength: t.log.length,
			};
		}
		state.teams = teams;
		state.recruitingClasses = computeRecruitingClasses(
			state.players, teams, rng.child("recruitclasses" + variationSalt(state.cfg)));
		return state;
	}

	/* Recruiting class rankings (§8.8). Per-player recruiting data existed —
	   rank, stars, committed — but the aggregate every fan actually argues
	   about did not. To rank all 368 programs the class needs synthetic
	   recruits for every school (the same move the returning-talent model
	   makes); real prospects keep the national rank assignRecruiting gave
	   them and the synthetics fill the remaining slots in quality order.

	   The score is the 247-style shape: a per-recruit point value that
	   decays steeply with national rank, with diminishing returns after the
	   top handful of signees. */
	function computeRecruitingClasses(players, teams, rng) {
		const names = Object.keys(teams);
		const real = {};
		for (const p of players) {
			// A transfer's recruitment belongs to an earlier cycle at
			// another school; a freshman was signed this cycle, here.
			if (p.nonNcaa || !p.recruiting) continue;
			if (p.transfer && p.transfer.from) continue;
			(real[p.newCollege] = real[p.newCollege] || []).push(p);
		}
		const synthBySchool = {};
		const synth = [];
		for (const name of names) {
			const r = rng.child("rc:" + name);
			const prestige = C.prestige(name);
			const n = 3 + r.int(0, 2);
			synthBySchool[name] = [];
			for (let i = 0; i < n; i++) {
				const s = { school: name, q: prestige + r.normal(0, 14) };
				synth.push(s);
				synthBySchool[name].push(s);
			}
		}
		synth.sort((a, b) => b.q - a.q);
		const taken = new Set();
		for (const s of Object.keys(real)) {
			for (const p of real[s]) taken.add(p.recruiting.rank);
		}
		let next = 1;
		for (const s of synth) {
			while (taken.has(next)) next++;
			taken.add(next);
			s.rank = next;
		}
		const starsOf = (rank) => (rank <= 8 ? 5 : rank <= 40 ? 4 : rank <= 130 ? 3 : 2);
		const pts = (rank) => 100 / Math.pow(rank + 15, 0.42);
		const rows = names.map((name) => {
			const signees = (real[name] || [])
				.map((p) => ({
					rank: p.recruiting.rank, stars: p.recruiting.stars,
					name: p.name, key: p.key, real: true,
				}))
				.concat(synthBySchool[name].map((s) => ({
					rank: s.rank, stars: starsOf(s.rank), real: false,
				})))
				.sort((a, b) => a.rank - b.rank);
			let score = 0;
			signees.forEach((s, i) => {
				score += pts(s.rank) / (1 + 0.35 * Math.max(0, i - 4));
			});
			const stars = { 5: 0, 4: 0, 3: 0, 2: 0 };
			for (const s of signees) stars[s.stars]++;
			return {
				name,
				conf: teams[name].conf,
				score,
				signees: signees.length,
				fiveStars: stars[5], fourStars: stars[4], threeStars: stars[3],
				avgRank: signees.reduce((a, s) => a + s.rank, 0) / Math.max(1, signees.length),
				headliner: signees[0] || null,
			};
		}).sort((a, b) => b.score - a.score);
		const confSeen = {};
		rows.forEach((row, i) => {
			row.natRank = i + 1;
			confSeen[row.conf] = (confSeen[row.conf] || 0) + 1;
			row.confRank = confSeen[row.conf];
			if (teams[row.name]) teams[row.name].recruitClass = row;
		});
		return rows;
	}

	/* ------------------------------------------------------------- phase 3 */

	const POSTSEASON_KEYS = [
		"ctW", "inConfTourney", "confTourneyChamp", "confRegularChamp", "bid",
		"ncaaSeed", "ncaaRegion", "ncaaResult", "ncaaWins", "ffWin", "apRank",
		"nitBid", "nitWins", "nitResult", "nitChamp",
		// The rankings layer (js/rankings.js) — recomputed every postseason
		// pass, so a warm re-run must not inherit a previous pass's values.
		"netRank", "netScore", "tvi", "adjEff", "quads", "roadW", "roadL",
		"last12W", "last12L", "committeeScore",
		"apHistory", "apPeak", "apPreseason", "apFirstPlace",
	];

	function resetPostseason(teams) {
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			const snap = t.regSnapshot;
			if (!snap) continue;
			t.w = snap.w; t.l = snap.l; t.cw = snap.cw; t.cl = snap.cl;
			t.games = snap.games; t.sos = snap.sos; t.quadWins = snap.quadWins;
			if (t.log.length > snap.logLength) t.log.length = snap.logLength;
			for (const k of POSTSEASON_KEYS) delete t[k];
		}
	}

	function phasePostseason(state) {
		// The bent config, for the same reason phaseRegular reads it: the
		// narrative flavors move upsetFactor.
		const { teams } = state;
		const cfg = state.effectiveCfg || state.cfg;
		const rng = state.rng;
		resetPostseason(teams);
		state.confTourneys = T.simulateConferenceTournaments(teams, cfg, rng.child("conftourney"));
		/* Results-derived rankings replace the one-line poll and the
		   rating-peeking resume sort: a NET built from the game log (TVI +
		   margin-capped adjusted efficiency), quadrant records, a committee
		   score over observables only, and a weekly AP poll voted by a
		   persistent 60-member electorate. See js/rankings.js. */
		RK.computeRankings(teams);
		state.pollHistory = RK.weeklyPoll(teams, rng.child("appoll"));
		// Same shape the old one-shot poll produced: the top 25, in order.
		const finalWeek = state.pollHistory[state.pollHistory.length - 1];
		state.poll = finalWeek
			? finalWeek.ranks.map((r) => teams[r.team]).filter(Boolean) : [];
		state.tourney = TN.simulate(teams, cfg, rng.child("ncaa"));
		// Chronological order and full records, now that March has happened.
		T.finalizeSchedule(teams);
		return state;
	}

	/* ------------------------------------------------------------- phase 4 */

	function phaseStats(state) {
		const { teams, bySchool } = state;
		const cfg = state.effectiveCfg || state.cfg;
		const statRng = state.rng.child("stats" + variationSalt(state.cfg));
		/* Which era's empirical anchors every rate in the stat model targets.
		   Set once, here, so a run is internally consistent; see the header of
		   js/calibration.js for why the answer is not always "2009-2021". */
		CAL.setEra(cfg.era);

		/* Compute the class's composite reference correction: how far these
		   prospects' composites sit below the level the stat model's intercepts
		   were fitted on. A synthetic N(45,13) class gets ~0 (no correction);
		   a realistic draft-slot-curve class gets ~0.11 (full correction).
		   Computed once here, passed through ctx to every team simulation. */
		const prospectComps = [];
		for (const name of Object.keys(teams)) {
			for (const m of teams[name].members) {
				if (!m.filler && m.player && m.player.newRatings)
					prospectComps.push(BB.composites(m.player.newRatings).usage);
			}
		}
		const meanUsageComposite = prospectComps.length > 0
			? prospectComps.reduce((a, b) => a + b, 0) / prospectComps.length : 0;
		const rawRef = prospectComps.length > 0
			? S.TUNING.PROSPECT_COMP_BASE - meanUsageComposite
			: 0;
		const classRefVolume = S.TUNING.PROSPECT_COMP_SCALE * Math.max(0, rawRef);
		const classRefEfficiency = S.TUNING.PROSPECT_COMP_SCALE_EFF * rawRef;

		/* What each program's opponents actually looked like defensively. This
		   is the channel that lets a conference of rim protectors hold everyone
		   under their season rim percentage — before it, team defense affected
		   nothing but the scoreboard. */
		const profiles = {};
		const shooting = {};
		for (const name of Object.keys(teams)) {
			profiles[name] = S.rosterDefenseProfile(teams[name]);
			shooting[name] = S.rosterShooting(teams[name]);
		}
		for (const name of Object.keys(teams)) {
			const t = teams[name];
			let rim = 0;
			let per = 0;
			let ovr = 0;
			let press = 0;
			let fg = 0;
			let n = 0;
			for (const g of t.log) {
				const pr = profiles[g.opp];
				const opp = teams[g.opp];
				if (!pr) continue;
				rim += pr.rim; per += pr.perimeter; ovr += pr.overall;
				press += (opp && opp.style ? opp.style.press : 0);
				fg += shooting[g.opp];
				n++;
			}
			t.oppDefense = n
				? { rim: rim / n, perimeter: per / n, overall: ovr / n }
				: { rim: 0, perimeter: 0, overall: 0 };
			t.oppPress = n ? press / n : 0;
			// How well the schedule shot, so this team's defensive rebound pool
			// answers to who it played rather than to a constant.
			t.teamFg = shooting[name];
			t.oppFg = n ? fg / n : shooting[name];
		}

		/* Every program in the country, not only the forty that happen to have
		   a prospect on them. The other 313 cost about 60ms and buy the award
		   model a real field to rank against (see awards.js), true national
		   statistical leaders, and offensive/defensive ratings for the whole
		   AP poll rather than for a handful of teams. */
		for (const school of Object.keys(teams)) {
			const team = teams[school];
			const conf = C.CONFERENCES[team.conf] || C.CONFERENCES.Independent;
			// team.games now includes every postseason game the team played,
			// because record() is finally called for them, so there is no
			// separate "extra games" arithmetic to keep in sync.
			S.simulateTeamStats(team, {
				oppStrength: (team.sosAvg + conf.strength * 0.35) / 1.35,
				oppDefense: team.oppDefense,
				oppPress: team.oppPress,
				teamFg: team.teamFg,
				oppFg: team.oppFg,
				games: Math.round(team.games),
				league: S.NCAA_ENV,
				pro: false,
				classRefVolume,
				classRefEfficiency,
			}, cfg, statRng.child(school));
		}
		void bySchool;

		// Pro / DII players: a real club in a real league table.
		state.proLeagues = simulateProLeagues(state.players, cfg, statRng.child("pro"));

		// Per-game logs. signatureGame already fabricated one of these and threw
		// it away; keeping it costs nothing and buys season highs, 20-point-game
		// counts, streaks, an injury with a reason, and a game log tab.
		const logRng = state.rng.child("gamelog" + variationSalt(state.cfg));
		for (const p of state.players) {
			const home = p.nonNcaa ? p.proTeam : teams[p.newCollege];
			p.gameLog = S.gameLog(p, home, logRng.child("gl:" + p.key));
			p.signature = p.gameLog ? p.gameLog.best : null;
			// The log-derived numbers a table column needs on the stat line.
			if (p.stats && p.gameLog) {
				p.stats.pm = p.gameLog.plusMinus;
				p.stats.onOff = p.gameLog.onOff;
				p.stats.clutchPpg = p.gameLog.clutch ? p.gameLog.clutch.ppg : undefined;
			}
		}
		buildPriorSeasons(state.players, state.season, state.rng.child("prior"),
			teams, cfg, classRefVolume, classRefEfficiency);
		return state;
	}

	/* The seasons before this one.

	   These used to be a backward-scaled copy of the draft year: multiply the
	   minutes by 0.60 and the production by 0.45 and call that a sophomore
	   season. It reads fine and it is not a season — the shape of a prior year
	   is set by the SAME things that shape this one (how good he was, which
	   build he is, where he sat in a rotation that contained an older player,
	   what a coach gives a sophomore) and a scalar cannot express any of them.
	   A 22-point senior year scaled back to a 10-point sophomore year is a
	   different claim from a sophomore who was the fourth option and took 14%
	   of the shots, and only one of them is a story.

	   So a prior season is SIMULATED, through the same stat model the draft
	   year goes through: the prospect at the ratings he had then, with that
	   year's class year (so the experience curve and the college-role draw
	   apply), in a rotation rebuilt at his program's level for that year.
	   The cost is one team simulation per prior season — a few hundred against
	   the 368 the season itself runs — and `cfg.priorSeasons` turns it off,
	   which restores the old reconstruction exactly.

	   A transfer's earlier seasons still happen at the school he came from, and
	   a redshirt year is still a year with no games in it. */
	const PRIOR_CURVE = [
		// [minutes share, production share] of his draft-year line, by how many
		// years before it the season was.
		{ back: 1, mins: 0.82, prod: 0.72 },
		{ back: 2, mins: 0.60, prod: 0.45 },
		{ back: 3, mins: 0.44, prod: 0.29 },
		{ back: 4, mins: 0.34, prod: 0.20 },
	];

	function priorYears(classYear) {
		const y = String(classYear || "");
		const base = y.indexOf("Sophomore") !== -1 ? 1
			: y.indexOf("Junior") !== -1 ? 2
			: y.indexOf("Graduate") !== -1 ? 4
			: y.indexOf("Senior") !== -1 ? 3 : 0;
		// A redshirt year is a year on campus with no season in it, and it is
		// why a "redshirt sophomore" is in his third year at the school.
		return base;
	}

	/* How much worse a prospect was, in overall rating, i seasons ago. A
	   freshman year is a long way below a draft year and the gap closes as the
	   player arrives; the ovr→pot gap says how fast, because a high-upside
	   player is one who was further back. */
	function ovrYearsAgo(p, i) {
		/* talentPot, not newPot: this runs in the stats phase, and newPot is
		   finalized by the pot phase after it — so on a cold run this read the
		   build-phase provisional and on a warm re-run it read the previous
		   pass's adjusted value, which made prior seasons differ between the
		   two. talentPot is set in the build phase for exactly this purpose
		   (and keeps the cosmetic "Potential bias" dial out of the sim). */
		const room = Math.max(2, (p.talentPot || p.newOvr) - p.newOvr);
		const step = 2.6 + 0.32 * room;
		return clamp(Math.round(p.newOvr - step * Math.pow(i, 0.85)), 8, 90);
	}

	/* One prior season, simulated. Returns a stat line or null. */
	function simulatePriorSeason(p, i, teams, season, cfg, rng, classRefVolume, classRefEfficiency) {
		if (!p.buildCleanBase || !RB.resolveTo) return null;
		/* The rotation is built at his CURRENT program's level even when the
		   row names the school he transferred from, because that school is a
		   string in a biography and not a simulated program — a JUCO, "a Big
		   Ten program", a club in Australia. The row still names it; what the
		   level stands in for is "a place of roughly this quality", which is
		   the only thing the simulation needs from it. */
		const home = teams[p.newCollege];
		if (!home) return null;
		const targetOvr = ovrYearsAgo(p, i);
		let re;
		try {
			re = RB.resolveTo(p.buildCleanBase, targetOvr, p.archetype,
				p.origRatings ? p.origRatings.fuzz : 0, p.buildPinned, p.buildCleanBase);
		} catch (e) {
			return null;
		}
		const younger = {
			key: p.key + "|y" + i,
			name: p.name,
			archetype: p.archetype,
			classYear: CLASS_YEARS[clamp(priorYears(p.classYear) - i, 0, 3)],
			newRatings: re.ratings,
			newOvr: re.ovr,
			availability: null,
			statSalt: "|prior" + i,
		};
		/* A rotation rebuilt at the program's level for that year, with the
		   men he was BEHIND actually on it.

		   Without them a freshman year came out better than the draft year:
		   nine synthesized role players leave the one real prospect all the
		   minutes and all the shots, so a 45-overall sophomore's freshman
		   season read 32 minutes and 15 points and his actual sophomore season
		   read 32 and 13. The thing that makes a freshman year a freshman year
		   is not a scalar on his production, it is the senior in front of him,
		   and that senior is cheap to put on the floor. Fewer of them each year
		   as he becomes the one they are behind. */
		const level = clamp((home.level || 50) + rng.normal(0, 3), 5, 99);
		// talentPot for the same reason ovrYearsAgo reads it.
		const mine = T.prospectTalent(younger.newOvr, p.talentPot || younger.newOvr);
		const members = [{ filler: false, player: younger, talent: mine }];
		const fillers = [];
		for (let j = 0; j < 9; j++) fillers.push(T.makeFiller(rng.child("f" + j), level, j));
		/* How many of them he is behind is a function of WHICH YEAR it was, not
		   of how many years ago: a freshman is the fifth or sixth option
		   whether he turns into a lottery pick or a fifth-year senior, and
		   using the distance back instead made a sophomore's freshman year and
		   a senior's freshman year two different seasons. */
		const AHEAD_BY_YEAR = [4.4, 2.9, 1.7, 0.9];
		const yearIdx = clamp(priorYears(p.classYear) - i, 0, 3);
		const ahead = clamp(
			Math.round(rng.normal(AHEAD_BY_YEAR[yearIdx], 1.1)), 0, 7);
		for (let j = 0; j < ahead && j < fillers.length; j++) {
			fillers[j].talent = clamp(mine + rng.uniform(2, 15), 6, 97);
		}
		fillers.sort((a, b) => b.talent - a.talent);
		T.capFillers(fillers, members);
		for (const f of fillers) members.push(f);
		const team = {
			name: home.name + "|" + (season - i),
			conf: home.conf,
			style: home.style,
			members,
			log: [],
		};
		S.simulateTeamStats(team, {
			oppStrength: home.sosAvg || 50,
			oppDefense: home.oppDefense || { rim: 0, perimeter: 0, overall: 0 },
			oppPress: home.oppPress || 0,
			teamFg: home.teamFg,
			oppFg: home.oppFg,
			games: SEASON_GAMES,
			league: S.NCAA_ENV,
			pro: false,
			classRefVolume: classRefVolume,
			classRefEfficiency: classRefEfficiency,
		}, cfg, rng.child("sim"));
		return younger.stats
			? {
				line: younger.stats, ovr: younger.newOvr, box: team.box,
				lines: team.lines, pos: BB.pos(re.ratings),
			}
			: null;
	}

	function buildPriorSeasons(players, season, rng, teams, cfg, classRefVolume, classRefEfficiency) {
		const simulate = !cfg || cfg.priorSeasons !== "reconstruct";
		for (const p of players) {
			p.priorSeasons = null;
			const n = priorYears(p.classYear);
			if (!n || !p.stats) continue;
			const r = rng.child("prior:" + p.key);
			const rows = [];
			for (let i = n; i >= 1; i--) {
				const sim = simulate && !p.nonNcaa
					? simulatePriorSeason(p, i, teams, season, cfg, r.child("y" + i), classRefVolume, classRefEfficiency)
					: null;
				if (sim) {
					const L = sim.line;
					rows.push({
						season: season - i,
						team: (p.transfer && p.transfer.from && i >= 1)
							? p.transfer.from : p.newCollege,
						classYear: CLASS_YEARS[Math.max(0, priorYears(p.classYear) - i)],
						ovr: sim.ovr,
						gp: Math.round(L.gp),
						mpg: L.mpg,
						ppg: L.ppg,
						rpg: L.rpg,
						apg: L.apg,
						usg: L.usg,
						ts: L.ts,
						/* The whole line and the team it was played on, kept so
						   the export can write this season as a complete BBGM
						   stats row instead of guessing its shot mix off the
						   draft year (see collegeStatsRows). The summary fields
						   above stay: they are what the views read, and a
						   reconstructed prior season has them without having
						   any of this. */
						line: L,
						box: sim.box || null,
						lines: sim.lines || null,
						pos: sim.pos || null,
						simulated: true,
						redshirt: false,
					});
					continue;
				}
				const c = PRIOR_CURVE[Math.min(PRIOR_CURVE.length - 1, i - 1)];
				// A developing player is not a scaled copy of himself: the
				// jitter is what makes a leap or a plateau readable.
				const m = clamp(p.stats.mpg * c.mins * (1 + r.normal(0, 0.13)), 3, 38);
				const k = c.prod * (1 + r.normal(0, 0.16));
				rows.push({
					season: season - i,
					// Before a transfer he was somewhere else. A walk-on and a
					// non-transfer were always here.
					team: (p.transfer && p.transfer.from && i >= 1)
						? p.transfer.from : p.newCollege,
					classYear: CLASS_YEARS[Math.max(0, priorYears(p.classYear) - i)],
					gp: Math.max(4, Math.round(p.stats.gp * (0.88 + r.uniform(0, 0.2)))),
					mpg: m,
					ppg: Math.max(0, p.stats.ppg * k),
					rpg: Math.max(0, p.stats.rpg * (c.mins + (k - c.prod) * 0.5)),
					apg: Math.max(0, p.stats.apg * (c.mins + (k - c.prod) * 0.5)),
					ts: clamp(p.stats.ts - (1 - k) * 0.09 + r.normal(0, 0.012), 0.35, 0.72),
					// The one that is not fabricated production: a redshirt year
					// really is a year with no games in it.
					redshirt: false,
				});
			}
			if (p.redshirt) {
				rows.unshift({
					season: season - n - 1,
					team: rows.length ? rows[0].team : p.newCollege,
					classYear: "Redshirt",
					redshirt: true,
					reason: p.redshirt,
				});
			}
			p.priorSeasons = rows;
			/* The flag a scout actually reads off a multi-year page: he was
			   better before. Prior seasons were simulated and nothing ranked
			   on them. A real edge only — two clear points on meaningful
			   minutes — so it marks a trajectory, not noise. */
			p.betterEarlier = null;
			if (p.stats) {
				for (const row of rows) {
					if (row.redshirt || !(row.mpg >= 15)) continue;
					if (row.ppg > p.stats.ppg + 2 &&
						(!p.betterEarlier || row.ppg > p.betterEarlier.ppg)) {
						p.betterEarlier = {
							season: row.season, classYear: row.classYear, ppg: row.ppg,
						};
					}
				}
			}
		}
	}

	/* ------------------------------------------------------------- phase 5 */

	/* Potential. Split out because none of it feeds the simulation: moving
	   "Potential bias" or "Potential spread" should recompute two numbers, not
	   re-play a season. */
	/* Mean usage per archetype across this class, so potFromRole can ask
	   whether a prospect used more or less of the offense than others of his
	   build did — rather than more or less than the class average, which for a
	   Rim Protector is a question about being a Rim Protector. See potFromRole.

	   A build with too few members in this class has no reference worth having,
	   so it falls back to the class mean; the threshold is three, below which
	   the "reference" would mostly be the player himself. */
	const USAGE_REF_MIN = 3;
	function archetypeUsageReference(players) {
		const sums = {};
		const counts = {};
		let total = 0;
		let n = 0;
		for (const p of players) {
			if (p.nonNcaa || !p.stats || !Number.isFinite(p.stats.usg)) continue;
			total += p.stats.usg;
			n++;
			const k = p.archetype;
			sums[k] = (sums[k] || 0) + p.stats.usg;
			counts[k] = (counts[k] || 0) + 1;
		}
		const classMean = n ? total / n : RB.ROLE_USG_CENTER;
		/* Returned as sums-and-counts rather than a finished mean, so the
		   caller can exclude the PLAYER HIMSELF from his own reference. In a
		   17-build pool over sixty players the rarer builds routinely have
		   two or three members, and a mean that includes the man being judged
		   is partly a mirror — the exact circularity potFromRole exists to
		   avoid, surviving in the builds where it was worst. */
		return { classMean, sums, counts };
	}

	function usageRefFor(ref, p) {
		const k = p.archetype;
		const c = ref.counts[k] || 0;
		const own = p.stats && Number.isFinite(p.stats.usg) ? p.stats.usg : null;
		// At least USAGE_REF_MIN OTHERS with his build, himself excluded.
		if (own !== null && c - 1 >= USAGE_REF_MIN) {
			return (ref.sums[k] - own) / (c - 1);
		}
		if (own === null && c >= USAGE_REF_MIN) return ref.sums[k] / c;
		return ref.classMean;
	}

	function phasePot(state) {
		/* The EFFECTIVE config, for the same reason phaseRegular and phaseStats
		   read it: the narrative flavors bend settings this phase owns.

		   This read state.cfg, so every flavor's potential bend was computed,
		   stored on state.effectiveCfg and then never looked at. Four flavors
		   exist mainly to move these two numbers — "a weak year" sets potSpread
		   1.2, "old and finished" sets potBias -1.3, "a volatile year" sets
		   potSpread 3.5, "deep and even" sets 2.5 — and measured, the potential
		   gap's standard deviation came out at 5.5 under every one of them and
		   under no flavor at all. The most-advertised effect of four of the
		   twenty-four flavors did nothing, silently, and nothing could see it
		   because no row anywhere measured the potential DISTRIBUTION. (One
		   now does; see tools/validate.js.) */
		const cfg = state.effectiveCfg || state.cfg;
		const rng = state.rng.child("pot" + variationSalt(state.cfg));
		const usageRef = archetypeUsageReference(state.players);
		for (const p of state.players) {
			const ov = p.override || {};
			const prng = rng.child("pot:" + p.key);
			if (Number.isFinite(ov.pot)) {
				p.newPot = clamp(Math.round(ov.pot), p.newOvr, 100);
				p.potFactors = null;
				continue;
			}
			const spread = Math.max(0, cfg.potSpread);
			const bias = cfg.potBias * 2.2;
			const factors = RB.potFactors(
				p.archetype, p.age, p.newRatings,
				{ hgtInches: p.newHgtInches, weight: p.newWeight }, state.classAge);
			factors.role = RB.potFromRole(p.stats, p.classYear, usageRefFor(usageRef, p));
			factors.bias = bias;
			factors.noise = prng.normal(0, spread * 0.35);
			factors.total = factors.arch + factors.age + factors.ageClass +
				factors.touch + factors.frame + factors.role;
			p.potFactors = factors;
			const gap = Math.max(1, p.baseGap + bias + factors.total * 0.55 + factors.noise);
			p.newPot = clamp(Math.round(p.newOvr + gap), Math.min(p.newOvr + 1, 100), 100);
		}
		return state;
	}

	/* ------------------------------------------------------------- phase 6 */

	function phaseAwards(state) {
		state.ranked = AW.assign(state.players, state.teams, state.tourney,
			state.effectiveCfg || state.cfg, state.rng.child("awards"));
		// Lifted off the map before anything iterates it, like __realignment.
		state.fieldHonors = state.teams.__fieldHonors || [];
		delete state.teams.__fieldHonors;
		state.fieldTop = state.teams.__fieldTop || [];
		delete state.teams.__fieldTop;
		return state;
	}

	/* ------------------------------------------------------------- phase 7 */

	/* The draft board. The file already carries draft.round and draft.pick and
	   the tool used them as nothing but a class-order proxy — a whole feature
	   sitting in data that was already there. This turns the simulated season
	   into a mock draft, with a preseason board to move against, so "helped his
	   stock in March" is something the tool can actually say. */
	/* --- draft day ------------------------------------------------------

	   The board was one ordered list: every prospect slotted exactly where his
	   production and his tools said, with nothing between the last game of the
	   season and the pick. Real drafts are not that. A player falls ten spots
	   on a medical nobody will confirm; a team trades up for the specific man
	   it wants; somebody takes a nineteen-year-old with two tools and no
	   production at 24 because the alternative is a senior who is what he is.
	   Those three things are most of what a draft is REMEMBERED for, and a mock
	   board that cannot produce any of them reads as a ranking rather than as a
	   draft.

	   Each event names itself on the player, so the note and the board can say
	   what happened rather than the prospect simply appearing at a rank his
	   season does not explain. `apply` reorders the board in place before the
	   ranks are assigned, so every downstream reader — the board rank, the mock
	   round and pick, the stock move — sees one consistent order. */
	const DRAFT_EVENTS = [
		{
			name: "medical flag", w: 2.0,
			label: "fell on a medical flag",
			/* Only worth telling in the first round: a man sliding from 52 to 58
			   is not a story anyone tells. */
			pick: (i, n) => i < Math.min(26, n),
			apply: (board, i, r) => {
				const drop = r.int(7, 14);
				const to = Math.min(board.length - 1, i + drop);
				const p = board[i];
				p.draftEvent = {
					kind: "fall",
					from: i,
					say: (moved) => "flagged at the combine and slid " + moved + " spots",
					detail: r.pick([
						"a stress reaction in the foot",
						"a back issue teams could not agree on",
						"a knee that failed two physicals",
						"a shoulder that had been managed all season",
					]),
				};
				move(board, i, to);
				return true;
			},
		},
		{
			name: "workout riser", w: 1.8,
			label: "rose on the workout circuit",
			pick: (i, n) => i >= 12 && i < Math.min(48, n),
			apply: (board, i, r) => {
				const to = Math.max(0, i - r.int(6, 13));
				const p = board[i];
				p.draftEvent = {
					kind: "rise",
					from: i,
					say: (moved) => "rose " + (-moved) + " spots on the workout circuit",
					detail: r.pick([
						"measured longer than his listed height",
						"shot it far better in a gym than he had all season",
						"was the best athlete at the combine",
						"tested out of the building and interviewed better still",
					]),
				};
				move(board, i, to);
				return true;
			},
		},
		{
			name: "trade up", w: 1.6,
			label: "a team traded up for him",
			pick: (i, n) => i >= 4 && i < Math.min(30, n),
			apply: (board, i, r) => {
				const to = Math.max(0, i - r.int(3, 9));
				const p = board[i];
				p.draftEvent = {
					kind: "trade",
					from: i,
					say: (moved) => "a team moved up " + (-moved) + " spots to take him",
					detail: "the pick cost a future first",
				};
				move(board, i, to);
				return true;
			},
		},
		{
			name: "late reach", w: 1.5,
			label: "a late-first reach on upside",
			// A reach is a man taken well before his board slot, so he has to
			// have one well behind the late first.
			pick: (i, n) => i >= 34 && i < n,
			apply: (board, i, r) => {
				const to = r.int(20, 29);
				if (to >= i) return false;
				const p = board[i];
				p.draftEvent = {
					kind: "reach",
					from: i,
					say: (moved) => "taken " + (-moved) +
						" spots earlier than the board had him",
					detail: r.pick([
						"a 19-year-old with two tools and no production",
						"the youngest player in the class",
						"a project nobody else was willing to wait on",
					]),
				};
				move(board, i, to);
				return true;
			},
		},
		{
			name: "green room slide", w: 1.2,
			label: "slid out of the lottery",
			pick: (i, n) => i < Math.min(12, n),
			apply: (board, i, r) => {
				const to = Math.min(board.length - 1, r.int(15, 24));
				if (to <= i) return false;
				const p = board[i];
				p.draftEvent = {
					kind: "fall",
					from: i,
					say: (moved, at) => "sat in the green room until pick " + (at + 1),
					detail: r.pick([
						"teams could not agree on the position he plays",
						"a fit nobody in the lottery wanted to solve",
						"an off-court question that never went away",
					]),
				};
				move(board, i, to);
				return true;
			},
		},
	];

	/* Move one entry of an array from `from` to `to`, keeping everything else
	   in order. Splice-and-insert rather than a swap: a swap would send whoever
	   is at the destination all the way back to the origin, which is two moves
	   nobody asked for and would break the second event's assumptions about
	   where players are. */
	function move(arr, from, to) {
		if (from === to) return;
		const [x] = arr.splice(from, 1);
		arr.splice(to, 0, x);
	}

	function applyDraftEvents(board, rng, cfg) {
		/* Clear last run's flags FIRST, and unconditionally.

		   `pick` skips a player who already carries a draftEvent, so that two
		   events cannot land on one man. Only phaseBuild re-creates the player
		   objects; every warm re-run that starts at `stock` or later hands this
		   function the same objects it flagged last time — so a slider with
		   nothing to do with the draft board (award strictness, say) silently
		   re-drew all four events from a pool that excluded last run's four,
		   and a warm run stopped matching a cold one for the same seed. That
		   is precisely the guarantee a shared link depends on.

		   Before the budget check, because `draftEvents: 0` returning early
		   with the flags still set would leave those players permanently
		   ineligible the next time the slider came back up. */
		for (const p of board) p.draftEvent = null;
		const budget = Math.round(clamp(
			cfg && cfg.draftEvents !== undefined ? cfg.draftEvents : 4, 0, 8));
		if (!budget || board.length < 20) return [];
		const n = Math.max(0, Math.round(rng.uniform(budget - 1, budget + 1)));
		const kinds = DRAFT_EVENTS.slice();
		const out = [];
		for (let k = 0; k < n && kinds.length; k++) {
			const kind = rng.weighted(kinds);
			kinds.splice(kinds.indexOf(kind), 1);
			// Candidates are read off the CURRENT board, after any earlier
			// event has already moved people.
			const options = [];
			for (let i = 0; i < board.length; i++) {
				if (board[i].draftEvent) continue;
				if (kind.pick(i, board.length)) options.push(i);
			}
			if (!options.length) continue;
			const at = options[Math.floor(rng.random() * options.length)];
			const who = board[at];
			if (!kind.apply(board, at, rng.child("de:" + kind.name))) {
				who.draftEvent = null;
				continue;
			}
			out.push({
				name: kind.name, label: kind.label,
				player: who.name, key: who.key,
				detail: who.draftEvent.detail,
			});
		}
		/* The sentences are written LAST, from where each player actually ended
		   up.

		   Each event moved a man from one index to another and described the
		   move as it made it — but a later event's `move()` shifts everyone it
		   passes by one, so by the time the board is final "slid nine spots" is
		   describing a slide of eight and "until pick 20" is pointing at pick
		   21. Bounded by the number of later events, so it was off by a few
		   rather than wildly wrong, and off by a few is the kind of wrong a user
		   checks against the rank printed beside it. Each event now records
		   where it started and asks for its sentence once nothing else is going
		   to move. */
		const finalAt = {};
		board.forEach((p, i) => { finalAt[p.key] = i; });
		for (const e of out) {
			const p = board[finalAt[e.key]];
			const ev = p.draftEvent;
			const moved = finalAt[e.key] - ev.from;
			ev.text = ev.say(moved, finalAt[e.key]);
			e.text = ev.text;
			delete ev.say;
		}
		return out;
	}

	function phaseStock(state) {
		const players = state.players;
		const rng = state.rng.child("stock" + variationSalt(state.cfg));
		// Preseason board: what he was thought to be before a game was played.
		const pre = players.slice().sort((a, b) => {
			const sa = a.newOvr * 1.0 + (a.talentPot - a.newOvr) * 0.55;
			const sb = b.newOvr * 1.0 + (b.talentPot - b.newOvr) * 0.55;
			return sb - sa;
		});
		pre.forEach((p, i) => { p.preseasonRank = i + 1; });

		// Post-season board: what the year actually showed. Production and
		// winning matter, but so does the fact that scouts draft upside.
		for (const p of players) {
			const s = p.stats;
			const prod = s ? (AW.productionScore(p) || 0) : 0;
			const awards = (p.awards || []).length;
			const march = p.gameLog && p.gameLog.postseason
				? p.gameLog.postseason.ppg * 0.16 * Math.min(6, p.gameLog.postseason.gp)
				: 0;
			p.stockScore =
				p.newOvr * 1.25 +
				(p.newPot - p.newOvr) * 0.65 +
				prod * 0.30 +
				awards * 0.55 +
				march +
				(p.nonNcaa ? -1.2 : 0) +
				rng.child("stock:" + p.key).normal(0, 1.8);
		}
		const board = players.slice().sort((a, b) => b.stockScore - a.stockScore);
		state.draftEvents = applyDraftEvents(board, rng.child("draftday"),
			state.effectiveCfg || state.cfg);
		board.forEach((p, i) => {
			p.boardRank = i + 1;
			p.mockRound = i < 30 ? 1 : i < 60 ? 2 : null;
			p.mockPick = i < 60 ? (i % 30) + 1 : null;
			p.stockMove = p.preseasonRank - p.boardRank;   // + = riser
		});
		state.board = board;
		state.risers = board.slice().sort((a, b) => b.stockMove - a.stockMove)
			.filter((p) => p.stockMove > 0).slice(0, 8);
		state.fallers = board.slice().sort((a, b) => a.stockMove - b.stockMove)
			.filter((p) => p.stockMove < 0).slice(0, 8);
		return state;
	}

	/* ------------------------------------------------------------- phase 8 */

	function phaseNotes(state) {
		for (const p of state.players) {
			p.note = buildNote(p, state.teams, state.season, state.cfg, state);
		}
		return state;
	}

	/* ------------------------------------------------------------- staging */

	/* Which settings each phase reads. The UI uses this to re-run only what a
	   given change actually invalidates: the note template and the award dials
	   used to cost a full 368-program season simulation each time they moved. */
	const PHASES = [
		{
			name: "build",
			deps: [
				"seed", "ovrMode", "classQuality", "classDepth", "eliteCount",
				"specialization", "archetypeDiversity", "buildNoise", "varySize",
				"archetypeWeights", "classFlavor", "freshmanShare", "transferShare",
				"redshirtShare", "reclassShare", "leagueWeights", "wEuroLeague",
				"wGLeague", "wNBL", "pDII", "overrides",
				"archetypePool", "surpriseBudget",
				// See variationSalt / pickClassPool: both reshape the class
				// from the build phase down.
				"variation", "flavorHint", "poolMemory", "recentPools",
			],
			run: phaseBuild,
		},
		// injuryRate is read by assignAvailability, which runs here — before a
		// game is played, which is the whole point of it.
		{
			name: "regular",
			deps: ["pace", "scoringEnv", "injuryRate", "realignmentRate",
				"bluebloodDownYears", "midMajorLift", "teamMomentum", "seasonEvents"],
			run: phaseRegular,
		},
		{ name: "postseason", deps: ["upsetFactor"], run: phasePostseason },
		{
			name: "stats",
			deps: ["era", "pace", "scoringEnv", "efficiencyEnv", "statNoise",
				"priorSeasons"],
			run: phaseStats,
		},
		{ name: "pot", deps: ["potBias", "potSpread"], run: phasePot },
		{
			name: "awards",
			deps: ["awardStrictness", "confAwardStrictness", "proAwardStrictness",
				"awardNoise"],
			run: phaseAwards,
		},
		{ name: "stock", deps: ["draftEvents"], run: phaseStock },
		{ name: "notes", deps: ["noteLines"], run: phaseNotes },
	];

	/* JSON.stringify with object keys sorted at every level, so two configs
	   that differ only in key INSERTION order hash identically. Without this,
	   editing one archetype weight (or re-reading overrides from storage in a
	   different order) forced a full rebuild nothing semantically required. */
	function stableStringify(v) {
		if (v === undefined) return "undefined";
		if (v === null || typeof v !== "object") return JSON.stringify(v);
		if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
		return "{" + Object.keys(v).sort().map(
			(k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
	}

	function phaseKey(phase, cfg) {
		const parts = [];
		for (const k of phase.deps) parts.push(k + "=" + stableStringify(cfg[k]));
		return parts.join("&");
	}

	/* A runner keeps the intermediate state of one file, so successive runs
	   with slightly different settings only redo the phases that changed. */
	function createRunner(leagueFile) {
		const validation = validateLeagueFile(leagueFile);
		// validateLeagueFile no longer writes to its input (it is a check, not
		// a migration), so the season it recovered is applied here.
		leagueFile.startingSeason = validation.season;
		let state = null;
		let keys = null;

		function run(cfg) {
			const seed = cfg.seed && String(cfg.seed).trim() !== ""
				? String(cfg.seed).trim()
				: String(Math.floor(Math.random() * 1e9));
			const effective = Object.assign({}, cfg, { seed });
			const nextKeys = PHASES.map((p) => phaseKey(p, effective));
			let from = 0;
			if (state && keys) {
				from = PHASES.length;
				for (let i = 0; i < PHASES.length; i++) {
					if (keys[i] !== nextKeys[i]) { from = i; break; }
				}
			}
			if (!state) {
				state = { leagueFile, rng: new Rng(seed), seed };
				from = 0;
			}
			state.cfg = effective;
			/* Re-derive the flavor's config bend against the NEW settings.

			   Later phases read `effectiveCfg` because the narrative flavors
			   bend settings those phases own (injuryRate, upsetFactor, the
			   realignment rate). `effectiveCfg` was written once, in the build
			   phase — so a warm re-run that skipped the build phase left the
			   postseason reading the previous run's upset factor, and a staged
			   run stopped matching a cold one. The bend itself is a pure
			   function of the flavor and the settings, so it is cheap to
			   recompute here whether or not the build phase runs. */
			if (state.flavor !== undefined) {
				const bent = applyFlavorConfig(effective, state.flavor);
				/* Re-apply class-level environment jitter (same deterministic
				   stream the build phase used). Without this a warm re-run that
				   skips the build phase would lose the jitter. */
				const envRng = new Rng(seed).child("classEnv");
				const j = Object.assign({}, bent);
				j.pace = Math.max(55, bent.pace + envRng.normal(0, 2.5));
				j.efficiencyEnv = clamp(
					(bent.efficiencyEnv || 0) + envRng.normal(0, 0.6), -3, 3);
				j.statNoise = Math.max(0,
					(Number.isFinite(bent.statNoise) ? bent.statNoise : 1) + envRng.normal(0, 0.25));
				state.effectiveCfg = j;
			}
			if (from === 0) {
				state.rng = new Rng(seed);
				state.seed = seed;
			}
			const ran = [];
			for (let i = from; i < PHASES.length; i++) {
				PHASES[i].run(state);
				ran.push(PHASES[i].name);
			}
			keys = nextKeys;
			return {
				seed: state.seed,
				season: state.season,
				cfg: effective,
				players: state.players,
				teams: state.teams,
				poll: state.poll,
				pollHistory: state.pollHistory || [],
				tourney: state.tourney,
				confTourneys: state.confTourneys,
				ranked: state.ranked,
				proLeagues: state.proLeagues,
				board: state.board,
				risers: state.risers,
				fallers: state.fallers,
				draftEvents: state.draftEvents || [],
			fieldHonors: state.fieldHonors || [],
			fieldTop: state.fieldTop || [],
				seasonEvents: state.seasonEvents || [],
				flavor: state.flavor,
				// The builds this class was drawn from, and the anomalies it
				// was given, so the UI can say what makes this class this one.
				archetypePool: state.archetypePool
					? state.archetypePool.map((a) => a.name) : null,
				surprises: state.surprises || [],
				recruitingClasses: state.recruitingClasses || [],
				realignment: state.realignment || [],
				warnings: validation.warnings,
				phasesRun: ran,
				leagueFile,
			};
		}

		return { run, warnings: validation.warnings, phases: PHASES.map((p) => p.name) };
	}

	/* One-shot run. Kept as the simple entry point (and the one the tests and
	   the headless tools use); the UI holds a runner instead. */
	function run(leagueFile, cfg) {
		return createRunner(leagueFile).run(cfg);
	}

	/* A season for every non-NCAA destination that has a prospect in it. */
	/* --- how a prospect abroad got here ---------------------------------

	   An international prospect had a league, a club, a contract type and a
	   stat line, and no history. Every NCAA prospect carried a recruiting rank,
	   a class year, a transfer, a redshirt and a reclassification — five facts
	   about how he arrived — and the man who came through Real Madrid's academy
	   had none of them, so the two populations in the same draft class were
	   described at completely different resolutions. The OVERSEAS_ORIGINS list
	   existed and was used for exactly one thing: the backstory line of the
	   "returned from overseas" NCAA transfer.

	   A European prospect's path is a real and well-known shape: a youth
	   academy, a first senior contract, usually a loan to a lower division to
	   get minutes, and national-team age-group basketball alongside it. All
	   four are drawn here from the club and league he is actually in, so the
	   path is consistent with the rest of his season rather than decoration
	   printed next to it. */
	const YOUTH_SYSTEMS = {
		"EuroLeague": ["the club's own cantera", "an academy in Belgrade",
			"a Lithuanian youth system", "the Mega Basket production line",
			"a French INSEP intake"],
		"Liga ACB": ["the club's cantera", "a Canarian youth system",
			"a Basque academy", "the Joventut youth side"],
		"NBL": ["an NBL Next Stars intake", "the Australian Institute of Sport",
			"a New Zealand academy"],
		"Adriatic League": ["the Mega Basket production line",
			"a Belgrade youth system", "a Croatian academy"],
		"LNB Pro A": ["INSEP", "a Villeurbanne youth side", "a Pau-Orthez academy"],
		"Basketball Bundesliga": ["a Bundesliga youth program",
			"the Ulm youth system", "a Bavarian academy"],
	};
	const GENERIC_YOUTH = ["the club's own youth system", "a regional academy",
		"a national development program"];
	const LOAN_TARGETS = ["a second-division side", "a feeder club",
		"a lower-division team in the same region", "a club two levels down"];
	const NATIONAL_TEAMS = {
		"EuroLeague": ["Spain", "Serbia", "France", "Lithuania", "Greece",
			"Turkey", "Slovenia", "Germany", "Italy", "Israel"],
		"Liga ACB": ["Spain", "Georgia", "Senegal", "Dominican Republic"],
		"Adriatic League": ["Serbia", "Croatia", "Slovenia", "Montenegro", "Bosnia"],
		"LNB Pro A": ["France", "Senegal", "Ivory Coast"],
		"Basketball Bundesliga": ["Germany", "Austria", "Switzerland"],
		"NBL": ["Australia", "New Zealand"],
		"Chinese CBA": ["China"],
		"Japan B.League": ["Japan"],
		"Brazil NBB": ["Brazil"],
	};

	function proPath(p, lgName, club, rng) {
		const lg = C.NON_NCAA[lgName] || {};
		// The G League and the American academies are not this story.
		if (!lg.pro && !lg.youth) return null;
		if (lgName === "NBA G League" || lgName === "Overtime Elite" ||
			lgName === "NBA Academy") {
			return null;
		}
		const youth = rng.pick(YOUTH_SYSTEMS[lgName] || GENERIC_YOUTH);
		const path = { youth, caps: null, loan: null, debutAge: null };
		/* A first-team debut age. Younger is the signal here in the same way it
		   is for an NCAA freshman: a seventeen-year-old on a EuroLeague floor
		   is the whole scouting report. */
		path.debutAge = rng.int(16, Math.max(17, Math.min(20, (p.age || 19) - 1)));
		// A loan spell to get minutes, which is the ordinary case for a young
		// player at a big club and not for one at a small one.
		if (rng.random() < (club && club.level > 60 ? 0.55 : 0.25)) {
			path.loan = {
				where: rng.pick(LOAN_TARGETS),
				season: rng.int(1, 2),
			};
		}
		const pool = NATIONAL_TEAMS[lgName];
		if (pool && rng.random() < 0.65) {
			/* His own country if the file gave him one and the league plays
			   there, otherwise one of the league's. A man born in Serbia
			   playing in the Adriatic League should have Serbian age-group caps
			   and not Montenegrin ones, and the file usually knows. */
			const born = p.born && p.born.loc ? String(p.born.loc) : "";
			const own = pool.filter((c) => born.indexOf(c) !== -1)[0];
			const country = own || rng.pick(pool);
			const level = rng.weighted([
				{ w: 3, v: "U18" }, { w: 2.4, v: "U19" },
				{ w: 1.4, v: "U20" }, { w: 0.5, v: "senior" },
			]).v;
			path.caps = {
				country, level,
				n: level === "senior" ? rng.int(1, 8) : rng.int(4, 22),
			};
		}
		path.text = describePath(path);
		return path;
	}

	function describePath(path) {
		const bits = ["came through " + path.youth];
		if (path.debutAge) bits.push("first-team debut at " + path.debutAge);
		if (path.loan) {
			bits.push("loaned to " + path.loan.where + " for " +
				(path.loan.season === 1 ? "a season" : "two seasons"));
		}
		if (path.caps) {
			bits.push(path.caps.n + " caps for " +
				(path.caps.level === "senior"
					? "the senior " + path.caps.country + " side"
					: path.caps.country + " at " + path.caps.level));
		}
		return bits.join("; ");
	}

	function simulateProLeagues(players, cfg, rng) {
		const out = {};
		const byLeague = {};
		for (const p of players) {
			if (!p.nonNcaa) continue;
			(byLeague[p.newCollege] = byLeague[p.newCollege] || []).push(p);
		}
		for (const lgName of Object.keys(byLeague)) {
			const lg = C.NON_NCAA[lgName];
			/* A year with no season in it. A redshirt, a visa that never came,
			   an ACL in October: the tool could only ever put a man in a
			   league, so a real and common draft-class outcome was
			   inexpressible. These players get no club, no schedule and no stat
			   line — which is the point, and which everything downstream
			   already tolerates, because a stat line has always been optional
			   (`p.stats ? ... : ...`) for a player the engine could not
			   simulate. */
			if (lg.idle) {
				for (const p of byLeague[lgName]) {
					p.proClub = null;
					p.idleYear = true;
					p.proDeal = "and did not play a competitive season";
				}
				continue;
			}
			const env = S.leagueEnv(lgName);
			const lrng = rng.child("lg:" + lgName);
			const roster = C.PRO_CLUBS[lgName] ||
				[["" + lgName + " Select", 0], [lgName + " United", 0]];
			const level = lg.strength * (lg.pro ? 0.78 : 0.62);
			const clubs = roster.map(([name, off]) => {
				const crng = lrng.child("club:" + name);
				const members = [];
				const clubLevel = clamp(level + off * 1.6 + crng.normal(0, 3), 10, 97);
				for (let i = 0; i < 10; i++) {
					members.push({
						filler: true,
						talent: clamp(crng.normal(clubLevel, 7.5) - Math.pow(i, 1.3) * 1.5, 8, 97),
						endurance: clamp(crng.normal(0.55 - 0.02 * i, 0.10), 0.15, 0.95),
						name: "sq" + i,
					});
				}
				return {
					name, conf: lgName, members, prospects: [],
					level: clubLevel, prestige: 50 + off * 3,
					w: 0, l: 0, cw: 0, cl: 0, sos: 0, games: 0, quadWins: 0,
					log: [], form: crng.normal(1.0, 3.5),
				};
			});

			// Prospects sign where they fit: better prospects at better clubs.
			const signings = byLeague[lgName].slice()
				.sort((a, b) => b.newOvr - a.newOvr);
			const ranked = clubs.slice().sort((a, b) => b.level - a.level);
			signings.forEach((p, i) => {
				const club = ranked[i % ranked.length];
				club.prospects.push(p);
				/* Make room by dropping the club's WEAKEST FILLER. members.pop()
				   took the last entry, which after the first signing is the
				   previous prospect — so a club could only ever hold one, and
				   any others were left in club.prospects with no roster spot,
				   no minutes and no stat line. It never showed while blank
				   colleges spread thinly over three leagues; concentrate them
				   in one and two thirds of the league has no stats at all. */
				let worst = -1;
				for (let j = 0; j < club.members.length; j++) {
					if (!club.members[j].filler) continue;
					if (worst < 0 || club.members[j].talent < club.members[worst].talent) worst = j;
				}
				if (worst >= 0) club.members.splice(worst, 1);
				club.members.push({
					filler: false, player: p,
					talent: T.prospectTalent(p.newOvr, p.talentPot) * (lg.pro ? 0.94 : 1.05),
				});
				p.proClub = club.name;
				/* How he is actually attached to the club. A two-way contract is
				   the defining feature of the G League and a loan is the
				   defining feature of European development, and both were
				   missing entirely. */
				const crng = lrng.child("deal:" + p.key);
				if (lgName === "NBA G League") {
					p.proDeal = crng.random() < 0.45 ? "on a two-way contract"
						: crng.random() < 0.5 ? "as an affiliate player" : "on a standard deal";
				} else if (lg.youth) {
					p.proDeal = "in the academy program";
				} else if (crng.random() < 0.30) {
					const parent = ranked[Math.floor(crng.random() * Math.min(4, ranked.length))];
					p.proDeal = parent && parent !== club
						? "on loan from " + parent.name
						: "on a development contract";
				} else {
					p.proDeal = "on a first-team contract";
				}
				p.proPath = proPath(p, lgName, club, crng);
			});
			for (const c of clubs) c.rating = T.teamRating(c.members);

			const games = PRO_GAMES[lgName] || 30;
			T.pairUp(lrng, clubs, games, null, (A, B) => {
				const when = lrng.random();
				// Which side was at home has to reach the log, or a prospect
				// abroad never plays a home game.
				const homeForA = lrng.random() < 0.5 ? 1 : -1;
				const sc = T.playGameScore(lrng, A, B, homeForA, cfg, when);
				T.recordPostseason(A, B, sc, "reg", when, null, homeForA);
			});
			for (const c of clubs) {
				c.pct = c.games ? c.w / c.games : 0;
				c.sosAvg = c.games ? c.sos / c.games : 50;
			}
			const table = clubs.slice().sort((a, b) => b.pct - a.pct || b.rating - a.rating);
			table.forEach((c, i) => { c.standing = i + 1; });

			/* Playoff: top 8 (or the whole league if it is smaller), single
			   elimination. Rounds are named, so the EuroLeague's ends in a
			   Final Four rather than an anonymous "round 2". */
			let alive = table.slice(0, Math.min(8, table.length));
			const rounds = [];
			const names = PLAYOFF_ROUNDS[alive.length] || null;
			let ri = 0;
			while (alive.length > 1) {
				const next = [];
				const gamesLog = [];
				const roundName = names && names[ri]
					? names[ri]
					: (alive.length === 2 ? "Final" : "Round of " + alive.length);
				for (let i = 0; i < Math.floor(alive.length / 2); i++) {
					const A = alive[i];
					const B = alive[alive.length - 1 - i];
					// Higher seed hosts, in the playoffs as on the scoreboard.
					const sc = T.playGameScore(lrng, A, B, 1, cfg, 1, true);
					T.recordPostseason(A, B, sc, "playoff", 1.05 + ri * 0.01, roundName, 1);
					const winner = sc.won ? A : B;
					gamesLog.push({
						a: A, b: B, winner, round: roundName,
						score: sc.won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a,
					});
					next.push(winner);
				}
				if (alive.length % 2 === 1) next.push(alive[Math.floor(alive.length / 2)]);
				rounds.push({ name: roundName, games: gamesLog });
				alive = next;
				ri++;
			}
			const champ = alive[0];
			if (champ) champ.leagueChamp = true;

			/* A domestic cup, which every one of these leagues actually plays
			   and none of them had. Straight knockout over the whole league. */
			let cupAlive = lrng.shuffle(clubs);
			const cupRounds = [];
			while (cupAlive.length > 1) {
				const next = [];
				const gamesLog = [];
				for (let i = 0; i + 1 < cupAlive.length; i += 2) {
					const A = cupAlive[i];
					const B = cupAlive[i + 1];
					const sc = T.playGameScore(lrng, A, B, 0, cfg, 1, true);
					T.recordPostseason(A, B, sc, "cup", 1.02, "Cup");
					const winner = sc.won ? A : B;
					gamesLog.push({
						a: A, b: B, winner,
						score: sc.won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a,
					});
					next.push(winner);
				}
				if (cupAlive.length % 2 === 1) next.push(cupAlive[cupAlive.length - 1]);
				cupRounds.push(gamesLog);
				cupAlive = next;
			}
			const cupChamp = cupAlive[0];
			if (cupChamp) cupChamp.cupChamp = true;

			// Promotion and relegation, where the league has it.
			const relegated = [];
			if (lg.relegation) {
				for (let i = 0; i < lg.relegation && table.length - 1 - i >= 0; i++) {
					const t = table[table.length - 1 - i];
					t.relegated = true;
					relegated.push(t);
				}
			}

			/* The continental layer. A domestic league's top clubs spend the
			   winter in a European (or Asian, or American) competition
			   alongside it, and the note used to say nothing about it: a
			   prospect at Real Madrid had a Liga ACB table and no EuroLeague.
			   The run is drawn from the club's own rating against the
			   competition's strength; it moves the note, the honors (see
			   js/awards.js) and nothing about the domestic season, which is
			   what the scaffolding already simulated. */
			continentalRuns(lgName, table, lrng.child("continental"));

			for (const c of clubs) {
				if (!c.prospects.length) continue;
				const idx = table.indexOf(c);
				c.finish = c.leagueChamp ? "league champions"
					: idx < Math.min(8, table.length) ? "made the playoffs"
					: c.relegated ? "relegated"
					: "missed the playoffs";
				if (c.cupChamp) c.finish += ", cup winners";
				if (c.continental) {
					c.finish += "; " + c.continental.competition + ": " + c.continental.result;
				}
			}

			// Stats: each club is simulated exactly like a college rotation, in
			// its OWN environment — pace, game length and a teenager's minutes
			// ceiling all come from the league, not from the college slider.
			for (const c of clubs) {
				if (!c.prospects.length) continue;
				c.oppDefense = { rim: 0, perimeter: 0, overall: 0 };
				S.simulateTeamStats(c, {
					oppStrength: lg.strength,
					oppDefense: c.oppDefense,
					games: Math.round(c.games),
					league: env,
					pro: lg.pro,
				}, cfg, lrng.child("stats:" + c.name));
			}
			for (const p of byLeague[lgName]) {
				const club = clubs.filter((c) => c.name === p.proClub)[0];
				p.proTeam = club;
			}
			out[lgName] = {
				name: lgName, clubs, table, rounds, champion: champ,
				cup: { rounds: cupRounds, champion: cupChamp }, relegated,
				env,
			};
		}
		return out;
	}

	/* Which continental competition a domestic league's top clubs enter,
	   how many of them, and how strong the field is. The EuroLeague, the
	   EuroCup and the Champions League are themselves destinations in this
	   tool, so a club already IN one of those does not enter another. */
	const CONTINENTAL = {
		"Liga ACB": [["EuroLeague", 2, 88], ["EuroCup", 2, 74], ["Basketball Champions League", 2, 68]],
		"Turkish BSL": [["EuroLeague", 2, 88], ["EuroCup", 1, 74], ["Basketball Champions League", 2, 68]],
		"Greek Basket League": [["EuroLeague", 2, 88], ["Basketball Champions League", 2, 68]],
		"Israeli Premier League": [["EuroLeague", 1, 88], ["Basketball Champions League", 2, 68]],
		"Adriatic League": [["EuroLeague", 2, 88], ["EuroCup", 2, 74]],
		"LNB Pro A": [["EuroLeague", 2, 88], ["EuroCup", 2, 74], ["Basketball Champions League", 2, 68]],
		"Basketball Bundesliga": [["EuroLeague", 2, 88], ["EuroCup", 2, 74], ["Basketball Champions League", 2, 68]],
		"Brazil NBB": [["BCL Americas", 2, 60]],
		"Japan B.League": [["East Asia Super League", 2, 66]],
		"Chinese CBA": [["East Asia Super League", 2, 66]],
		"NBL": [["East Asia Super League", 2, 66]],
	};
	const CONTINENTAL_STAGES = ["group stage", "round of 16", "quarterfinals",
		"Final Four", "final", "champions"];
	function continentalRuns(lgName, table, rng) {
		const entries = CONTINENTAL[lgName];
		if (!entries) return;
		let i = 0;
		for (const [competition, slots, strength] of entries) {
			for (let k = 0; k < slots && i < table.length; k++, i++) {
				const club = table[i];
				/* How far the club goes: each stage is a coin weighted by the
				   club's rating against the field, so a 60-rated club in an
				   88-rated competition usually goes out in the group and a
				   90 usually reaches the last four. */
				let stage = 0;
				while (stage < CONTINENTAL_STAGES.length - 1) {
					const edge = club.rating - strength;
					const p = 1 / (1 + Math.exp(-(edge + 4) / 7));
					if (rng.random() > p) break;
					stage++;
				}
				club.continental = { competition, result: CONTINENTAL_STAGES[stage] };
				for (const p of club.prospects) p.continental = club.continental;
			}
		}
	}

	/* The best single night of a prospect's season. Kept as a named export
	   because it is a useful thing to call on its own; the pipeline reads it
	   off the full game log instead. */
	function signatureGame(p, team, rng) {
		const log = S.gameLog(p, team, rng);
		return log ? log.best : null;
	}

	function pct(x) { return (x * 100).toFixed(1) + "%"; }
	function n1(x) { return x.toFixed(1); }

	/* The scouting note written into the exported file. Which lines appear is
	   configurable (cfg.noteLines) rather than hardcoded, so the README no
	   longer has to explain a fixed set of omissions. */
	const NOTE_LINES = [
		["summary", "One-line scouting summary"],
		["team", "School / club, conference, class year"],
		["path", "How he got here (recruiting, transfer, redshirt)"],
		["record", "Team record and postseason result"],
		["stats", "Season stat line"],
		["shooting", "Shooting splits and TS%"],
		["advanced", "Usage, rebounds split, fouls"],
		["defense", "Defensive line (contests, deflections, charges, DRtg)"],
		["playmaking", "Assisted rate, transition share, plus/minus, close games"],
		["signature", "Best game of the season"],
		["highs", "Season highs, 20-point games, streaks"],
		["march", "Postseason splits"],
		["injury", "Games missed and why"],
		["coach", "Who coaches him, and what kind of year the staff is having"],
		["archetype", "Archetype label"],
		["awards", "Honors"],
		["stock", "Draft stock and mock position"],
		/* Where his season places him against the rest of Division I. Every
		   number on the lines above is a number until something says what it
		   was worth, and the model already ranked the whole field to hand out
		   awards. See rankAgainstField in js/awards.js. */
		["ranks", "Where he finished nationally and in his conference"],
	];
	const DEFAULT_NOTE_LINES = ["summary", "team", "stats", "shooting", "signature", "awards"];

	/* The note's opening sentence. It used to start "School (Conf) · Year"
	   and go straight to stat lines, which reads like a stat export; a
	   scout's note opens with what the player IS. Built from the things
	   the engine already knows — hand, size, class year, position, build,
	   the one number his season was about, and what the jumper looks like
	   — and drawn from the player's own key so it survives a re-run. */
	function noteSummary(p, team, season) {
		const s = p.stats;
		const r = p.newRatings || {};
		const rng = new Rng("summary|" + p.key);
		const year = String(p.classYear || "").toLowerCase();
		const size = Number.isFinite(p.newHgtInches)
			? Math.floor(p.newHgtInches / 12) + "'" + (p.newHgtInches % 12) + "\"" : "";
		const pos = ({ PG: "point guard", SG: "guard", G: "guard", GF: "wing", SF: "wing",
			F: "forward", PF: "forward", FC: "big", C: "center" })[p.newPos] || "player";
		const who = [p.hand === "left" ? "left-handed" : "", size, year, pos]
			.filter(Boolean).join(" ");
		const build = p.archetype && p.archetype !== "Balanced"
			? " built as " + Text.withArticle(p.archetype) : "";
		// The jumper, which is the first thing after the height and the hand.
		const shot = Number.isFinite(r.tp)
			? (r.tp >= 62 ? "a real jumper" : r.tp >= 45 ? "a workable jumper"
				: r.tp >= 28 ? "a jumper still in progress" : "no jumper to speak of")
			: "";
		const ft = s && Number.isFinite(s.ftp) && s.fta >= 1.5
			? " and " + (s.ftp * 100).toFixed(0) + "% from the line" : "";
		const where = p.nonNcaa
			? (p.proClub ? p.proClub + " (" + p.newCollege + ")" : p.newCollege)
			: p.newCollege;
		const record = team && Number.isFinite(team.w) && Number.isFinite(team.l)
			? team.w + "-" + team.l + " " : "";
		const numbers = s && s.gp > 0
			? (global.News ? global.News.statBlurb(s) : s.ppg.toFixed(1) + " points a game")
			: "no season on record";
		const variants = [
			() => Text.capitalize(Text.withArticle(who) + build + ": " + numbers +
				" for " + record + where + (shot ? ", with " + shot + ft : "") + "."),
			() => Text.capitalize(p.archetype && p.archetype !== "Balanced"
				? Text.withArticle(p.archetype) + " at " + where + ", " + Text.withArticle(who) +
					" who put up " + numbers + (shot ? "; " + shot + ft : "") + "."
				: Text.withArticle(who) + " at " + where + " who put up " + numbers +
					(shot ? "; " + shot + ft : "") + "."),
			() => Text.capitalize("put up " + numbers + " for " + record + where + " as " +
				Text.withArticle(who) + build + (shot ? " — " + shot + ft : "") + "."),
		];
		void season;
		return rng.pick(variants)();
	}

	function buildNote(p, teams, season, cfg, state) {
		const s = p.stats;
		const lines = [];
		const want = (cfg && Array.isArray(cfg.noteLines) ? cfg.noteLines : DEFAULT_NOTE_LINES);
		const on = (k) => want.indexOf(k) !== -1;
		const team = p.nonNcaa ? p.proTeam : teams[p.newCollege];

		if (on("summary")) lines.push(noteSummary(p, team, season));

		if (on("team")) {
			if (p.nonNcaa) {
				lines.push((p.proClub ? p.proClub + " (" + p.newCollege + ")" : p.newCollege) +
					" · " + p.classYear + (p.proDeal ? " · " + p.proDeal : ""));
			} else {
				lines.push(p.newCollege + " (" + team.conf +
					// A program that moved leagues this year says so, because
					// "first year in the Big Ten" is half the story of a season.
					(team.movedFrom ? ", first year after leaving the " +
						team.movedFrom : "") +
					") · " + p.classYear +
					(team.style && team.style.name !== "balanced"
						? " · " + team.style.name : ""));
			}
		}
		if (on("path")) {
			const bits = [];
			if (p.recruiting) {
				bits.push(p.recruiting.stars + "-star recruit (No. " +
					p.recruiting.rank + " nationally)");
				if (p.recruiting.headliner) bits.push("headline signing of his class");
			}
			// The international equivalent of a recruiting rank: how he got to
			// the club he is at. See proPath.
			if (p.proPath && p.proPath.text) bits.push(p.proPath.text);
			if (p.transfer) {
				// A walk-on turned starter has no previous school to name, and
				// a move between two known programs says which way it went.
				bits.push(p.transfer.from
					? p.transfer.kind + " — " + (p.transfer.story ||
						("from " + p.transfer.from))
					: p.transfer.kind);
			}
			if (p.redshirt) bits.push(p.redshirt);
			if (p.reclassified) bits.push(p.reclassified);
			// What the class anomalies write. They were applied to the model
			// and then had nowhere to be said.
			if (p.backstory) bits.push(p.backstory);
			if (p.recruiting && p.recruiting.decommits) {
				bits.push(p.recruiting.decommits + " decommitments");
			}
			if (p.recruiting && p.recruiting.classmates && p.recruiting.classmates.length) {
				bits.push("shared a roster with " + p.recruiting.classmates.join(" and "));
			}
			if (bits.length) lines.push(bits.join("; "));
		}
		if (on("record") && team) {
			let rec = team.w + "-" + team.l;
			if (p.nonNcaa) {
				rec += team.standing ? ", " + ordinal(team.standing) + " in the " +
					p.newCollege + (team.finish ? ", " + team.finish : "") : "";
			} else {
				rec += " (" + team.cw + "-" + team.cl + " " + team.conf + ")";
				if (team.confRegularChamp) rec += ", regular-season champions";
				if (team.confTourneyChamp) rec += ", conference tournament champions";
				if (team.ncaaSeed) {
					rec += " · No. " + team.ncaaSeed + " seed, " + team.ncaaResult;
				} else if (team.nitBid) {
					rec += " · " + (team.nitResult || "NIT");
				} else if (!team.bid) {
					rec += " · no postseason";
				}
			}
			lines.push(rec);
		}
		if (s && on("stats")) {
			lines.push(
				season + ": " + s.gp + " GP, " + n1(s.mpg) + " MPG, " + n1(s.ppg) +
				" PPG, " + n1(s.rpg) + " RPG, " + n1(s.apg) + " APG, " + n1(s.spg) +
				" SPG, " + n1(s.bpg) + " BPG",
			);
			// "He was better as a sophomore" is exactly what a scout reads off
			// a multi-year page, and the simulated prior seasons can say it.
			if (p.betterEarlier) {
				lines.push("Was better as a " +
					String(p.betterEarlier.classYear || "").toLowerCase() +
					" (" + n1(p.betterEarlier.ppg) + " PPG in " +
					p.betterEarlier.season + ")");
			}
		}
		if (s && on("shooting")) {
			lines.push(
				"FG " + pct(s.fgp) + " / 3P " + pct(s.tpp) + " / FT " + pct(s.ftp) +
				" (TS " + pct(s.ts) + ")",
			);
		}
		if (s && on("advanced")) {
			lines.push(
				"USG " + pct(s.usg) + " · " + n1(s.orpg) + " ORB / " + n1(s.drpg) +
				" DRB · " + n1(s.topg) + " TO · " + n1(s.pfpg) + " PF",
			);
		}
		if (s && on("defense")) {
			lines.push(
				"Defense: " + n1(s.cspg) + " contests, " + n1(s.deflpg) +
				" deflections, " + n1(s.chgpg) + " charges drawn · DRtg " +
				s.drtg.toFixed(1),
			);
		}
		if (s && on("ranks") && !p.nonNcaa) {
			const hi = AW.rankHighlights(p, 3);
			if (hi.length) lines.push("Finished: " + hi.join("; "));
		}
		if (on("signature") && p.signature && p.signature.pts > 0) {
			const g = p.signature;
			lines.push(
				"Season high: " + g.pts + " points" +
				(g.reb >= 8 ? " and " + g.reb + " rebounds" :
					g.ast >= 7 ? " and " + g.ast + " assists" : "") +
				(Number.isFinite(g.fgm) && g.fga > 0
					? " on " + g.fgm + "-of-" + g.fga + " shooting" +
						(g.tpa >= 3 ? " (" + g.tpm + "-of-" + g.tpa + " from three)" : "")
					: "") +
				" in " + (g.won ? "a win over " : "a loss to ") + g.opp +
				(g.round ? " in the " + g.round : "") +
				(g.pf !== null && g.pf !== undefined
					? " (" + g.pf + "-" + g.pa + (g.ot ? " " + (g.ot > 1 ? g.ot + "OT" : "OT") : "") + ")"
					: ""),
			);
		}
		if (on("highs") && p.gameLog) {
			const gl = p.gameLog;
			const bits = ["highs " + gl.highs.pts + "p / " + gl.highs.reb + "r / " +
				gl.highs.ast + "a"];
			if (gl.twentyPointGames) bits.push(Text.plural(gl.twentyPointGames, "20-point game"));
			if (gl.doubleDoubles) bits.push(Text.plural(gl.doubleDoubles, "double-double"));
			if (gl.tripleDoubles) bits.push(Text.plural(gl.tripleDoubles, "triple-double"));
			if (gl.hotStreak) {
				bits.push("best stretch: " + gl.hotStreak.games + " straight at " +
					n1(gl.hotStreak.ppg) + " a night");
			}
			lines.push(bits.join(" · "));
		}
		if (on("march") && p.gameLog && p.gameLog.postseason) {
			const ps = p.gameLog.postseason;
			lines.push("Postseason: " + Text.plural(ps.gp, "game") + ", " + n1(ps.ppg) + " PPG, " +
				n1(ps.rpg) + " RPG, " + n1(ps.apg) + " APG");
		}
		if (on("injury") && p.gameLog && p.gameLog.injury) {
			const inj = p.gameLog.injury;
			lines.push("Missed " + inj.games + " game" + (inj.games === 1 ? "" : "s") +
				" with " + inj.kind + ".");
		}
		if (on("coach") && team && team.coach) {
			lines.push("Coach: " + team.coach.name +
				(team.coach.situationLabel ? ", " + team.coach.situationLabel : "") +
				" (year " + team.coach.tenure + ")" +
				(team.downYear ? " · a down year for the program" : ""));
		}
		if (s && on("playmaking")) {
			const bits = [];
			if (Number.isFinite(s.astdRate)) bits.push("assisted on " + pct(s.astdRate) + " of his makes");
			if (Number.isFinite(s.transShare)) bits.push(pct(s.transShare) + " of his points in transition");
			if (Number.isFinite(s.pm)) bits.push((s.pm >= 0 ? "+" : "") + n1(s.pm) + " per game");
			const cl = p.gameLog && p.gameLog.clutch;
			if (cl) {
				bits.push("close games: " + cl.w + "-" + cl.l + ", " + n1(cl.ppg) + " PPG" +
					(Math.abs(cl.delta) >= 1.5 ? " (" + (cl.delta > 0 ? "+" : "") + n1(cl.delta) + " on his average)" : ""));
			}
			if (bits.length) lines.push(bits.join(" · "));
		}
		if (on("archetype") && p.archetype) {
			lines.push("Profile: " + p.archetype + (p.hand === "left" ? ", left-handed" : ""));
		}
		if (on("awards") && p.awards && p.awards.length) {
			// Awards arrive sorted by prestige. A genuine star can collect a
			// dozen honors across the national, conference and tournament
			// lists, and a note that prints all of them buries the ones that
			// matter — so the top few, then a count.
			const MAX = 6;
			const shown = p.awards.slice(0, MAX);
			const extra = p.awards.length - shown.length;
			lines.push("Honors: " + shown.join("; ") +
				(extra > 0 ? " (+" + extra + " more)" : ""));
		}
		if (on("stock") && p.boardRank) {
			const move = p.stockMove > 0 ? "up " + p.stockMove
				: p.stockMove < 0 ? "down " + (-p.stockMove) : "level";
			lines.push("Board: No. " + p.boardRank + " (" + move +
				" from No. " + p.preseasonRank + " preseason)" +
				(p.mockRound ? " · mock: round " + p.mockRound + ", pick " + p.mockPick : ""));
		}
		void state;
		return lines.join("\n");
	}

	function ordinal(n) {
		const v = n % 100;
		if (v >= 11 && v <= 13) return n + "th";
		return n + (["th", "st", "nd", "rd"][n % 10] || "th");
	}

	/* One BBGM-shaped season-total stats row from a per-game rate line.
	   BBGM wants integer totals, and the derivation has to reconcile: the
	   points a reader recomputes from 2*(fg-tp) + 3*tp + ft must be the
	   points the row reports, so makes are adjusted after rounding until
	   the identity holds against the target scoring total. `ref` supplies
	   the shot mix when the rate line itself has none (a prior season). */
	function bbgmStatsRow(rates, ref, seasonYear) {
		const rnd = Math.round;
		const gp = Math.max(1, rnd(rates.gp));
		const k = ref && ref.ppg > 0.1 ? rates.ppg / ref.ppg : 1;
		const fgaG = Number.isFinite(rates.fga) ? rates.fga : (ref ? ref.fga * k : 0);
		const tpaG = Number.isFinite(rates.tpa) ? rates.tpa : (ref ? ref.tpa * k : 0);
		const ftaG = Number.isFinite(rates.fta) ? rates.fta : (ref ? ref.fta * k : 0);
		const fgp = Number.isFinite(rates.fgp) ? rates.fgp : (ref ? ref.fgp : 0.45);
		const tpp = Number.isFinite(rates.tpp) ? rates.tpp : (ref ? ref.tpp : 0.33);
		const ftp = Number.isFinite(rates.ftp) ? rates.ftp : (ref ? ref.ftp : 0.70);
		const fga = rnd(fgaG * gp);
		const tpa = Math.min(fga, rnd(tpaG * gp));
		const fta = rnd(ftaG * gp);
		let tp = Math.min(tpa, rnd(tpa * tpp));
		let fg = Math.min(fga, Math.max(tp, rnd(fga * fgp)));
		let ft = Math.min(fta, rnd(fta * ftp));
		// Reconcile to the season scoring total: free throws absorb the
		// rounding first (worth one point each), twos absorb the rest.
		const target = rnd(rates.ppg * gp);
		let diff = target - (2 * (fg - tp) + 3 * tp + ft);
		const ft2 = Math.max(0, Math.min(fta, ft + diff));
		diff -= ft2 - ft;
		ft = ft2;
		const fg2 = Math.max(tp, Math.min(fga, fg + Math.trunc(diff / 2)));
		fg = fg2;
		const pts = 2 * (fg - tp) + 3 * tp + ft;
		const row = {
			season: seasonYear,
			tid: -1,          // no team: this season predates the draft
			playoffs: false,
			gp,
			gs: 0,
			min: rnd(rates.mpg * gp),
			fg, fga, tp, tpa, ft, fta, pts,
			orb: rnd((Number.isFinite(rates.orpg) ? rates.orpg : rates.rpg * 0.3) * gp),
			ast: rnd(rates.apg * gp),
			stl: rnd((rates.spg || 0) * gp),
			blk: rnd((rates.bpg || 0) * gp),
			tov: rnd((rates.topg || 0) * gp),
			pf: rnd((rates.pfpg || 0) * gp),
		};
		row.drb = Math.max(0, rnd(rates.rpg * gp) - row.orb);
		return row;
	}


	/* ------------------------------------------------- BBGM stats rows

	   A college season, written the way Basketball GM writes a season.

	   What used to be here wrote twenty of the seventy-four keys a BBGM stats
	   row has and, with the highs option on, five bare numbers named ptsMax
	   and friends. Neither is the shape the game uses (see js/bbgmstats.js): a
	   season high is [value, gameId], not a number. A row missing two-thirds
	   of its keys does not display as a smaller row, it displays as a row of
	   blanks, and a bare ptsMax does not display at all — which is exactly
	   what a user reported seeing after importing a class exported with the
	   statline options on.

	   So the export now builds the whole simulated field once — every program,
	   its rotation, its opponents — and computes the row the same way the game
	   would: totals off the game log that the season highs come from, the shot
	   mix off the model that produced the shooting percentages, and every
	   derived statistic through the ported formulas in js/bbgmstats.js. */

	const BS = global.BBGMStats;

	/* Cached per result object, because the field-wide pass (PER's league
	   normalization, BPM's team adjustment) is not something to redo per
	   player, and exportFile can be called several times on one result. */
	const SEASON_STATS = new WeakMap();

	function statsHash(str) {
		let h = 5381;
		for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
		return h;
	}

	/* A filler teammate has no ratings row, so his position — which EWA and
	   BPM both read — is taken off the one thing his line does carry about
	   his size. */
	function sizePos(bigness) {
		const b = Number.isFinite(bigness) ? bigness : 0.45;
		if (b < 0.20) return "PG";
		if (b < 0.40) return "SG";
		if (b < 0.60) return "SF";
		if (b < 0.80) return "PF";
		return "C";
	}

	/* Integers that sum to `total`, apportioned by `weights` and capped by
	   `caps`, largest remainder first. Used wherever a rounded split has to
	   stay reconcilable with the number it was split out of. */
	function apportion(weights, total, caps) {
		const n = weights.length;
		const out = new Array(n).fill(0);
		if (total <= 0) return out;
		const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
		const rem = [];
		let used = 0;
		for (let i = 0; i < n; i++) {
			const want = sum > 0 ? (Math.max(0, weights[i]) / sum) * total : total / n;
			const cap = caps ? caps[i] : Infinity;
			const v = Math.min(cap, Math.floor(want));
			out[i] = v;
			used += v;
			rem.push({ i, frac: want - Math.floor(want) });
		}
		rem.sort((a, b) => b.frac - a.frac);
		let guard = 0;
		while (used < total && guard++ < 10 * n + 50) {
			let moved = false;
			for (const r of rem) {
				if (used >= total) break;
				const cap = caps ? caps[r.i] : Infinity;
				if (out[r.i] < cap) { out[r.i]++; used++; moved = true; }
			}
			if (!moved) break;
		}
		return out;
	}

	/* The two-point attempts and makes of a season, split into the three zones
	   BBGM records (at the rim, the low post, the mid-range).

	   The simulation already decides a rim/jumper split and a percentage for
	   each (see statLine's rimMix, insideEff and midEff) and used to fold them
	   into one two-point percentage. This unfolds them, and reconciles: the
	   three zones sum to the attempts and the makes on the row, so nothing a
	   reader adds up disagrees with anything else on it. The low post is the
	   one zone the model does not name — a post-up is a two that is not a
	   layup — so its share of the non-rim twos is taken off size, and it
	   converts a little worse than the rim. */
	function zoneSplit(fg, fga, tp, tpa, line) {
		const L = line || {};
		const twoA = Math.max(0, fga - tpa);
		const twoM = Math.max(0, Math.min(twoA, fg - tp));
		const rimMix = clamp(Number.isFinite(L.rimMix) ? L.rimMix : 0.50, 0.05, 0.95);
		const postMix = clamp(
			0.12 + 0.55 * (Number.isFinite(L.bigness) ? L.bigness : 0.45), 0.05, 0.80);
		const rimA = Math.round(twoA * rimMix);
		const lowA = Math.round((twoA - rimA) * postMix);
		const midA = Math.max(0, twoA - rimA - lowA);
		const rimP = clamp(Number.isFinite(L.rimPct) ? L.rimPct : 0.62, 0.20, 0.90);
		const midP = clamp(Number.isFinite(L.midPct) ? L.midPct : 0.38, 0.15, 0.70);
		const lowP = clamp(rimP - 0.12, 0.15, 0.80);
		const makes = apportion(
			[rimA * rimP, lowA * lowP, midA * midP], twoM, [rimA, lowA, midA]);
		return {
			fgaAtRim: rimA, fgAtRim: makes[0],
			fgaLowPost: lowA, fgLowPost: makes[1],
			fgaMidRange: midA, fgMidRange: makes[2],
		};
	}

	/* The per-game rows a season row is summed from.

	   The game log is the source wherever there is one, because the season
	   highs have to come out of the same nights the totals do: a 34-point high
	   on a 300-point season that was computed separately is a file that
	   contradicts itself. `null` when the log never got a shooting line
	   attached (see attachMinutesAndShooting, which returns early on an
	   incomplete rate line), in which case the caller falls back to the rate
	   line and writes no highs. */
	function gameRows(gameLog, line) {
		if (!gameLog || !gameLog.games || !gameLog.games.length) return null;
		const games = gameLog.games;
		for (const g of games) {
			if (!Number.isFinite(g.fgm) || !Number.isFinite(g.min)) return null;
		}
		// The log counts rebounds but does not split the glass; the split is
		// the season's own, applied every night.
		const orbShare = line && line.rpg > 0
			? clamp(line.orpg / line.rpg, 0, 1) : 0.30;
		return games.map((g) => {
			const orb = Math.round(g.reb * orbShare);
			return {
				min: g.min, fg: g.fgm, fga: g.fga, tp: g.tpm, tpa: g.tpa,
				ft: g.ftm, fta: g.fta, pts: g.pts,
				orb, drb: Math.max(0, g.reb - orb),
				ast: g.ast, tov: g.tov, stl: g.stl, blk: g.blk, pf: g.fouls,
				pm: Number.isFinite(g.pm) ? g.pm : 0,
				ba: 0,
				// Overtime lengthens the night, which is what "minutes
				// available" counts.
				available: 40 + 5 * (g.ot || 0),
			};
		});
	}

	function sumGames(games) {
		const t = {
			gp: games.length, min: 0, fg: 0, fga: 0, tp: 0, tpa: 0, ft: 0, fta: 0,
			pts: 0, orb: 0, drb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0, pm: 0,
			minAvailable: 0,
		};
		for (const g of games) {
			t.min += g.min; t.fg += g.fg; t.fga += g.fga;
			t.tp += g.tp; t.tpa += g.tpa; t.ft += g.ft; t.fta += g.fta;
			t.pts += g.pts; t.orb += g.orb; t.drb += g.drb; t.ast += g.ast;
			t.tov += g.tov; t.stl += g.stl; t.blk += g.blk; t.pf += g.pf;
			t.pm += g.pm; t.minAvailable += g.available;
		}
		t.trb = t.orb + t.drb;
		return t;
	}

	/* Season totals from a rate line, for a season with no game log behind it:
	   a reconstructed prior year (cfg.priorSeasons = "reconstruct"), or a log
	   that never got its shooting attached. */
	function rateTotals(rates, ref, seasonYear) {
		const row = bbgmStatsRow(rates, ref, seasonYear);
		const gp = row.gp;
		const orb = row.orb;
		return {
			gp,
			min: Math.round((rates.mpg || 0) * gp),
			fg: row.fg, fga: row.fga, tp: row.tp, tpa: row.tpa,
			ft: row.ft, fta: row.fta, pts: row.pts,
			orb, drb: row.drb, trb: orb + row.drb,
			ast: row.ast, tov: row.tov, stl: row.stl, blk: row.blk, pf: row.pf,
			pm: Number.isFinite(rates.pm) ? Math.round(rates.pm * gp) : 0,
			minAvailable: 40 * gp,
		};
	}

	/* One team of the simulated field, as BBGM's advanced statistics want it:
	   season totals, with the opponent columns they divide by.

	   The opponent line is the one thing a season simulated at this level of
	   detail does not record. Every opponent was itself a simulated program,
	   so the field's own average line is the honest stand-in: it is scaled to
	   this team's possessions (so a fast team's opponents take a fast team's
	   shots) and then its makes are scaled again so that the points come out
	   at what this defense actually gave up. Attempts stay where the pace put
	   them, which puts the whole difference between a good defense and a bad
	   one into the opponent's percentages — where most of it belongs. */
	function opponentTotals(box, avg, margin, gp) {
		const scale = avg.poss > 0 ? box.poss / avg.poss : 1;
		const opp = {
			fga: avg.fga * scale, tpa: avg.tpa * scale, fta: avg.fta * scale,
			fg: avg.fg * scale, tp: avg.tp * scale, ft: avg.ft * scale,
			orb: avg.orb * scale, drb: avg.drb * scale, trb: avg.trb * scale,
			tov: avg.tov * scale,
		};
		/* What the opponents scored. The number to match is the MARGIN, not
		   the points allowed: a team's box score and its scoreboard are two
		   different sums here — the stat model puts a program at 74.5 points a
		   game where the season it played says 69.8 — and pairing box points
		   with scoreboard points allowed hands every team in the country a
		   +4.5 margin it did not have. Plus/minus, on/off and both team
		   ratings are all differences, so all four came out wrong. Against a
		   team with no season behind it (a prior year, whose schedule was
		   never played) the opponent is the field's average. */
		const target = Number.isFinite(margin)
			? Math.max(20, box.pts - margin) : avg.pts;
		const implied = 2 * (opp.fg - opp.tp) + 3 * opp.tp + opp.ft;
		const k = implied > 0 ? clamp(target / implied, 0.6, 1.5) : 1;
		opp.fg *= k; opp.tp *= k; opp.ft *= k;
		return {
			oppPts: target * gp,
			oppFga: opp.fga * gp, oppTpa: opp.tpa * gp, oppFta: opp.fta * gp,
			oppFg: opp.fg * gp, oppTp: opp.tp * gp, oppFt: opp.ft * gp,
			oppOrb: opp.orb * gp, oppDrb: opp.drb * gp, oppTrb: opp.trb * gp,
			oppTov: opp.tov * gp,
		};
	}

	/* Every season this class played, as complete BBGM stats rows.

	   Runs once per result: the field is 368 programs and the two statistics
	   that cannot be computed a team at a time (PER's league normalization,
	   BPM's adjustment to the league average team) need all of it. */
	function collegeSeasonStats(result) {
		const cached = SEASON_STATS.get(result);
		if (cached) return cached;

		const season = result.season;
		const rosters = [];   // one per simulated team-season
		const entries = [];   // one per row this export can write

		/* One team-season: the rotation that played it, and which of its
		   players this export needs a row for. */
		const addTeam = (box, lines, margin, wanted) => {
			if (!box || !lines || !lines.length) return;
			const gp = Math.max(1, box.gp);
			const players = [];
			for (const item of lines) {
				const line = item.line;
				const glog = item.log || null;
				const games = gameRows(glog, line);
				const totals = games
					? sumGames(games)
					: rateTotals(line, null, season);
				const zones = zoneSplit(totals.fg, totals.fga, totals.tp, totals.tpa, line);
				players.push({
					pos: item.pos || sizePos(line.bigness),
					key: item.key || null,
					line, games, zones, stats: totals,
				});
			}
			rosters.push({
				box, gp, margin,
				stats: null,        // filled in the second pass
				players,
			});
			for (const w of wanted || []) {
				const i = players.findIndex((pl) => pl.key === w.key);
				if (i >= 0) entries.push({ roster: rosters[rosters.length - 1], i, meta: w });
			}
		};

		// The draft year: every program, its rotation, and a row for every
		// prospect on it.
		const teams = result.teams || {};
		for (const name of Object.keys(teams)) {
			const team = teams[name];
			if (!team || !team.box || !team.lines) continue;
			const byLine = new Map();
			for (const p of team.prospects || []) {
				if (p && p.stats) byLine.set(p.stats, p);
			}
			const items = team.lines.map((line) => {
				const p = byLine.get(line);
				return p
					? { line, log: p.gameLog, pos: p.newPos, key: p.key }
					: { line, log: null, pos: null, key: null };
			});
			const wanted = (team.prospects || [])
				.filter((p) => p && p.stats && !p.nonNcaa)
				.map((p) => ({ key: p.key, player: p, season, team: name, draftYear: true }));
			const margin = team.log && team.log.length
				? team.log.reduce((a, g) => a + ((g.pf || 0) - (g.pa || 0)), 0) /
					team.log.length
				: null;
			addTeam(team.box, items, margin, wanted);
		}

		// The seasons before it, each one its own simulated team.
		for (const p of result.players || []) {
			if (p.nonNcaa || !Array.isArray(p.priorSeasons)) continue;
			for (const row of p.priorSeasons) {
				if (row.redshirt || !row.line) continue;
				if (!row.box || !row.lines) continue;
				const key = p.key + "|" + row.season;
				const items = row.lines.map((line) => ({
					line,
					log: null,
					pos: line === row.line ? row.pos : null,
					key: line === row.line ? key : null,
				}));
				addTeam(row.box, items, null, [{
					key, player: p, season: row.season, team: row.team,
					draftYear: false, prior: row,
				}]);
			}
		}

		if (!rosters.length) {
			const empty = new Map();
			SEASON_STATS.set(result, empty);
			return empty;
		}

		/* Pass two: the field's average line, which the opponent columns and
		   the blocked-shot model are both read off. */
		const avg = { fga: 0, tpa: 0, fta: 0, fg: 0, tp: 0, ft: 0, orb: 0, drb: 0,
			trb: 0, tov: 0, pts: 0, poss: 0, blk: 0 };
		for (const r of rosters) {
			for (const k of Object.keys(avg)) avg[k] += r.box[k] || 0;
		}
		for (const k of Object.keys(avg)) avg[k] /= rosters.length;

		/* Blocked shots against, which the simulation does not record: a
		   defense's blocks have to land on somebody. The field blocks a fixed
		   share of the two-pointers it faces, and a player's share of that is
		   how many of his own shots he takes where shots get blocked. The
		   weights are normalized on the field's own mean, so the total handed
		   out is the total blocked. */
		const rimWeight = (pl) => {
			const z = pl.zones;
			return 1.6 * z.fgaAtRim + 1.1 * z.fgaLowPost + 0.35 * z.fgaMidRange;
		};
		let twoTotal = 0;
		let weightTotal = 0;
		for (const r of rosters) {
			for (const pl of r.players) {
				twoTotal += Math.max(0, pl.stats.fga - pl.stats.tpa);
				weightTotal += rimWeight(pl);
			}
		}
		// Blocks per two-point attempt, field-wide, converted into a rate per
		// unit of the weight above.
		const blkRate = avg.poss > 0 && weightTotal > 0
			? (avg.blk * twoTotal) / (Math.max(1, avg.fga - avg.tpa) * weightTotal)
			: 0;
		for (const r of rosters) {
			for (const pl of r.players) {
				const ba = Math.round(blkRate * rimWeight(pl));
				pl.stats.ba = ba;
				if (pl.games && pl.games.length) {
					// Spread over the nights he took the shots on, so baMax is
					// a number that could have happened.
					const w = pl.games.map((g) => Math.max(0, g.fga - g.tpa));
					const per = apportion(w, ba, w.map((v) => v));
					pl.games.forEach((g, i) => { g.ba = per[i]; });
				}
			}
		}

		/* Pass three: team season totals, and the whole field through the
		   ported advanced-statistic formulas. */
		for (const r of rosters) {
			const b = r.box;
			const gp = r.gp;
			const t = {
				gp,
				min: b.min * gp,
				fg: b.fg * gp, fga: b.fga * gp, tp: b.tp * gp, tpa: b.tpa * gp,
				ft: b.ft * gp, fta: b.fta * gp,
				orb: b.orb * gp, drb: b.drb * gp, trb: b.trb * gp,
				ast: b.ast * gp, tov: b.tov * gp, stl: b.stl * gp,
				blk: b.blk * gp, pf: b.pf * gp, pts: b.pts * gp,
				poss: b.poss * gp,
				pace: b.pace,
			};
			Object.assign(t, opponentTotals(b, avg, r.margin, gp));
			t.ortg = b.poss > 0 ? (100 * b.pts) / b.poss : 100;
			t.drtg = b.poss > 0 ? (100 * (t.oppPts / gp)) / b.poss : 100;
			r.stats = t;
			/* Plus/minus for a season with no game log behind it. The log
			   estimates it as the team's margin scaled by how much of the game
			   he was on the floor for; without one, the same estimate off the
			   season margin is the answer, and it matters — leaving it at zero
			   tells the on/off calculation that the team was exactly even
			   whenever he played, which then reports a large negative on/off
			   for a good player on a good team. */
			const marginPerMin = t.min > 0 ? (t.pts - t.oppPts) / (t.min / 5) : 0;
			for (const pl of r.players) {
				if (!pl.games) pl.stats.pm = Math.round(marginPerMin * pl.stats.min);
			}
		}
		/* Every team-season at once, earlier years included. A prior season is
		   a real simulated team-season of the same model at the same program
		   level, so it belongs in the field it is normalized against; the
		   alternative — normalizing one man's freshman year against a league
		   of one team — is not an approximation of the right answer, it is a
		   different number entirely. */
		const adv = BS.leagueAdvanced(rosters, {
			gameMinutes: 40, numPlayersOnCourt: 5,
		});
		let flat = 0;
		for (const r of rosters) {
			for (const pl of r.players) pl.adv = adv[flat++];
		}

		/* Pass four: the rows themselves. */
		const rows = new Map();
		for (const e of entries) {
			const pl = e.roster.players[e.i];
			const meta = e.meta;
			const p = meta.player;
			const s = pl.stats;
			const number = String(statsHash(String(p.key || p.name || "")) % 55);
			const row = BS.blankRow(meta.season, BS.TID_DOES_NOT_EXIST, number);
			row.gp = s.gp;
			/* Games started. The season model decides who is in a rotation
			   and where, not who was announced before tip-off, so the draft
			   year reads the reserve flag the award model already set and an
			   earlier season is called a starting year at a starter's
			   minutes. */
			const starter = meta.draftYear
				? !p.isReserve
				: !!(meta.prior && meta.prior.mpg >= 24);
			row.gs = starter ? s.gp : 0;
			row.min = Math.round(s.min);
			row.minAvailable = Math.round(s.minAvailable);
			row.fg = s.fg; row.fga = s.fga;
			row.tp = s.tp; row.tpa = s.tpa;
			row.ft = s.ft; row.fta = s.fta;
			Object.assign(row, pl.zones);
			row.pm = Math.round(s.pm);
			row.orb = s.orb; row.drb = s.drb;
			row.ast = s.ast; row.tov = s.tov; row.stl = s.stl; row.blk = s.blk;
			row.ba = s.ba; row.pf = s.pf; row.pts = s.pts;
			for (const k of BS.STATS.derived) {
				const v = pl.adv ? pl.adv[k] : 0;
				row[k] = Number.isFinite(v) ? v : 0;
			}
			if (pl.games) {
				Object.assign(row, BS.doubleCounts(pl.games));
			}
			rows.set(meta.key, { row, games: pl.games, meta });
		}
		SEASON_STATS.set(result, rows);
		return rows;
	}


	/* One player's row for one season, ready to write.

	   The rows collegeSeasonStats built are cached and shared, so this hands
	   back a copy — exportFile can be called repeatedly on one result, and a
	   caller that edited a row would otherwise be editing every later export
	   of it too.

	   `prior` is the earlier-season row this is for, or null for the draft
	   year. A prior season that was reconstructed rather than simulated
	   (cfg.priorSeasons = "reconstruct") has no team and no rotation behind
	   it, so it takes the fallback: the counting stats are real, and the
	   derived statistics — every one of which is a ratio against a team that
	   was never simulated — stay at zero rather than being invented. */
	function seasonRow(built, p, season, prior, opts) {
		const key = prior ? p.key + "|" + season : p.key;
		const where = prior ? (prior.team || p.newCollege) : p.newCollege;
		const entry = built.get(key);
		if (entry) {
			const row = JSON.parse(JSON.stringify(entry.row));
			if (opts.highs && entry.games) {
				const highs = BS.seasonHighs(entry.games, season);
				if (highs) Object.assign(row, highs);
			}
			row.__team = where;
			return row;
		}
		const rates = prior || p.stats;
		const totals = rateTotals(rates, prior ? p.stats : null, season);
		const row = BS.blankRow(season, BS.TID_DOES_NOT_EXIST,
			String(statsHash(String(p.key || p.name || "")) % 55));
		row.gp = totals.gp;
		row.gs = prior ? 0 : (p.isReserve ? 0 : totals.gp);
		row.min = totals.min;
		row.minAvailable = totals.minAvailable;
		row.fg = totals.fg; row.fga = totals.fga;
		row.tp = totals.tp; row.tpa = totals.tpa;
		row.ft = totals.ft; row.fta = totals.fta;
		Object.assign(row, zoneSplit(totals.fg, totals.fga, totals.tp, totals.tpa,
			prior ? prior.line : p.stats));
		row.pm = totals.pm;
		row.orb = totals.orb; row.drb = totals.drb;
		row.ast = totals.ast; row.tov = totals.tov;
		row.stl = totals.stl; row.blk = totals.blk;
		row.pf = totals.pf; row.pts = totals.pts;
		row.__team = where;
		return row;
	}

	/* Produce the modified BBGM draft class file.

	   `opts` is the §8.13 opt-in surface — every flag off writes exactly the
	   file this function has always written:
	     stats:  the simulated draft-year season as a BBGM stats row
	     prior:  simulated earlier seasons as additional stats rows
	     awards: every honor as {season, type}, concatenated (a re-imported
	             file may already carry awards)
	     highs:  game-log season highs and double-double counts on the row

	   IMPORTANT: BBGM's own Import -> Draft class tool (handleUploadedDraftClass
	   in its source) unconditionally does `delete p.stats` on every uploaded
	   player before merging him into the league — confirmed against BBGM's
	   source, not guessed. So `stats`/`prior`/`highs` never survive THAT
	   import; only `awards` (never deleted there) and `note` (a plain string
	   field) come through.

	   The route that does keep them is Tools -> Import players (importPlayers
	   in the same file), which has an "include stats" option and copies the
	   rows across as they are, stamping each one's tid as DOES_NOT_EXIST —
	   the same value these rows already carry, because a college program is
	   not a team in the league. A hand-merge into an existing league file's
	   own `players` array works too. Both of those read the row as BBGM
	   writes rows, which is why collegeSeasonStats builds a complete one.
	   The export dialog says which import is which. */
	function exportFile(result, opts) {
		opts = opts || {};
		/* The export firewall: a generated (past/future) season carries
		   exportable: false and there is nothing legitimate to write back.
		   An assert, not a filter — silence is how a world leaks into a
		   save file. */
		if (result.exportable === false) {
			throw new Error("Only the loaded draft class can be exported.");
		}
		const src = result.leagueFile;
		// Match by array position, not pid: files with duplicate pids would
		// otherwise silently give every duplicate the same rebuilt ratings.
		const byIdx = result.players;
		let passthroughs = 0;

		const players = src.players.map((orig, i) => {
			const p = byIdx[i] && byIdx[i].src === orig ? byIdx[i] : null;
			// A failed identity check passes the player through untouched;
			// counted now, so the caller can warn instead of shipping a
			// half-modified file in silence.
			if (!p) { passthroughs++; return orig; }
			const out = JSON.parse(JSON.stringify(orig));
			out.college = p.newCollege;
			const ov = p.override || {};
			if (ov.name && String(ov.name).trim()) {
				const parts = String(ov.name).trim().split(/\s+/);
				out.firstName = parts.shift();
				out.lastName = parts.join(" ");
			}
			/* The README promises hgt/weight are rewritten only when Vary size
			   is on or the source file lacked them; the old code wrote both
			   unconditionally, adding keys to files that never had them.

			   Which override keys count as a SIZE override is now stated
			   rather than inferred. The old expression happened to name the
			   only two size keys the editor could write, so it was correct —
			   but it was correct by coincidence, and the next override key
			   added to `ov` would have had to be checked against this line by
			   someone who remembered it existed. SIZE_OVERRIDE_KEYS is the
			   one place that fact lives, and buildOverride() below is checked
			   against it by tools/test.js. */
			const sized = result.cfg.varySize ||
				SIZE_OVERRIDE_KEYS.some((k) => Number.isFinite(ov[k]));
			if (sized || !Number.isFinite(orig.hgt)) out.hgt = p.newHgtInches;
			if (sized || !Number.isFinite(orig.weight)) out.weight = p.newWeight;
			const last = out.ratings.length - 1;
			const r = out.ratings[last];
			for (const k of BB.RATING_KEYS) {
				r[k] = Number.isFinite(p.newRatings[k]) ? p.newRatings[k] : 0;
			}
			r.ovr = p.newOvr;
			r.pot = p.newPot;
			r.pos = p.newPos;
			r.skills = p.newSkills.slice();
			out.draft = Object.assign({}, out.draft, {
				ovr: p.newOvr, pot: p.newPot, skills: p.newSkills.slice(),
			});
			out.note = p.note;
			/* The flag matches the note: writing noteBool = 1 beside an
			   empty note made BBGM flag a note the player doesn't have. */
			if (p.note && String(p.note).trim()) out.noteBool = 1;
			else delete out.noteBool;

			if (opts.awards && p.awards && p.awards.length) {
				out.awards = (Array.isArray(out.awards) ? out.awards : [])
					.concat(p.awards.map((type) => ({ season: result.season, type })));
			}
			if (opts.stats && p.stats && !p.nonNcaa) {
				const built = collegeSeasonStats(result);
				const rows = [];
				if (opts.prior && Array.isArray(p.priorSeasons)) {
					for (const r of p.priorSeasons) {
						if (r.redshirt) continue;
						rows.push(seasonRow(built, p, r.season, r, opts));
					}
				}
				rows.push(seasonRow(built, p, result.season, null, opts));
				/* yearsWithTeam counts consecutive seasons at the same
				   program, which is what a transfer breaks — the one thing
				   about a multi-season row that a reader would notice being
				   wrong, since the rows do not name the school. */
				let years = 0;
				let last = null;
				for (const r of rows) {
					const where = r.__team;
					years = last && last.team === where && last.season === r.season - 1
						? years + 1 : 1;
					r.yearsWithTeam = years;
					last = { team: where, season: r.season };
					delete r.__team;
				}
				out.stats = (Array.isArray(out.stats) ? out.stats : []).concat(rows);
			}
			return out;
		});

		const file = Object.assign({}, src, { players });
		// Readable by the caller, never written into the file.
		exportFile.passthroughs = passthroughs;
		return file;
	}

	/* Everything the simulated season produced, as plain data. The whole
	   simulation used to be throwaway except for the note strings. */
	function exportSeason(result) {
		const teams = Object.values(result.teams)
			.filter((t) => t.prospects.length || t.apRank || t.bid || t.nitBid)
			.map((t) => ({
				name: t.name, conf: t.conf, w: t.w, l: t.l, cw: t.cw, cl: t.cl,
				regW: t.regW, regL: t.regL,
				apRank: t.apRank || null, sos: round2(t.sosAvg), rating: round2(t.rating),
				bid: t.bid || null, ncaaSeed: t.ncaaSeed || null,
				ncaaResult: t.ncaaResult || null, nitResult: t.nitResult || null,
				confRegularChamp: !!t.confRegularChamp,
				confTourneyChamp: !!t.confTourneyChamp,
				offRtg: round2(t.offRtg), defRtg: round2(t.defRtg),
				prospects: t.prospects.map((p) => p.name),
			}));
		const bracket = [];
		if (result.tourney && result.tourney.regions) {
			for (const region of Object.keys(result.tourney.regions)) {
				const r = result.tourney.regions[region];
				r.rounds.forEach((games, i) => {
					for (const g of games) {
						bracket.push({
							region, round: i + 1, score: g.score, upset: !!g.upset,
							winner: g.winner.team.name, winnerSeed: g.winner.seed,
							loser: (g.winner === g.a ? g.b : g.a).team.name,
							loserSeed: (g.winner === g.a ? g.b : g.a).seed,
						});
					}
				});
			}
		}
		return {
			seed: result.seed,
			season: result.season,
			flavor: result.flavor ? result.flavor.label : null,
			champion: result.tourney ? result.tourney.champion.team.name : null,
			runnerUp: result.tourney && result.tourney.runnerUp ? result.tourney.runnerUp.team.name : null,
			nitChampion: result.tourney && result.tourney.nit && result.tourney.nit.champion
				? result.tourney.nit.champion.name : null,
			poll: result.poll.map((t, i) => ({ rank: i + 1, team: t.name, record: t.w + "-" + t.l })),
			teams,
			bracket,
			board: (result.board || []).map((p) => ({
				rank: p.boardRank, name: p.name, pos: p.newPos, ovr: p.newOvr,
				pot: p.newPot, school: p.proClub || p.newCollege,
				preseason: p.preseasonRank, move: p.stockMove,
				round: p.mockRound, pick: p.mockPick,
			})),
			awards: result.players
				.filter((p) => p.awards && p.awards.length)
				.map((p) => ({ name: p.name, school: p.proClub || p.newCollege, awards: p.awards.slice() })),
			proLeagues: Object.keys(result.proLeagues || {}).map((name) => ({
				name,
				champion: result.proLeagues[name].champion
					? result.proLeagues[name].champion.name : null,
				cupChampion: result.proLeagues[name].cup && result.proLeagues[name].cup.champion
					? result.proLeagues[name].cup.champion.name : null,
				table: result.proLeagues[name].table.map((c, i) => ({
					pos: i + 1, club: c.name, w: c.w, l: c.l, relegated: !!c.relegated,
				})),
			})),
		};
	}

	/* The season as a BBGM-shaped league fragment: `teams` and `teamSeasons`
	   in the game's own field names, one conference per college league, plus
	   a `coaches` block this tool defines. exportSeason is a flat report;
	   this is the same programs as records a league file can carry, so a
	   user building a college league in BBGM has the year's standings and
	   staff in the shape the game reads rather than in a CSV. It is a
	   fragment — no players, no schedule — and says so in `format`. */
	function exportLeagueFragment(result) {
		const teams = Object.values(result.teams)
			.filter((t) => t && t.name && t.log)
			.sort((a, b) => a.name.localeCompare(b.name));
		const confs = [];
		const cidOf = {};
		for (const t of teams) {
			if (cidOf[t.conf] === undefined) {
				cidOf[t.conf] = confs.length;
				confs.push({ cid: confs.length, name: t.conf });
			}
		}
		const seen = {};
		const abbrevOf = (name) => {
			let a = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean)
				.map((w) => w[0]).join("").toUpperCase();
			if (a.length < 3) a = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
			let out = a;
			let n = 2;
			while (seen[out]) out = a + n++;
			seen[out] = true;
			return out;
		};
		const season = result.season;
		const out = {
			format: "bbgm-draft-workshop/league-fragment",
			version: 1,
			startingSeason: season,
			confs,
			teams: [],
			teamSeasons: [],
			coaches: [],
		};
		teams.forEach((t, tid) => {
			out.teams.push({
				tid, cid: cidOf[t.conf], did: cidOf[t.conf],
				region: t.name, name: "", abbrev: abbrevOf(t.name),
				pop: 1, stadiumCapacity: 10000,
			});
			out.teamSeasons.push({
				tid, season, won: t.w, lost: t.l, wonConf: t.cw, lostConf: t.cl,
				wonHome: (t.log || []).filter((g) => g.home > 0 && g.won).length,
				lostHome: (t.log || []).filter((g) => g.home > 0 && !g.won).length,
				wonAway: (t.log || []).filter((g) => g.home < 0 && g.won).length,
				lostAway: (t.log || []).filter((g) => g.home < 0 && !g.won).length,
				playoffRoundsWon: t.ncaaSeed ? (t.ncaaWins || 0) : -1,
				// This tool's own fields, prefixed so they cannot collide.
				ncaaSeed: t.ncaaSeed || null, ncaaResult: t.ncaaResult || null,
				nitResult: t.nitResult || null, apRank: t.apRank || null,
			});
			if (t.coach) {
				out.coaches.push({
					tid, name: t.coach.name, tenure: t.coach.tenure,
					philosophy: t.coach.philosophy ? t.coach.philosophy.name || t.coach.philosophy : null,
					style: t.coach.style ? t.coach.style.name : null,
					situation: t.coach.situation || null,
				});
			}
		});
		return out;
	}

	function round2(x) {
		return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
	}

	global.Engine = {
		run, createRunner, exportFile, exportSeason, exportLeagueFragment, buildNote, classYear,
		assignClassYears, inchesFromHgtRating, validateLeagueFile, findSeason, playerKey,
		SIZE_OVERRIDE_KEYS, SURPRISES, DRAFT_EVENTS,
		MAX_CLASS,
		rerollSalt,
		signatureGame, simulateProLeagues, assignRecruiting,
		NOTE_LINES, DEFAULT_NOTE_LINES, PHASES, PRO_GAMES,
	};
})(typeof window !== "undefined" ? window : self);
