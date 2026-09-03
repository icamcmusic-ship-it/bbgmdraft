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

	const VERSION = 1;

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

	/* What one finished season hands the next. */
	function harvest(res) {
		const carry = { confOf: {}, levels: {}, coaches: {}, returners: {} };
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
		const nationalPOY = new Set(
			(global.Awards.NATIONAL_POY || []).map((a) => a.name)
				.concat(["Consensus National Player of the Year"]));
		for (const p of res.players || []) {
			if ((p.awards || []).some((a) => nationalPOY.has(a))) {
				add(p, "player of the year");
			}
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
		const poy = (res.players || []).filter((p) => (p.awards || []).some(
			(a) => /^(Naismith Trophy|John R\. Wooden Award)$/.test(a)))[0];
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
		};
	}

	/* Continuity threads across the timeline, for the Universe view: repeat
	   champions, programs with multiple No. 1 picks, back-to-back POY
	   schools — the connections that make it one world rather than N runs. */
	function threads(rows) {
		const out = [];
		const titleCount = {};
		const no1Count = {};
		for (const r of rows) {
			if (r.champion) titleCount[r.champion] = (titleCount[r.champion] || 0) + 1;
			if (r.no1) no1Count[r.no1.school] = (no1Count[r.no1.school] || 0) + 1;
		}
		for (const name of Object.keys(titleCount)) {
			if (titleCount[name] >= 2) {
				out.push(name + " won " + titleCount[name] + " national titles");
			}
		}
		for (const name of Object.keys(no1Count)) {
			if (no1Count[name] >= 2) {
				out.push(name + " produced " + no1Count[name] + " No. 1 picks");
			}
		}
		for (let i = 1; i < rows.length; i++) {
			if (rows[i].champion && rows[i].champion === rows[i - 1].champion) {
				out.push(rows[i].champion + " repeated as champions in " + rows[i].season);
			}
			if (rows[i].poy && rows[i - 1].poy &&
				rows[i].poy.school === rows[i - 1].poy.school) {
				out.push(rows[i].poy.school + " had back-to-back players of the year");
			}
		}
		return out;
	}

	function exportUniverse(u) {
		return {
			format: "bbgm-draft-workshop/universe",
			version: VERSION,
			name: u.name || "Universe",
			createdAt: u.createdAt || new Date().toISOString(),
			baseSeed: u.baseSeed,
			seasons: (u.rows || []).map((r) => ({
				season: r.season, fileName: r.fileName,
				fingerprint: r.fingerprint || null, seed: r.seed,
			})),
		};
	}

	global.Universe = {
		VERSION, validate, harvest, returnersOf, alumniOf, summarize, threads,
		exportUniverse,
	};
})(typeof window !== "undefined" ? window : self);
