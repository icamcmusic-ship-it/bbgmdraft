/* Universe mode: many draft classes, one continuous world.

   A universe is an ORDERED run over several loaded class files, where each
   season hands state forward to the next: conference membership (so
   realignment has memory), programme strength (so a breakout persists rather
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
			if (row.players > 250) {
				row.ok = false;
				row.errors.push(row.players + " players — above the 250 cap");
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
			defEmphasis: c.defEmphasis, rep: c.rep,
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
		const fired = new Set();
		for (const e of res.seasonEvents || []) {
			if (e.kind === "coaching change" && e.teams && e.teams[0]) {
				fired.add(e.teams[0]);
			}
		}
		for (const t of Object.values(res.teams || {})) {
			if (!t || !t.name || !t.log) continue;
			carry.confOf[t.name] = t.conf;
			carry.levels[t.name] = t.level;
			carry.coaches[t.name] = {
				coach: stripCoach(t.coach),
				fired: fired.has(t.name),
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
				school: p.proClub || p.newCollege,
				boardRank: p.boardRank || null,
				why,
			});
		};
		for (const p of res.players || []) {
			if ((p.awards || []).some((a) => /Player of the Year/.test(a) &&
				!/Defensive|Conference/.test(a))) add(p, "player of the year");
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
	function summarise(res, seed, fileName) {
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
			coachChanges: (res.seasonEvents || [])
				.filter((e) => e.kind === "coaching change").length,
		};
	}

	/* Continuity threads across the timeline, for the Universe view: repeat
	   champions, programmes with multiple No. 1 picks, back-to-back POY
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
		VERSION, validate, harvest, returnersOf, alumniOf, summarise, threads,
		exportUniverse,
	};
})(typeof window !== "undefined" ? window : self);
