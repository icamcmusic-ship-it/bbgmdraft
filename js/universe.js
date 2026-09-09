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
		const pidSig = rows.map((r) => {
			if (!r.ok) return null;
			const pids = (files[r.index].data.players || [])
				.map((p) => p.pid).filter((x) => x !== undefined);
			return pids.length ? pids.slice(0, 50).join(",") + "|" + pids.length : null;
		});
		for (let i = 0; i < rows.length; i++) {
			for (let j = i + 1; j < rows.length; j++) {
				if (pidSig[i] && pidSig[i] === pidSig[j]) {
					rows[j].warnings.push("identical pid set to " + rows[i].name +
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
	   to bring them back as the same men. See buildPrograms in js/teams.js. */
	function returnersOf(t) {
		const out = [];
		for (const m of t.members || []) {
			if (!m.filler || !m.starReturner || !m.name) continue;
			const slotIndex = Number(String(m.slot || "").replace(/^roster/, ""));
			out.push({
				name: m.name, starReturner: m.starReturner, classYear: m.classYear,
				talent: m.talent, slotIndex: Number.isFinite(slotIndex) ? slotIndex : 0,
			});
		}
		return out;
	}

	/* What one finished season hands the next.

	   `prev` is the carry this season was handed, and it is read for one
	   thing: the running title count, which is what makes recruiting momentum
	   possible (see assignCollege in js/engine.js). A program's banner count
	   is a fact about the world, not about one season, so it has to
	   accumulate — and the alternative, re-deriving it from the timeline rows
	   inside the engine, would make the engine depend on the app's state. */
	function harvest(res, prev) {
		const carry = { confOf: {}, levels: {}, coaches: {}, returners: {},
			champion: null, titles: Object.assign({}, (prev && prev.titles) || {}) };
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
		for (const t of Object.values(res.teams || {})) {
			if (!t || !t.name || !t.log) continue;
			carry.confOf[t.name] = t.conf;
			carry.levels[t.name] = t.level;
			carry.coaches[t.name] = {
				coach: stripCoach(t.coach),
				fired: fired.has(t.name),
				reason: why[t.name] || null,
			};
			const ret = returnersOf(t);
			if (ret.length) carry.returners[t.name] = ret;
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
			champion: carry.champion || null,
			titles: Object.assign({}, carry.titles || {}),
			stale: (carry.stale || 0) + years,
		};
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
	function coachTreeStep(tree, prevCarry, res, season, baseSeed) {
		tree = tree || { by: {}, hires: [] };
		const pool = [];
		for (const name of Object.keys((prevCarry && prevCarry.coaches) || {})) {
			const c = prevCarry.coaches[name];
			if (c && c.coach && c.coach.name) {
				pool.push({ name: c.coach.name, school: name, rep: c.coach.rep || 0 });
			}
		}
		if (!pool.length) return tree;
		pool.sort((a, b) => (b.rep - a.rep) || (a.name < b.name ? -1 : 1));
		for (const t of Object.values(res.teams || {})) {
			if (!t || !t.coach || !t.coach.replaced || t.coach.mentor) continue;
			/* A deterministic pick weighted toward the men with a reputation:
			   assistants come off good staffs. rng is the shared seeded RNG so
			   this replays; the string is the one fact that identifies the
			   hire. */
			const r = new global.BBGMRng.Rng(
				String(baseSeed) + "|tree|" + season + "|" + t.name);
			const idx = Math.min(pool.length - 1,
				Math.floor(Math.pow(r.random(), 1.7) * pool.length));
			const mentor = pool[idx];
			if (!mentor || mentor.name === t.coach.name) continue;
			t.coach.mentor = mentor.name;
			t.coach.mentorSchool = mentor.school;
			if (!tree.by[mentor.name]) tree.by[mentor.name] = [];
			tree.by[mentor.name].push({ season, coach: t.coach.name, school: t.name });
			tree.hires.push({ season, coach: t.coach.name, school: t.name,
				mentor: mentor.name, mentorSchool: mentor.school });
		}
		return tree;
	}

	/* The names a later season can drop: award winners, the top of the board,
	   the champion's best prospect. Compact on purpose — it persists. */
	function alumniOf(res, season) {
		const out = [];
		const seen = new Set();
		const add = (p, why) => {
			if (!p || seen.has(p.key)) return;
			seen.add(p.key);
			out.push({
				season, name: p.name, key: p.key,
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
		   produces and the timeline could not see one. */
		const unbeaten = teamList.filter((x) => (x.regL || x.l || 0) === 0 &&
			(x.regW || x.w || 0) >= 20).map((x) => x.name).sort();
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
	function threads(rows) {
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
		out.push.apply(out, moreThreads(rows));
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
			const abroad = played.filter((r) => r.no1 && r.no1.nonNcaa);
			if (abroad.length >= 2) {
				add("no1Abroad", null, abroad.map((r) => r.season), abroad.length,
					abroad.length + " No. 1 picks never played college basketball");
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
			if (row) out.push(row);
		}
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
		const added = [];
		for (const p of pool) {
			if (added.length >= want) break;
			added.push(p);
		}
		if (!added.length) return row;
		/* One shuffle so the top-up is not always the same five names in the
		   same order across a chain of partial files. */
		for (let i = added.length - 1; i > 0; i--) {
			const j = Math.floor(rng.random() * (i + 1));
			const tmp = added[i]; added[i] = added[j]; added[j] = tmp;
		}
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
			out.push({
				season: r.season, name: r.poy.name, key: null,
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
	function records(rows, alumni) {
		rows = (rows || []).filter((r) => r && !r.error);
		alumni = alumni || [];
		const titles = {};
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
		const WEIGHT = { "player of the year": 5, "top of the board": 2 };
		const byMan = {};
		for (const a of alumni) {
			const w = WEIGHT[a.why] !== undefined ? WEIGHT[a.why]
				: /won the title/.test(a.why || "") ? 3 : 1;
			const m = byMan[a.key] || (byMan[a.key] = {
				key: a.key, name: a.name, school: a.school, seasons: [], score: 0,
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

		return {
			titles: leaders(titles, "titles"),
			finals: leaders(finals, "title games"),
			apOnes: leaders(apOnes, "seasons at AP No. 1"),
			poys: leaders(poys, "players of the year"),
			no1s: leaders(no1s, "No. 1 picks"),
			longestApRun: best.team ? best : null,
			bestSeason,
			playersOfTheDecade: Object.keys(decades).sort()
				.map((d) => ({ decade: Number(d), player: decades[d] })),
			hall,
		};
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
			alumni: (u.alumni || []).slice(-400),
			tail: u.tail || null,
		};
		if (u.broken) out.broken = u.broken;
		if (u.biography && Object.keys(u.biography).length) out.biography = u.biography;
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
	function biographyOf(results) {
		const out = {};
		for (const res of results || []) {
			if (!res || !res.players) continue;
			for (const p of res.players) {
				if (!p.key || out[p.key]) continue;
				out[p.key] = {
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

	global.Universe = {
		VERSION, ENGINE_REV, validate, harvest, returnersOf, alumniOf, summarize,
		threads, moreThreads, records, exportUniverse, biographyOf, seedFor, resultFingerprint,
		extrapolateGap, extrapolateSeason, topUpPartialSeason, extrapolatedAlumni,
		PARTIAL_CLASS_SHARE,
		ageCarry, coachTreeStep, nationalPOYSet, recruitingCohorts,
	};
})(typeof window !== "undefined" ? window : self);
