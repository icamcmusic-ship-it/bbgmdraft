/* The pipeline: league file in, customised league file (plus a whole simulated
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
	const T = global.TeamsSim;
	const S = global.StatsSim;
	const TN = global.Tournament;
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

	function assignCollege(rng, player, cfg) {
		if (player.college && player.college.trim() !== "") return player.college;
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
					const n = num(Array.isArray(v) && v.length ? v[v.length - 1].value : v);
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
		leagueFile.players.forEach((p, i) => {
			const who = p && (p.firstName || p.lastName)
				? ((p.firstName || "") + " " + (p.lastName || "")).trim()
				: "player #" + i;
			if (!p || typeof p !== "object") { bad.push("player #" + i + " is not an object"); return; }
			if (!Array.isArray(p.ratings) || !p.ratings.length) {
				bad.push(who + " has no ratings");
			} else if (!p.born || !Number.isFinite(Number(p.born.year))) {
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

	/* The stable per-player key every RNG stream and every lock is derived
	   from. */
	function playerKey(p, idx) {
		return Number.isFinite(Number(p && p.pid)) ? String(p.pid) : "idx" + idx;
	}

	/* ------------------------------------------------------------- phase 1 */

	/* Apply a flavour's config bend to the settings the user has left alone.
	   Compared against Config.DEFAULTS key by key: a value the user moved is
	   theirs and is not touched. */
	function applyFlavorConfig(cfg, flavor) {
		const bend = RB.flavorConfig(flavor);
		if (!bend) return cfg;
		const out = Object.assign({}, cfg);
		const D = global.Config.DEFAULTS;
		let moved = false;
		for (const k of Object.keys(bend)) {
			if (cfg[k] !== D[k]) continue;
			out[k] = bend[k];
			moved = true;
		}
		return moved ? out : cfg;
	}

	function phaseBuild(state) {
		const { leagueFile } = state;
		const rng = state.rng;
		const season = leagueFile.startingSeason;

		/* This year's flavour, drawn before anything is built because some
		   flavours bend the class itself and not only its archetype mix.

		   "A weak year", "one-and-done heavy" and "a transfer-portal class" are
		   the things a draft class is actually remembered as, and none of them
		   is expressible as a tilt on archetype weights: they are statements
		   about how good the top of the class is, how old it is, and how it got
		   where it is. So a flavour carries a config bend, applied here.

		   A user's own setting always wins. The bend is applied only to
		   settings still sitting at their default, so a flavour moves what the
		   user has not decided and never overrules what they have. */
		const flavor = RB.pickFlavor(rng.child("flavor"), state.cfg);
		state.flavor = flavor;
		const cfg = applyFlavorConfig(state.cfg, flavor);
		state.effectiveCfg = cfg;
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
				age: (p.draft && Number.isFinite(p.draft.year) ? p.draft.year : season) -
					Number(p.born.year),
				draftRound: p.draft && Number.isFinite(p.draft.round) ? p.draft.round : null,
				draftPick: p.draft && Number.isFinite(p.draft.pick) ? p.draft.pick : null,
				origCollege: p.college,
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
		assignClassYears(players, cfg, rng.child("classyears"), ageSd >= 0.75);

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
					rng.child("college:" + p.key + rerollSalt(p, "school")), p.src, cfg);
			p.collegeChanged = p.newCollege !== p.origCollege;
			// Professional (a EuroLeague club) as against amateur (DII, an NBA
			// Academy). The UI tags the two differently and the award bar
			// scales with it.
			p.leaguePro = !!C.NON_NCAA[p.newCollege] && C.NON_NCAA[p.newCollege].pro;
			p.nonNcaa = !!C.NON_NCAA[p.newCollege];
		}

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
			const prng = rng.child("build:" + p.key + rerollSalt(p, "build"));
			const targetOvr = Number.isFinite(ov.ovr)
				? clamp(Math.round(ov.ovr), 0, 100)
				: (curve ? curve[i] : p.origOvr);
			// The raw ovr->pot gap, before any of the potential dials. This is
			// what the college season is simulated off (see talentPot), so
			// moving "Potential bias" never re-simulates a game.
			let gap = Math.max(1, p.origPot - p.origOvr);
			if (curve) gap = prng.truncNormal(24, 8, 2, 55);

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
				state.archetypePool);
			p.newRatings = built.ratings;
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
		assignRecruiting(players, rng.child("recruiting"));
		state.surprises = assignSurprises(players, rng.child("surprises"), cfg);
		return state;
	}

	/* ------------------------------------------------------------ surprises */

	/* Every class gets two to four forced anomalies.

	   The class-level knobs were flavour and nothing else, and a class made
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
				p.backstory = "did not play organised basketball until junior college";
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
					"point guard", "the wing", "the four", "centre",
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
	];

	function assignSurprises(players, rng, cfg) {
		const budget = clamp(
			cfg && cfg.surpriseBudget !== undefined ? cfg.surpriseBudget : 4, 0, 10);
		if (!budget || !players.length) return [];
		const n = Math.max(0, Math.round(rng.uniform(budget - 1, budget + 1)));
		const used = new Set();
		const kinds = SURPRISES.slice();
		const out = [];
		for (let i = 0; i < n && kinds.length; i++) {
			const kind = rng.weighted(kinds);
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
		order.forEach((p, i) => {
			const r = rng.child("rec:" + p.key);
			const prestige = C.prestige(p.newCollege);
			// Recruiting rank blends where the player actually is in the class
			// with how good his program is: blue bloods get the blue-chippers.
			const base = (i / n) * 100;
			const pull = (60 - prestige) * 0.28;
			const rank = clamp(Math.round(base + pull + r.normal(0, 14)), 1, 320);
			const stars = rank <= 8 ? 5 : rank <= 40 ? 4 : rank <= 130 ? 3 : 2;
			p.recruiting = {
				rank,
				stars,
				// A transfer was recruited somewhere else; a freshman was
				// recruited here.
				committed: (p.transfer && p.transfer.from) || p.newCollege,
			};
		});
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
			// The draft-year games-played mean is 33.5 against a ~35-game
			// schedule, so a bit over half a class misses something.
			if (r.random() >= 0.54 * rate) continue;
			const hurt = r.random() < 0.55 * rate;
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
		/* The EFFECTIVE config, which is the one the flavour bent. The
		   narrative flavours ("the year everybody got hurt", "the year the
		   blue bloods fell over") move settings this phase reads —
		   injuryRate, the realignment rate, the down-year count — and reading
		   state.cfg here would have silently discarded every one of them.
		   Safe against the phase cache: the flavour is drawn in the build
		   phase, so anything that changes it re-runs this phase too. */
		const cfg = state.effectiveCfg || state.cfg;
		const rng = state.rng;
		const bySchool = {};
		for (const p of state.players) {
			if (p.nonNcaa) continue;
			(bySchool[p.newCollege] = bySchool[p.newCollege] || []).push(p);
		}
		state.bySchool = bySchool;
		assignAvailability(state.players, rng.child("availability"), cfg);
		const teams = T.buildPrograms(bySchool, rng.child("programs"), cfg);
		/* buildPrograms returns the season's realignment alongside the teams;
		   lift it off before anything iterates the map. */
		state.realignment = teams.__realignment || [];
		delete teams.__realignment;
		T.applyOutages(teams);
		T.simulateRegularSeason(teams, cfg, rng.child("season"));
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
		return state;
	}

	/* ------------------------------------------------------------- phase 3 */

	const POSTSEASON_KEYS = [
		"ctW", "inConfTourney", "confTourneyChamp", "confRegularChamp", "bid",
		"ncaaSeed", "ncaaRegion", "ncaaResult", "ncaaWins", "ffWin", "apRank",
		"nitBid", "nitWins", "nitResult", "nitChamp",
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
		// narrative flavours move upsetFactor.
		const { teams } = state;
		const cfg = state.effectiveCfg || state.cfg;
		const rng = state.rng;
		resetPostseason(teams);
		state.confTourneys = T.simulateConferenceTournaments(teams, cfg, rng.child("conftourney"));
		state.poll = TN.apPoll(teams, 25);
		state.tourney = TN.simulate(teams, cfg, rng.child("ncaa"));
		// Chronological order and full records, now that March has happened.
		T.finalizeSchedule(teams);
		return state;
	}

	/* ------------------------------------------------------------- phase 4 */

	function phaseStats(state) {
		const { cfg, teams, bySchool } = state;
		const statRng = state.rng.child("stats");
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
		const classRef = prospectComps.length > 0
			? S.TUNING.PROSPECT_COMP_SCALE * Math.max(0,
				S.TUNING.PROSPECT_COMP_BASE - (prospectComps.reduce((a, b) => a + b, 0) / prospectComps.length))
			: 0;

		/* What each program's opponents actually looked like defensively. This
		   is the channel that lets a conference of rim protectors hold everyone
		   under their season rim percentage — before it, team defence affected
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
				classRef,
			}, cfg, statRng.child(school));
		}
		void bySchool;

		// Pro / DII players: a real club in a real league table.
		state.proLeagues = simulateProLeagues(state.players, cfg, statRng.child("pro"));

		// Per-game logs. signatureGame already fabricated one of these and threw
		// it away; keeping it costs nothing and buys season highs, 20-point-game
		// counts, streaks, an injury with a reason, and a game log tab.
		const logRng = state.rng.child("gamelog");
		for (const p of state.players) {
			const home = p.nonNcaa ? p.proTeam : teams[p.newCollege];
			p.gameLog = S.gameLog(p, home, logRng.child("gl:" + p.key));
			p.signature = p.gameLog ? p.gameLog.best : null;
		}
		buildPriorSeasons(state.players, state.season, state.rng.child("prior"),
			teams, cfg, classRef);
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
	   apply), in a rotation rebuilt at his programme's level for that year.
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
		const room = Math.max(2, (p.newPot || p.newOvr) - p.newOvr);
		const step = 2.6 + 0.32 * room;
		return clamp(Math.round(p.newOvr - step * Math.pow(i, 0.85)), 8, 90);
	}

	/* One prior season, simulated. Returns a stat line or null. */
	function simulatePriorSeason(p, i, teams, season, cfg, rng, classRef) {
		if (!p.buildCleanBase || !RB.resolveTo) return null;
		/* The rotation is built at his CURRENT programme's level even when the
		   row names the school he transferred from, because that school is a
		   string in a biography and not a simulated programme — a JUCO, "a Big
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
		/* A rotation rebuilt at the programme's level for that year, with the
		   men he was BEHIND actually on it.

		   Without them a freshman year came out better than the draft year:
		   nine synthesised role players leave the one real prospect all the
		   minutes and all the shots, so a 45-overall sophomore's freshman
		   season read 32 minutes and 15 points and his actual sophomore season
		   read 32 and 13. The thing that makes a freshman year a freshman year
		   is not a scalar on his production, it is the senior in front of him,
		   and that senior is cheap to put on the floor. Fewer of them each year
		   as he becomes the one they are behind. */
		const level = clamp((home.level || 50) + rng.normal(0, 3), 5, 99);
		const mine = T.prospectTalent(younger.newOvr, p.newPot || younger.newOvr);
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
			classRef: classRef,
		}, cfg, rng.child("sim"));
		return younger.stats ? { line: younger.stats, ovr: younger.newOvr } : null;
	}

	function buildPriorSeasons(players, season, rng, teams, cfg, classRef) {
		const simulate = !cfg || cfg.priorSeasons !== "reconstruct";
		for (const p of players) {
			p.priorSeasons = null;
			const n = priorYears(p.classYear);
			if (!n || !p.stats) continue;
			const r = rng.child("prior:" + p.key);
			const rows = [];
			for (let i = n; i >= 1; i--) {
				const sim = simulate && !p.nonNcaa
					? simulatePriorSeason(p, i, teams, season, cfg, r.child("y" + i), classRef)
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
		}
	}

	/* ------------------------------------------------------------- phase 5 */

	/* Potential. Split out because none of it feeds the simulation: moving
	   "Potential bias" or "Potential spread" should recompute two numbers, not
	   re-play a season. */
	function phasePot(state) {
		const { cfg } = state;
		const rng = state.rng.child("pot");
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
			factors.role = RB.potFromRole(p.stats, p.classYear);
			factors.bias = bias;
			factors.noise = prng.normal(0, spread * 0.35);
			factors.total = factors.arch + factors.age + factors.ageClass +
				factors.touch + factors.frame + factors.role;
			p.potFactors = factors;
			const gap = Math.max(1, p.baseGap + bias + factors.total + factors.noise);
			p.newPot = clamp(Math.round(p.newOvr + gap), Math.min(p.newOvr + 1, 100), 100);
		}
		return state;
	}

	/* ------------------------------------------------------------- phase 6 */

	function phaseAwards(state) {
		state.ranked = AW.assign(state.players, state.teams, state.tourney,
			state.cfg, state.rng.child("awards"));
		return state;
	}

	/* ------------------------------------------------------------- phase 7 */

	/* The draft board. The file already carries draft.round and draft.pick and
	   the tool used them as nothing but a class-order proxy — a whole feature
	   sitting in data that was already there. This turns the simulated season
	   into a mock draft, with a preseason board to move against, so "helped his
	   stock in March" is something the tool can actually say. */
	function phaseStock(state) {
		const players = state.players;
		const rng = state.rng.child("stock");
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
			],
			run: phaseBuild,
		},
		// injuryRate is read by assignAvailability, which runs here — before a
		// game is played, which is the whole point of it.
		{
			name: "regular",
			deps: ["pace", "scoringEnv", "injuryRate", "realignmentRate",
				"bluebloodDownYears", "midMajorLift"],
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
			deps: ["awardStrictness", "confAwardStrictness", "proAwardStrictness"],
			run: phaseAwards,
		},
		{ name: "stock", deps: [], run: phaseStock },
		{ name: "notes", deps: ["noteLines"], run: phaseNotes },
	];

	function phaseKey(phase, cfg) {
		const parts = [];
		for (const k of phase.deps) parts.push(k + "=" + JSON.stringify(cfg[k]));
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
			/* Re-derive the flavour's config bend against the NEW settings.

			   Later phases read `effectiveCfg` because the narrative flavours
			   bend settings those phases own (injuryRate, upsetFactor, the
			   realignment rate). `effectiveCfg` was written once, in the build
			   phase — so a warm re-run that skipped the build phase left the
			   postseason reading the previous run's upset factor, and a staged
			   run stopped matching a cold one. The bend itself is a pure
			   function of the flavour and the settings, so it is cheap to
			   recompute here whether or not the build phase runs. */
			if (state.flavor !== undefined) {
				state.effectiveCfg = applyFlavorConfig(effective, state.flavor);
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
				tourney: state.tourney,
				confTourneys: state.confTourneys,
				ranked: state.ranked,
				proLeagues: state.proLeagues,
				board: state.board,
				risers: state.risers,
				fallers: state.fallers,
				flavor: state.flavor,
				// The builds this class was drawn from, and the anomalies it
				// was given, so the UI can say what makes this class this one.
				archetypePool: state.archetypePool
					? state.archetypePool.map((a) => a.name) : null,
				surprises: state.surprises || [],
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
					p.proDeal = "in the academy programme";
				} else if (crng.random() < 0.30) {
					const parent = ranked[Math.floor(crng.random() * Math.min(4, ranked.length))];
					p.proDeal = parent && parent !== club
						? "on loan from " + parent.name
						: "on a development contract";
				} else {
					p.proDeal = "on a first-team contract";
				}
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

			for (const c of clubs) {
				if (!c.prospects.length) continue;
				const idx = table.indexOf(c);
				c.finish = c.leagueChamp ? "league champions"
					: idx < Math.min(8, table.length) ? "made the playoffs"
					: c.relegated ? "relegated"
					: "missed the playoffs";
				if (c.cupChamp) c.finish += ", cup winners";
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
		["team", "School / club, conference, class year"],
		["path", "How he got here (recruiting, transfer, redshirt)"],
		["record", "Team record and postseason result"],
		["stats", "Season stat line"],
		["shooting", "Shooting splits and TS%"],
		["advanced", "Usage, rebounds split, fouls"],
		["defense", "Defensive line (contests, deflections, charges, DRtg)"],
		["signature", "Best game of the season"],
		["highs", "Season highs, 20-point games, streaks"],
		["march", "Postseason splits"],
		["injury", "Games missed and why"],
		["coach", "Who coaches him, and what kind of year the staff is having"],
		["archetype", "Archetype label"],
		["awards", "Honours"],
		["stock", "Draft stock and mock position"],
	];
	const DEFAULT_NOTE_LINES = ["team", "stats", "shooting", "signature", "awards"];

	function buildNote(p, teams, season, cfg, state) {
		const s = p.stats;
		const lines = [];
		const want = (cfg && Array.isArray(cfg.noteLines) ? cfg.noteLines : DEFAULT_NOTE_LINES);
		const on = (k) => want.indexOf(k) !== -1;
		const team = p.nonNcaa ? p.proTeam : teams[p.newCollege];

		if (on("team")) {
			if (p.nonNcaa) {
				lines.push((p.proClub ? p.proClub + " (" + p.newCollege + ")" : p.newCollege) +
					" · " + p.classYear + (p.proDeal ? " · " + p.proDeal : ""));
			} else {
				lines.push(p.newCollege + " (" + team.conf +
					// A programme that moved leagues this year says so, because
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
			if (p.transfer) {
				// A walk-on turned starter has no previous school to name.
				bits.push(p.transfer.from
					? p.transfer.kind + " from " + p.transfer.from
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
				"Defence: " + n1(s.cspg) + " contests, " + n1(s.deflpg) +
				" deflections, " + n1(s.chgpg) + " charges drawn · DRtg " +
				s.drtg.toFixed(1),
			);
		}
		if (on("signature") && p.signature && p.signature.pts > 0) {
			const g = p.signature;
			lines.push(
				"Season high: " + g.pts + " points" +
				(g.reb >= 8 ? " and " + g.reb + " rebounds" :
					g.ast >= 7 ? " and " + g.ast + " assists" : "") +
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
			if (gl.twentyPointGames) bits.push(gl.twentyPointGames + " 20-point games");
			if (gl.doubleDoubles) bits.push(gl.doubleDoubles + " double-doubles");
			if (gl.tripleDoubles) bits.push(gl.tripleDoubles + " triple-doubles");
			if (gl.hotStreak) {
				bits.push("best stretch: " + gl.hotStreak.games + " straight at " +
					n1(gl.hotStreak.ppg) + " a night");
			}
			lines.push(bits.join(" · "));
		}
		if (on("march") && p.gameLog && p.gameLog.postseason) {
			const ps = p.gameLog.postseason;
			lines.push("Postseason: " + ps.gp + " games, " + n1(ps.ppg) + " PPG, " +
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
				(team.downYear ? " · a down year for the programme" : ""));
		}
		if (on("archetype") && p.archetype) lines.push("Profile: " + p.archetype);
		if (on("awards") && p.awards && p.awards.length) {
			// Awards arrive sorted by prestige. A genuine star can collect a
			// dozen honours across the national, conference and tournament
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

	/* Produce the modified BBGM draft class file. */
	function exportFile(result) {
		const src = result.leagueFile;
		// Match by array position, not pid: files with duplicate pids would
		// otherwise silently give every duplicate the same rebuilt ratings.
		const byIdx = result.players;

		const players = src.players.map((orig, i) => {
			const p = byIdx[i] && byIdx[i].src === orig ? byIdx[i] : null;
			if (!p) return orig;
			const out = JSON.parse(JSON.stringify(orig));
			out.college = p.newCollege;
			const ov = p.override || {};
			if (ov.name && String(ov.name).trim()) {
				const parts = String(ov.name).trim().split(/\s+/);
				out.firstName = parts.shift();
				out.lastName = parts.join(" ");
			}
			// The README promises hgt/weight are rewritten only when Vary size
			// is on or the source file lacked them; the old code wrote both
			// unconditionally, adding keys to files that never had them.
			const sized = result.cfg.varySize || Number.isFinite(ov.hgtInches) ||
				Number.isFinite(ov.weight);
			if (sized || !Number.isFinite(orig.hgt)) out.hgt = p.newHgtInches;
			if (sized || !Number.isFinite(orig.weight)) out.weight = p.newWeight;
			const last = out.ratings.length - 1;
			const r = out.ratings[last];
			for (const k of BB.RATING_KEYS) r[k] = p.newRatings[k];
			r.ovr = p.newOvr;
			r.pot = p.newPot;
			r.pos = p.newPos;
			r.skills = p.newSkills.slice();
			out.draft = Object.assign({}, out.draft, {
				ovr: p.newOvr, pot: p.newPot, skills: p.newSkills.slice(),
			});
			out.note = p.note;
			out.noteBool = 1;
			return out;
		});

		return Object.assign({}, src, { players });
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
			runnerUp: result.tourney ? result.tourney.runnerUp.team.name : null,
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

	function round2(x) {
		return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
	}

	global.Engine = {
		run, createRunner, exportFile, exportSeason, buildNote, classYear,
		assignClassYears, inchesFromHgtRating, validateLeagueFile, findSeason, playerKey,
		MAX_CLASS,
		rerollSalt,
		signatureGame, simulateProLeagues, assignRecruiting,
		NOTE_LINES, DEFAULT_NOTE_LINES, PHASES, PRO_GAMES,
	};
})(typeof window !== "undefined" ? window : self);
