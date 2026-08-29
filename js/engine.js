/* The pipeline: league file in, customised league file (plus a whole simulated
   college season) out. */
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

	const REGION_LEAGUE_MULT = {
		usa:     { "EuroLeague": 0.35, "NBA G League": 1.7, "NBL": 0.3 },
		europe:  { "EuroLeague": 2.4,  "NBA G League": 0.5, "NBL": 0.2 },
		oceania: { "EuroLeague": 0.5,  "NBA G League": 0.6, "NBL": 2.6 },
		other:   { "EuroLeague": 1.0,  "NBA G League": 1.0, "NBL": 0.7 },
	};

	const PRO_GAMES = { "EuroLeague": 34, "NBA G League": 48, "NBL": 28, "DII NCAA": 29 };

	function classYear(age) {
		if (age <= 19) return "Freshman";
		if (age === 20) return "Sophomore";
		if (age === 21) return "Junior";
		return "Senior";
	}

	function assignCollege(rng, player, cfg) {
		if (player.college && player.college.trim() !== "") return player.college;
		if (rng.chance(clamp(cfg.pDII, 0, 1))) return "DII NCAA";
		const mult = REGION_LEAGUE_MULT[C.region(player.born && player.born.loc)];
		const opts = [
			{ name: "EuroLeague", w: cfg.wEuroLeague * mult["EuroLeague"] },
			{ name: "NBA G League", w: cfg.wGLeague * mult["NBA G League"] },
			{ name: "NBL", w: cfg.wNBL * mult["NBL"] },
		];
		if (opts.every((o) => o.w <= 0)) return "NBA G League";
		return rng.weighted(opts).name;
	}

	function inchesFromHgtRating(hgtRating) {
		// BBGM height ratings map roughly linearly onto listed height.
		return Math.round(66 + (hgtRating / 100) * 24);
	}

	function run(leagueFile, cfg) {
		const seed = cfg.seed && String(cfg.seed).trim() !== ""
			? String(cfg.seed).trim()
			: String(Math.floor(Math.random() * 1e9));
		const rng = new Rng(seed);
		const season = leagueFile.startingSeason;

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
			return {
				src: p,
				idx,
				pid: p.pid,
				name: (p.firstName + " " + p.lastName).trim(),
				born: p.born,
				age: (p.draft && p.draft.year ? p.draft.year : season) - p.born.year,
				origCollege: p.college,
				origRatings: r,
				origOvr: r.ovr,
				origPot: r.pot,
				origPos: r.pos,
				hgtInches: hgtIn,
				weight: wt,
			};
		});
		for (const p of players) p.classYear = classYear(p.age);

		// --- 1. colleges -------------------------------------------------
		for (const p of players) {
			p.newCollege = assignCollege(rng.child("college:" + p.pid), p.src, cfg);
			p.collegeChanged = p.newCollege !== p.origCollege;
			p.leaguePro = !!C.NON_NCAA[p.newCollege] && C.NON_NCAA[p.newCollege].pro;
			p.nonNcaa = !!C.NON_NCAA[p.newCollege];
		}

		// --- 2. ratings ---------------------------------------------------
		const order = players.slice().sort((a, b) => b.origOvr - a.origOvr);
		let curve = null;
		if (cfg.ovrMode === "curve") curve = RB.classCurve(rng, players.length, cfg);

		order.forEach((p, i) => {
			const prng = rng.child("build:" + p.pid);
			const targetOvr = curve ? curve[i] : p.origOvr;
			let gap = p.origPot - p.origOvr;
			if (curve) gap = prng.truncNormal(24 + cfg.potBias * 3.5, cfg.potSpread, 2, 55);
			else gap = Math.max(1, gap + cfg.potBias * 2.2 + prng.normal(0, cfg.potSpread * 0.35));
			const targetPot = clamp(Math.round(targetOvr + gap), targetOvr, 100);

			// Size variance happens BEFORE the rebuild so the hgt rating and the
			// listed height stay in sync (they'd otherwise drift up to 3 inches
			// apart and the player would simulate at a different size than
			// listed). ~4.2 rating points per inch on BBGM's mapping.
			p.newHgtInches = p.hgtInches;
			let baseRatings = p.origRatings;
			if (cfg.varySize) {
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

			const built = RB.rebuild(prng, baseRatings, targetOvr, targetPot, cfg);
			p.newRatings = built.ratings;
			p.newOvr = built.ovr;
			p.newPot = built.pot;
			p.newPos = built.pos;
			p.newSkills = built.skills;
			p.archetype = built.archetype;
			p.newWeight = p.weight;
			if (cfg.varySize) {
				p.newWeight = clamp(
					Math.round(p.weight + (built.ratings.stre - p.origRatings.stre) * 0.55 +
						(p.newHgtInches - p.hgtInches) * 5 + prng.normal(0, 5)), 150, 330,
				);
			}
		});

		// --- 3. the college season -----------------------------------------
		const bySchool = {};
		for (const p of players) {
			if (p.nonNcaa) continue;
			(bySchool[p.newCollege] = bySchool[p.newCollege] || []).push(p);
		}
		const teams = T.buildPrograms(bySchool, rng.child("programs"));
		T.simulateRegularSeason(teams, cfg, rng.child("season"));
		const confTourneys = T.simulateConferenceTournaments(teams, cfg, rng.child("conftourney"));
		const poll = TN.apPoll(teams, 25);
		const tourney = TN.simulate(teams, cfg, rng.child("ncaa"));

		// --- 4. stats -------------------------------------------------------
		const statRng = rng.child("stats");
		const touched = new Set();
		for (const school of Object.keys(bySchool)) {
			const team = teams[school];
			const conf = C.CONFERENCES[team.conf] || C.CONFERENCES.Independent;
			// Postseason games actually played: conference-tournament wins + a
			// first appearance, First Four, and every NCAA game.
			const extraGames =
				(team.ctW || 0) + 1 + (team.ffWin || 0) +
				(team.ncaaWins || 0) + (team.bid ? 1 : 0);
			S.simulateTeamStats(team, {
				oppStrength: (team.sosAvg + conf.strength * 0.35) / 1.35,
				games: Math.round(team.games + extraGames),
				pro: false,
			}, cfg, statRng.child(school));
			touched.add(school);
		}

		// Pro / DII players: one synthetic club each.
		for (const p of players) {
			if (!p.nonNcaa) continue;
			const lg = C.NON_NCAA[p.newCollege];
			const prng = statRng.child("pro:" + p.pid);
			const clubLevel = lg.strength * (lg.pro ? 0.78 : 0.62);
			const members = [{
				filler: false, player: p,
				talent: T.prospectTalent(p.newOvr, p.newPot) * (lg.pro ? 0.94 : 1.05),
			}];
			for (let i = 0; i < 9; i++) {
				members.push({
					filler: true,
					talent: clamp(prng.normal(clubLevel, 8) - i * 1.2, 8, 97),
					name: "club" + i,
				});
			}
			const club = { name: p.newCollege + " club", members, conf: null };
			S.simulateTeamStats(club, {
				oppStrength: lg.strength,
				games: PRO_GAMES[p.newCollege] || 30,
				pro: lg.pro,
			}, cfg, prng);
		}

		// --- 5. awards -------------------------------------------------------
		const ranked = AW.assign(players, teams, tourney, cfg, rng.child("awards"));

		// --- 6. notes ---------------------------------------------------------
		for (const p of players) p.note = buildNote(p, teams, season);

		return {
			seed, season, cfg, players, teams, poll, tourney, confTourneys, ranked,
			leagueFile,
		};
	}

	function pct(x) { return (x * 100).toFixed(1) + "%"; }
	function n1(x) { return x.toFixed(1); }

	/* The scouting note written into the exported file. Deliberately omits the
	   team record/result line, the player's age, and the archetype label — the
	   note carries the school, class year, stat line and honours only. */
	function buildNote(p, teams, season) {
		const s = p.stats;
		const lines = [];
		const team = teams[p.newCollege];
		if (p.nonNcaa) {
			lines.push(p.newCollege);
		} else {
			lines.push(p.newCollege + " (" + team.conf + ") · " + p.classYear);
		}
		if (s) {
			lines.push(
				season + ": " + s.gp + " GP, " + n1(s.mpg) + " MPG, " + n1(s.ppg) +
				" PPG, " + n1(s.rpg) + " RPG, " + n1(s.apg) + " APG, " + n1(s.spg) +
				" SPG, " + n1(s.bpg) + " BPG",
			);
			lines.push(
				"FG " + pct(s.fgp) + " / 3P " + pct(s.tpp) + " / FT " + pct(s.ftp) +
				" (TS " + pct(s.ts) + ")",
			);
		}
		if (p.awards && p.awards.length) {
			lines.push("Honors: " + p.awards.join("; "));
		}
		return lines.join("\n");
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
			out.hgt = p.newHgtInches;
			out.weight = p.newWeight;
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

	global.Engine = { run, exportFile, buildNote, classYear, inchesFromHgtRating };
})(window);
