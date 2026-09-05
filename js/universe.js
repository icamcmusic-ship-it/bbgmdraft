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

	const VERSION = 2;

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
			try {
				const v = global.Engine.validateLeagueFile(f.data);
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
				row.ok = false;
				row.errors.push(row.players + " players — above the " + cap + " cap");
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
		   universe used to move about ten jobs across 368 programs.

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
		for (const name of Object.keys(carry.levels || {})) {
			/* Regress toward the middle of the range, one step a year: an
			   unplayed decade should not preserve a 94 that nobody defended. */
			let lvl = carry.levels[name];
			for (let y = 0; y < years; y++) lvl = lvl + (55 - lvl) * 0.18;
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
		return {
			season: res.leagueFile ? res.leagueFile.startingSeason : null,
			fileName,
			seed,
			flavor: res.flavor ? res.flavor.label : null,
			champion: t && t.champion ? t.champion.team.name : null,
			champSeed: t && t.champion ? t.champion.seed : null,
			runnerUp: t && t.runnerUp ? t.runnerUp.team.name : null,
			poy: poy ? { name: poy.name, school: poy.proClub || poy.newCollege } : null,
			no1: no1 ? { name: no1.name, school: no1.proClub || no1.newCollege } : null,
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
			if (r.no1 && r.no1.school) {
				(no1Seasons[r.no1.school] = no1Seasons[r.no1.school] || []).push(r.season);
			}
		}
		for (const name of Object.keys(titleSeasons).sort()) {
			const seasons = titleSeasons[name];
			if (seasons.length >= 2) {
				out.push({ kind: "titles", team: name, seasons: seasons.slice(),
					count: seasons.length,
					text: name + " won " + seasons.length + " national titles" });
			}
		}
		for (const name of Object.keys(no1Seasons).sort()) {
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
			if (r.poy && r.poy.school) poys[r.poy.school] = (poys[r.poy.school] || 0) + 1;
			if (r.no1 && r.no1.school) no1s[r.no1.school] = (no1s[r.no1.school] || 0) + 1;
		}
		const leaders = (map, label) => Object.keys(map)
			.map((team) => ({ team, count: map[team], label }))
			.sort((a, b) => b.count - a.count || (a.team < b.team ? -1 : 1))
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

	   `version` goes to 2. Version 1 files still import — see importUniverse,
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

	global.Universe = {
		VERSION, ENGINE_REV, validate, harvest, returnersOf, alumniOf, summarize,
		threads, records, exportUniverse, biographyOf, seedFor, resultFingerprint,
		ageCarry, coachTreeStep, nationalPOYSet,
	};
})(typeof window !== "undefined" ? window : self);
