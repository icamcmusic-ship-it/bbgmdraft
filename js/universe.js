/* Universe mode: many draft classes, one continuous world.

   A universe is an ORDERED run over several loaded class files, where each
   season hands state forward to the next: conference membership (so
   realignment has memory), program strength (so a breakout persists rather
   than being redrawn), coaches (so a fired coach is replaced by a named
   first-year hire rather than reappearing), the build-pool memory, and an
   alumni index that lets later seasons refer to earlier ones.

   Everything re-runnable is derived from seeds — the export stores seeds and
   fingerprints, not simulated output, which is what the deterministic RNG
   design buys. */
(function (global) {
	"use strict";

	/* 3: the export carries the timeline itself — the rows, the threads, the
	   records book, the alumni index and the chain's tail — beside the seeds
	   that produced it. A version 1 or 2 file still imports; it simply has
	   nothing to restore a diverged season from. See exportUniverse. */
	const VERSION = 3;

	/* WHICH ENGINE BUILT IT.

	   `version` is the shape of the export file. ENGINE_REV is the shape of
	   the WORLD: bump it whenever a change to the simulation would make the
	   same seeds replay into a different season. An import compares it against
	   the per-season result fingerprints below and can then say "season 2034
	   diverged — this universe was built on an older engine" instead of
	   silently handing back another world under the same name. */
	const ENGINE_REV = 1;

	/* THE ONE DEFINITION OF PLAYER OF THE YEAR.

	   There used to be two in this file: alumniOf read Awards.NATIONAL_POY
	   plus the consensus row, and summarize — thirty lines below it — tested
	   /^(Naismith Trophy|John R\. Wooden Award)$/. So the timeline's POY
	   column and the alumni index could disagree about the same season, and a
	   trophy added to the awards module appeared in one and not the other. */
	function nationalPOYSet() {
		return new Set((global.Awards && global.Awards.NATIONAL_POY || [])
			.map((a) => a.name)
			.concat(["Consensus National Player of the Year"]));
	}

	function isNationalPOY(p, set) {
		return (p.awards || []).some((a) => set.has(a));
	}

	/* THE SEED FOR ONE SEASON OF A CHAIN.

	   It used to be baseSeed + "#" + (d.season || k), which is a seed keyed on
	   a number the FILE claims rather than on the file. Two files both saying
	   startingSeason 2031 — which validate() already warns about — drew the
	   identical seed and therefore the identical world, twice, and the chain
	   said nothing. The fingerprint is the file's identity and is what the
	   export already stores per season; the index and the season come along so
	   that the same file used twice in one chain is still two seasons. */
	function seedFor(baseSeed, index, season, fingerprint) {
		return String(baseSeed) + "#" + index + ":" +
			(Number.isFinite(season) ? season : "?") +
			(fingerprint ? ":" + String(fingerprint).slice(0, 12) : "");
	}

	/* A CHEAP HASH OF WHAT A SEASON PRODUCED.

	   Seeds and fingerprints say what went IN. This says what came out, so an
	   import that replays a universe can tell that it got a different world
	   rather than assuming determinism held across an engine change. FNV-1a
	   over a short, stable digest — champion, POY, the top of the board, the
	   coaching-change count — not over the whole result, because the point is
	   a value that changes when the season changes and not when an unrelated
	   field is added to a player. */
	function hashString(str) {
		let h = 0x811c9dc5;
		for (let i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i);
			h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
		}
		return ("00000000" + h.toString(16)).slice(-8);
	}

	function resultFingerprint(res) {
		if (!res) return null;
		const poySet = nationalPOYSet();
		const poy = (res.players || []).filter((p) => isNationalPOY(p, poySet))[0];
		const board = (res.players || []).slice()
			.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999))
			.slice(0, 10).map((p) => p.key || p.name).join(",");
		const t = res.tourney;
		return hashString([
			t && t.champion ? t.champion.team.name : "-",
			poy ? poy.key || poy.name : "-",
			board,
			(res.coachingCarousel || []).length,
		].join("|"));
	}

	/* --------------------------------------------------------- validation

	   A 50-file batch that fails opaquely at file 37 is unusable, so every
	   file gets its own diagnostics and a bad one is rejected BY NAME while
	   the rest run. */
	function validate(files) {
		const rows = files.map((f, i) => {
			const row = {
				index: i, name: f.name, ok: true, errors: [], warnings: [],
				season: null, players: 0,
			};
			let v;
			try {
				v = global.Engine.validateLeagueFile(f.data);
				row.season = v.season;
				row.warnings = (v.warnings || []).slice();
				row.players = (f.data.players || []).length;
			} catch (e) {
				row.ok = false;
				row.errors.push(e && e.message ? e.message : String(e));
				return row;
			}
			if (!row.players) {
				row.ok = false;
				row.errors.push("no players in the file");
			}
			/* The cap is Engine.MAX_CLASS, read rather than retyped: it used
			   to be the literal 250 here and a named constant there, which is
			   two numbers that have to be changed together and one place that
			   says so. */
			const cap = global.Engine.MAX_CLASS;
			if (row.players > cap) {
				/* THE SAME RULE AS THE STANDALONE PATH.

				   Engine.validateLeagueFile warns about an oversized file and
				   offers `classPids` — the players drafted in the file's own
				   season — so a whole-league export dropped on the page loads
				   as the class it contains. This used to be a hard rejection
				   with no offer, so the same file was accepted by one path and
				   refused by name by the other. Now the offer travels with the
				   row and the chain runs the subset (see runUniverse); a file
				   with no recoverable class is still refused, because fifty
				   seasons of five thousand men is not a universe anybody
				   waits for. */
				if (v.classPids && v.classPids.length) {
					row.classPids = v.classPids.slice();
					row.classCount = v.classCount;
					row.players = v.classCount;
					row.warnings.push(v.total + " players in the file — only the " +
						v.classCount + " drafted in " + v.season + " run as this season's class");
				} else {
					row.ok = false;
					row.errors.push(row.players + " players — above the " + cap +
						" cap, and none of them are drafted in " + v.season +
						" so no class could be picked out of the file");
				}
			}
			return row;
		});
		// Chronology: seasons should be distinct and orderable. Two files
		// claiming the same startingSeason is almost always the same export
		// loaded twice.
		const bySeason = {};
		for (const r of rows) {
			if (!r.ok || r.season === null) continue;
			if (bySeason[r.season] !== undefined) {
				r.warnings.push("same startingSeason (" + r.season + ") as " +
					rows[bySeason[r.season]].name + " — the later file runs second");
			} else {
				bySeason[r.season] = r.index;
			}
		}
		/* GAPS, not only duplicates.

		   2025, 2026, 2031 is three files and six years, and the carry-over
		   treats the hole as one year passing: coaches age by one, program
		   levels drift one step, a star returner advances one class year. The
		   chain ages the carry across a gap now (see ageCarry), and the file
		   list says where a gap is so the timeline is not quietly wrong about
		   how much time went by. */
		const ordered = rows.filter((r) => r.ok && Number.isFinite(r.season))
			.sort((a, b) => a.season - b.season);
		for (let i = 1; i < ordered.length; i++) {
			const gap = ordered[i].season - ordered[i - 1].season;
			if (gap > 1) {
				ordered[i].warnings.push(gap - 1 + " season" + (gap > 2 ? "s" : "") +
					" between " + ordered[i - 1].season + " and " + ordered[i].season +
					" with no file — the carry-over is aged across the gap");
			}
		}
		// Cross-file duplicate pids: legitimate between separate BBGM exports
		// (each starts from 0), so a warning, not a rejection — but worth
		// saying, because identical pid SETS usually mean a duplicated file.
		/* THE SAME MEN, NOT THE SAME NUMBERS.

		   This compared pid sets, and every BBGM export numbers its players
		   from zero — so any two files of the same size (a 70-man 2025 class
		   and a 70-man 2026 class) had "identical pid sets" and were reported
		   as a duplicate. What identifies a class is who is in it: the file's
		   own fingerprint when the caller has one, and otherwise the set of
		   names, births, draft years and ratings, which two different classes
		   do not share. */
		const who = rows.map((r) => {
			if (!r.ok) return null;
			const ps = files[r.index].data.players || [];
			if (!ps.length) return null;
			const ids = ps.map((p) => [
				p.name || ((p.firstName || "") + " " + (p.lastName || "")).trim(),
				p.born && p.born.year, p.born && p.born.loc, p.draft && p.draft.year,
				/* The ratings too: generated names repeat ("Player 7") and a
				   class's ratings are what nobody else's share. */
				Array.isArray(p.ratings) && p.ratings.length
					? JSON.stringify(p.ratings[p.ratings.length - 1]) : "",
			].join("|")).sort();
			return hashString(ids.join(";")) + "|" + ps.length;
		});
		const fpSig = rows.map((r) => (r.ok && files[r.index].fingerprint) || null);
		for (let i = 0; i < rows.length; i++) {
			for (let j = i + 1; j < rows.length; j++) {
				if ((fpSig[i] && fpSig[i] === fpSig[j]) || (who[i] && who[i] === who[j])) {
					rows[j].warnings.push("the same players as " + rows[i].name +
						" — looks like the same class loaded twice");
				}
			}
		}
		return rows;
	}

	/* ------------------------------------------------------- carry-over */

	function stripCoach(c) {
		if (!c) return null;
		return {
			name: c.name, tenure: c.tenure, philosophy: c.philosophy,
			style: c.style, dev: c.dev, usageBias: c.usageBias,
			// Age, so the same man can get a year older and eventually retire.
			defEmphasis: c.defEmphasis, rep: c.rep, age: c.age,
		};
	}

	/* The named star returners on a roster, with what the next season needs
	   to bring them back as the same men. See buildPrograms in js/teams.js.

	   `hgt`, `slotType` and `endurance` travel too: a returner used to be
	   handed back as a name and a talent and then poured into whatever filler
	   slot the new roster drew, so a 6'11" center could come back as a guard.
	   The build side reads them where it has them. */
	function returnersOf(t) {
		const out = [];
		for (const m of t.members || []) {
			if (!m.filler || !m.starReturner || !m.name) continue;
			const slotIndex = Number(String(m.slot || "").replace(/^roster/, ""));
			out.push({
				name: m.name, starReturner: m.starReturner, classYear: m.classYear,
				talent: m.talent, slotIndex: Number.isFinite(slotIndex) ? slotIndex : 0,
				hgt: Number.isFinite(m.hgt) ? m.hgt : null,
				slotType: m.slotType || null,
				endurance: Number.isFinite(m.endurance) ? m.endurance : null,
			});
		}
		return out;
	}

	/* PROGRAM PRESTIGE DRIFT.

	   A program's level is redrawn every season from its static prestige and
	   blended 62/38 with last season's (see buildPrograms), so the world had
	   memory of ONE year: a blue blood that went 12-20 for a decade was back
	   near its prior every November, and a mid-major that won three titles
	   in five years was dragged back to where the prestige table put it in
	   2025. `prestigeDelta` is the slow variable underneath: it moves with
	   how a season went against what that program expects, decays toward
	   zero (so it is mean-reverting and a single fluke fades), and is capped,
	   so a dynasty is worth a few levels and not a new tier table. It is a
	   pure function of the finished season, so a replay draws the same one.

	   How it reaches the sim: the carried level is what buildPrograms blends
	   at 0.38. Adding PRESTIGE_GAIN x delta to it — 0.62 / 0.38 — makes the
	   steady-state shift of the season's level exactly `delta`. */
	const PRESTIGE_CAP = 8;
	const PRESTIGE_DECAY = 0.85;
	const PRESTIGE_GAIN = 0.62 / 0.38;

	function priorPrestige(name, fallback) {
		const C = global.Colleges;
		if (C && typeof C.prestigeOrLowMajor === "function") {
			const p = C.prestigeOrLowMajor(name);
			if (Number.isFinite(p)) return p;
		}
		return Number.isFinite(fallback) ? fallback : 50;
	}

	function marchDepth(t) {
		const r = String(t.ncaaResult || "");
		if (/Champion/.test(r)) return 1.3;
		if (/Runner/.test(r)) return 1.0;
		if (!r) return 0;
		return 0.1 + 0.18 * Math.max(0, t.ncaaWins || 0);
	}

	function prestigeStep(d0, t) {
		const games = Math.max(1, (t.w || 0) + (t.l || 0));
		const winPct = (t.w || 0) / games;
		const prestige = priorPrestige(t.name, t.prestige);
		// The same expectation the carousel fires coaches against.
		const expected = Math.min(0.72, Math.max(0.32, 0.35 + 0.0037 * prestige));
		const expMarch = prestige >= 70 ? 0.35 : prestige >= 50 ? 0.15 : 0.03;
		const perf = Math.max(-1.2, Math.min(1.5,
			(winPct - expected) * 3 + (marchDepth(t) - expMarch)));
		const d = (Number.isFinite(d0) ? d0 : 0) * PRESTIGE_DECAY + perf * 0.9;
		return Math.round(Math.max(-PRESTIGE_CAP, Math.min(PRESTIGE_CAP, d)) * 100) / 100;
	}

	/* RIVALRIES.

	   A pair of programmes that keeps meeting in March is a story the
	   timeline could not tell, because a row records the Final Four and not
	   the bracket. The carry accumulates head-to-head between pairs from the
	   team game logs: a pair enters the book the first time it meets in the
	   NCAA tournament, and from then on every game between the two counts.
	   Bounded (RIVALRY_MAX pairs, the ones with the most March meetings and
	   the most recent), because the carry is persisted and exported. Copied
	   rather than mutated: every season's recorded carry-over is a snapshot a
	   resume reads back. */
	const RIVALRY_MAX = 400;

	function rivalriesStep(prev, res) {
		const out = {};
		for (const k of Object.keys(prev || {})) {
			const e = prev[k];
			if (e) out[k] = Object.assign({}, e, { march: (e.march || []).slice() });
		}
		const season = res && Number.isFinite(res.season) ? res.season : null;
		const teams = Object.values((res && res.teams) || {})
			.filter((t) => t && t.name && Array.isArray(t.log));
		// Pass one: the pairs that met in March this season.
		for (const t of teams) {
			for (const g of t.log) {
				if (!g || !g.opp || g.stage !== "ncaa" || !(t.name < g.opp)) continue;
				const key = t.name + "|" + g.opp;
				if (!out[key]) out[key] = { a: t.name, b: g.opp, games: 0, aw: 0, bw: 0, march: [] };
				if (Number.isFinite(season)) out[key].march.push(season);
			}
		}
		// Pass two: every game between a pair in the book.
		for (const t of teams) {
			for (const g of t.log) {
				if (!g || !g.opp || !(t.name < g.opp)) continue;
				const e = out[t.name + "|" + g.opp];
				if (!e) continue;
				e.games++;
				if (g.won) e.aw++; else e.bw++;
			}
		}
		const keys = Object.keys(out);
		if (keys.length > RIVALRY_MAX) {
			keys.sort((x, y) => {
				const a = out[x], b = out[y];
				return b.march.length - a.march.length ||
					(b.march[b.march.length - 1] || 0) - (a.march[a.march.length - 1] || 0) ||
					(x < y ? -1 : 1);
			});
			for (const k of keys.slice(RIVALRY_MAX)) delete out[k];
		}
		return out;
	}

	/* THE COACHING CAROUSEL MOVES MEN, NOT ONLY JOBS.

	   A coach "hired away by a bigger program" used to vanish: his school got
	   a first-year hire, and the bigger program that had a vacancy the same
	   April got a freshly generated stranger. When a vacancy exists that
	   season at a program of higher prestige, the coach who was hired away
	   is the one who fills it — the same name, age, reputation and style.
	   Deterministic: hired-away men are taken best season first, vacancies
	   best program first, and each man takes the best open job above his
	   own. An NBA departure stays a departure. */
	const VACANCY = { "fired": 1, "retired": 1, "not retained": 1, "fired in-season": 1 };

	function carouselMoves(res) {
		const car = (res && res.coachingCarousel) || [];
		const pct = (c) => (c.w || 0) / Math.max(1, (c.w || 0) + (c.l || 0));
		const away = car.filter((c) => c && c.school && c.reason === "hired away" &&
			!/NBA/.test(String(c.to || "")))
			.sort((a, b) => pct(b) - pct(a) || (a.school < b.school ? -1 : 1));
		const open = car.filter((c) => c && c.school && VACANCY[c.reason])
			.map((c) => ({ school: c.school, p: priorPrestige(c.school) }))
			.sort((a, b) => b.p - a.p || (a.school < b.school ? -1 : 1));
		const taken = new Set();
		const moves = {};
		for (const c of away) {
			const from = priorPrestige(c.school);
			const job = open.filter((v) => !taken.has(v.school) && v.school !== c.school &&
				v.p > from)[0];
			if (!job) continue;
			taken.add(job.school);
			moves[job.school] = c.school;
		}
		return moves;
	}

	/* What one finished season hands the next.

	   `prev` is the carry this season was handed, and it is read for the
	   things that accumulate across seasons: the running title count (which
	   is what makes recruiting momentum possible — see assignCollege in
	   js/engine.js), the prestige drift and the rivalry book. A program's
	   banner count is a fact about the world, not about one season, so it has
	   to accumulate — and the alternative, re-deriving it from the timeline
	   rows inside the engine, would make the engine depend on the app's
	   state. */
	function harvest(res, prev) {
		const carry = { confOf: {}, levels: {}, coaches: {}, returners: {},
			champion: null, titles: Object.assign({}, (prev && prev.titles) || {}),
			prestigeDelta: {}, rivalries: rivalriesStep(prev && prev.rivalries, res) };
		if (res.tourney && res.tourney.champion) {
			carry.champion = res.tourney.champion.team.name;
			carry.titles[carry.champion] = (carry.titles[carry.champion] || 0) + 1;
		}
		/* Which programs have a vacancy. Read from the April carousel (a
		   per-program draw over record, prestige, situation, tenure and age),
		   not from the news feed: the feed carried at most one "coaching
		   change" a season out of a budget of seven stories, so a decade of
		   universe used to move about ten jobs across 364 programs.

		   `fired` is a misnomer kept for the shape of the carry object: a
		   retirement and a coach hired away are the same fact to the next
		   season, which is that somebody else is on the sideline. The reason
		   travels beside it so the next season's team page and the news can
		   tell the three apart. */
		const fired = new Set();
		const why = {};
		for (const c of res.coachingCarousel || []) {
			if (!c || !c.school) continue;
			fired.add(c.school);
			why[c.school] = c.reason;
		}
		const moves = carouselMoves(res);
		const prevDelta = (prev && prev.prestigeDelta) || {};
		for (const t of Object.values(res.teams || {})) {
			if (!t || !t.name || !t.log) continue;
			carry.confOf[t.name] = t.conf;
			/* THE PROGRAM'S LEVEL, NOT THE COACHED ONE.

			   `t.level` is the season's level PLUS the coach's situation
			   adjustment (a first-year rebuild, a hot seat), and it was
			   carried and blended back in at 0.38 — so a hot seat that cost
			   a program 2.6 levels cost it again next season, which made the
			   seat hotter, which is a loop and not a program. The situation
			   is a fact about this season's sideline; what persists is the
			   level under it. */
			const adj = t.coach && Number.isFinite(t.coach.levelAdj) ? t.coach.levelAdj : 0;
			const base = Number.isFinite(t.baseLevel) ? t.baseLevel : t.level - adj;
			const d = prestigeStep(prevDelta[t.name], t);
			carry.prestigeDelta[t.name] = d;
			carry.levels[t.name] = Math.max(5, Math.min(99, base + PRESTIGE_GAIN * d));
			carry.coaches[t.name] = {
				coach: stripCoach(t.coach),
				fired: fired.has(t.name),
				reason: why[t.name] || null,
			};
			const ret = returnersOf(t);
			if (ret.length) carry.returners[t.name] = ret;
		}
		/* The men who moved: the vacancy is filled by the coach hired away,
		   carried as a kept coach so buildPrograms brings him back a year
		   older, at tenure one, at his new school. */
		for (const to of Object.keys(moves)) {
			const from = moves[to];
			const was = res.teams && res.teams[from];
			if (!was || !was.coach || !carry.coaches[to]) continue;
			const coach = stripCoach(was.coach);
			coach.tenure = 0;
			coach.movedFrom = from;
			carry.coaches[to] = { coach, fired: false, reason: "hired", from,
				replaced: carry.coaches[to].coach ? carry.coaches[to].coach.name : null };
			if (carry.coaches[from]) carry.coaches[from].hiredBy = to;
		}
		return carry;
	}

	/* CARRY-OVER ACROSS A GAP, AND ACROSS A FAILURE.

	   Two cases produce a season that was never played and a next season that
	   would otherwise inherit a world frozen in time:

	     - a hole in the files (2025, 2026, 2031), which the carry-over used to
	       treat as one year passing;
	     - a season that threw. An error row was pushed and `carry` kept
	       pointing at season k-1, so season k+1 inherited a two-year-old world
	       with no aging at all: coaches did not get a year older, levels did
	       not drift, and a senior star returner was still a junior.

	   Aging the carry synthetically is not the same as simulating the missing
	   years and does not pretend to be. What it does is make the passage of
	   time monotonic: coaches age and the oldest of them leave, program levels
	   regress toward their own mean, and star returners advance a class year
	   and graduate out. `stale` counts the unplayed years so the timeline and
	   the news can say a gap happened. */
	const NEXT_YEAR = { Freshman: "Sophomore", Sophomore: "Junior", Junior: "Senior" };
	const CARRY_RETIRE_AGE = 70;

	function ageCarry(carry, years) {
		if (!carry || !(years > 0)) return carry;
		const out = {
			confOf: Object.assign({}, carry.confOf),
			levels: {}, coaches: {}, returners: {},
			/* NOT the champion from before the gap. `champion` is what the
			   next season's recruiting reads as "the team that just won it"
			   (see assignCollege), and a title five unplayed years ago is not
			   that — it used to hand the pre-gap champion a recruiting boost
			   in a season it had nothing to do with. The banner count keeps
			   the title; the momentum is gone. */
			champion: null,
			titles: Object.assign({}, carry.titles || {}),
			stale: (carry.stale || 0) + years,
			/* The slow variables ride along: prestige drift decays toward
			   zero at its own rate for every year nobody played, and the
			   rivalry book is history and does not age at all. */
			prestigeDelta: {},
			rivalries: carry.rivalries || {},
		};
		if (carry.extrapolatedTitles) {
			out.extrapolatedTitles = Object.assign({}, carry.extrapolatedTitles);
		}
		for (const name of Object.keys(carry.prestigeDelta || {})) {
			out.prestigeDelta[name] = Math.round(carry.prestigeDelta[name] *
				Math.pow(PRESTIGE_DECAY, years) * 100) / 100;
		}
		/* Regress toward THIS field's own mean, not a literal.

		   The target was a hardcoded 55, which is only the middle of the range
		   in a universe that happens to look like the default one. A universe
		   built at midMajorLift 12, or one whose only carried programs are the
		   twenty-four blue bloods, has a mean nowhere near 55, and regressing
		   it toward 55 across a gap does not "let the levels decay" — it drags
		   the whole field toward a number from another world, upward for a
		   weak field and downward for a strong one. The field's own mean is
		   the only fixed point that leaves a gap-year universe recognisable as
		   itself. The 55 survives as the fallback for an empty carry, where
		   there is no field to take a mean of. */
		const names = Object.keys(carry.levels || {});
		const fieldMean = names.length
			? names.reduce((a, n) => a + carry.levels[n], 0) / names.length
			: 55;
		for (const name of names) {
			// One step a year: an unplayed decade should not preserve a 94
			// that nobody defended.
			let lvl = carry.levels[name];
			for (let y = 0; y < years; y++) lvl = lvl + (fieldMean - lvl) * 0.18;
			out.levels[name] = lvl;
		}
		for (const name of Object.keys(carry.coaches || {})) {
			const rec = carry.coaches[name];
			if (!rec || !rec.coach) { out.coaches[name] = rec; continue; }
			const coach = Object.assign({}, rec.coach);
			coach.age = (coach.age || 45) + years;
			coach.tenure = (coach.tenure || 1) + years;
			/* Nobody coaches to 70 in the dark. A man who would have aged out
			   during the gap leaves a vacancy, which is what the next season
			   needs to know rather than a 78-year-old in year twenty-two. */
			const gone = coach.age >= CARRY_RETIRE_AGE;
			out.coaches[name] = gone
				? { coach: rec.coach, fired: true, reason: "retired" }
				: { coach, fired: !!rec.fired, reason: rec.reason || null };
		}
		for (const name of Object.keys(carry.returners || {})) {
			const kept = [];
			for (const r of carry.returners[name]) {
				let year = r.classYear;
				let ok = true;
				for (let y = 0; y < years; y++) {
					year = NEXT_YEAR[year];
					if (!year) { ok = false; break; }
				}
				if (!ok) continue;
				kept.push(Object.assign({}, r, { classYear: year }));
			}
			if (kept.length) out.returners[name] = kept;
		}
		return out;
	}

	/* THE COACHING TREE.

	   A first-year hire already replaces a fired coach with a name (see
	   buildPrograms), and nothing recorded where he came from. Every new hire
	   is attributed here to a head coach who was working in the universe the
	   season before — deterministically, off the universe seed, so a replay
	   produces the same tree — and after a decade "Marcus Hillard's tree now
	   holds six head jobs" falls out of state the chain was already carrying.

	   Kept out of the engine on purpose: a mentor is a fact about the
	   TIMELINE, and a single class file run on its own has no tree. */
	/* IDEMPOTENT, and it never trusts the result it is handed.

	   It used to skip any team whose coach already carried a `mentor`, as a
	   marker for "already processed" — but a warm runner hands back the SAME
	   team objects when no phase before the awards had to re-run, so the
	   second chain run after an awards-only change found every mentor set,
	   skipped every hire, and recorded a coaching tree with nothing in it.
	   Each step now recomputes every hire from the carry it was handed and
	   the seed (so the same inputs give the same mentor whether the team
	   object is fresh or cached), overwrites what is there, clears a stale
	   one, and returns a NEW tree rather than appending to the caller's —
	   which is what lets a resume hand it a pruned copy of the held seasons'
	   tree (see pruneCoachTree). */
	function coachTreeStep(tree, prevCarry, res, season, baseSeed) {
		tree = tree
			? { by: {}, hires: (tree.hires || []).slice() }
			: { by: {}, hires: [] };
		rebuildTreeIndex(tree);
		const pool = [];
		for (const name of Object.keys((prevCarry && prevCarry.coaches) || {})) {
			const c = prevCarry.coaches[name];
			if (c && c.coach && c.coach.name) {
				pool.push({ name: c.coach.name, school: name, rep: c.coach.rep || 0 });
			}
		}
		pool.sort((a, b) => (b.rep - a.rep) || (a.name < b.name ? -1 : 1));
		for (const t of Object.values(res.teams || {})) {
			if (!t || !t.coach) continue;
			if (!t.coach.replaced || !pool.length) {
				if (t.coach.mentor && !t.coach.replaced) {
					delete t.coach.mentor;
					delete t.coach.mentorSchool;
				}
				continue;
			}
			/* A deterministic pick weighted toward the men with a reputation:
			   assistants come off good staffs. rng is the shared seeded RNG so
			   this replays; the string is the one fact that identifies the
			   hire. */
			const r = new global.BBGMRng.Rng(
				String(baseSeed) + "|tree|" + season + "|" + t.name);
			const idx = Math.min(pool.length - 1,
				Math.floor(Math.pow(r.random(), 1.7) * pool.length));
			const mentor = pool[idx];
			if (!mentor || mentor.name === t.coach.name) {
				delete t.coach.mentor;
				delete t.coach.mentorSchool;
				continue;
			}
			t.coach.mentor = mentor.name;
			t.coach.mentorSchool = mentor.school;
			const hire = { season, coach: t.coach.name, school: t.name,
				mentor: mentor.name, mentorSchool: mentor.school };
			tree.hires.push(hire);
			if (!tree.by[mentor.name]) tree.by[mentor.name] = [];
			tree.by[mentor.name].push({ season, coach: hire.coach, school: hire.school });
		}
		return tree;
	}

	function rebuildTreeIndex(tree) {
		tree.by = {};
		for (const h of tree.hires || []) {
			if (!h || !h.mentor) continue;
			(tree.by[h.mentor] = tree.by[h.mentor] || [])
				.push({ season: h.season, coach: h.coach, school: h.school });
		}
		return tree;
	}

	/* The tree as it stood after `lastSeason`: what a resume holds. The hires
	   recorded by the seasons it is about to re-run come off, or they would be
	   recorded twice. */
	function pruneCoachTree(tree, lastSeason) {
		if (!tree) return null;
		const hires = (tree.hires || []).filter((h) => h &&
			Number.isFinite(lastSeason) && h.season <= lastSeason);
		return rebuildTreeIndex({ by: {}, hires });
	}

	/* The names a later season can drop: award winners, the top of the board,
	   the champion's best prospect. Compact on purpose — it persists. */
	/* AND EACH ONE CARRIES A CROSS-FILE IDENTITY.

	   `key` is a BBGM pid, which is unique inside one export and meaningless
	   between two of them — the same fact playerId() was written for, and the
	   same fault biographyOf was fixed for. The alumni index never adopted it,
	   and records() groups the index with byMan[a.key] to build the Hall of
	   Fame and the player of the decade: so in a chain of real exports, pid 7
	   in 2025 and pid 7 in 2026 are two different men whose scores were summed
	   together under whichever name arrived first.

	   `id` is the scoped identity and is what everything cross-season should
	   group on; `key` stays beside it unchanged, because a caller matching a
	   row against the players of ONE result still wants the file-local pid.
	   The fingerprint is optional so that a caller without one (and every
	   version 1 or 2 export already in the wild) degrades to exactly the
	   behavior it has today rather than failing. */
	function alumniOf(res, season, fingerprint) {
		const out = [];
		const seen = new Set();
		const add = (p, why) => {
			if (!p || seen.has(p.key)) return;
			seen.add(p.key);
			out.push({
				season, name: p.name, key: p.key,
				id: fingerprint ? playerId(fingerprint, p.key) : null,
				/* The NCAA program, always — `proClub || newCollege` put a
				   EuroLeague club name here and the alumni link then pointed
				   at a team page that does not exist. The club is kept beside
				   it so the view can still say where he played, without
				   pretending it is somewhere you can click. */
				school: p.newCollege,
				club: p.proClub || null,
				nonNcaa: !!p.nonNcaa,
				boardRank: p.boardRank || null,
				why,
			});
		};
		/* The national player-of-the-year trophies, named. The old test was
		   /Player of the Year/ minus /Defensive|Conference/, which is a rule
		   about the WORD "conference" and not about conferences: an ACC Player
		   of the Year does not contain it, and neither does a National Prep
		   Player of the Year or a Sporting News Player of the Year. Six alumni
		   a season came back tagged "player of the year" when there is one.

		   AW.NATIONAL_POY is the list the awards module actually mints from,
		   plus the consensus row it derives; reading it here means a trophy
		   added there is picked up rather than missed. */
		const nationalPOY = nationalPOYSet();
		for (const p of res.players || []) {
			if (isNationalPOY(p, nationalPOY)) add(p, "player of the year");
		}
		const board = (res.players || []).slice()
			.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
		for (const p of board.slice(0, 3)) add(p, "top of the board");
		if (res.tourney && res.tourney.champion) {
			const champ = res.tourney.champion.team.name;
			const star = board.filter((p) => p.newCollege === champ)[0];
			if (star) add(star, "won the title at " + champ);
		}
		return out;
	}

	/* One row of the timeline. */
	function summarize(res, seed, fileName) {
		const t = res.tourney;
		/* One definition of player of the year, shared with alumniOf — see
		   nationalPOYSet. This used to be a second hardcoded pair of trophy
		   names, so the timeline column and the alumni index could name two
		   different men for the same season. */
		const poySet = nationalPOYSet();
		const poy = (res.players || []).filter((p) => isNationalPOY(p, poySet))[0];
		const no1 = (res.players || []).filter((p) => p.boardRank === 1)[0];
		return Object.assign({
			season: res.leagueFile ? res.leagueFile.startingSeason : null,
			fileName,
			seed,
			flavor: res.flavor ? res.flavor.label : null,
			champion: t && t.champion ? t.champion.team.name : null,
			champSeed: t && t.champion ? t.champion.seed : null,
			runnerUp: t && t.runnerUp ? t.runnerUp.team.name : null,
			/* `school` is the NCAA program, always, for the reason alumniOf
			   gives: `proClub || newCollege` put a EuroLeague club in the
			   field, and threads() then counted "Kansas produced 2 No. 1
			   picks" against a club with no team page, and "back-to-back
			   players of the year" matched two pro clubs. The club rides
			   beside it so the timeline can still say where he played. */
			poy: poy ? { name: poy.name, school: poy.newCollege,
				club: poy.proClub || null, nonNcaa: !!poy.nonNcaa } : null,
			no1: no1 ? { name: no1.name, school: no1.newCollege,
				club: no1.proClub || null, nonNcaa: !!no1.nonNcaa } : null,
			apOne: res.poll && res.poll[0] ? res.poll[0].name : null,
			realignment: (res.realignment || [])
				.map((m) => m.school + " → " + m.to),
			coachChanges: (res.coachingCarousel || []).length,
			coachFired: (res.coachingCarousel || [])
				.filter((c) => c.reason === "fired" || c.reason === "not retained").length,
			coachRetired: (res.coachingCarousel || [])
				.filter((c) => c.reason === "retired").length,
			coachHiredAway: (res.coachingCarousel || [])
				.filter((c) => c.reason === "hired away").length,
			/* Later classes' underclassmen who played this season, and the
			   honors they took — the seam between two class files. */
			futureOnRosters: (res.futurePlayers || []).length,
			futureHonors: (res.futurePlayers || [])
				.reduce((a, p) => a + ((p.awards || []).length), 0),
		}, extraTracking(res, poy, no1));
	}

	/* WHAT ELSE A ROW HAS TO CARRY.

	   threads() can only say what a row records, and the row recorded eleven
	   facts: champion, runner-up, POY, No. 1 pick, AP No. 1, realignment and
	   four coaching counts. Six thread kinds is what eleven facts supports,
	   and every one of them is a repeat-count over one field — which is why a
	   twenty-season timeline's Threads panel read as the same two sentences
	   with bigger numbers.

	   Everything below is derived from a season the chain has ALREADY
	   simulated and then thrown away, so none of it costs a re-run. It is
	   deliberately small and scalar-or-short-list: a row is persisted, and a
	   forty-season universe carrying a full bracket per season is not a
	   localStorage payload. The rule applied to each field is the one the
	   archetype table uses for a build — a fact nothing can be said about is
	   not tracked. */
	function extraTracking(res, poy, no1) {
		const t = res.tourney;
		const teamList = Object.values(res.teams || {}).filter((x) => x && x.name);
		const confOf = (name) => {
			const x = res.teams && res.teams[name];
			return x ? x.conf || null : null;
		};
		const byRecord = teamList.slice().sort((a, b) =>
			(b.w || 0) - (a.w || 0) || (a.l || 0) - (b.l || 0) ||
			String(a.name).localeCompare(String(b.name)));
		const best = byRecord[0] || null;
		/* An undefeated regular season is the rarest fact a college season
		   produces and the timeline could not see one.

		   IT STILL COULD NOT, because the fallback was written with `||`.
		   `regW`/`regL` are the records frozen at the end of the regular
		   season (see js/teams.js) and `w`/`l` keep growing through March, so
		   the fallback exists for a team that has no frozen snapshot. But a
		   team that really went unbeaten has regL === 0, which is falsy — so
		   `x.regL || x.l` skipped the 0 and read the loss that ended the run
		   in the tournament instead. The one input the guard exists to catch
		   was the one input it threw away, and the thread has never fired for
		   a team that lost in March, which is almost all of them. Measured on
		   seed "audit1": Georgetown finished 31-0 and the list came back
		   empty.

		   `num` falls back on PRESENCE rather than on truthiness, which is
		   what was meant and is the idiom tools/test.js already uses. */
		const num = (a, b) => (Number.isFinite(a) ? a
			: (Number.isFinite(b) ? b : 0));
		const unbeaten = teamList.filter((x) => num(x.regL, x.l) === 0 &&
			num(x.regW, x.w) >= 20).map((x) => x.name).sort();
		const ff = (t && t.finalFour ? t.finalFour : []).map(
			(x) => (x && x.team ? x.team.name : x && x.name) || null).filter(Boolean);
		/* The deepest run by a seed nobody picked. `finalFour` carries seeds
		   where the bracket built it; the champion and runner-up always do. */
		const seeded = [];
		if (t && t.champion) seeded.push({ name: t.champion.team.name, seed: t.champion.seed, round: "champion" });
		if (t && t.runnerUp) seeded.push({ name: t.runnerUp.team.name, seed: t.runnerUp.seed, round: "runner-up" });
		for (const x of (t && t.finalFour) || []) {
			if (x && x.team && Number.isFinite(x.seed)) {
				seeded.push({ name: x.team.name, seed: x.seed, round: "Final Four" });
			}
		}
		const cinder = seeded.filter((x) => Number.isFinite(x.seed) && x.seed >= 8)
			.sort((a, b) => b.seed - a.seed)[0] || null;
		const preseason = (res.pollHistory && res.pollHistory[0] &&
			res.pollHistory[0].ranks && res.pollHistory[0].ranks[0]) || null;
		return {
			champConf: t && t.champion ? confOf(t.champion.team.name) : null,
			runnerUpConf: t && t.runnerUp ? confOf(t.runnerUp.team.name) : null,
			finalFour: ff.slice(0, 4),
			nitChampion: t && t.nit && t.nit.champion
				? (t.nit.champion.team ? t.nit.champion.team.name : t.nit.champion.name) || null
				: null,
			apPreseasonOne: preseason
				? (preseason.team || preseason.name || null) : null,
			bestRecord: best ? { team: best.name, w: best.w || 0, l: best.l || 0 } : null,
			unbeaten,
			cinderella: cinder,
			poyConf: poy && poy.newCollege ? confOf(poy.newCollege) : null,
			no1Conf: no1 && no1.newCollege ? confOf(no1.newCollege) : null,
			/* The class's own character, as a name rather than as a label, so
			   two seasons drawing the same flavor can be counted. */
			flavorName: res.flavor ? res.flavor.name : null,
			/* The narrative layer returns a LIST of drawn narratives; the
			   first is the one the season is named for. */
			narrative: Array.isArray(res.narrative) && res.narrative[0]
				? res.narrative[0].name
				: (res.narrative && res.narrative.name) || null,
			anomalies: (res.surprises || []).map((x) => x.name).slice(0, 6),
			/* One number for how good the class was and one for how old it
			   was: a chain can then say which year was the strong one. */
			topOvr: (res.players || []).reduce((a, p) => Math.max(a, p.newOvr || 0), 0),
			freshmen: (res.players || []).filter((p) => p.isFreshman).length,
			transfers: (res.players || []).filter((p) => p.transfer).length,
			classSize: (res.players || []).length,
		};
	}

	/* Continuity threads across the timeline, for the Universe view: repeat
	   champions, programs with multiple No. 1 picks, back-to-back POY
	   schools — the connections that make it one world rather than N runs.

	   STRUCTURED, not English. They used to be sentences ("Duke won 3 national
	   titles"), which meant the view could not link the program or the season
	   out of one, and the news module could not consume them at all without
	   parsing prose it had just generated. Each thread is now
	   {kind, team, seasons, count, text}: `text` is the same sentence, built
	   here so there is still one place that words it, and everything the view
	   wants to make clickable is beside it. */
	function threads(rows, alumni, extra) {
		const out = [];
		const titleSeasons = {};
		const no1Seasons = {};
		for (const r of rows) {
			if (r.champion) {
				(titleSeasons[r.champion] = titleSeasons[r.champion] || []).push(r.season);
			}
			/* Programs only: a No. 1 pick out of a EuroLeague club is not a
			   program producing picks, and there is no team page to link. */
			if (r.no1 && r.no1.school && !r.no1.nonNcaa) {
				(no1Seasons[r.no1.school] = no1Seasons[r.no1.school] || []).push(r.season);
			}
		}
		const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
		for (const name of Object.keys(titleSeasons).sort(byName)) {
			const seasons = titleSeasons[name];
			if (seasons.length >= 2) {
				out.push({ kind: "titles", team: name, seasons: seasons.slice(),
					count: seasons.length,
					text: name + " won " + seasons.length + " national titles" });
			}
		}
		for (const name of Object.keys(no1Seasons).sort(byName)) {
			const seasons = no1Seasons[name];
			if (seasons.length >= 2) {
				out.push({ kind: "no1", team: name, seasons: seasons.slice(),
					count: seasons.length,
					text: name + " produced " + seasons.length + " No. 1 picks" });
			}
		}
		const crossed = rows.reduce((a, r) => a + (r.futureOnRosters || 0), 0);
		if (crossed) {
			out.push({ kind: "crossover", team: null, seasons: [], count: crossed,
				text: crossed + " roster spots across the timeline were filled by " +
					"players from a later draft class" });
		}
		for (let i = 1; i < rows.length; i++) {
			if (rows[i].champion && rows[i].champion === rows[i - 1].champion) {
				out.push({ kind: "repeat", team: rows[i].champion,
					seasons: [rows[i - 1].season, rows[i].season], count: 2,
					text: rows[i].champion + " repeated as champions in " + rows[i].season });
			}
			if (rows[i].poy && rows[i - 1].poy &&
				!rows[i].poy.nonNcaa && !rows[i - 1].poy.nonNcaa &&
				rows[i].poy.school === rows[i - 1].poy.school) {
				out.push({ kind: "poyRepeat", team: rows[i].poy.school,
					seasons: [rows[i - 1].season, rows[i].season], count: 2,
					text: rows[i].poy.school + " had back-to-back players of the year" });
			}
		}
		/* A gap in the files is a fact about the world, not only about the
		   file list: five years passed with nobody playing them. */
		for (const r of rows) {
			if (r.gap > 0) {
				out.push({ kind: "gap", team: null, seasons: [r.season], count: r.gap,
					text: r.gap + " season" + (r.gap > 1 ? "s" : "") +
						" before " + r.season + " were not played — the world was " +
						"aged across the gap" });
			}
		}
		out.push.apply(out, moreThreads(rows, alumni));
		out.push.apply(out, rivalryThreads(extra && extra.rivalries));
		return out;
	}

	/* RIVALRIES AS THREADS.

	   Read off the carry's rivalry book (see rivalriesStep), which is the one
	   place the bracket is remembered — a row keeps the Final Four and not the
	   sixty-three games under it. A pair is a thread when it met in March
	   three times inside five years, or four times at all; the sentence says
	   when, and who leads the whole series. */
	function rivalryThreads(riv) {
		const out = [];
		const list = Object.keys(riv || {}).map((k) => riv[k])
			.filter((e) => e && e.a && e.b && (e.march || []).length >= 2);
		const scored = [];
		for (const e of list) {
			const ss = e.march.slice().sort((a, b) => a - b);
			let best = { count: 0, from: ss[0], to: ss[0] };
			for (let i = 0; i < ss.length; i++) {
				let j = i;
				while (j + 1 < ss.length && ss[j + 1] - ss[i] <= 4) j++;
				if (j - i + 1 > best.count) best = { count: j - i + 1, from: ss[i], to: ss[j] };
			}
			if (best.count < 3 && ss.length < 4) continue;
			scored.push({ e, ss, best });
		}
		scored.sort((x, y) => y.best.count - x.best.count || y.ss.length - x.ss.length ||
			String(x.e.a + x.e.b).localeCompare(String(y.e.a + y.e.b)));
		for (const x of scored.slice(0, 6)) {
			const e = x.e;
			const inWindow = x.ss.filter((s) => s >= x.best.from && s <= x.best.to);
			const lead = e.aw === e.bw
				? "the series is level at " + e.aw + "-" + e.bw
				: (e.aw > e.bw ? e.a + " leads the series " + e.aw + "-" + e.bw
					: e.b + " leads the series " + e.bw + "-" + e.aw);
			const text = x.best.count >= 3
				? e.a + " and " + e.b + " met in March " + x.best.count + " times in " +
					(x.best.to - x.best.from + 1) + " years (" + inWindow.join(", ") + "); " + lead
				: e.a + " and " + e.b + " met in March " + x.ss.length + " times (" +
					x.ss.join(", ") + "); " + lead;
			out.push({ kind: "rivalry", team: e.a, other: e.b, seasons: x.ss,
				count: x.ss.length, games: e.games, text });
		}
		return out;
	}

	/* FIFTY MORE THREADS.

	   The six above are the connections a row's eleven original fields could
	   support, and every one of them counts a repeat: this program won N, that
	   one produced N. A history is not only a tally — it is droughts, first
	   times, streaks that ended, a conference that owned a decade, the year
	   the bracket came apart, the man who won it twice. Those are all facts
	   about the ORDERED timeline, which is exactly what a thread is for and
	   exactly what a count cannot say.

	   Everything here reads the fields extraTracking added and the alumni
	   index the chain already builds; nothing re-simulates. Each row follows
	   the shape threads() established — {kind, team, seasons, count, text} —
	   so the view keeps linking programs and seasons without knowing which
	   kinds exist.

	   The gates are deliberately not "did this ever happen": a thread that
	   fires every season is a column, not a thread. Each one states a
	   threshold that makes it worth a sentence. */
	function moreThreads(rows, alumni) {
		const out = [];
		const played = (rows || []).filter((r) => r && !r.error && !r.extrapolated);
		const all = (rows || []).filter((r) => r && !r.error);
		if (!played.length) return out;
		const add = (kind, team, seasons, count, text) => {
			out.push({ kind, team: team || null, seasons: seasons || [], count, text });
		};
		const push = (map, key, season) => {
			if (!key) return;
			(map[key] = map[key] || []).push(season);
		};
		const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
		const keys = (map) => Object.keys(map).sort(byName);
		const list = (names) => names.length === 1 ? names[0]
			: names.slice(0, -1).join(", ") + " and " + names[names.length - 1];


		const titles = {};
		const finals = {};
		const ffs = {};
		const apOnes = {};
		const poys = {};
		const no1s = {};
		const confTitles = {};
		const confFinals = {};
		const poyConf = {};
		const no1Conf = {};
		const flavors = {};
		const anomalies = {};
		const moved = {};
		for (const r of played) {
			push(titles, r.champion, r.season);
			push(finals, r.champion, r.season);
			push(finals, r.runnerUp, r.season);
			for (const f of r.finalFour || []) push(ffs, f, r.season);
			push(apOnes, r.apOne, r.season);
			if (r.poy && r.poy.school && !r.poy.nonNcaa) push(poys, r.poy.school, r.season);
			if (r.no1 && r.no1.school && !r.no1.nonNcaa) push(no1s, r.no1.school, r.season);
			push(confTitles, r.champConf, r.season);
			push(confFinals, r.champConf, r.season);
			push(confFinals, r.runnerUpConf, r.season);
			push(poyConf, r.poyConf, r.season);
			push(no1Conf, r.no1Conf, r.season);
			push(flavors, r.flavorName, r.season);
			for (const a of r.anomalies || []) push(anomalies, a, r.season);
			for (const m of r.realignment || []) {
				push(moved, String(m).split(" → ")[0], r.season);
			}
		}

		// --- titles, finals and the shape of a dynasty ----------------------
		for (const name of keys(titles)) {
			const ss = titles[name].slice().sort((a, b) => a - b);
			let run = 1;
			let best = 1;
			let bestEnd = ss[0];
			for (let i = 1; i < ss.length; i++) {
				run = ss[i] === ss[i - 1] + 1 ? run + 1 : 1;
				if (run > best) { best = run; bestEnd = ss[i]; }
			}
			if (best >= 3) {
				add("threepeat", name, ss.filter((x) => x > bestEnd - best && x <= bestEnd),
					best, name + " won " + best + " in a row, through " + bestEnd);
			}
			for (let i = 1; i < ss.length; i++) {
				const gap = ss[i] - ss[i - 1];
				if (gap >= 6) {
					add("titleDrought", name, [ss[i - 1], ss[i]], gap,
						name + " went " + (gap - 1) + " years between titles, " +
						ss[i - 1] + " to " + ss[i]);
				}
			}
		}
		{
			const first = {};
			for (const r of played) {
				if (r.champion && first[r.champion] === undefined) first[r.champion] = r.season;
			}
			const late = keys(first).filter((n) => first[n] >= (played[0].season || 0) + 4);
			if (late.length) {
				add("firstTitle", late.length === 1 ? late[0] : null,
					late.map((n) => first[n]).sort((a, b) => a - b), late.length,
					late.length + " programme" + (late.length === 1 ? "" : "s") +
					" won a first title inside this timeline: " +
					list(late.slice(0, 4).map((n) => n + " (" + first[n] + ")")));
			}
		}
		for (const name of keys(finals)) {
			const won = (titles[name] || []).length;
			const lost = finals[name].length - won;
			if (lost >= 2 && won === 0) {
				add("bridesmaid", name, finals[name].slice(), lost,
					name + " lost " + lost + " finals without winning one");
			}
			if (lost >= 2 && won >= 2) {
				add("finalsRegular", name, finals[name].slice(), finals[name].length,
					name + " played in " + finals[name].length + " finals, winning " + won);
			}
		}
		for (const name of keys(ffs)) {
			const n = ffs[name].length;
			if (n >= 4 && !(titles[name] || []).length) {
				add("finalFourNoTitle", name, ffs[name].slice(), n,
					name + " reached " + n + " Final Fours without winning one");
			}
			if (n >= 5) {
				add("finalFourRegular", name, ffs[name].slice(), n,
					name + " reached " + n + " Final Fours");
			}
		}
		{
			const pairs = {};
			for (const r of played) {
				if (!r.champion || !r.runnerUp) continue;
				const k = [r.champion, r.runnerUp].sort(byName).join(" — ");
				push(pairs, k, r.season);
			}
			for (const k of keys(pairs)) {
				if (pairs[k].length >= 2) {
					add("finalsRematch", null, pairs[k].slice(), pairs[k].length,
						k + " met in " + pairs[k].length + " finals");
				}
			}
		}
		{
			const lostThenWon = [];
			for (const name of keys(titles)) {
				const lostFirst = played.filter((r) => r.runnerUp === name)
					.map((r) => r.season).sort((a, b) => a - b)[0];
				const won = titles[name].slice().sort((a, b) => a - b)[0];
				if (Number.isFinite(lostFirst) && lostFirst < won) {
					lostThenWon.push({ name, lostFirst, won });
				}
			}
			for (const x of lostThenWon.slice(0, 6)) {
				add("cameBack", x.name, [x.lostFirst, x.won], x.won - x.lostFirst,
					x.name + " lost the final in " + x.lostFirst + " and won it in " + x.won);
			}
		}

		// --- seeds, upsets and the bracket ----------------------------------
		{
			const wild = played.filter((r) => Number.isFinite(r.champSeed) && r.champSeed >= 4);
			if (wild.length >= 2) {
				add("unseededChampions", null, wild.map((r) => r.season), wild.length,
					wild.length + " champions were seeded fourth or worse: " +
					list(wild.slice(0, 4).map((r) => r.champion + " (" + r.champSeed + ", " + r.season + ")")));
			}
			const chalk = played.filter((r) => r.champSeed === 1);
			if (chalk.length >= 4) {
				add("chalkEra", null, chalk.map((r) => r.season), chalk.length,
					chalk.length + " of " + played.length + " titles went to a one seed");
			}
		}
		{
			const cind = played.filter((r) => r.cinderella && r.cinderella.seed >= 10);
			if (cind.length >= 2) {
				const deepest = cind.slice().sort((a, b) => b.cinderella.seed - a.cinderella.seed)[0];
				add("cinderellaEra", deepest.cinderella.name, cind.map((r) => r.season), cind.length,
					cind.length + " double-digit seeds reached a Final Four, the deepest " +
					deepest.cinderella.name + " as a " + deepest.cinderella.seed +
					" seed in " + deepest.season);
			}
		}
		{
			const wire = played.filter((r) => r.apPreseasonOne && r.champion &&
				r.apPreseasonOne === r.champion);
			if (wire.length) {
				add("wireToWire", wire.length === 1 ? wire[0].champion : null,
					wire.map((r) => r.season), wire.length,
					wire.length === 1
						? wire[0].champion + " was preseason No. 1 and champion in " + wire[0].season
						: wire.length + " teams went from preseason No. 1 to champion");
			}
		}
		{
			const never = keys(apOnes).filter((n) => apOnes[n].length >= 3 && !(titles[n] || []).length);
			for (const n of never.slice(0, 6)) {
				add("apOneNoTitle", n, apOnes[n].slice(), apOnes[n].length,
					n + " finished No. 1 in the poll " + apOnes[n].length + " times without a title");
			}
			const apMost = keys(apOnes).sort((a, b) => apOnes[b].length - apOnes[a].length)[0];
			if (apMost && apOnes[apMost].length >= 4) {
				add("apOneEra", apMost, apOnes[apMost].slice(), apOnes[apMost].length,
					apMost + " ended " + apOnes[apMost].length + " seasons ranked No. 1");
			}
		}

		// --- records the season sheet now carries ---------------------------
		{
			const unbeaten = played.filter((r) => (r.unbeaten || []).length);
			for (const r of unbeaten.slice(0, 5)) {
				add("unbeaten", r.unbeaten[0], [r.season], r.unbeaten.length,
					list(r.unbeaten) + " went unbeaten in the regular season of " + r.season);
			}
			const bests = played.filter((r) => r.bestRecord).slice()
				.sort((a, b) => b.bestRecord.w - a.bestRecord.w);
			if (bests.length && bests[0].bestRecord.w >= 30) {
				const b = bests[0];
				add("bestRecord", b.bestRecord.team, [b.season], b.bestRecord.w,
					b.bestRecord.team + " won " + b.bestRecord.w + " games in " + b.season +
					", the most in the timeline");
			}
			const nits = {};
			for (const r of played) push(nits, r.nitChampion, r.season);
			for (const n of keys(nits)) {
				if (nits[n].length >= 2) {
					add("nitRegular", n, nits[n].slice(), nits[n].length,
						n + " won " + nits[n].length + " NITs");
				}
			}
		}

		// --- conferences ----------------------------------------------------
		for (const c of keys(confTitles)) {
			if (confTitles[c].length >= 3) {
				add("confDynasty", null, confTitles[c].slice(), confTitles[c].length,
					"the " + c + " produced " + confTitles[c].length + " national champions");
			}
		}
		for (const c of keys(confFinals)) {
			if (confFinals[c].length >= 5) {
				add("confFinals", null, confFinals[c].slice(), confFinals[c].length,
					"the " + c + " put a team in " + confFinals[c].length + " title games");
			}
		}
		{
			const allSame = played.filter((r) => r.champConf && r.champConf === r.runnerUpConf);
			if (allSame.length >= 2) {
				add("allConfFinal", null, allSame.map((r) => r.season), allSame.length,
					allSame.length + " title games were played between two teams from the same conference");
			}
		}
		for (const c of keys(poyConf)) {
			if (poyConf[c].length >= 4) {
				add("confPOY", null, poyConf[c].slice(), poyConf[c].length,
					"the " + c + " produced " + poyConf[c].length + " players of the year");
			}
		}
		for (const c of keys(no1Conf)) {
			if (no1Conf[c].length >= 4) {
				add("confNo1", null, no1Conf[c].slice(), no1Conf[c].length,
					"the " + c + " produced " + no1Conf[c].length + " No. 1 picks");
			}
		}

		// --- the men --------------------------------------------------------
		{
			const poyNames = {};
			const no1Names = {};
			for (const r of played) {
				if (r.poy && r.poy.name) push(poyNames, r.poy.name, r.season);
				if (r.no1 && r.no1.name) push(no1Names, r.no1.name, r.season);
			}
			for (const n of keys(poyNames)) {
				if (poyNames[n].length >= 2) {
					add("poyTwice", null, poyNames[n].slice(), poyNames[n].length,
						n + " was named player of the year " + poyNames[n].length + " times");
				}
			}
			for (const n of keys(no1Names)) {
				if (no1Names[n].length >= 2) {
					add("no1Twice", null, no1Names[n].slice(), no1Names[n].length,
						n + " went No. 1 in " + no1Names[n].length + " different classes — " +
						"two files describe the same man");
				}
			}
			const sweep = played.filter((r) => r.poy && r.no1 && r.poy.name === r.no1.name);
			if (sweep.length >= 2) {
				add("poyAndNo1", null, sweep.map((r) => r.season), sweep.length,
					sweep.length + " men were player of the year and the No. 1 pick in the same season");
			}
			const double = played.filter((r) => r.champion && r.poy &&
				r.poy.school === r.champion);
			if (double.length >= 2) {
				add("poyOnAChampion", null, double.map((r) => r.season), double.length,
					double.length + " players of the year also won the title that season");
			}
			const no1Champ = played.filter((r) => r.champion && r.no1 &&
				r.no1.school === r.champion);
			if (no1Champ.length >= 2) {
				add("no1OnAChampion", null, no1Champ.map((r) => r.season), no1Champ.length,
					no1Champ.length + " No. 1 picks came out of that season's champion");
			}
			/* THE ONE no1Abroad THREAD.

			   There were two, on the same fact: this one over the rows at a
			   threshold of two, and a second over the alumni index at a
			   threshold of one, which named the men. So any timeline with
			   two or more of them printed both sentences — which is exactly
			   what the note beside the sweep thread forty lines above warns
			   against ("a second thread saying the same thing with different
			   words is how a Threads panel becomes unreadable").

			   The rows won because they are complete: the alumni index is
			   trimmed to its last 400 entries on export and in the app's
			   persisted state, so on a long universe the alumni version
			   would quietly stop counting the early seasons. The naming
			   moved here, where the rows already carry it. */
			const abroad = played.filter((r) => r.no1 && r.no1.nonNcaa);
			if (abroad.length) {
				add("no1Abroad", null, abroad.map((r) => r.season), abroad.length,
					abroad.length + " No. 1 pick" + (abroad.length === 1 ? "" : "s") +
					" never played college basketball (" +
					abroad.slice(0, 4).map((r) => r.no1.name + ", " +
						(r.no1.club || r.no1.school || "abroad")).join("; ") + ")");
			}
			const poyAbroad = played.filter((r) => r.poy && r.poy.nonNcaa);
			if (poyAbroad.length >= 2) {
				add("poyAbroad", null, poyAbroad.map((r) => r.season), poyAbroad.length,
					poyAbroad.length + " players of the year were playing professionally");
			}
		}
		{
			/* Surnames that turn up in two different classes far enough apart
			   to be a father and a son rather than two brothers. */
			const surnames = {};
			for (const r of played) {
				for (const p of [r.poy, r.no1]) {
					if (!p || !p.name) continue;
					const last = String(p.name).trim().split(/\s+/).pop();
					if (last && last.length > 2) push(surnames, last, r.season);
				}
			}
			const fams = keys(surnames).filter((n) => {
				const ss = surnames[n].slice().sort((a, b) => a - b);
				return ss.length >= 2 && ss[ss.length - 1] - ss[0] >= 8;
			});
			for (const n of fams.slice(0, 4)) {
				const ss = surnames[n].slice().sort((a, b) => a - b);
				add("bloodline", null, ss, ss.length,
					"a second " + n + " was at the top of the board in " +
					ss[ss.length - 1] + ", " + (ss[ss.length - 1] - ss[0]) +
					" years after the first");
			}
		}

		// --- the sideline ---------------------------------------------------
		{
			const busiest = played.slice().sort((a, b) =>
				(b.coachChanges || 0) - (a.coachChanges || 0))[0];
			if (busiest && busiest.coachChanges >= 40) {
				add("carouselPeak", null, [busiest.season], busiest.coachChanges,
					busiest.coachChanges + " head-coaching jobs changed hands in " +
					busiest.season + ", the busiest April in the timeline");
			}
			const quiet = played.filter((r) => (r.coachChanges || 0) <= 8);
			for (const r of quiet.slice(0, 3)) {
				add("carouselQuiet", null, [r.season], r.coachChanges || 0,
					"only " + (r.coachChanges || 0) + " jobs changed hands after " +
					r.season + " — the sport stood still");
			}
			const retire = played.filter((r) => (r.coachRetired || 0) >= 6);
			for (const r of retire.slice(0, 3)) {
				add("retirementWave", null, [r.season], r.coachRetired,
					r.coachRetired + " coaches retired at the end of " + r.season);
			}
			const poached = played.reduce((a, r) => a + (r.coachHiredAway || 0), 0);
			if (poached >= 12) {
				add("poachingEra", null, played.map((r) => r.season), poached,
					poached + " coaches were hired away by another programme across the timeline");
			}
			const fired = played.reduce((a, r) => a + (r.coachFired || 0), 0);
			if (fired >= 40) {
				add("firingEra", null, [], fired,
					fired + " coaches were fired or not retained across " +
					played.length + " seasons");
			}
		}

		// --- realignment ------------------------------------------------------
		{
			const total = played.reduce((a, r) => a + (r.realignment || []).length, 0);
			if (total >= 6) {
				add("realignmentEra", null,
					played.filter((r) => (r.realignment || []).length).map((r) => r.season),
					total, total + " programmes changed conference across the timeline");
			}
			const waves = played.filter((r) => (r.realignment || []).length >= 4);
			for (const r of waves.slice(0, 3)) {
				add("realignmentWave", null, [r.season], r.realignment.length,
					r.realignment.length + " programmes moved conference in " + r.season);
			}
			for (const n of keys(moved)) {
				if (moved[n].length >= 2) {
					add("serialMover", n, moved[n].slice(), moved[n].length,
						n + " changed conference " + moved[n].length + " times");
				}
			}
		}

		// --- the character of the classes --------------------------------------
		for (const f of keys(flavors)) {
			if (flavors[f].length >= 3) {
				add("flavorRepeat", null, flavors[f].slice(), flavors[f].length,
					flavors[f].length + " classes came out " + f);
			}
			const ss = flavors[f].slice().sort((a, b) => a - b);
			for (let i = 1; i < ss.length; i++) {
				if (ss[i] === ss[i - 1] + 1) {
					add("flavorRun", null, [ss[i - 1], ss[i]], 2,
						"back-to-back " + f + " classes in " + ss[i - 1] + " and " + ss[i]);
					break;
				}
			}
		}
		for (const a of keys(anomalies)) {
			if (anomalies[a].length >= 4) {
				add("anomalyEra", null, anomalies[a].slice(), anomalies[a].length,
					"“" + a + "” happened to somebody in " +
					anomalies[a].length + " different seasons");
			}
		}
		{
			const strong = played.filter((r) => Number.isFinite(r.topOvr)).slice()
				.sort((a, b) => b.topOvr - a.topOvr);
			if (strong.length >= 3 && strong[0].topOvr - strong[strong.length - 1].topOvr >= 8) {
				add("bestClass", null, [strong[0].season], strong[0].topOvr,
					"the strongest class in the timeline was " + strong[0].season +
					", and the weakest " + strong[strong.length - 1].season);
			}
			const young = played.filter((r) => r.classSize &&
				(r.freshmen || 0) / r.classSize >= 0.5);
			if (young.length >= 2) {
				add("freshmanEra", null, young.map((r) => r.season), young.length,
					young.length + " classes were more than half freshmen");
			}
			const portal = played.filter((r) => r.classSize &&
				(r.transfers || 0) / r.classSize >= 0.5);
			if (portal.length >= 2) {
				add("portalEra", null, portal.map((r) => r.season), portal.length,
					portal.length + " classes were more than half transfers");
			}
		}

		/* --- THE PEOPLE ------------------------------------------------------

		   Every thread above counts a PROGRAMME's repeats: this school won N,
		   that conference owned a decade. The alumni index — a compact
		   per-season record of every national player of the year, the top
		   three of every board, and the champion's best prospect — has been
		   built, persisted and handed to the news desk since universe mode
		   existed, and the thread generator never read it. The parameter was
		   in the signature and in the comment above this function, and in
		   nothing else.

		   These are the sentences a timeline is actually read for, and every
		   one of them is a fact about the ORDERED index rather than a tally
		   over it — which is the whole distinction between a thread and a
		   column. */
		{
			const list = (alumni || []).filter((a) => a && Number.isFinite(a.season));
			const poys = list.filter((a) => a.why === "player of the year");
			const bySchool = {};
			for (const a of list) {
				if (a.school && !a.nonNcaa) push(bySchool, a.school, a.season);
			}
			/* THE ONE THREAD THAT IS NOT HERE, and why.

			   "He was one of the names of the year in 2026 and 2029 — he came
			   back" is the most human sentence this index could produce, and
			   it cannot be written yet. A class file's player key is its pid,
			   which is unique within one BBGM export and collides across
			   them, so two entries a season apart carrying the same name or
			   the same key are not evidence of the same person: on the test
			   fixtures, where every file names its players the same way, a
			   name match fired on seven different men. Saying it anyway would
			   put a confident false claim in a history whose whole value is
			   that it is consistent.

			   It needs the persistent player registry — an identity that
			   survives a file boundary — and when that exists this is the
			   first thing to build on it. Recorded here rather than shipped
			   wrong. */
			/* The drought: a programme that produced somebody the world
			   remembers, then went years without. A tally cannot say this and
			   it is the thing every fanbase actually talks about. */
			for (const school of keys(bySchool)) {
				const ss = bySchool[school].slice().sort((a, b) => a - b);
				if (ss.length < 2) continue;
				let worst = 0;
				let from = ss[0];
				for (let i = 1; i < ss.length; i++) {
					if (ss[i] - ss[i - 1] > worst) { worst = ss[i] - ss[i - 1]; from = ss[i - 1]; }
				}
				if (worst >= 5) {
					add("drought", school, [from, from + worst], worst,
						school + " went " + (worst - 1) + " years between men the " +
						"world remembers, from " + from + " to " + (from + worst));
				}
			}
			/* A player of the year who was not the No. 1 pick, season after
			   season, is a statement about how this world values players. */
			const poyNotNo1 = poys.filter((a) => Number.isFinite(a.boardRank) && a.boardRank > 1);
			if (poys.length >= 4 && poyNotNo1.length >= Math.ceil(poys.length * 0.6)) {
				add("poyNotNo1", null, poyNotNo1.map((a) => a.season), poyNotNo1.length,
					poyNotNo1.length + " of " + poys.length + " players of the year " +
					"were not the No. 1 pick in their own class");
			}
			/* The man who was both is already a thread (see the sweep above,
			   which reads the rows rather than the index); naming him is what
			   the index adds. A second thread saying the same thing with
			   different words is how a Threads panel becomes unreadable. */
			const both = poys.filter((a) => a.boardRank === 1);
			if (both.length) {
				add("sweepNamed", null, both.map((a) => a.season), both.length,
					"the men who were both: " + both
						.map((a) => a.name + " (" + a.season + ")").join(", "));
			}
			/* A prospect abroad at the very top of a board used to be said
			   TWICE — once here off the index and once over the rows — for
			   the same fact and in different words. The rows keep it, and
			   carry the names this version added; see the no1Abroad thread
			   above for why the complete source won. */
			/* How many people this world remembers at all: a twenty-season
			   universe with eleven names in it had a very different history
			   from one with sixty. */
			if (list.length >= 12) {
				/* Counted by ENTRY, not by name: without a cross-file identity
				   (see the note above) two names that match are not known to
				   be one person, and a count that silently merges them would
				   understate the world's memory rather than describe it. */
				add("remembered", null, [], list.length,
					list.length + " player-seasons are in this world's memory " +
					"across " + played.length + " seasons");
			}
		}

		// --- the shape of the timeline itself -----------------------------------
		{
			const seasons = played.map((r) => r.season).filter(Number.isFinite)
				.sort((a, b) => a - b);
			if (seasons.length >= 2) {
				let run = 1;
				let best = 1;
				let end = seasons[0];
				for (let i = 1; i < seasons.length; i++) {
					run = seasons[i] === seasons[i - 1] + 1 ? run + 1 : 1;
					if (run > best) { best = run; end = seasons[i]; }
				}
				if (best >= 4) {
					add("unbrokenRun", null, [end - best + 1, end], best,
						best + " consecutive seasons were played, " + (end - best + 1) +
						" to " + end);
				}
				add("span", null, [seasons[0], seasons[seasons.length - 1]], seasons.length,
					seasons.length + " seasons played across " +
					(seasons[seasons.length - 1] - seasons[0] + 1) + " years, " +
					seasons[0] + " to " + seasons[seasons.length - 1]);
			}
			const broken = all.filter((r) => r.error);
			if (broken.length) {
				add("brokenSeasons", null, broken.map((r) => r.season).filter(Number.isFinite),
					broken.length, broken.length + " season" +
					(broken.length === 1 ? "" : "s") + " failed to simulate and " +
					"the world was aged across " + (broken.length === 1 ? "it" : "them"));
			}
			const guessed = (rows || []).filter((r) => r && r.extrapolated);
			if (guessed.length) {
				add("extrapolated", null, guessed.map((r) => r.season), guessed.length,
					guessed.length + " season" + (guessed.length === 1 ? "" : "s") +
					" had no class file and were extrapolated from the world either side");
			}
			const honors = played.reduce((a, r) => a + (r.futureHonors || 0), 0);
			if (honors >= 5) {
				add("underclassHonors", null, [], honors,
					honors + " honours across the timeline were won by players from a " +
					"later draft class");
			}
		}
		return out;
	}


	/* ------------------------------------------------- extrapolated seasons

	   THE YEARS NOBODY PLAYED.

	   A universe built from 2025, 2026 and 2031 is a six-year world with three
	   seasons in it, and until now the four missing years were a hole: the
	   carry-over was aged across them (see ageCarry) so the world on the far
	   side was older, and that was all. The timeline skipped from 2026 to
	   2031, the records book counted three champions in six years, and a
	   player's page said he was a junior in a season the world has no account
	   of. The gap warning said "the world was aged across it", which is true
	   and is not a history.

	   Extrapolation fills those years with the one thing a season is
	   remembered by — its awards: a champion, a runner-up, a poll No. 1 and a
	   player of the year, plus a five-man All-America. It is NOT a simulation
	   and does not pretend to be, and every row it produces is flagged
	   `extrapolated: true` so the view, the records book and the export can
	   say which seasons were played and which were inferred. Nothing derived
	   from an extrapolated season is fed back into the chain: the carry that
	   crosses the gap is still ageCarry's, so turning this off changes what is
	   DISPLAYED and not what is simulated.

	   What it reads is what the carry already holds: program levels (which
	   ageCarry regresses year by year, so a gap year's favourites drift the
	   way they should) and the named star returners each program is carrying,
	   which is where a player of the year with an actual name comes from. The
	   draw is seeded off the universe seed and the season, so a replay
	   produces the same missing years — the same contract every other part of
	   the chain keeps.

	   HOW FAR IT REACHES. The names come from the star returners the carry is
	   holding, and ageCarry graduates them out one class year at a time — so
	   the first missing year after a played one has a player of the year the
	   world has met, and the fifth has a champion and a poll and nobody left
	   to name. That is the right shape for the guess: a world five years past
	   the last file it was given genuinely does not know who is playing.

	   `partial` is the other case this exists for, and it is the commoner one:
	   a class file that covers only part of a season's field — a league export
	   whose draft class is forty men rather than seventy — produces a season
	   whose awards are drawn from a thin field. The caller marks such a row
	   `partial: true` and the same machinery tops up the honours that field
	   could not fill, rather than leaving a season with three All-Americans in
	   it. */

	/* How much of a full class a file has to carry before its season's awards
	   are taken at face value. Below this the field is thin enough that the
	   honours it produced are topped up from the carry. */
	const PARTIAL_CLASS_SHARE = 0.55;

	function weightedPick(rng, entries) {
		let total = 0;
		for (const e of entries) total += Math.max(0, e.w);
		if (!(total > 0)) return entries.length ? entries[0] : null;
		let x = rng.random() * total;
		for (const e of entries) {
			x -= Math.max(0, e.w);
			if (x <= 0) return e;
		}
		return entries[entries.length - 1];
	}

	/* The programs a missing season would have been about, strongest first,
	   with a weight that is steep enough that a 90-level blue blood is a real
	   favourite and flat enough that the same four teams do not win every
	   unplayed year in a decade. */
	function contendersOf(carry) {
		const levels = (carry && carry.levels) || {};
		return Object.keys(levels)
			.map((name) => ({ name, level: levels[name] }))
			.filter((x) => Number.isFinite(x.level))
			.sort((a, b) => b.level - a.level ||
				String(a.name).localeCompare(String(b.name)))
			.slice(0, 40)
			.map((x) => ({ name: x.name, level: x.level, w: Math.pow(Math.max(1, x.level - 40), 2.2) }));
	}

	/* The named men the carry says are still on a roster, best first. These
	   are star returners harvested from the season before the gap (see
	   returnersOf), so an extrapolated player of the year is somebody the
	   world has already met rather than a generated name. */
	function returnerPool(carry) {
		const out = [];
		const levels = (carry && carry.levels) || {};
		for (const school of Object.keys((carry && carry.returners) || {})) {
			for (const r of carry.returners[school] || []) {
				if (!r || !r.name) continue;
				out.push({
					name: r.name, school, classYear: r.classYear || null,
					talent: Number.isFinite(r.talent) ? r.talent : 50,
					level: Number.isFinite(levels[school]) ? levels[school] : 55,
				});
			}
		}
		return out.sort((a, b) => (b.talent + b.level * 0.35) - (a.talent + a.level * 0.35) ||
			String(a.name).localeCompare(String(b.name)));
	}

	/* One extrapolated season. `carry` is the world as it stood going into it,
	   already aged to that year by ageCarry. */
	function extrapolateSeason(carry, season, baseSeed, opts) {
		const rng = new global.BBGMRng.Rng(
			String(baseSeed) + "|gap|" + season);
		const field = contendersOf(carry);
		if (!field.length) return null;
		const champ = weightedPick(rng, field);
		const rest = field.filter((x) => x.name !== (champ && champ.name));
		const runnerUp = rest.length ? weightedPick(rng, rest) : null;
		/* The poll No. 1 is the best programme most years and the champion
		   sometimes, which is what a poll is. */
		const apOne = rng.random() < 0.42 && champ ? champ
			: (field[Math.min(field.length - 1, Math.floor(Math.pow(rng.random(), 2) * 6))] || champ);
		const pool = returnerPool(carry);
		/* A player of the year comes from the top of the returner pool,
		   weighted so the best man usually wins it and not always. */
		const poy = pool.length
			? weightedPick(rng, pool.slice(0, 12).map((p, i) => ({ p, w: Math.pow(0.78, i) }))).p
			: null;
		const allAmerica = [];
		const used = new Set(poy ? [poy.name] : []);
		for (const p of pool) {
			if (allAmerica.length >= 5) break;
			if (used.has(p.name)) continue;
			used.add(p.name);
			allAmerica.push(p);
		}
		const awards = [];
		if (poy) {
			awards.push({ season, name: poy.name, school: poy.school,
				award: "Consensus National Player of the Year", extrapolated: true });
		}
		for (const p of allAmerica) {
			awards.push({ season, name: p.name, school: p.school,
				award: "First Team All-American", extrapolated: true });
		}
		if (champ) {
			awards.push({ season, name: null, school: champ.name,
				award: "National Champion", extrapolated: true });
		}
		return {
			season,
			fileName: null,
			seed: null,
			extrapolated: true,
			flavor: "extrapolated — no class file for this season",
			flavorName: null,
			champion: champ ? champ.name : null,
			champSeed: null,
			runnerUp: runnerUp ? runnerUp.name : null,
			champConf: (carry.confOf || {})[champ ? champ.name : ""] || null,
			runnerUpConf: (carry.confOf || {})[runnerUp ? runnerUp.name : ""] || null,
			finalFour: [champ, runnerUp].filter(Boolean).map((x) => x.name),
			apOne: apOne ? apOne.name : null,
			poy: poy ? { name: poy.name, school: poy.school, club: null, nonNcaa: false } : null,
			poyConf: poy ? (carry.confOf || {})[poy.school] || null : null,
			no1: null,
			no1Conf: null,
			realignment: [],
			coachChanges: 0, coachFired: 0, coachRetired: 0, coachHiredAway: 0,
			futureOnRosters: 0, futureHonors: 0,
			awards,
			allAmerica: allAmerica.map((p) => ({ name: p.name, school: p.school })),
			gap: 0,
		};
	}

	/* Every season between two played ones, extrapolated. `carry` is the world
	   as the earlier season left it; it is aged one year per step so the
	   fourth missing year is drawn against a world that has drifted four years
	   rather than against the one the gap started from. */
	function extrapolateGap(carry, fromSeason, toSeason, baseSeed) {
		const out = [];
		if (!carry || !Number.isFinite(fromSeason) || !Number.isFinite(toSeason)) return out;
		let world = carry;
		for (let y = fromSeason + 1; y < toSeason; y++) {
			world = ageCarry(world, 1);
			const row = extrapolateSeason(world, y, baseSeed);
			if (row) {
				out.push(row);
				world = creditGuess(world, row);
			}
		}
		return out;
	}

	/* A GUESSED TITLE IS STILL A TITLE IN THE GUESSED WORLD.

	   Each missing year was drawn against the carry aged one more year, and
	   nothing the previous missing year produced was credited to it — so the
	   champion of 2031 was no stronger going into 2032 than a team that lost
	   in the first round, and ten years past the last file could never
	   produce a dynasty: every year was an independent draw off a field
	   regressing to its mean. The records book, meanwhile, counted those
	   titles off the rows. The guessed world now credits them — a banner, a
	   bump in level for the champion and a smaller one for the runner-up —
	   and keeps a separate `extrapolatedTitles` tally so nothing mistakes an
	   inferred banner for a played one. This is the EXTRAPOLATION's world
	   only: the chain's own carry across a gap is still ageCarry's (see
	   runUniverse), so turning extrapolation off still changes what is
	   displayed and not what is simulated. */
	function creditGuess(world, row) {
		if (!world || !row || !row.champion) return world;
		const out = Object.assign({}, world, {
			titles: Object.assign({}, world.titles || {}),
			extrapolatedTitles: Object.assign({}, world.extrapolatedTitles || {}),
			levels: Object.assign({}, world.levels || {}),
			champion: row.champion,
		});
		out.titles[row.champion] = (out.titles[row.champion] || 0) + 1;
		out.extrapolatedTitles[row.champion] = (out.extrapolatedTitles[row.champion] || 0) + 1;
		if (Number.isFinite(out.levels[row.champion])) {
			out.levels[row.champion] = Math.min(95, out.levels[row.champion] + 2.5);
		}
		if (row.runnerUp && Number.isFinite(out.levels[row.runnerUp])) {
			out.levels[row.runnerUp] = Math.min(95, out.levels[row.runnerUp] + 1);
		}
		row.titlesAfter = out.titles[row.champion];
		return out;
	}

	/* THE TOP-UP FOR A PARTIAL CLASS.

	   A season run from a file that carries half a class produces half a
	   season's honours: the awards module hands out what the field it was
	   given can support, so a forty-man class file yields an All-America team
	   with three men on it and a conference honours list with holes. The
	   season is real and its honours are real; what is missing is everything
	   the men who are not in the file would have won.

	   `share` is how much of a full class the file carried. The honours added
	   are drawn from the same returner pool an extrapolated season uses and
	   are flagged the same way, so nothing that reads a universe can mistake
	   an inferred All-American for a simulated one. */
	function topUpPartialSeason(row, carry, baseSeed, share) {
		if (!row || row.error || !carry) return row;
		if (!(share >= 0) || share >= PARTIAL_CLASS_SHARE) return row;
		const pool = returnerPool(carry)
			.filter((p) => !row.poy || p.name !== row.poy.name);
		if (!pool.length) return row;
		const rng = new global.BBGMRng.Rng(String(baseSeed) + "|partial|" + row.season);
		const want = Math.max(0, Math.round(5 * (1 - share)));
		/* SHUFFLE BEFORE THE TAKE, not after it.

		   The shuffle used to run on the already-chosen subset, so it
		   permuted the order of the same five men and the comment beside it
		   ("not always the same five names") was describing something the
		   code did not do: a chain of partial files topped up with the
		   identical names every season, in a different order each time.

		   The draw is weighted by talent so the best returners are still the
		   likely All-Americans — a top-up is meant to be the men the thin
		   field could not supply, not a lottery — and it is drawn without
		   replacement off the season's own stream, so it replays. */
		const bag = pool.slice();
		const added = [];
		while (added.length < want && bag.length) {
			let total = 0;
			for (const c of bag) total += Math.max(1, c.talent || 50);
			let x = rng.random() * total;
			let idx = bag.length - 1;
			for (let i = 0; i < bag.length; i++) {
				x -= Math.max(1, bag[i].talent || 50);
				if (x <= 0) { idx = i; break; }
			}
			added.push(bag.splice(idx, 1)[0]);
		}
		if (!added.length) return row;
		row.partial = true;
		row.partialShare = share;
		row.awards = (row.awards || []).concat(added.map((p) => ({
			season: row.season, name: p.name, school: p.school,
			award: "First Team All-American", extrapolated: true,
		})));
		row.allAmerica = (row.allAmerica || []).concat(
			added.map((p) => ({ name: p.name, school: p.school })));
		return row;
	}

	/* The extrapolated seasons as alumni rows, so the news desk and a player
	   page can refer to a man who was player of the year in a year nobody
	   played. Flagged, for the reason everything else here is. */
	function extrapolatedAlumni(rows) {
		const out = [];
		for (const r of rows || []) {
			if (!r || !r.extrapolated || !r.poy) continue;
			/* A KEY THAT IS NOT null.

			   These used to carry `key: null`, and records() groups the
			   index with byMan[a.key] — so a universe with a five-year gap
			   collapsed all five extrapolated winners into ONE row keyed
			   null, scoring five times a real player of the year, carrying
			   whichever name came first, and outranking every man who
			   actually played in the Hall of Fame and in
			   playersOfTheDecade. There is no pid to scope here because
			   there is no file; the season and the name are the two facts
			   that identify the row and both are drawn deterministically
			   off the universe seed, so this replays. */
			const id = "extrap:" + r.season + ":" + r.poy.name;
			out.push({
				season: r.season, name: r.poy.name, key: id, id,
				school: r.poy.school, club: null, nonNcaa: false,
				boardRank: null, why: "player of the year", extrapolated: true,
			});
		}
		return out;
	}

	/* THE RECORDS BOOK.

	   A timeline is a list of seasons; a save has a records book. All-time
	   leaders, the longest run at AP No. 1, the best single season anybody
	   had, a player of the decade and an annual Hall of Fame class are what
	   turn twenty rows into a world with a history — and every one of them is
	   derived from rows and alumni the chain already carries, so none of it
	   costs a re-simulation.

	   Everything here is structured for the same reason threads() is. */
	function records(rows, alumni, registry) {
		rows = (rows || []).filter((r) => r && !r.error);
		alumni = alumni || [];
		const titles = {};
		/* Guessed titles are titles in the book — an extrapolated season has a
		   champion and the timeline shows it — but they are counted apart, so
		   the leaderboard can say "3 (1 extrapolated)" rather than pretending
		   all three were played. */
		const guessedTitles = {};
		for (const r of rows) {
			if (r.champion && r.extrapolated) {
				guessedTitles[r.champion] = (guessedTitles[r.champion] || 0) + 1;
			}
		}
		const finals = {};
		const apOnes = {};
		const poys = {};
		const no1s = {};
		for (const r of rows) {
			if (r.champion) titles[r.champion] = (titles[r.champion] || 0) + 1;
			if (r.champion) finals[r.champion] = (finals[r.champion] || 0) + 1;
			if (r.runnerUp) finals[r.runnerUp] = (finals[r.runnerUp] || 0) + 1;
			if (r.apOne) apOnes[r.apOne] = (apOnes[r.apOne] || 0) + 1;
			if (r.poy && r.poy.school && !r.poy.nonNcaa) {
				poys[r.poy.school] = (poys[r.poy.school] || 0) + 1;
			}
			if (r.no1 && r.no1.school && !r.no1.nonNcaa) {
				no1s[r.no1.school] = (no1s[r.no1.school] || 0) + 1;
			}
		}
		const leaders = (map, label) => Object.keys(map)
			.map((team) => ({ team, count: map[team], label }))
			.sort((a, b) => b.count - a.count ||
				String(a.team).localeCompare(String(b.team), undefined, { sensitivity: "base" }))
			.slice(0, 10);

		/* The longest unbroken run at AP No. 1, which is a streak over the
		   ORDERED timeline and so cannot be read off a count. */
		let best = { team: null, length: 0, from: null, to: null };
		let cur = { team: null, length: 0, from: null };
		for (const r of rows) {
			if (r.apOne && r.apOne === cur.team) {
				cur.length++;
			} else {
				cur = { team: r.apOne || null, length: r.apOne ? 1 : 0, from: r.season };
			}
			if (cur.team && cur.length > best.length) {
				best = { team: cur.team, length: cur.length, from: cur.from, to: r.season };
			}
		}

		/* The best single season anybody had: a champion who was also the AP
		   No. 1 and produced the player of the year is the rare one, so the
		   score is simply how many of those three a program collected. */
		let bestSeason = null;
		for (const r of rows) {
			if (!r.champion) continue;
			const score = 1 + (r.apOne === r.champion ? 1 : 0) +
				(r.poy && r.poy.school === r.champion ? 1 : 0) +
				(r.no1 && r.no1.school === r.champion ? 1 : 0);
			if (!bestSeason || score > bestSeason.score) {
				bestSeason = { season: r.season, team: r.champion, score,
					apOne: r.apOne === r.champion,
					poy: !!(r.poy && r.poy.school === r.champion),
					no1: !!(r.no1 && r.no1.school === r.champion) };
			}
		}

		/* Player of the decade, and a Hall of Fame class a season at a time.
		   The alumni index is already the list of men this world remembers and
		   why; weighting the reasons turns it into a ranking. */
		/* GROUPED ON THE SCOPED IDENTITY, not on the pid.

		   `a.key` is a BBGM pid, which every export numbers from zero, so
		   this map used to sum two different men in two different files into
		   one Hall of Fame row. `a.id` is fingerprint-scoped (see alumniOf),
		   and the fallback chain keeps a version 1 or 2 export — whose rows
		   have no id — behaving exactly as it does today rather than
		   throwing. The season is the last resort so that a row with neither
		   is still its own man rather than joining a bucket keyed
		   `undefined`. */
		const WEIGHT = { "player of the year": 5, "top of the board": 2 };
		const byMan = {};
		for (const a of alumni) {
			const w = WEIGHT[a.why] !== undefined ? WEIGHT[a.why]
				: /won the title/.test(a.why || "") ? 3 : 1;
			const id = a.id || (a.key !== null && a.key !== undefined
				? "pid:" + a.key : "anon:" + a.season + ":" + a.name);
			const m = byMan[id] || (byMan[id] = {
				id, key: a.key, name: a.name, school: a.school, seasons: [], score: 0,
				reasons: [],
			});
			m.score += w;
			if (m.seasons.indexOf(a.season) < 0) m.seasons.push(a.season);
			m.reasons.push(a.why);
		}
		const men = Object.keys(byMan).map((k) => byMan[k])
			.sort((a, b) => b.score - a.score ||
				(a.name < b.name ? -1 : 1));
		const decades = {};
		for (const m of men) {
			const dec = Math.floor(Math.min.apply(null, m.seasons) / 10) * 10;
			if (!decades[dec] || decades[dec].score < m.score) decades[dec] = m;
		}
		const hall = men.slice(0, Math.max(5, Math.round(rows.length / 2)));

		const titleLeaders = leaders(titles, "titles");
		for (const x of titleLeaders) x.extrapolated = guessedTitles[x.team] || 0;
		return {
			titles: titleLeaders,
			finals: leaders(finals, "title games"),
			apOnes: leaders(apOnes, "seasons at AP No. 1"),
			poys: leaders(poys, "players of the year"),
			no1s: leaders(no1s, "No. 1 picks"),
			longestApRun: best.team ? best : null,
			bestSeason,
			playersOfTheDecade: Object.keys(decades).sort()
				.map((d) => ({ decade: Number(d), player: decades[d] })),
			hall,
			people: registry ? peopleRecords(registry) : null,
		};
	}

	/* THE RECORD BOOK FOR PEOPLE.

	   records() above is about programmes and about the alumni index's few
	   names a season. The registry (see registryOf) is every person the world
	   has met and every season he appears in, and it supports the questions a
	   save's record book actually answers about men: who collected the most
	   honours, who was around longest, who went undrafted and came back and
	   did the most with it. Structured like everything else here; derived,
	   so it costs no re-run. */
	function peopleRecords(registry) {
		const men = Object.keys(registry || {}).map((id) => registry[id])
			.filter((x) => x && x.id);
		const byName = (a, b) => String(a.name).localeCompare(String(b.name));
		const brief = (x, extra) => Object.assign({ id: x.id, name: x.name,
			span: x.span || 0, school: x.draft ? x.draft.school || null : null }, extra);
		const mostHonors = men.filter((x) => (x.honors || []).length)
			.sort((a, b) => b.honors.length - a.honors.length || b.span - a.span || byName(a, b))
			.slice(0, 10).map((x) => brief(x, { count: x.honors.length,
				seasons: Array.from(new Set(x.honors.map((h) => h.season))).sort() }));
		const mostSeasons = men.filter((x) => (x.seasons || []).length >= 2)
			.sort((a, b) => b.seasons.length - a.seasons.length || b.span - a.span || byName(a, b))
			.slice(0, 10).map((x) => brief(x, { count: x.seasons.length,
				from: x.seasons[0].season, to: x.seasons[x.seasons.length - 1].season }));
		const returners = [];
		for (const x of men) {
			const back = (x.seasons || []).filter((s) => s.as === "returned undrafted");
			if (!back.length) continue;
			const ppg = back.reduce((a, s) => Math.max(a, Number.isFinite(s.ppg) ? s.ppg : 0), 0);
			const honors = (x.honors || []).filter((h) => (x.returned || []).indexOf(h.season) !== -1).length;
			returners.push(brief(x, { returned: back.map((s) => s.season), bestPpg: ppg, honors,
				score: back.length * 10 + honors * 6 + ppg }));
		}
		returners.sort((a, b) => b.score - a.score || byName(a, b));
		let bestSeason = null;
		for (const x of men) {
			const per = {};
			for (const h of x.honors || []) per[h.season] = (per[h.season] || 0) + 1;
			for (const season of Object.keys(per)) {
				if (!bestSeason || per[season] > bestSeason.count) {
					bestSeason = brief(x, { season: Number(season), count: per[season] });
				}
			}
		}
		return {
			mostHonors, mostSeasons,
			bestReturners: returners.slice(0, 10),
			bestHonorSeason: bestSeason,
			people: men.length,
			careers: men.filter((x) => x.span >= 2).length,
		};
	}

	/* PROGRAM HISTORY.

	   The chain plays every programme every season and threw away everything
	   but the champion's name: a team page could say what Butler did in the
	   season on screen and nothing about Butler in the universe. One compact
	   row per programme per played season — level (the programme's, not the
	   coached one), prestige drift, coach, conference, record, March result,
	   title — is recorded as the chain runs (see programRowsOf) and read here.
	   With no recorded rows (a reload: the table is not persisted) it is
	   rebuilt from whatever results are handed in. */
	function programRowsOf(res, carryAfter) {
		const out = {};
		const champ = res && res.tourney && res.tourney.champion
			? res.tourney.champion.team.name : null;
		for (const t of Object.values((res && res.teams) || {})) {
			if (!t || !t.name || !t.log) continue;
			const adj = t.coach && Number.isFinite(t.coach.levelAdj) ? t.coach.levelAdj : 0;
			const lvl = Number.isFinite(t.baseLevel) ? t.baseLevel : t.level - adj;
			out[t.name] = {
				season: res.season,
				level: Math.round(lvl * 10) / 10,
				drift: carryAfter && carryAfter.prestigeDelta
					? carryAfter.prestigeDelta[t.name] || 0 : 0,
				coach: t.coach ? t.coach.name : null,
				movedFrom: t.coach && t.coach.movedFrom ? t.coach.movedFrom : null,
				conf: t.conf || null,
				w: t.w || 0, l: t.l || 0,
				ncaa: t.ncaaResult || null,
				seed: Number.isFinite(t.ncaaSeed) ? t.ncaaSeed : null,
				title: t.name === champ,
			};
		}
		return out;
	}

	function addProgramRows(programs, rows) {
		for (const name of Object.keys(rows)) {
			(programs[name] = programs[name] || []).push(rows[name]);
		}
		return programs;
	}

	function programHistory(u, name, results) {
		let programs = u && u.programs;
		if ((!programs || !Object.keys(programs).length) && Array.isArray(results)) {
			programs = {};
			const sorted = results.filter(Boolean).slice()
				.sort((a, b) => (a.season || 0) - (b.season || 0));
			for (const res of sorted) addProgramRows(programs, programRowsOf(res, null));
		}
		programs = programs || {};
		const one = (list) => {
			let titles = 0;
			return (list || []).slice().sort((a, b) => a.season - b.season).map((r) => {
				if (r.title) titles++;
				return Object.assign({}, r, { titles });
			});
		};
		if (name) return one(programs[name]);
		const out = {};
		for (const n of Object.keys(programs)) out[n] = one(programs[n]);
		return out;
	}

	/* The universe as a file.

	   The format is still seeds and fingerprints rather than simulated output,
	   because that is what the deterministic RNG design buys and it keeps a
	   fifty-season world under a kilobyte. Three things are added:

	     - `settings`, because a universe is only reproducible if the settings
	       it ran under travel with it. Without them, importing somebody's
	       fifty-season world at YOUR coachTurnover and YOUR era replays
	       something else entirely and calls it the same universe.
	     - `biography`, the class year and transfer path drawn for each player
	       key. Once a prospect appears in more than one season these have to be
	       a fact about the WORLD rather than about one run.
	     - `files`, optional, so a universe can be one file you hand somebody
	       instead of a file plus a folder of class exports.

	   `version` goes to 3. Older files still import — see importUniverse,
	   which reads what is present and says what is missing. */
	const ALUMNI_EXPORT_MAX = 5000;

	function exportUniverse(u, opts) {
		opts = opts || {};
		const out = {
			format: "bbgm-draft-workshop/universe",
			version: VERSION,
			/* Which engine built it. An import that replays these seeds
			   compares its own rev and its own per-season result fingerprints
			   against the ones stored here — see importUniverse. */
			engineRev: ENGINE_REV,
			name: u.name || "Universe",
			createdAt: u.createdAt || new Date().toISOString(),
			baseSeed: u.baseSeed,
			settings: u.settings || null,
			seasons: (u.rows || []).map((r) => ({
				season: r.season, fileName: r.fileName,
				fingerprint: r.fingerprint || null, seed: r.seed,
				/* What the season PRODUCED, so a replay can tell that it got a
				   different world rather than assuming it did not. */
				result: r.result || null,
				gap: r.gap || 0,
				error: r.error || null,
			})),
			/* THE WORLD ITSELF, NOT ONLY ITS SEEDS.

			   The export carried seeds, fingerprints and settings, which is
			   everything needed to REPRODUCE the universe and nothing at all
			   about what it was. So a shared universe whose replay diverged —
			   a newer engine, a class file the recipient had a different copy
			   of, a locked setting — arrived as a different world with the
			   right name, and the file it came from could not even say who had
			   won. Divergence was detected and then had nothing to show.

			   The rows are the timeline as it was played: champion, runner-up,
			   player of the year, No. 1 pick, the poll, the Final Four, the
			   coaching carousel counts. They are small — a season is a few
			   hundred bytes — and they are the whole of what a person means
			   when they say they want to keep somebody's universe. Threads,
			   the records book and the alumni index travel with them because
			   all three are derived from the rows and re-deriving them on
			   import would produce a book that disagreed with its own
			   timeline.

			   `tail` is what step() carried out of the last season, so an
			   imported universe can be EXTENDED with a later class file
			   instead of only replayed (see canExtendUniverse in js/app.js). */
			timeline: (u.rows || []).map((r) => Object.assign({}, r)),
			threads: (u.threads || []).slice(0, 400),
			records: u.records || null,
			/* The whole index, not the last 400: a diverged import REPLACED
			   the replay's alumni with this slice, so a forty-season world
			   came back remembering its last eighty seasons' worth of names
			   and none of its first. A row is a hundred bytes. */
			alumni: (u.alumni || []).slice(-ALUMNI_EXPORT_MAX),
			tail: u.tail || null,
			/* HOW THE WORLD WAS BUILT, not only from what.

			   A universe that was extended, or partly re-run under new
			   settings, is not the cold chain of its files: an extension's
			   earlier seasons never saw the appended classes, and a resumed
			   run's later seasons ran under different settings from its held
			   ones. `segments` records each run in order — cold, extend@k,
			   resume@k — with the settings it ran under, and `order` the
			   files in chain order, so an import can replay it run by run
			   (see replayPlan) instead of replaying a cold chain and calling
			   the difference a divergence. */
			segments: (u.segments || []).map((g) => ({
				kind: g.kind, from: g.from, to: g.to, settings: g.settings || null,
			})),
			order: (u.order || []).map((d) => ({
				season: d.season, name: d.name || null,
				fingerprint: d.fingerprint || null, seed: d.seed || null,
			})),
		};
		if (u.broken) out.broken = u.broken;
		if (u.biography && Object.keys(u.biography).length) out.biography = u.biography;
		/* THE CAREERS. Derived from the results, like the threads and the
		   records book, and travelling with the timeline for the same reason:
		   an imported world whose class files are not to hand can still say
		   who its people were. Only the multi-season rows — a man who appears
		   once is a draft prospect and the timeline already has him. */
		if (u.registry) {
			const careers = {};
			for (const id of Object.keys(u.registry)) {
				const x = u.registry[id];
				if (x && x.span >= 2) careers[id] = x;
			}
			if (Object.keys(careers).length) out.registry = careers;
		}
		if (opts.embedFiles && Array.isArray(opts.files)) {
			out.files = opts.files.map((f) => ({
				name: f.name, fingerprint: f.fingerprint || null, data: f.data,
			}));
		}
		return out;
	}

	/* Every player's class year and transfer path, keyed by player key.

	   A biography is drawn per run today, which is correct while a file is one
	   world on its own and wrong the moment a prospect appears in more than one
	   season of a chain: a man who is a junior in the 2027 class has to have
	   been a sophomore in 2026, and re-drawing it each season would make him a
	   different person every time somebody moved a slider. Exported so that a
	   shared universe replays the same men, not merely the same seeds. */
	/* AN IDENTITY THAT SURVIVES A FILE BOUNDARY.

	   A class file's player key is its pid, which BBGM numbers from zero
	   inside each export — so pid 7 exists in every file in a universe and
	   means a different man in each. Every cross-file structure here was keyed
	   on it anyway, and `biographyOf` in particular walked the files in order
	   and took the FIRST occurrence of each key: in a chain of real BBGM
	   exports that hands the 2025 class's biography to the 2026 class's man
	   with the same pid, silently, in a map whose entire purpose is to make a
	   replay reproduce the same men.

	   The file's fingerprint is its content, so fingerprint + pid is unique
	   across a universe and stable across a replay — which is the same pair
	   `seedFor` already uses to key a season. `biographyForFile` projects the
	   universe-wide map back down to the per-file map the engine reads, so the
	   engine stays file-local and knows nothing about any of this. */
	function playerId(fingerprint, key) {
		return String(fingerprint || "?").slice(0, 12) + "/" + String(key);
	}

	/* The per-file view the engine's `cfg.biography` wants. A version 1 or 2
	   export's map is keyed on the bare pid, and is handed back unchanged: it
	   is wrong in exactly the way described above, and rejecting it would
	   break every universe file already in the wild for a fault that only
	   shows up on colliding pids. Its own `__scoped` marker says which it is. */
	function biographyForFile(map, fingerprint) {
		if (!map || typeof map !== "object") return null;
		if (!map.__scoped) return map;
		const prefix = playerId(fingerprint, "");
		const out = {};
		for (const id of Object.keys(map)) {
			if (id === "__scoped" || id.indexOf(prefix) !== 0) continue;
			out[id.slice(prefix.length)] = map[id];
		}
		return out;
	}

	/* WHICH FILE A RESULT CAME OUT OF.

	   Both functions below are handed `results` and `files` and used to index
	   the second with the first's array position. That is right only while the
	   two arrays line up, and in the app they do not have to: the chain's
	   results are collected by walking the files it actually ran (see
	   liveResults in js/app.js), so a file that failed validation, or one
	   loaded after the chain, is skipped and every result after it shifts down
	   one. The fingerprints then belong to the wrong men — two careers merged
	   under one id, one career split across two — and the Careers table's
	   "open his page" button opened somebody else's file.

	   So the chain stamps the file index on the result it produced, and this
	   reads it. A result without one (tools/universe.js builds its chain one
	   result per file, in order) falls back to the position, which is what it
	   always did and is correct there. */
	function fileIndexOf(res, i) {
		return res && Number.isFinite(res.fileIndex) ? res.fileIndex : i;
	}

	function biographyOf(results, files) {
		const out = { __scoped: true };
		(results || []).forEach((res, i) => {
			if (!res || !res.players) return;
			const at = fileIndexOf(res, i);
			const fp = (files && files[at] && files[at].fingerprint) ||
				(res.leagueFile && res.leagueFile.startingSeason) || at;
			for (const p of res.players) {
				if (!p.key) continue;
				const id = playerId(fp, p.key);
				if (out[id]) continue;
				out[id] = {
					classYear: p.classYear,
					redshirt: p.redshirt || null,
					reclassified: p.reclassified || null,
					transfer: p.transfer
						? { kind: p.transfer.kind, from: p.transfer.from || null,
							fifthYear: !!p.transfer.fifthYear }
						: null,
					college: p.newCollege,
				};
			}
		});
		return out;
	}

	/* THE PERSISTENT PLAYER REGISTRY.

	   Three audits have recorded this as the enabling change for half of the
	   universe list, and it is one thing: an index of PEOPLE rather than of
	   seasons. Everything a universe knew was keyed on a program — this school
	   won N titles, that conference owned a decade — because a program has a
	   name that is the same in every file and a player did not.

	   Now he does (see playerId), and there is a second source of him: the
	   reverse roster link puts an undrafted man on the rosters of the seasons
	   after his own class file, and the forward link already put a later
	   class's underclassmen on the seasons before theirs. So one man can
	   appear in a universe as his own draft class, as somebody else's season's
	   freshman, and as a returner — and the registry is what says those are
	   one person.

	   Deliberately compact. It is persisted, it rides in an export, and a
	   forty-season universe carrying a full career per player is not a
	   localStorage payload: one row per person, with the seasons he appears in
	   and what he was in each. The heavy data stays on the results. */
	function registryOf(results, files, rows) {
		const out = {};
		const seasonOf = (i) => {
			const r = results && results[i];
			if (r && Number.isFinite(r.season)) return r.season;
			const row = rows && rows[i];
			return row && Number.isFinite(row.season) ? row.season : null;
		};
		const fpOf = (i) => (files && files[i] && files[i].fingerprint) || String(i);
		const touch = (id, name) => {
			if (!out[id]) {
				out[id] = { id, name, seasons: [], draft: null, honors: [], returned: [] };
			}
			return out[id];
		};
		(results || []).forEach((res, i) => {
			if (!res) return;
			const season = seasonOf(i);
			const self = fileIndexOf(res, i);
			/* His own class: the season he was drafted out of, where his board
			   rank and his honours are. */
			for (const p of res.players || []) {
				if (!p.key) continue;
				const e = touch(playerId(fpOf(self), p.key), p.name);
				e.fileIndex = self;
				e.draft = {
					season, boardRank: p.boardRank || null,
					slot: p.draftSlot || null, school: p.newCollege,
					club: p.proClub || null, classYear: p.classYear,
					ovr: p.newOvr, pot: p.newPot,
				};
				if (Number.isFinite(season)) e.seasons.push({ season, as: "draft class" });
				for (const a of p.awards || []) e.honors.push({ season, award: a });
			}
			/* And every season he played that is not his own file's. The
			   forward link and the reverse link both land here — they are the
			   same fact about a person from two directions. */
			for (const fp of res.futurePlayers || []) {
				if (!fp.homeKey && !fp.key) continue;
				/* `self` and `fp.fileIndex` are both FILE indices — the one
				   the result came out of, and the one the roster entry was
				   built from. Mixing a file index with an array position here
				   is exactly what fileIndexOf exists to stop. */
				const home = fp.past ? self : fp.fileIndex;
				const key = fp.past ? fp.homeKey || fp.key : fp.homeKey;
				if (!Number.isFinite(home) || !key) continue;
				const e = touch(playerId(fpOf(home), key), fp.name);
				if (Number.isFinite(season)) {
					e.seasons.push({
						season, as: fp.past ? "returned undrafted" : "underclassman",
						school: fp.newCollege, classYear: fp.classYear,
						ppg: fp.stats ? fp.stats.ppg : null,
					});
					if (fp.past) e.returned.push(season);
				}
				for (const a of fp.awards || []) e.honors.push({ season, award: a });
			}
		});
		for (const id of Object.keys(out)) {
			const e = out[id];
			e.seasons.sort((a, b) => a.season - b.season);
			e.honors.sort((a, b) => a.season - b.season);
			e.returned.sort((a, b) => a - b);
			/* The span is what makes a row worth looking at: a man who appears
			   in one season is a draft prospect, and a man who appears in four
			   is a career. */
			e.span = e.seasons.length
				? e.seasons[e.seasons.length - 1].season - e.seasons[0].season + 1 : 0;
		}
		return out;
	}

	/* THE REGISTRY, BUILT AS THE CHAIN RUNS.

	   registryOf takes every result at once, and the app used to call it at
	   the end of a chain over liveResults() — which rehydrated (re-simulated)
	   every season eviction had dropped, all of them at once, to build a map
	   of a few thousand small rows. The chain now folds each season's rows
	   in as it plays it, and a resume prunes the seasons it is about to
	   re-run. Same rows, no rehydration. */
	function finalizeEntry(e) {
		e.seasons.sort((a, b) => a.season - b.season);
		e.honors.sort((a, b) => a.season - b.season);
		e.returned.sort((a, b) => a - b);
		e.span = e.seasons.length
			? e.seasons[e.seasons.length - 1].season - e.seasons[0].season + 1 : 0;
		return e;
	}

	function mergeRegistry(into, add) {
		into = into || {};
		for (const id of Object.keys(add || {})) {
			const x = add[id];
			const e = into[id];
			if (!e) { into[id] = x; continue; }
			into[id] = finalizeEntry(Object.assign({}, e, {
				name: e.name || x.name,
				draft: x.draft || e.draft || null,
				fileIndex: Number.isFinite(x.fileIndex) ? x.fileIndex : e.fileIndex,
				seasons: (e.seasons || []).concat(x.seasons || []),
				honors: (e.honors || []).concat(x.honors || []),
				returned: (e.returned || []).concat(x.returned || []),
			}));
		}
		return into;
	}

	function pruneRegistry(reg, lastSeason) {
		const out = {};
		if (!Number.isFinite(lastSeason)) return out;
		for (const id of Object.keys(reg || {})) {
			const e = reg[id];
			if (!e) continue;
			const seasons = (e.seasons || []).filter((s) => s.season <= lastSeason);
			const draft = e.draft && e.draft.season <= lastSeason ? e.draft : null;
			if (!seasons.length && !draft) continue;
			out[id] = finalizeEntry(Object.assign({}, e, {
				seasons, draft,
				honors: (e.honors || []).filter((h) => h.season <= lastSeason),
				returned: (e.returned || []).filter((s) => s <= lastSeason),
			}));
		}
		return out;
	}

	/* ONE RECRUITING CLASS ACROSS SEVERAL FILES.

	   assignRecruiting ranks within the high-school cohort, and a file run
	   alone can only see the members of a cohort that are in that file. So
	   a 19-year-old freshman in the 2027 class and the 20-year-old
	   sophomore in the 2028 class — the same high-school class — each came
	   out No. 1 nationally in his own file, and the universe, which chains
	   everything else, did not chain the one layer most visible on a player
	   page.

	   The chain already runs every file's build phase alone, oldest first,
	   before any season is played (see runUniverse's preview pass). This
	   takes those previews, pools every player's recruiting score by his
	   high-school class across all of them, ranks each pooled cohort once
	   with the engine's own rankCohort, and hands the ranks back per player
	   for the real run to take (cfg.universeRecruiting).

	   A cohort is PARTIAL when a draft year it would feed is not loaded: the
	   oldest file's seniors have no cohort-mates loaded, and the newest
	   file's freshmen have cohort-mates who have not been drafted yet. They
	   are ranked as-is and marked, rather than pretended complete, and the
	   Universe tab says which. */
	function recruitingCohorts(previews) {
		const E = global.Engine;
		const loaded = new Set();
		for (const pv of previews || []) {
			if (pv && Number.isFinite(pv.season)) loaded.add(pv.season);
		}
		const groups = {};
		/* One map PER FILE, because a player key is a pid and two class
		   files can reuse the same pids for different men. */
		const byFile = (previews || []).map(() => ({}));
		(previews || []).forEach((pv, fileIdx) => {
			if (!pv || !pv.players || !Number.isFinite(pv.season)) return;
			for (const p of pv.players) {
				const rec = p.recruiting;
				if (!rec || !Number.isFinite(rec.score) || !Number.isFinite(rec.hsClass)) continue;
				(groups[rec.hsClass] = groups[rec.hsClass] || []).push({
					key: p.key, fileIdx, season: pv.season, name: p.name,
					recruiting: { score: rec.score, diOnly: rec.diOnly },
				});
			}
		});
		const cohorts = [];
		for (const h of Object.keys(groups).map(Number).sort((a, b) => a - b)) {
			const members = groups[h];
			/* Freshman through senior: the draft years this class feeds. */
			const missing = [];
			for (let y = h + 1; y <= h + 4; y++) if (!loaded.has(y)) missing.push(y);
			const partial = missing.length > 0;
			const seasons = Array.from(new Set(members.map((m) => m.season))).sort();
			E.rankCohort(members);
			let top = null;
			for (const m of members) {
				byFile[m.fileIdx][m.key] = {
					rank: m.recruiting.rank, partial, cohortSize: members.length,
				};
				if (!top || m.recruiting.rank < top.rank) {
					top = { rank: m.recruiting.rank, name: m.name, season: m.season };
				}
			}
			cohorts.push({ hsClass: h, size: members.length, seasons, partial, missing, top });
		}
		return { byFile, cohorts };
	}

	/* ------------------------------------------------------ THE CHAIN

	   What js/app.js used to run inline, as closures inside runUniverse: the
	   state going into season one (cold, an extension's tail, or a held
	   season's recorded config), the preview pass, the recruiting cohorts,
	   both roster links, the step, and the tail a finished run leaves. It
	   lives here so the app and tools/universe.js run the SAME code — the
	   harness used to carry its own copy of the loop, and so a resume that did
	   not reproduce the chain, or an extension that forgot the returners of
	   the seasons it held, was invisible to it.

	   Nothing here touches the DOM or app state: the caller hands in the
	   files, a config maker, a runner per file and somewhere to put each
	   result, and gets back an object that plays one season per step(). */

	/* THE MEN A SEASON DID NOT GET DRAFTED, WITHOUT THE SEASON.

	   The chain used to keep every finished result that had a returner in it
	   (`returners.push({ res })`) for the rest of the run, and ask each one
	   again every season — a result is the whole season (teams, box scores,
	   game logs), so a forty-season chain held forty seasons whatever the
	   eviction budget said, and every later season paid a pass over all of
	   them. A source is now just the men Engine.pastRosterFor can ever return
	   from that season, with the fields it reads, and `until` — the last
	   season any of them has eligibility for — so a source drops out of the
	   window the moment it cannot contribute. Small enough to ride in the
	   tail, which is what lets an extension (and a resume) hand the next
	   season the same returners a cold chain would have. */
	function returnerSource(res, index) {
		const E = global.Engine;
		if (!res || !res.players || !Number.isFinite(res.season) ||
			!E || typeof E.pastRosterFor !== "function") return null;
		const keys = new Set();
		let until = null;
		for (let a = 1; a <= 4; a++) {
			let got = [];
			try { got = E.pastRosterFor(res, res.season + a, index); } catch (e) { got = []; }
			if (!got.length) continue;
			until = res.season + a;
			for (const x of got) keys.add(x.key);
		}
		if (!keys.size) return null;
		const players = [];
		for (const p of res.players) {
			if (!keys.has(p.key)) continue;
			players.push({
				key: p.key, name: p.name, nonNcaa: !!p.nonNcaa,
				buildCleanBase: p.buildCleanBase, boardRank: p.boardRank,
				classYear: p.classYear, newCollege: p.newCollege,
				newOvr: p.newOvr, talentPot: p.talentPot, archetype: p.archetype,
				origRatings: p.origRatings ? { fuzz: p.origRatings.fuzz } : null,
				buildPinned: p.buildPinned, hand: p.hand, volatility: p.volatility,
				orbBias: p.orbBias, traitInjuryMult: p.traitInjuryMult,
			});
		}
		return { season: res.season, index, until, res: { season: res.season, players } };
	}

	function pastRosterFrom(sources, season) {
		let out = [];
		if (!Number.isFinite(season)) return out;
		for (const src of sources || []) {
			if (!src || !(season > src.season) || season > src.until) continue;
			/* Once per earlier season, not once per candidate: the whole
			   population is one call, and a returner's overall is computed
			   against the season that is asking. */
			out = out.concat(global.Engine.pastRosterFor(src.res, season, src.index));
		}
		return out;
	}

	/* The settings order position `p` last ran under. */
	function segmentSettings(u, p) {
		let found = null;
		for (const g of (u && u.segments) || []) {
			if (g && p >= g.from && p < g.to && g.settings) found = g.settings;
		}
		return found || (u && u.settings) || null;
	}

	function pruneProgramsAfter(programs, lastSeason) {
		const out = {};
		for (const name of Object.keys(programs || {})) {
			const list = programs[name].filter((r) => !Number.isFinite(lastSeason) ||
				r.season <= lastSeason);
			if (list.length) out[name] = list;
		}
		return out;
	}

	/* spec: {
	     mode: "cold" | "extend" | "resume", from (resume position),
	     universe: the existing universe (extend / resume),
	     files, runnable ([{index, name, season}] in chain order),
	     settings (the frozen config), baseSeed, make (settings -> fresh cfg),
	     runnerFor(index), store(index, res), biographyFor(fingerprint),
	     extrapolateGaps, fullClass, anomalyHistory, diags,
	   } */
	function beginChain(spec) {
		const E = global.Engine;
		const make = spec.make;
		const files = spec.files || [];
		const prior = spec.universe || null;
		const mode = spec.mode || "cold";
		const frozen = spec.settings;
		const baseSeed = spec.baseSeed;
		const fullClass = spec.fullClass || 65;
		const anomalyHistory = spec.anomalyHistory || 4;
		const copyPools = (list) => (list || []).map((a) => a.slice());
		const fpAt = (index) => (files[index] && files[index].fingerprint) || null;
		const runnable = (spec.runnable || []).map((d) => ({
			index: d.index, name: d.name, season: d.season, fingerprint: fpAt(d.index),
		}));
		const indexOf = (d) => {
			if (d && Number.isFinite(d.index) && files[d.index] &&
				(!d.fingerprint || files[d.index].fingerprint === d.fingerprint)) return d.index;
			if (!d || !d.fingerprint) return -1;
			for (let i = 0; i < files.length; i++) {
				if (files[i] && files[i].fingerprint === d.fingerprint) return i;
			}
			return -1;
		};
		let held = [];
		let carry = null;
		let lastSeason = null;
		let recentPools = [];
		let recentAnomalies = [];
		let sources = [];
		let tree = null;
		let seedBase = 0;
		let u;
		let segment;
		if (mode === "extend") {
			const tail = prior.tail;
			/* A persisted order's file indices are the LAST session's; the
			   files may have been dropped back in a different order. Each
			   held entry is re-pointed at the loaded file with its
			   fingerprint, or at none. */
			held = (prior.order || []).map((h) => Object.assign({}, h, { index: indexOf(h) }));
			carry = tail.carry || null;
			lastSeason = tail.lastSeason;
			recentPools = copyPools(tail.recentPools);
			recentAnomalies = copyPools(tail.recentAnomalies);
			sources = (tail.returners || []).slice();
			tree = prior.coachTree || null;
			seedBase = Number.isFinite(tail.count) ? tail.count : held.length;
			/* THE LAST RUN'S GUESSED TAIL COMES OFF BEFORE ANYTHING IS
			   APPENDED. The rows extrapolated past the old last season
			   describe years this extension is about to play or re-draw;
			   pruning them only in finish() left the gap rows the first new
			   season draws sitting beside the old guesses for the same
			   years. */
			const live = (x) => !(x && x.extrapolated && Number.isFinite(x.season) &&
				Number.isFinite(lastSeason) && x.season > lastSeason);
			segment = { kind: "extend", from: held.length, to: held.length + runnable.length,
				settings: frozen };
			u = Object.assign(prior, {
				rows: (prior.rows || []).filter((r) => r && live(r)),
				alumni: (prior.alumni || []).filter((a) => a && live(a)),
				order: held.concat(runnable),
				segments: (prior.segments || []).concat([segment]),
				links: prior.links || {},
				programs: pruneProgramsAfter(prior.programs, lastSeason),
				registry: prior.registry || {},
				cfgs: prior.cfgs || {},
				running: true, diags: spec.diags || prior.diags, total: runnable.length,
				done: 0, cancelled: false, records: null, careers: null,
			});
		} else if (mode === "resume") {
			const from = spec.from;
			held = prior.order.slice(0, from);
			const saved = prior.cfgs[prior.order[from].index];
			carry = saved.carryOver || null;
			recentPools = copyPools(saved.recentPools);
			recentAnomalies = copyPools(saved.recentAnomalies);
			sources = (saved.returners || []).slice();
			lastSeason = held.length ? held[held.length - 1].season : null;
			seedBase = from;
			tree = pruneCoachTree(prior.coachTree, lastSeason);
			const keptFps = held.map((d) => d.fingerprint).filter(Boolean);
			const heldRow = (r) => {
				if (!r) return false;
				/* An extrapolated row belongs to the held seasons when it is
				   inside them; a guessed year after the resume point goes with
				   the seasons it described (step() re-draws a gap it walks
				   past). */
				if (r.extrapolated) {
					return Number.isFinite(r.season) && Number.isFinite(lastSeason) &&
						r.season <= lastSeason;
				}
				if (Number.isFinite(r.position)) return r.position < from;
				return keptFps.indexOf(r.fingerprint) !== -1;
			};
			const links = {};
			for (const t of Object.keys(prior.links || {})) {
				const list = prior.links[t].filter((x) => x.position < from);
				if (list.length) links[t] = list;
			}
			/* A superseded resume is dropped: everything it re-ran is being
			   re-run again. Cold and extend segments stay, because they are
			   what built the order the held seasons came from. */
			const segs = (prior.segments || []).filter((g) =>
				!(g.kind === "resume" && g.from >= from));
			segment = { kind: "resume", from, to: held.length + runnable.length, settings: frozen };
			const rows = (prior.rows || []).filter(heldRow);
			u = Object.assign(prior, {
				rows,
				alumni: (prior.alumni || []).filter((a) => a && (Number.isFinite(a.position) && !a.extrapolated
					? a.position < from
					: !Number.isFinite(lastSeason) || a.season <= lastSeason)),
				order: held.concat(runnable),
				segments: segs.concat([segment]),
				links,
				programs: pruneProgramsAfter(prior.programs, lastSeason),
				registry: pruneRegistry(prior.registry, lastSeason),
				coachTree: tree,
				running: true, diags: spec.diags || prior.diags, total: runnable.length,
				done: 0, cancelled: false, records: null, careers: null,
				broken: (rows.filter((r) => r.error)[0] || {}).season || null,
			});
		} else {
			segment = { kind: "cold", from: 0, to: runnable.length, settings: frozen };
			u = {
				rows: [], threads: [], alumni: [], baseSeed, cfgs: {},
				/* The chain's own order, so a result evicted to bound memory
				   can be rebuilt AND relinked on demand. */
				order: runnable.slice(),
				running: true, diags: spec.diags || null, total: runnable.length, done: 0,
				settings: frozen, segments: [segment], coachTree: null, records: null,
				engineRev: ENGINE_REV, cancelled: false, broken: null, tail: null,
				links: {}, programs: {}, registry: {},
				/* Stamped once, here, so two exports of one world are the
				   same bytes; an import's replay passes the file's own. */
				name: spec.name || "Universe",
				createdAt: spec.createdAt || new Date().toISOString(),
			};
		}
		const seedAt = (k) => seedFor(baseSeed, seedBase + k, runnable[k].season,
			runnable[k].fingerprint);

		/* PASS ONE: who is in every class, before any season is played — the
		   files this run plays, AND the ones it holds. The held previews are
		   rebuilt from the seed and settings each held season recorded, so
		   the recruiting cohorts a resumed or extended season is ranked in
		   are the ones a cold chain over the same files ranks it in. */
		const heldPreviews = [];
		{
			let pools = [];
			for (let p = 0; p < held.length; p++) {
				const h = held[p];
				const idx = indexOf(h);
				const saved = prior && prior.cfgs && idx >= 0 ? prior.cfgs[idx] : null;
				const seed = (saved && saved.seed) || h.seed || null;
				const settings = (saved && saved.settings) || segmentSettings(prior, p) || frozen;
				const use = saved && saved.recentPools ? saved.recentPools : pools;
				let pv = null;
				if (idx >= 0 && seed) {
					try {
						const c = make(settings);
						c.seed = seed;
						c.overrides = {};
						c.recentPools = copyPools(use);
						pv = E.previewClass(files[idx].data, c);
					} catch (e) { pv = null; }
				}
				heldPreviews.push(pv);
				pools = copyPools(use);
				if (pv && pv.archetypePool) {
					pools.unshift(pv.archetypePool.slice());
					pools = pools.slice(0, 3);
				}
			}
		}
		const previews = [];
		{
			let pools = copyPools(recentPools);
			for (let k = 0; k < runnable.length; k++) {
				let pv = null;
				try {
					const c = make(frozen);
					c.seed = seedAt(k);
					c.overrides = {};
					c.recentPools = copyPools(pools);
					pv = E.previewClass(files[runnable[k].index].data, c);
				} catch (e) { pv = null; }
				previews.push(pv);
				if (pv && pv.archetypePool) {
					pools.unshift(pv.archetypePool.slice());
					pools = pools.slice(0, 3);
				}
			}
		}
		/* PASS ONE AND A HALF: rank every recruiting class across ALL the
		   files at once. See recruitingCohorts. */
		let recruiting = null;
		try {
			recruiting = recruitingCohorts(heldPreviews.concat(previews));
			u.recruiting = recruiting.cohorts;
		} catch (e) { recruiting = null; }
		const rosterFor = (k) => {
			const season = runnable[k].season;
			if (!Number.isFinite(season)) return [];
			let out = [];
			for (let j = k + 1; j < runnable.length; j++) {
				if (!previews[j] || !(runnable[j].season > season)) continue;
				out = out.concat(E.futureRosterFor(previews[j], season, runnable[j].index));
			}
			return out;
		};

		const stats = { resimulated: 0, touched: 0 };
		const captureLinks = (res, d, position) => {
			const shift = (typeof E.classSeasonOf === "function"
				? E.classSeasonOf(res) : res.season) - res.season;
			for (const fp of res.futurePlayers || []) {
				if (!fp || !fp.stats || !Number.isFinite(fp.fileIndex)) continue;
				const team = res.teams && res.teams[fp.newCollege];
				(u.links[fp.fileIndex] = u.links[fp.fileIndex] || []).push({
					source: d.index, position, season: res.season,
					exportSeason: res.season + shift, fp,
					team: team ? { w: team.w, l: team.l, box: team.box, lines: team.lines,
						postseason: team.ncaaResult || team.nitResult || null } : null,
				});
			}
		};

		function step(k) {
			const d = runnable[k];
			const position = held.length + k;
			/* A HOLE IN THE FILES IS TIME PASSING. See ageCarry. */
			const gap = (carry && Number.isFinite(lastSeason) && Number.isFinite(d.season))
				? Math.max(0, d.season - lastSeason - 1) : 0;
			/* THE YEARS NOBODY PLAYED GET AN ACCOUNT OF THEMSELVES — on the
			   timeline, and NOT fed back into the chain: `carry` below is
			   still ageCarry's. See extrapolateGap. */
			if (gap > 0 && spec.extrapolateGaps !== false) {
				const guessed = extrapolateGap(carry, lastSeason, d.season, baseSeed);
				for (const row of guessed) u.rows.push(row);
				u.alumni = u.alumni.concat(extrapolatedAlumni(guessed));
			}
			if (gap > 0) carry = ageCarry(carry, gap);
			let res = null;
			try {
				const cfg = make(frozen);
				cfg.seed = seedAt(k);
				cfg.overrides = {};
				cfg.recentPools = copyPools(recentPools);
				cfg.recentAnomalies = copyPools(recentAnomalies);
				cfg.carryOver = carry;
				cfg.universeRoster = rosterFor(k);
				// The window: a source nobody in it can return from is gone.
				if (Number.isFinite(d.season)) sources = sources.filter((s) => d.season <= s.until);
				const sourcesIn = sources.slice();
				cfg.pastRoster = pastRosterFrom(sources, d.season);
				cfg.biography = spec.biographyFor ? spec.biographyFor(d.fingerprint) : null;
				cfg.universeRecruiting = recruiting
					? { byKey: recruiting.byFile[position] || {} } : null;
				/* What the world remembers, for the news desk. Bounded,
				   because it rides in a config that is kept per file. */
				cfg.universeAlumni = u.alumni.slice(-120);
				cfg.universeTitles = (carry && carry.titles) || {};
				const prevCarry = carry;
				res = spec.runnerFor(d.index).run(cfg);
				const heavy = (res.phasesRun || [])
					.some((x) => x === "build" || x === "regular" || x === "stats");
				if (heavy) stats.resimulated++;
				if ((res.phasesRun || []).length) stats.touched++;
				res.fileIndex = d.index;
				if (spec.store) spec.store(d.index, res);
				/* Everything the season was run with, so it can be rebuilt on
				   demand (see universeCfgFor in js/app.js) and so a resume can
				   start from exactly here: the settings it ran under (a resume
				   runs later seasons under new ones, and a held season is
				   rebuilt under its own), and the returner sources it was
				   handed. */
				u.cfgs[d.index] = {
					seed: cfg.seed,
					settings: frozen,
					position,
					carryOver: cfg.carryOver,
					recentPools: copyPools(cfg.recentPools),
					recentAnomalies: copyPools(cfg.recentAnomalies),
					universeRoster: cfg.universeRoster,
					pastRoster: cfg.pastRoster,
					universeRecruiting: cfg.universeRecruiting,
					universeAlumni: cfg.universeAlumni,
					universeTitles: cfg.universeTitles,
					returners: sourcesIn,
				};
				if (u.order[position]) u.order[position].seed = cfg.seed;
				const src = returnerSource(res, d.index);
				if (src) sources.push(src);
				tree = coachTreeStep(tree, prevCarry, res, d.season, baseSeed);
				/* A FILE THAT CARRIES PART OF A CLASS. See topUpPartialSeason. */
				const share = Math.min(1, (res.players || []).length / Math.max(1, fullClass));
				u.rows.push(topUpPartialSeason(Object.assign(
					summarize(res, cfg.seed, d.name),
					{
						fingerprint: d.fingerprint || null,
						result: resultFingerprint(res),
						gap,
						position,
					}), prevCarry, baseSeed, share));
				u.alumni = u.alumni.concat(alumniOf(res, d.season, d.fingerprint || null)
					.map((a) => Object.assign(a, { position })));
				captureLinks(res, d, position);
				try { mergeRegistry(u.registry, registryOf([res], files, null)); }
				catch (e) { /* the registry is a view; the season stands */ }
				carry = harvest(res, prevCarry);
				addProgramRows(u.programs, programRowsOf(res, carry));
				lastSeason = d.season;
				if (res.archetypePool) {
					recentPools.unshift(res.archetypePool.slice());
					recentPools = recentPools.slice(0, 3);
				}
				if (Array.isArray(res.surprises) && res.surprises.length) {
					recentAnomalies.unshift(res.surprises.map((sp) => sp.name));
					recentAnomalies = recentAnomalies.slice(0, anomalyHistory);
				}
			} catch (e) {
				/* A FAILED SEASON STILL PASSES TIME. */
				u.rows.push({
					season: d.season, fileName: d.name, seed: null, gap, position,
					fingerprint: d.fingerprint || null,
					error: e && e.message ? e.message : String(e),
				});
				carry = ageCarry(carry, 1);
				if (Number.isFinite(d.season)) lastSeason = d.season;
				if (!u.broken) u.broken = d.season || d.name;
				res = null;
			}
			u.done = k + 1;
			return res;
		}

		/* RUNNING FORWARD PAST THE LAST FILE. Guessed rows past the end are
		   pruned first (so a dial turned down drops them), then redrawn. The
		   tail is untouched: loading a real class later extends the world
		   from the last season that was actually simulated. */
		function extrapolateForward(years) {
			const stale = new Set();
			u.rows = u.rows.filter((row) => {
				if (row && row.extrapolated && Number.isFinite(row.season) &&
					Number.isFinite(lastSeason) && row.season > lastSeason) {
					stale.add(row.season);
					return false;
				}
				return true;
			});
			if (stale.size) {
				u.alumni = (u.alumni || []).filter((a) =>
					!(a && a.extrapolated && stale.has(a.season)));
			}
			const n = Math.max(0, Math.round(years || 0));
			if (!n || !carry || !Number.isFinite(lastSeason)) return 0;
			const guessed = extrapolateGap(carry, lastSeason, lastSeason + n + 1, baseSeed);
			for (const row of guessed) u.rows.push(row);
			u.alumni = u.alumni.concat(extrapolatedAlumni(guessed));
			return guessed.length;
		}

		function finish(fo) {
			fo = fo || {};
			const done = u.done || 0;
			u.running = false;
			u.cancelled = !!fo.cancelled && done < runnable.length;
			/* ONLY WHAT WAS PLAYED. After Stop, the order and the tail used to
			   name every PLANNED file — so an extension treated the classes
			   that never ran as part of the chain and skipped them. */
			if (done < runnable.length) {
				u.order = held.concat(runnable.slice(0, done));
				segment.to = held.length + done;
			}
			const guessed = extrapolateForward(fo.extrapolateYears || 0);
			u.coachTree = tree;
			/* THE TAIL. Everything step() carries from one season to the
			   next — now including the returner sources still inside their
			   window — so an extension continues exactly where the chain
			   stopped. */
			u.tail = {
				baseSeed,
				carry,
				lastSeason,
				count: seedBase + done,
				recentPools: copyPools(recentPools),
				recentAnomalies: copyPools(recentAnomalies),
				returners: sources.filter((s) => !Number.isFinite(lastSeason) ||
					s.until > lastSeason),
				fingerprints: u.order.map((d) => d.fingerprint).filter(Boolean),
			};
			u.threads = threads(u.rows, u.alumni, { rivalries: carry && carry.rivalries });
			u.records = records(u.rows, u.alumni, u.registry || null);
			return { guessed, resimulated: stats.resimulated, touched: stats.touched };
		}

		return {
			universe: u, runnable, held, previews, heldPreviews, step, finish, stats,
			get carry() { return carry; },
			get lastSeason() { return lastSeason; },
			get sources() { return sources; },
		};
	}

	/* ---------------------------------------------------------- IMPORT */

	/* WHICH ROW IS WHICH, when two files claim the same season.

	   The import's expected results and its restorable rows were both keyed on
	   the season alone, so two files both claiming 2031 — which validate()
	   warns about but allows — collided: one overwrote the other, and the
	   survivor was compared against (or restored over) both. A row's key is
	   now its file fingerprint and season plus which occurrence of that pair
	   it is; an extrapolated year, which has no file, is keyed on its season. */
	function rowKeys(rows) {
		const seen = {};
		return (rows || []).map((r) => {
			if (!r) return null;
			if (r.extrapolated) return "x|" + r.season;
			const base = (r.fingerprint || "") + "|" + r.season;
			seen[base] = (seen[base] || 0) + 1;
			return base + "#" + seen[base];
		});
	}

	/* HOW TO REPLAY AN EXPORT: run by run, the way it was built.

	   A version 3 export records its runs (see exportUniverse): replaying an
	   extended universe as a cold chain gives its early seasons the appended
	   classes' underclassmen they never had, and replaying a partly re-run one
	   under one set of settings gives half of it the wrong ones. When every
	   file in the recorded order is loaded, the plan is the recorded runs; when
	   one is missing, or the export predates segments, it is one cold run of
	   whatever is loaded, and `followed` says whether that is faithful. */
	function replayPlan(json, files) {
		const have = new Set((files || []).map((f) => f && f.fingerprint).filter(Boolean));
		const order = Array.isArray(json && json.order) && json.order.length ? json.order : null;
		const segs = (Array.isArray(json && json.segments) ? json.segments : [])
			.filter((g) => g && g.kind);
		const fps = order ? order.map((o) => o && o.fingerprint) : [];
		const complete = !!order && fps.every((fp) => fp && have.has(fp));
		if (segs.length && complete) {
			return {
				followed: true, segments: segs.length,
				steps: segs.map((g) => {
					const settings = g.settings || json.settings || null;
					if (g.kind === "extend") {
						return { kind: "extend", settings, only: fps.slice(g.from, g.to) };
					}
					if (g.kind === "resume") return { kind: "resume", settings, from: g.from };
					return { kind: "cold", settings, only: fps.slice(0, g.to) };
				}),
			};
		}
		return {
			followed: segs.length <= 1,
			segments: segs.length,
			reason: segs.length > 1 ? (order ? "missing files" : "no recorded order") : null,
			steps: [{ kind: "cold", settings: (json && json.settings) || null, only: null }],
		};
	}

	/* PUT THE IMPORTED WORLD BACK WHERE THE REPLAY COULD NOT REPRODUCE IT.

	   Three cases, all of which used to lose the file's own account:
	     - a season that replayed differently (`diverged`, by row key) is
	       replaced by the file's row, flagged `restored`;
	     - a season whose class file is not loaded was not played at all, and
	       the replay filled the hole with an EXTRAPOLATED champion — the file
	       says who actually won, so its row goes in instead (`missingFile`);
	     - the alumni index and the registry are MERGED with the file's, not
	       replaced by them: the replay's own entries are the live ones, and
	       the file supplies what the replay could not.
	   Threads and the records book are rebuilt from the merged timeline so
	   they cannot disagree with it. Returns what it did. */
	function restoreImported(u, imported, diverged) {
		const out = { restored: 0, missing: 0, alumni: 0, registry: 0 };
		if (!u || !imported) return out;
		const importedRows = imported.rows || [];
		const iKeys = rowKeys(importedRows);
		const byKey = {};
		importedRows.forEach((r, i) => { if (r && iKeys[i]) byKey[iKeys[i]] = r; });
		const dset = new Set(diverged || []);
		const rKeys = rowKeys(u.rows);
		u.rows = (u.rows || []).map((r, i) => {
			if (!dset.has(rKeys[i])) return r;
			const src = byKey[rKeys[i]];
			if (!src) return r;
			out.restored++;
			return Object.assign({}, src, {
				restored: true, replayResult: r.result || null,
				seed: r.seed || src.seed || null,
			});
		});
		const have = new Set(rowKeys(u.rows));
		importedRows.forEach((src, i) => {
			if (!src || src.extrapolated || src.error || have.has(iKeys[i])) return;
			const row = Object.assign({}, src, { restored: true, missingFile: true });
			const at = u.rows.findIndex((r) => r && r.extrapolated && r.season === src.season);
			if (at >= 0) u.rows[at] = row;
			else u.rows.push(row);
			out.missing++;
		});
		if (out.missing) {
			u.rows = u.rows.map((r, i) => ({ r, i }))
				.sort((a, b) => ((a.r && a.r.season) || 0) - ((b.r && b.r.season) || 0) || a.i - b.i)
				.map((x) => x.r);
		}
		if (Array.isArray(imported.alumni) && imported.alumni.length) {
			const key = (a) => (a.id || a.key) + "|" + a.season + "|" + a.why;
			const seen = new Set((u.alumni || []).map(key));
			const add = imported.alumni.filter((a) => a && !seen.has(key(a)));
			if (add.length) {
				out.alumni = add.length;
				u.alumni = (u.alumni || []).concat(add).map((a, i) => ({ a, i }))
					.sort((x, y) => (x.a.season || 0) - (y.a.season || 0) || x.i - y.i)
					.map((x) => x.a);
			}
		}
		if (imported.registry && typeof imported.registry === "object") {
			const live = u.registry || {};
			const merged = Object.assign({}, imported.registry, live);
			out.registry = Object.keys(merged).length - Object.keys(live).length;
			u.registry = merged;
		}
		if ((out.restored || out.missing) && imported.tail) u.tail = imported.tail;
		if (out.restored || out.missing || out.alumni || out.registry) {
			const riv = u.tail && u.tail.carry ? u.tail.carry.rivalries : null;
			u.threads = threads(u.rows, u.alumni, { rivalries: riv });
			u.records = records(u.rows, u.alumni, u.registry || null);
		}
		return out;
	}

	/* A universe from the file alone: no class files loaded, so nothing can
	   be replayed — but the timeline, the threads, the records book, the
	   alumni index, the registry and the tail are all in a version 3 export,
	   and a shared world should be readable without the folder it was built
	   from. Extendable, too, when a later class is loaded: the tail is here. */
	function viewOnlyUniverse(json) {
		const rows = (json.timeline || []).map((r) => Object.assign({}, r));
		const alumni = (json.alumni || []).slice();
		const registry = json.registry && typeof json.registry === "object" ? json.registry : null;
		const tail = json.tail || null;
		return {
			rows, alumni, registry, tail,
			threads: Array.isArray(json.threads) && json.threads.length ? json.threads
				: threads(rows, alumni, { rivalries: tail && tail.carry ? tail.carry.rivalries : null }),
			records: json.records || records(rows, alumni, registry),
			baseSeed: json.baseSeed || "",
			settings: json.settings || null,
			segments: (json.segments || []).slice(),
			order: (json.order || []).map((o) => ({ index: -1, name: o.name || null,
				season: o.season, fingerprint: o.fingerprint || null, seed: o.seed || null })),
			cfgs: {}, running: false, coachTree: null,
			broken: json.broken || null, engineRev: json.engineRev || null,
			viewOnly: true,
			name: json.name || "Universe", createdAt: json.createdAt || null,
		};
	}

	global.Universe = {
		VERSION, ENGINE_REV, validate, harvest, returnersOf, alumniOf, summarize,
		playerId, biographyForFile, registryOf,
		threads, moreThreads, records, exportUniverse, biographyOf, seedFor, resultFingerprint,
		extrapolateGap, extrapolateSeason, topUpPartialSeason, extrapolatedAlumni,
		PARTIAL_CLASS_SHARE,
		ageCarry, coachTreeStep, pruneCoachTree, nationalPOYSet, recruitingCohorts,
		peopleRecords, programHistory, programRowsOf, rivalryThreads,
		returnerSource, pastRosterFrom, beginChain, rowKeys, replayPlan,
		restoreImported, viewOnlyUniverse, segmentSettings, mergeRegistry, pruneRegistry,
		PRESTIGE_CAP, RIVALRY_MAX,
	};
})(typeof window !== "undefined" ? window : self);
