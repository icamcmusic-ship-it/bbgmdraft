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

	function assignClassYears(players, cfg, rng, ageIsInformative) {
		const share = clamp(
			(cfg.freshmanShare === undefined ? 46 : cfg.freshmanShare) / 100, 0, 1);
		const order = players.slice().sort((a, b) => b.origOvr - a.origOvr);
		const n = Math.max(1, order.length - 1);
		order.forEach((p, i) => {
			if (ageIsInformative) { p.classYear = classYear(p.age); return; }
			const rank = i / n;                    // 0 = best prospect in the class
			const r = rng.child("class:" + p.pid);
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
		});
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

	/* Reject a malformed file with a sentence a human can act on, instead of
	   letting a TypeError out of the middle of the pipeline. */
	function validateLeagueFile(leagueFile) {
		if (!leagueFile || typeof leagueFile !== "object") {
			throw new Error("That file is not a BBGM league or draft-class export.");
		}
		if (!Array.isArray(leagueFile.players) || !leagueFile.players.length) {
			throw new Error("No players array in this file (or it is empty).");
		}
		if (!Number.isFinite(Number(leagueFile.startingSeason))) {
			throw new Error(
				"This file has no startingSeason, so the season the stats belong to " +
				"is unknown. Export the draft class from BBGM again, or add " +
				'"startingSeason": <year> to the file.');
		}
		const bad = [];
		leagueFile.players.forEach((p, i) => {
			const who = p && (p.firstName || p.lastName)
				? ((p.firstName || "") + " " + (p.lastName || "")).trim()
				: "player #" + i;
			if (!p || typeof p !== "object") bad.push("player #" + i + " is not an object");
			else if (!Array.isArray(p.ratings) || !p.ratings.length) {
				bad.push(who + " has no ratings");
			} else if (!p.born || !Number.isFinite(Number(p.born.year))) {
				bad.push(who + " has no born.year");
			}
		});
		if (bad.length) {
			throw new Error("Malformed players (" + bad.length + "): " +
				bad.slice(0, 4).join("; ") + (bad.length > 4 ? "; …" : ""));
		}
		return true;
	}

	function run(leagueFile, cfg) {
		validateLeagueFile(leagueFile);
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
		assignClassYears(players, cfg, rng.child("classyears"), ageSd >= 0.75);

		// --- 1. colleges -------------------------------------------------
		// Per-player overrides ("lock this guy at 55 ovr / to Duke / as a Rim
		// Protector") survive rerolls: they are read here, not re-rolled.
		const overrides = (cfg && cfg.overrides) || {};
		const ovOf = (p) => overrides[p.pid] || overrides[String(p.pid)] || {};

		for (const p of players) {
			const ov = ovOf(p);
			p.override = ov;
			p.newCollege = ov.college ||
				assignCollege(rng.child("college:" + p.pid), p.src, cfg);
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
			const ov = p.override || {};
			const targetOvr = Number.isFinite(ov.ovr)
				? clamp(Math.round(ov.ovr), 0, 100)
				: (curve ? curve[i] : p.origOvr);
			let gap = p.origPot - p.origOvr;
			if (curve) gap = prng.truncNormal(24 + cfg.potBias * 3.5, cfg.potSpread, 2, 55);
			else gap = Math.max(1, gap + cfg.potBias * 2.2 + prng.normal(0, cfg.potSpread * 0.35));
			const targetPot = Number.isFinite(ov.pot)
				? clamp(Math.round(ov.pot), targetOvr, 100)
				: clamp(Math.round(targetOvr + gap), targetOvr, 100);

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

			const built = RB.rebuild(
				prng, baseRatings, targetOvr, targetPot, cfg, ov.archetype || null);
			p.newRatings = built.ratings;
			p.newOvr = built.ovr;
			p.ovrRange = built.ovrRange;
			// A locked overall this player's height cannot reach is reported
			// rather than silently approximated.
			p.lockUnreachable = Number.isFinite(ov.ovr) && built.ovr !== targetOvr
				? { asked: targetOvr, got: built.ovr, range: built.ovrRange }
				: null;
			// The build and the age move potential: a Raw Project is a wider bet
			// than a Floor General, and an 18-year-old has more runway than a
			// 22-year-old. A locked potential overrides all of it.
			p.newPot = Number.isFinite(ov.pot)
				? built.pot
				: clamp(Math.round(built.pot + RB.potAdjust(built.archetype, p.age)),
					Math.min(built.ovr + 1, 100), 100);
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
			// Conference tournament: one game for making the bracket, plus one
			// per win. Teams outside the bracket (and, before this, every
			// program in the country) play none. NCAA: one for the bid plus one
			// per win, and the First Four game on top when there was one.
			const extraGames =
				(team.inConfTourney ? 1 + (team.ctW || 0) : 0) +
				(team.ffWin || 0) + (team.ncaaWins || 0) + (team.bid ? 1 : 0);
			S.simulateTeamStats(team, {
				oppStrength: (team.sosAvg + conf.strength * 0.35) / 1.35,
				games: Math.round(team.games + extraGames),
				pro: false,
			}, cfg, statRng.child(school));
			touched.add(school);
		}

		// Pro / DII players: a real club in a real league table. Each league
		// gets its full club list with per-club strength, a round-robin season,
		// standings and a playoff, so a EuroLeague prospect's note reads like
		// the NCAA one instead of the single word "EuroLeague".
		const proLeagues = simulateProLeagues(players, cfg, statRng.child("pro"));

		// --- 5. awards -------------------------------------------------------
		const ranked = AW.assign(players, teams, tourney, cfg, rng.child("awards"));

		// --- 6. notes ---------------------------------------------------------
		const sigRng = rng.child("signature");
		for (const p of players) {
			const home = p.nonNcaa ? p.proTeam : teams[p.newCollege];
			p.signature = signatureGame(p, home, sigRng.child("sig:" + p.pid));
		}
		for (const p of players) p.note = buildNote(p, teams, season, cfg);

		return {
			seed, season, cfg, players, teams, poll, tourney, confTourneys, ranked,
			proLeagues, leagueFile,
		};
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
						talent: clamp(crng.normal(clubLevel, 7.5) - i * 1.4, 8, 97),
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
				club.members.pop();
				club.members.push({
					filler: false, player: p,
					talent: T.prospectTalent(p.newOvr, p.newPot) * (lg.pro ? 0.94 : 1.05),
				});
				p.proClub = club.name;
			});
			for (const c of clubs) c.rating = T.teamRating(c.members);

			const games = PRO_GAMES[lgName] || 30;
			T.pairUp(lrng, clubs, games, null, (A, B) => {
				const when = lrng.random();
				const sc = T.playGameScore(lrng, A, B, lrng.random() < 0.5 ? 1 : -1, cfg, when);
				const rec = (t, opp, won, pf, pa) => {
					if (won) { t.w++; t.cw++; } else { t.l++; t.cl++; }
					t.games++;
					t.sos += opp.rating;
					t.log.push({ opp: opp.name, won, pf, pa, ot: sc.ot, when, quality: opp.rating });
				};
				rec(A, B, sc.won, sc.a, sc.b);
				rec(B, A, !sc.won, sc.b, sc.a);
			});
			for (const c of clubs) {
				c.pct = c.games ? c.w / c.games : 0;
				c.sosAvg = c.games ? c.sos / c.games : 50;
			}
			const table = clubs.slice().sort((a, b) => b.pct - a.pct || b.rating - a.rating);
			table.forEach((c, i) => { c.standing = i + 1; });

			// Playoff: top 8 (or the whole league if it is smaller), single
			// elimination, best seed advances more often than not.
			let alive = table.slice(0, Math.min(8, table.length));
			const rounds = [];
			while (alive.length > 1) {
				const next = [];
				const gamesLog = [];
				for (let i = 0; i < Math.floor(alive.length / 2); i++) {
					const A = alive[i];
					const B = alive[alive.length - 1 - i];
					const sc = T.playGameScore(lrng, A, B, 1, cfg, 1);
					const winner = sc.won ? A : B;
					gamesLog.push({
						a: A, b: B, winner,
						score: sc.won ? sc.a + "-" + sc.b : sc.b + "-" + sc.a,
					});
					next.push(winner);
				}
				if (alive.length % 2 === 1) next.push(alive[Math.floor(alive.length / 2)]);
				rounds.push(gamesLog);
				alive = next;
			}
			const champ = alive[0];
			if (champ) champ.leagueChamp = true;
			for (const c of clubs) {
				if (!c.prospects.length) continue;
				const idx = table.indexOf(c);
				c.finish = c.leagueChamp ? "league champions"
					: idx < Math.min(8, table.length) ? "made the playoffs"
					: "missed the playoffs";
			}

			// Stats: each club is simulated exactly like a college rotation.
			for (const c of clubs) {
				if (!c.prospects.length) continue;
				S.simulateTeamStats(c, {
					oppStrength: lg.strength,
					games,
					pro: lg.pro,
				}, cfg, lrng.child("stats:" + c.name));
			}
			for (const p of byLeague[lgName]) {
				const club = clubs.filter((c) => c.name === p.proClub)[0];
				p.proTeam = club;
			}
			out[lgName] = { name: lgName, clubs, table, rounds, champion: champ };
		}
		return out;
	}

	/* The best single night of a prospect's season, drawn as the maximum of his
	   game-by-game scoring against the opponents he actually played. A 36-point
	   game against a ranked team in January is the most memorable line in a
	   scouting report, and the sim had no concept of one. */
	function signatureGame(p, team, rng) {
		const s = p.stats;
		if (!s || !team || !team.log || !team.log.length) return null;
		const games = Math.max(1, Math.min(team.log.length, Math.round(s.gp)));
		const sd = 0.34 * s.ppg + 2.6;
		let best = null;
		for (let i = 0; i < games; i++) {
			const g = team.log[i];
			// A little more upside against a good opponent playing at home.
			const lift = (g.home > 0 ? 0.8 : 0) + (g.quality > 55 ? 0.6 : 0);
			const pts = Math.max(0, Math.round(rng.normal(s.ppg + lift, sd)));
			if (!best || pts > best.pts) {
				best = {
					pts, opp: g.opp, won: g.won, pf: g.pf, pa: g.pa, ot: g.ot,
					reb: Math.max(0, Math.round(rng.normal(s.rpg, 0.5 * s.rpg + 1.4))),
					ast: Math.max(0, Math.round(rng.normal(s.apg, 0.5 * s.apg + 1.2))),
				};
			}
		}
		return best;
	}

	function pct(x) { return (x * 100).toFixed(1) + "%"; }
	function n1(x) { return x.toFixed(1); }

	/* The scouting note written into the exported file. Which lines appear is
	   configurable (cfg.noteLines) rather than hardcoded, so the README no
	   longer has to explain a fixed set of omissions. */
	const NOTE_LINES = [
		["team", "School / club, conference, class year"],
		["record", "Team record and postseason result"],
		["stats", "Season stat line"],
		["shooting", "Shooting splits and TS%"],
		["advanced", "Usage, rebounds split, fouls"],
		["signature", "Best game of the season"],
		["archetype", "Archetype label"],
		["awards", "Honours"],
	];
	const DEFAULT_NOTE_LINES = ["team", "stats", "shooting", "signature", "awards"];

	function buildNote(p, teams, season, cfg) {
		const s = p.stats;
		const lines = [];
		const want = (cfg && Array.isArray(cfg.noteLines) ? cfg.noteLines : DEFAULT_NOTE_LINES);
		const on = (k) => want.indexOf(k) !== -1;
		const team = p.nonNcaa ? p.proTeam : teams[p.newCollege];

		if (on("team")) {
			if (p.nonNcaa) {
				lines.push((p.proClub ? p.proClub + " (" + p.newCollege + ")" : p.newCollege) +
					" · " + p.classYear);
			} else {
				lines.push(p.newCollege + " (" + team.conf + ") · " + p.classYear);
			}
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
				} else if (!team.bid) {
					rec += " · no NCAA bid";
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
		if (on("signature") && p.signature && p.signature.pts > 0) {
			const g = p.signature;
			lines.push(
				"Season high: " + g.pts + " points" +
				(g.reb >= 8 ? " and " + g.reb + " rebounds" :
					g.ast >= 7 ? " and " + g.ast + " assists" : "") +
				" in " + (g.won ? "a win over " : "a loss to ") + g.opp +
				(g.pf !== null && g.pf !== undefined
					? " (" + g.pf + "-" + g.pa + (g.ot ? " " + (g.ot > 1 ? g.ot + "OT" : "OT") : "") + ")"
					: ""),
			);
		}
		if (on("archetype") && p.archetype) lines.push("Profile: " + p.archetype);
		if (on("awards") && p.awards && p.awards.length) {
			lines.push("Honors: " + p.awards.join("; "));
		}
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
			// The README promises hgt/weight are rewritten only when Vary size
			// is on or the source file lacked them; the old code wrote both
			// unconditionally, adding keys to files that never had them.
			if (result.cfg.varySize || !Number.isFinite(orig.hgt)) out.hgt = p.newHgtInches;
			if (result.cfg.varySize || !Number.isFinite(orig.weight)) out.weight = p.newWeight;
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

	global.Engine = {
		run, exportFile, buildNote, classYear, assignClassYears, inchesFromHgtRating,
		validateLeagueFile, signatureGame, simulateProLeagues,
		NOTE_LINES, DEFAULT_NOTE_LINES,
	};
})(window);
