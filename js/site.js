/* THE SEASON SITE.

   The same season the almanac writes, exported as a small interactive
   website instead of a document: one self-contained .html file with the
   whole season embedded in it as JSON and a reader for that JSON beside it.

   The almanac (js/almanac.js) exists for a READER with a printer — markdown
   for the file, a print stylesheet for the PDF. That shape is the wrong one
   for the questions people actually bring back to a finished season: sort
   the board by potential, find every prospect out of one conference, read
   only the injury articles, look up what a team did in March. A document
   answers those by Ctrl-F; a site answers them by clicking.

   So there are two halves here and the seam between them matters:

     data(result, opts)  ->  the season as plain JSON. No DOM, no markup, no
                             HTML-shaped strings. It is the export a script
                             can read, and the page below is only its first
                             consumer — the file the site embeds is also the
                             file you can pull back out of it.
     html(result, opts)  ->  that JSON, embedded verbatim in a page carrying
                             the CSS and the reader inline.

   Nothing is fetched, so the file works off a thumb drive, out of an email
   attachment or from file:// with no server. And nothing in here reads a
   clock: the same seed writes the same site, byte for byte, which is the
   promise the rest of the tool makes and the reason CI can hash it. */
(function (global) {
	"use strict";

	/* ------------------------------------------------------------ helpers */

	const num = (v) => (Number.isFinite(v) ? v : null);
	const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
	const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

	/* Numbers stay numbers all the way into the JSON — formatting them here
	   would be the document's job leaking into the data, and a column of
	   "12.3" strings cannot be sorted numerically by the page or averaged by
	   whatever reads the file next. Rounding is only ever about not shipping
	   17 digits of float noise. */

	function schoolOf(p) { return p.proClub || p.newCollege; }

	function teamName(x) {
		if (!x) return "";
		return x.team ? x.team.name : x.name || "";
	}

	function scoped(awards, opts) {
		const A = global.Awards;
		if (!A || !A.scopeAwards) return (awards || []).slice();
		return A.scopeAwards(awards || [], opts.awardsScope || "all",
			opts.majorConferences || null);
	}

	/* A news segment carries the name AND what kind of thing it names, which
	   is what lets the page turn a prospect's name in a headline into a link
	   to his capsule. The almanac flattens these to text because a printed
	   page has nothing to link to; here they are the whole point, so they go
	   into the JSON as they are. */
	function segs(list) {
		return (list || [])
			.filter((s) => s && s.v !== undefined && s.v !== null)
			.map((s) => {
				const out = { v: String(s.v) };
				if (s.t) out.t = s.t;
				return out;
			});
	}

	function segText(list) {
		return (list || []).map((s) => (s && s.v !== undefined ? s.v : "")).join("");
	}

	/* Every prospect gets a stable id so the board, the news feed, the
	   leader boards and a team's roster can all point at one capsule rather
	   than each carrying its own copy of the player. Names are not unique
	   enough to be that id (two Jordan Smiths in one class is a normal
	   draw), so it is the array position. */
	function idsFor(players) {
		const byPlayer = new Map();
		const byName = new Map();
		players.forEach((p, i) => {
			const id = "p" + i;
			byPlayer.set(p, id);
			/* First one wins on a collision: the news feed links by name and
			   sending both Jordan Smiths to the same capsule is a better
			   answer than sending neither anywhere. */
			if (!byName.has(p.name)) byName.set(p.name, id);
		});
		return { byPlayer, byName };
	}

	const STAT_KEYS = ["gp", "gs", "mpg", "ppg", "rpg", "apg", "spg", "bpg", "topg",
		"fgp", "tpp", "ftp", "ts", "usg", "ortg", "drtg", "per",
		"cspg", "deflpg", "chgpg", "orpg", "drpg", "pfpg", "tpa", "fga", "fta"];

	function statsOf(p) {
		if (!p.stats) return null;
		const out = {};
		for (const k of STAT_KEYS) {
			const v = p.stats[k];
			if (!Number.isFinite(v)) continue;
			/* Percentages and rates keep three decimals, everything else two:
			   a .446 that arrives as .45 is a different number to a reader. */
			out[k] = /^(fgp|tpp|ftp|ts|usg)$/.test(k) ? r3(v) : r2(v);
		}
		return Object.keys(out).length ? out : null;
	}

	/* ------------------------------------------------------------ sections */

	/* Section ids are the almanac's, deliberately: one dialog picks the
	   sections and either export honours the choice, so a user who turned
	   the capsules off does not get them back by asking for the site. A
	   section absent from the JSON is absent from the page's nav too — the
	   reader builds itself off what it finds. */

	function buildFront(res, opts) {
		const t = res.tourney;
		const poy = (res.poyBallots || [])[0];
		const top = (res.board || [])[0];
		const coy = (res.coachHonors || [])[0];
		const winner = poy && (poy.top || [])[0];
		return {
			season: res.season,
			seed: res.seed,
			flavor: res.flavor && res.flavor.label ? res.flavor.label : null,
			champion: t && t.champion ? teamName(t.champion) : null,
			runnerUp: t && t.runnerUp ? teamName(t.runnerUp) : null,
			finalScore: t && t.final ? t.final.score || null : null,
			nitChampion: t && t.nit && t.nit.champion ? teamName(t.nit.champion) : null,
			apNo1: res.poll && res.poll.length
				? { team: res.poll[0].name, record: res.poll[0].w + "-" + res.poll[0].l }
				: null,
			playerOfTheYear: winner
				? { award: poy.award, name: winner.name, school: winner.school }
				: null,
			coachOfTheYear: coy
				? { award: coy.award, coach: coy.coach, school: coy.school, record: coy.record }
				: null,
			topProspect: top
				? {
					name: top.name, pos: top.newPos, ovr: num(top.newOvr),
					pot: num(top.newPot), school: schoolOf(top),
					archetype: top.archetype || null,
				}
				: null,
			classSize: (res.players || []).length,
			teamCount: Object.keys(res.teams || {}).length,
		};
	}

	function buildPoll(res) {
		return (res.poll || []).slice(0, 25).map((t, i) => ({
			rank: i + 1,
			team: t.name,
			conf: t.conf || null,
			w: num(t.w), l: num(t.l),
			cw: num(t.cw), cl: num(t.cl),
			firstPlace: num(t.apFirstPlace),
			preseason: num(t.apPreseason),
			ncaaSeed: num(t.ncaaSeed),
			postseason: t.ncaaResult || t.nitResult || null,
		}));
	}

	function buildStandings(res, opts, ids) {
		const byConf = {};
		for (const t of Object.values(res.teams || {})) {
			if (!t.conf) continue;
			(byConf[t.conf] = byConf[t.conf] || []).push(t);
		}
		return Object.keys(byConf).sort().map((conf) => ({
			conf,
			teams: byConf[conf].slice()
				.sort((a, b) => {
					const ap = (a.cw || 0) - (a.cl || 0);
					const bp = (b.cw || 0) - (b.cl || 0);
					if (bp !== ap) return bp - ap;
					return (b.w || 0) - (b.l || 0) - ((a.w || 0) - (a.l || 0));
				})
				.map((t) => ({
					name: t.name,
					w: num(t.w), l: num(t.l), cw: num(t.cw), cl: num(t.cl),
					apRank: num(t.apRank),
					postseason: t.ncaaResult || t.nitResult || null,
					regularChamp: !!t.confRegularChamp,
					tourneyChamp: !!t.confTourneyChamp,
					offRtg: r2(t.offRtg), defRtg: r2(t.defRtg),
					sos: r2(t.sosAvg), rating: r2(t.rating),
					prospects: (t.prospects || []).map((p) => ({
						id: ids.byPlayer.get(p) || null, name: p.name,
					})),
				})),
		}));
	}

	function buildConfTourneys(res) {
		const ct = res.confTourneys || {};
		return Object.keys(ct).sort().map((conf) => {
			const t = ct[conf];
			const champ = teamName(t.champ);
			const reg = teamName(t.regularChamp) || t.regularChamp || "";
			return {
				conf,
				champion: champ || null,
				regularChamp: reg || null,
				bidStolen: !!(champ && reg && champ !== reg),
			};
		});
	}

	const ROUND_NAMES = ["First round", "Second round", "Sweet 16", "Elite Eight"];

	function game(g) {
		if (!g || !g.winner) return null;
		const loser = g.winner === g.a ? g.b : g.a;
		return {
			winner: teamName(g.winner),
			winnerSeed: num(g.winner && g.winner.seed),
			loser: teamName(loser),
			loserSeed: num(loser && loser.seed),
			score: g.score || null,
			upset: !!g.upset,
		};
	}

	function buildBracket(res) {
		const t = res.tourney;
		if (!t || !t.regions) return null;
		return {
			firstFour: (t.firstFour || []).map((g) => {
				const row = game(g);
				if (row && Number.isFinite(g.seed)) row.seed = g.seed;
				return row;
			}).filter(Boolean),
			regions: Object.keys(t.regions).map((name) => {
				const r = t.regions[name];
				return {
					name,
					seeds: (r.seeds || []).map((s, i) => ({
						seed: i + 1, team: teamName(s),
					})).filter((s) => s.team),
					rounds: (r.rounds || []).map((games, i) => ({
						name: ROUND_NAMES[i] || "Round " + (i + 1),
						games: games.map(game).filter(Boolean),
					})),
					champion: r.champ ? teamName(r.champ) : null,
				};
			}),
			semis: (t.semis || []).map(game).filter(Boolean),
			final: game(t.final),
			nitChampion: t.nit && t.nit.champion ? teamName(t.nit.champion) : null,
		};
	}

	function buildAwards(res, opts, ids) {
		return {
			ballots: (res.poyBallots || []).map((b) => ({
				award: b.award,
				resumeLean: r2(b.resumeLean),
				top: (b.top || []).map((r) => ({
					rank: r.rank, name: r.name, school: r.school,
					inClass: r.inClass !== false,
					behind: r.rank === 1 ? 0 : r2(r.behind),
					id: ids.byName.get(r.name) || null,
				})),
			})),
			coachHonors: (res.coachHonors || []).map((h) => ({
				award: h.award, coach: h.coach, school: h.school, record: h.record,
			})),
			players: (res.players || [])
				.filter((p) => scoped(p.awards, opts).length)
				.sort((a, b) => scoped(b.awards, opts).length - scoped(a.awards, opts).length)
				.map((p) => ({
					id: ids.byPlayer.get(p) || null,
					name: p.name, school: schoolOf(p), honors: scoped(p.awards, opts),
				})),
			fieldHonors: (res.fieldHonors || []).map((h) => ({
				award: h.award, name: h.name, school: h.school,
				classYear: h.classYear || null,
			})),
		};
	}

	/* The leader boards the Awards tab shows, with the same 15-minute cutoff,
	   so the site, the screen and the almanac cannot disagree. `low` marks
	   the one board where the best number is the smallest. */
	const LEADERS = [
		{ key: "ppg", title: "Points", digits: 1 },
		{ key: "rpg", title: "Rebounds", digits: 1 },
		{ key: "apg", title: "Assists", digits: 1 },
		{ key: "spg", title: "Steals", digits: 1 },
		{ key: "bpg", title: "Blocks", digits: 1 },
		{ key: "ts", title: "True shooting", pct: true },
		{ key: "tpp", title: "Three-point percentage", digits: 3 },
		{ key: "cspg", title: "Contested shots", digits: 1 },
		{ key: "deflpg", title: "Deflections", digits: 1 },
		{ key: "chgpg", title: "Charges drawn", digits: 1 },
		{ key: "drtg", title: "Defensive rating (lowest)", digits: 1, low: true },
	];

	function buildLeaders(res, opts, ids) {
		const pool = (res.players || []).filter((p) => p.stats && p.stats.mpg >= 15);
		if (!pool.length) return [];
		const out = [];
		for (const spec of LEADERS) {
			const list = pool.filter((p) => Number.isFinite(p.stats[spec.key]))
				.sort((a, b) => (spec.low
					? a.stats[spec.key] - b.stats[spec.key]
					: b.stats[spec.key] - a.stats[spec.key]))
				.slice(0, 10);
			if (!list.length) continue;
			out.push({
				key: spec.key,
				title: spec.title,
				pct: !!spec.pct,
				digits: spec.digits || 1,
				low: !!spec.low,
				rows: list.map((p, i) => {
					const rank = p.statRanks && p.statRanks[spec.key];
					return {
						pos: i + 1,
						id: ids.byPlayer.get(p) || null,
						name: p.name,
						school: schoolOf(p),
						value: spec.pct ? r3(p.stats[spec.key]) : r2(p.stats[spec.key]),
						national: rank ? num(rank.national) : null,
						conf: rank ? num(rank.conf) : null,
						confName: rank ? rank.confName || null : null,
					};
				}),
			});
		}
		return out;
	}

	function buildProLeagues(res, opts, ids) {
		const leagues = res.proLeagues || {};
		return Object.keys(leagues).sort().map((name) => {
			const lg = leagues[name];
			return {
				name,
				champion: lg.champion ? teamName(lg.champion) : null,
				cupChampion: lg.cup && lg.cup.champion ? teamName(lg.cup.champion) : null,
				table: (lg.table || []).map((c, i) => ({
					pos: i + 1,
					club: c.name,
					w: num(c.w), l: num(c.l),
					relegated: !!c.relegated,
					prospects: (c.prospects || []).map((p) => ({
						id: ids.byPlayer.get(p) || null,
						name: p.name,
						ppg: r2(p.stats && p.stats.ppg),
					})),
				})),
			};
		});
	}

	function boardOrder(res) {
		return (res.board || []).length
			? res.board.slice()
			: (res.players || []).slice()
				.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
	}

	function buildBoard(res, opts, ids) {
		return boardOrder(res).map((p) => ({
			id: ids.byPlayer.get(p) || null,
			rank: num(p.boardRank),
			name: p.name,
			pos: p.newPos || null,
			ovr: num(p.newOvr),
			pot: num(p.newPot),
			school: schoolOf(p),
			conf: p.newConf || (p.team && p.team.conf) || null,
			classYear: p.classYear || null,
			archetype: p.archetype || null,
			preseason: num(p.preseasonRank),
			move: num(p.stockMove),
			mock: p.mockRound ? p.mockRound + "-" + p.mockPick : null,
			ppg: r2(p.stats && p.stats.ppg),
			rpg: r2(p.stats && p.stats.rpg),
			apg: r2(p.stats && p.stats.apg),
			honors: scoped(p.awards, opts).length,
		}));
	}

	/* One capsule per prospect — the header line the board shows, his season
	   line, his honors and the scouting note. This is the section the page's
	   search, its team rosters and its news links all resolve into, so it
	   carries the full record even when a table above only shows five of its
	   fields. */
	function buildPlayers(res, opts, ids) {
		return boardOrder(res).map((p) => ({
			id: ids.byPlayer.get(p) || null,
			rank: num(p.boardRank),
			name: p.name,
			pos: p.newPos || null,
			ovr: num(p.newOvr),
			pot: num(p.newPot),
			school: schoolOf(p),
			conf: p.newConf || (p.team && p.team.conf) || null,
			classYear: p.classYear || null,
			archetype: p.archetype || null,
			age: num(p.age),
			hgtInches: num(p.newHgtInches),
			weight: num(p.newWeight),
			skills: (p.newSkills || []).slice(),
			ratings: p.newRatings ? Object.assign({}, p.newRatings) : null,
			stats: statsOf(p),
			honors: scoped(p.awards, opts),
			mock: p.mockRound ? p.mockRound + "-" + p.mockPick : null,
			note: String(p.note || ""),
		}));
	}

	function buildNews(res, opts, ids) {
		const articles = global.News && global.News.build ? global.News.build(res) : [];
		if (!articles.length) return null;
		const limit = Number.isFinite(opts.newsLimit) && opts.newsLimit > 0
			? opts.newsLimit : articles.length;
		const shown = articles.slice(0, limit);
		return {
			total: articles.length,
			shown: shown.length,
			articles: shown.map((a) => {
				const head = segs(a.headline);
				for (const s of head) {
					if (s.t === "player" && ids.byName.has(s.v)) s.id = ids.byName.get(s.v);
				}
				const body = segs(a.body);
				for (const s of body) {
					if (s.t === "player" && ids.byName.has(s.v)) s.id = ids.byName.get(s.v);
				}
				return {
					dateline: a.dateline,
					kind: a.kind,
					byline: a.byline || null,
					headline: head,
					headlineText: segText(a.headline),
					body,
					paras: (a.paras || []).map(segText).filter((t) => t && t.trim()),
				};
			}),
		};
	}

	function buildEvents(res) {
		const dateline = global.News && global.News.dateline
			? global.News.dateline : () => "";
		const events = (res.seasonEvents || []).slice()
			.sort((a, b) => (a.when || 0) - (b.when || 0))
			.map((e) => ({
				when: dateline(e.when || 0), kind: e.kind, text: e.text,
			}));
		const carousel = (res.coachingCarousel || []).map((c) => ({
			school: c.school, coach: c.coach, w: num(c.w), l: num(c.l),
			reason: c.reason, tenure: num(c.tenure),
		}));
		if (!events.length && !carousel.length) return null;
		return { events, carousel };
	}

	function buildColophon(res) {
		const cfg = res.effectiveCfg || res.cfg || {};
		const settings = Object.keys(cfg).sort()
			.filter((k) => typeof cfg[k] !== "object" || cfg[k] === null)
			.map((k) => ({ key: k, value: String(cfg[k]) }));
		return {
			seed: res.seed,
			season: res.season,
			warnings: (res.warnings || []).slice(),
			settings,
		};
	}

	/* Every section is { id, label, build(res, opts, ids) }, in the order the
	   page's nav shows them. A section added here shows up in the JSON, in
	   the nav and in the dialog with nothing else to edit; one that builds
	   nothing (no pro leagues in this run, no news) is dropped rather than
	   shipping an empty tab. */
	const SECTIONS = [
		{ id: "front", label: "Front page", build: buildFront },
		{ id: "poll", label: "Final AP poll", build: buildPoll },
		{ id: "standings", label: "Conference standings", build: buildStandings },
		{ id: "confTourneys", label: "Conference tournaments", build: buildConfTourneys },
		{ id: "bracket", label: "March Madness", build: buildBracket },
		{ id: "awards", label: "Honors", build: buildAwards },
		{ id: "leaders", label: "Statistical leaders", build: buildLeaders },
		{ id: "proLeagues", label: "Pro and non-NCAA leagues", build: buildProLeagues },
		{ id: "board", label: "The draft board", build: buildBoard },
		{ id: "capsules", label: "The prospects", build: buildPlayers },
		{ id: "news", label: "The season as news", build: buildNews },
		{ id: "events", label: "Events and the carousel", build: buildEvents },
		{ id: "colophon", label: "Colophon", build: buildColophon },
	];

	/* The JSON keys the sections write to. `capsules` is the almanac's id for
	   the prospect capsules and `players` is what the array of them should be
	   called in a data file, so the two names are not the same name. */
	const KEYS = { capsules: "players" };

	function wanted(opts) {
		const pick = opts.sections;
		if (!pick) return SECTIONS;
		if (Array.isArray(pick)) return SECTIONS.filter((s) => pick.indexOf(s.id) !== -1);
		return SECTIONS.filter((s) => !!pick[s.id]);
	}

	function empty(v) {
		if (v === null || v === undefined) return true;
		if (Array.isArray(v)) return !v.length;
		if (typeof v === "object") return !Object.keys(v).length;
		return false;
	}

	const FORMAT = "bbgm-draft-season-site";
	const VERSION = 1;

	function data(result, options) {
		const opts = options || {};
		const ids = idsFor(result.players || []);
		const out = {
			format: FORMAT,
			version: VERSION,
			season: result.season,
			seed: result.seed,
			flavor: result.flavor && result.flavor.label ? result.flavor.label : null,
			title: title(result, opts),
			sections: [],
		};
		for (const s of wanted(opts)) {
			const built = s.build(result, opts, ids);
			if (empty(built)) continue;
			out[KEYS[s.id] || s.id] = built;
			/* The order and the labels travel WITH the data: a reader that
			   built its nav off a hard-coded list would show an empty tab for
			   a section this run has nothing for, and would silently hide a
			   section added later. */
			out.sections.push({ id: s.id, key: KEYS[s.id] || s.id, label: s.label });
		}
		return out;
	}

	/* ---------------------------------------------------------------- page */

	function title(result, opts) {
		return (opts && opts.title) || "The " + result.season + " season";
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	/* JSON inside a <script> element is not JSON in a string: a "</script>"
	   anywhere in a scouting note ends the element early and the rest of the
	   season becomes markup. The three characters below cannot appear
	   unescaped for that reason, and U+2028/9 are escaped because they are
	   legal in JSON and are line terminators in JavaScript. */
	function embed(json) {
		return JSON.stringify(json)
			.replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
			.replace(/&/g, "\\u0026")
			.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
	}

	/* The stylesheet. A SCREEN stylesheet, which is the whole difference
	   between this and the almanac's: sized in rem, dark by default with a
	   light mode for whoever prefers one, tables that scroll rather than
	   break across a page, and a nav that stays put. The print rules at the
	   bottom only exist so that a reader who hits Ctrl-P on a section gets
	   that section rather than the furniture around it. */
	const CSS = [
		":root { --bg:#12151b; --panel:#1a1f28; --panel2:#212836; --line:#2f3847;",
		"  --ink:#e8ecf3; --dim:#98a3b5; --accent:#6aa9ff; --good:#57c98b;",
		"  --warn:#e9b64d; --bad:#e4736b; --radius:10px; color-scheme: dark; }",
		"[data-theme=\"light\"] { --bg:#f6f7f9; --panel:#fff; --panel2:#eef1f5;",
		"  --line:#d5dae2; --ink:#141821; --dim:#5c6779; --accent:#1f6fd0;",
		"  color-scheme: light; }",
		"* { box-sizing: border-box; }",
		"body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5",
		"  system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }",
		"a { color:var(--accent); }",
		"header.top { position:sticky; top:0; z-index:5; background:var(--panel);",
		"  border-bottom:1px solid var(--line); padding:.6rem 1rem; }",
		".topline { display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; }",
		".topline h1 { font-size:1.15rem; margin:0; flex:1 1 14rem; }",
		".topline .sub { color:var(--dim); font-size:.85rem; }",
		"nav.tabs { display:flex; flex-wrap:wrap; gap:.25rem; margin-top:.5rem; }",
		"nav.tabs button { background:transparent; color:var(--dim); border:1px solid transparent;",
		"  border-radius:var(--radius); padding:.3rem .6rem; font:inherit; font-size:.9rem; cursor:pointer; }",
		"nav.tabs button:hover { color:var(--ink); background:var(--panel2); }",
		"nav.tabs button[aria-current=\"true\"] { color:var(--ink); background:var(--panel2);",
		"  border-color:var(--line); }",
		"main { max-width:78rem; margin:0 auto; padding:1rem 1rem 4rem; }",
		"section.view[hidden] { display:none; }",
		"h2 { font-size:1.35rem; margin:.2rem 0 1rem; }",
		"h3 { font-size:1.05rem; margin:1.4rem 0 .5rem; }",
		"h4 { font-size:.95rem; margin:1rem 0 .35rem; color:var(--dim); }",
		".card { background:var(--panel); border:1px solid var(--line);",
		"  border-radius:var(--radius); padding:1rem; margin:0 0 1rem; }",
		".grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(15rem,1fr)); }",
		".stat { background:var(--panel2); border-radius:var(--radius); padding:.7rem .8rem; }",
		".stat .k { color:var(--dim); font-size:.75rem; text-transform:uppercase;",
		"  letter-spacing:.04em; }",
		".stat .v { font-size:1.25rem; font-weight:600; }",
		".stat .n { color:var(--dim); font-size:.85rem; }",
		".hero { font-size:1.6rem; font-weight:700; line-height:1.25; }",
		".controls { display:flex; flex-wrap:wrap; gap:.5rem; margin:0 0 .6rem; }",
		"input[type=\"search\"], input[type=\"text\"], select, button.btn {",
		"  background:var(--panel2); color:var(--ink); border:1px solid var(--line);",
		"  border-radius:var(--radius); padding:.35rem .55rem; font:inherit; font-size:.9rem; }",
		"button.btn { cursor:pointer; }",
		"button.btn:hover { border-color:var(--accent); }",
		".tablewrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); }",
		"table { border-collapse:collapse; width:100%; font-size:.88rem; }",
		"th, td { text-align:left; padding:.35rem .55rem; border-bottom:1px solid var(--line);",
		"  white-space:nowrap; }",
		"td.wrap, th.wrap { white-space:normal; min-width:12rem; }",
		"thead th { position:sticky; top:0; background:var(--panel2); cursor:pointer;",
		"  user-select:none; z-index:1; }",
		"thead th.no-sort { cursor:default; }",
		"tbody tr:hover { background:var(--panel2); }",
		"td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }",
		".tag { display:inline-block; background:var(--panel2); border:1px solid var(--line);",
		"  border-radius:999px; padding:0 .45rem; font-size:.78rem; color:var(--dim); }",
		".pill { color:var(--accent); background:none; border:none; padding:0; font:inherit;",
		"  cursor:pointer; text-align:left; }",
		".pill:hover { text-decoration:underline; }",
		".up { color:var(--good); } .down { color:var(--bad); } .dim { color:var(--dim); }",
		".rounds { display:flex; gap:1rem; overflow-x:auto; padding-bottom:.5rem; }",
		".round { min-width:15rem; flex:0 0 auto; }",
		".gamecard { background:var(--panel2); border:1px solid var(--line);",
		"  border-radius:var(--radius); padding:.4rem .55rem; margin:0 0 .4rem; font-size:.85rem; }",
		".gamecard .w { font-weight:600; }",
		".gamecard .u { color:var(--warn); font-size:.75rem; }",
		".split { display:grid; gap:1rem; grid-template-columns:minmax(13rem,20rem) 1fr;",
		"  align-items:start; }",
		"@media (max-width:800px) { .split { grid-template-columns:1fr; } }",
		".plist { max-height:70vh; overflow-y:auto; border:1px solid var(--line);",
		"  border-radius:var(--radius); }",
		".plist button { display:block; width:100%; text-align:left; background:none;",
		"  border:none; border-bottom:1px solid var(--line); color:inherit; font:inherit;",
		"  padding:.4rem .6rem; cursor:pointer; }",
		".plist button:hover { background:var(--panel2); }",
		".plist button[aria-current=\"true\"] { background:var(--panel2); box-shadow:inset 3px 0 var(--accent); }",
		".plist .meta { color:var(--dim); font-size:.8rem; }",
		".note { white-space:pre-wrap; }",
		".article { border-bottom:1px solid var(--line); padding:.8rem 0; }",
		".article:last-child { border-bottom:none; }",
		".article h4 { color:var(--ink); font-size:1rem; margin:0 0 .3rem; }",
		".article .by { color:var(--dim); font-size:.8rem; margin-top:.3rem; }",
		".empty { color:var(--dim); font-style:italic; }",
		"footer { color:var(--dim); font-size:.8rem; padding:2rem 1rem; text-align:center; }",
		"@media print { header.top, nav.tabs, .controls, footer { display:none !important; }",
		"  body { background:#fff; color:#000; } .card { border-color:#999; }",
		"  section.view[hidden] { display:none; } .plist { max-height:none; } }",
	].join("\n");

	/* --------------------------------------------------------- the reader */

	/* The page's own code, written as a function and shipped through
	   Function.prototype.toString rather than as a string literal. It is
	   real code in a real file this way: an editor highlights it, a syntax
	   error in it fails at load here instead of silently in whatever browser
	   opens the export, and there is no escaping to get wrong. It reads the
	   JSON out of the document and touches nothing else. */
	function READER() {
		"use strict";
		const src = document.getElementById("season-data");
		const D = JSON.parse(src.textContent);
		const $ = (id) => document.getElementById(id);

		function el(tag, cls, text) {
			const n = document.createElement(tag);
			if (cls) n.className = cls;
			if (text !== undefined && text !== null) n.textContent = String(text);
			return n;
		}
		const has = (k) => D[k] !== undefined && D[k] !== null;
		const n1 = (v) => (typeof v === "number" ? v.toFixed(1) : "");
		const n2 = (v) => (typeof v === "number" ? v.toFixed(2) : "");
		const pct3 = (v) => (typeof v === "number"
			? v.toFixed(3).replace(/^0/, "") : "");
		const pc = (v) => (typeof v === "number" ? (v * 100).toFixed(1) + "%" : "");
		const rec = (w, l) => (typeof w === "number" ? w + "-" + l : "");
		const ordinal = (n) => {
			if (typeof n !== "number") return "";
			const v = n % 100;
			if (v >= 11 && v <= 13) return n + "th";
			return n + (["th", "st", "nd", "rd"][n % 10] || "th");
		};
		const players = has("players") ? D.players : [];
		const byId = new Map(players.map((p) => [p.id, p]));

		/* ---- a sortable, filterable table ------------------------------ */

		/* Every table on the page is this one function. A column is
		   { h, get, num, cls, cell }: `get` pulls the sort key out of a row
		   and `cell` (optional) draws it, so a cell holding a button still
		   sorts on the name behind the button. */
		function mkTable(cols, rows, opts) {
			const o = opts || {};
			const wrap = el("div");
			const state = { key: o.sort === undefined ? -1 : o.sort, dir: o.desc ? -1 : 1 };
			let filter = "";
			if (o.filter) {
				const bar = el("div", "controls");
				const input = el("input");
				input.type = "search";
				input.placeholder = o.filter === true ? "Filter rows…" : o.filter;
				input.addEventListener("input", () => {
					filter = input.value.trim().toLowerCase();
					draw();
				});
				bar.appendChild(input);
				if (o.extra) for (const node of o.extra) bar.appendChild(node);
				wrap.appendChild(bar);
			} else if (o.extra && o.extra.length) {
				const bar = el("div", "controls");
				for (const node of o.extra) bar.appendChild(node);
				wrap.appendChild(bar);
			}
			const box = el("div", "tablewrap");
			const table = el("table");
			const thead = el("thead");
			const htr = el("tr");
			cols.forEach((c, i) => {
				const th = el("th", (c.num ? "num " : "") + (c.wrap ? "wrap " : "") +
					(c.get ? "" : "no-sort"), c.h);
				if (c.get) {
					th.tabIndex = 0;
					th.title = "Sort by " + c.h;
					const sort = () => {
						if (state.key === i) state.dir = -state.dir;
						else { state.key = i; state.dir = c.num ? -1 : 1; }
						draw();
					};
					th.addEventListener("click", sort);
					th.addEventListener("keydown", (e) => {
						if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); }
					});
				}
				htr.appendChild(th);
			});
			thead.appendChild(htr);
			table.appendChild(thead);
			const tbody = el("tbody");
			table.appendChild(tbody);
			box.appendChild(table);
			wrap.appendChild(box);
			const count = el("p", "dim");
			count.style.fontSize = ".8rem";
			wrap.appendChild(count);

			function text(row) {
				return cols.map((c) => {
					const v = c.get ? c.get(row) : c.text ? c.text(row) : "";
					return v === null || v === undefined ? "" : String(v);
				}).join(" ").toLowerCase();
			}

			function draw() {
				let list = rows.slice();
				if (filter) list = list.filter((r) => text(r).indexOf(filter) !== -1);
				if (o.where) list = list.filter(o.where);
				const c = cols[state.key];
				if (c && c.get) {
					list.sort((a, b) => {
						const x = c.get(a);
						const y = c.get(b);
						/* A missing number sorts last whichever way the column
						   is pointing — an empty cell is not a small one. */
						const xn = x === null || x === undefined || x === "";
						const yn = y === null || y === undefined || y === "";
						if (xn || yn) return xn && yn ? 0 : xn ? 1 : -1;
						if (typeof x === "number" && typeof y === "number") {
							return (x - y) * state.dir;
						}
						return String(x).localeCompare(String(y)) * state.dir;
					});
				}
				tbody.textContent = "";
				for (const row of list) {
					const tr = el("tr");
					for (const col of cols) {
						const td = el("td", (col.num ? "num " : "") + (col.wrap ? "wrap " : "") +
							(col.cls ? col.cls(row) : ""));
						if (col.cell) {
							const node = col.cell(row);
							if (node !== null && node !== undefined) {
								if (node instanceof Node) td.appendChild(node);
								else td.textContent = String(node);
							}
						} else {
							const v = col.text ? col.text(row) : col.get ? col.get(row) : "";
							td.textContent = v === null || v === undefined ? "" : String(v);
						}
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
				}
				cols.forEach((col, i) => {
					const th = htr.children[i];
					if (!col.get) return;
					th.textContent = col.h + (state.key === i ? (state.dir > 0 ? " ↑" : " ↓") : "");
				});
				count.textContent = list.length === rows.length
					? list.length + " rows"
					: list.length + " of " + rows.length + " rows";
			}
			draw();
			wrap.redraw = draw;
			return wrap;
		}

		/* A prospect's name, as a link into his capsule. */
		function playerLink(id, name) {
			if (!id || !byId.has(id)) return document.createTextNode(name || "");
			const b = el("button", "pill", name || byId.get(id).name);
			b.addEventListener("click", () => showPlayer(id));
			return b;
		}

		function nameList(list) {
			const span = el("span");
			(list || []).forEach((p, i) => {
				if (i) span.appendChild(document.createTextNode(", "));
				span.appendChild(playerLink(p.id, p.name));
			});
			return span;
		}

		function note(text) {
			const p = el("p", "empty", text);
			return p;
		}

		/* ---- the sections ---------------------------------------------- */

		function stat(k, v, n) {
			const box = el("div", "stat");
			box.appendChild(el("div", "k", k));
			box.appendChild(el("div", "v", v));
			if (n) box.appendChild(el("div", "n", n));
			return box;
		}

		function viewFront(f) {
			const out = el("div");
			const card = el("div", "card");
			if (f.champion) {
				card.appendChild(el("div", "hero", f.champion + " won the national title"));
				if (f.runnerUp) {
					card.appendChild(el("p", "dim", "over " + f.runnerUp +
						(f.finalScore ? ", " + f.finalScore : "") + "."));
				}
			} else {
				card.appendChild(el("div", "hero", "The " + f.season + " season"));
			}
			out.appendChild(card);
			const grid = el("div", "grid");
			if (f.apNo1) grid.appendChild(stat("AP No. 1", f.apNo1.team, f.apNo1.record));
			if (f.playerOfTheYear) {
				grid.appendChild(stat(f.playerOfTheYear.award, f.playerOfTheYear.name,
					f.playerOfTheYear.school));
			}
			if (f.coachOfTheYear) {
				grid.appendChild(stat(f.coachOfTheYear.award, f.coachOfTheYear.coach,
					f.coachOfTheYear.school + " · " + f.coachOfTheYear.record));
			}
			if (f.topProspect) {
				grid.appendChild(stat("No. 1 prospect", f.topProspect.name,
					f.topProspect.pos + " · " + f.topProspect.ovr + "/" +
					f.topProspect.pot + " · " + f.topProspect.school));
			}
			if (f.nitChampion) grid.appendChild(stat("NIT", f.nitChampion, ""));
			grid.appendChild(stat("Prospects", f.classSize, f.teamCount + " programs"));
			grid.appendChild(stat("Seed", f.seed, f.flavor || ""));
			out.appendChild(grid);
			return out;
		}

		function viewPoll(poll) {
			return mkTable([
				{ h: "#", get: (r) => r.rank, num: true },
				{ h: "Team", get: (r) => r.team },
				{ h: "Conf", get: (r) => r.conf },
				{ h: "Record", get: (r) => (r.w || 0) - (r.l || 0), text: (r) => rec(r.w, r.l), num: true },
				{ h: "Conf record", get: (r) => (r.cw || 0) - (r.cl || 0), text: (r) => rec(r.cw, r.cl), num: true },
				{ h: "1st-place", get: (r) => r.firstPlace, num: true },
				{ h: "Preseason", get: (r) => r.preseason, num: true },
				{ h: "Seed", get: (r) => r.ncaaSeed, num: true },
				{ h: "Postseason", get: (r) => r.postseason },
			], poll, { sort: 0, filter: "Filter teams…" });
		}

		function viewStandings(confs) {
			const out = el("div");
			const bar = el("div", "controls");
			const sel = el("select");
			sel.appendChild(new Option("Every conference", ""));
			for (const c of confs) sel.appendChild(new Option(c.conf, c.conf));
			bar.appendChild(sel);
			out.appendChild(bar);
			out.appendChild(el("p", "dim",
				"† regular-season champion · ‡ conference tournament champion."));
			const blocks = [];
			for (const c of confs) {
				const box = el("div");
				box.appendChild(el("h3", null, c.conf));
				box.appendChild(mkTable([
					{
						h: "Team", get: (t) => t.name,
						text: (t) => t.name + (t.regularChamp ? " †" : "") +
							(t.tourneyChamp ? " ‡" : ""),
					},
					{ h: "Conf", get: (t) => (t.cw || 0) - (t.cl || 0), text: (t) => rec(t.cw, t.cl), num: true },
					{ h: "Overall", get: (t) => (t.w || 0) - (t.l || 0), text: (t) => rec(t.w, t.l), num: true },
					{ h: "AP", get: (t) => t.apRank, num: true },
					{ h: "Off", get: (t) => t.offRtg, text: (t) => n1(t.offRtg), num: true },
					{ h: "Def", get: (t) => t.defRtg, text: (t) => n1(t.defRtg), num: true },
					{ h: "Postseason", get: (t) => t.postseason },
					{ h: "Prospects", get: (t) => t.prospects.map((p) => p.name).join(", "),
						cell: (t) => nameList(t.prospects), wrap: true },
				], c.teams, {}));
				out.appendChild(box);
				blocks.push({ conf: c.conf, box });
			}
			sel.addEventListener("change", () => {
				for (const b of blocks) b.box.hidden = !!sel.value && b.conf !== sel.value;
			});
			return out;
		}

		function viewConfTourneys(rows) {
			return mkTable([
				{ h: "Conference", get: (r) => r.conf },
				{ h: "Tournament champion", get: (r) => r.champion },
				{ h: "Regular season", get: (r) => r.regularChamp },
				{ h: "Bid stolen", get: (r) => (r.bidStolen ? 1 : 0),
					text: (r) => (r.bidStolen ? "yes" : ""), num: true },
			], rows, { filter: "Filter conferences…" });
		}

		function gameCard(g) {
			const card = el("div", "gamecard");
			const w = el("div", "w", (g.winnerSeed ? g.winnerSeed + " " : "") + g.winner);
			card.appendChild(w);
			card.appendChild(el("div", "dim", "beat " +
				(g.loserSeed ? g.loserSeed + " " : "") + g.loser +
				(g.score ? ", " + g.score : "")));
			if (g.upset) card.appendChild(el("div", "u", "upset"));
			return card;
		}

		function viewBracket(b) {
			const out = el("div");
			if (b.final) {
				const card = el("div", "card");
				card.appendChild(el("h3", null, "National championship"));
				card.appendChild(gameCard(b.final));
				if (b.semis.length) {
					card.appendChild(el("h4", null, "Final Four"));
					for (const g of b.semis) card.appendChild(gameCard(g));
				}
				out.appendChild(card);
			}
			if (b.firstFour.length) {
				const card = el("div", "card");
				card.appendChild(el("h3", null, "First Four"));
				for (const g of b.firstFour) card.appendChild(gameCard(g));
				out.appendChild(card);
			}
			const bar = el("div", "controls");
			const sel = el("select");
			sel.appendChild(new Option("Every region", ""));
			for (const r of b.regions) sel.appendChild(new Option(r.name, r.name));
			bar.appendChild(sel);
			out.appendChild(bar);
			const blocks = [];
			for (const r of b.regions) {
				const box = el("div", "card");
				box.appendChild(el("h3", null, r.name + " region" +
					(r.champion ? " — " + r.champion : "")));
				if (r.seeds.length) {
					box.appendChild(el("p", "dim", "Seeds: " +
						r.seeds.map((s) => s.seed + " " + s.team).join(" · ")));
				}
				const rounds = el("div", "rounds");
				for (const round of r.rounds) {
					const col = el("div", "round");
					col.appendChild(el("h4", null, round.name));
					for (const g of round.games) col.appendChild(gameCard(g));
					rounds.appendChild(col);
				}
				box.appendChild(rounds);
				out.appendChild(box);
				blocks.push({ name: r.name, box });
			}
			sel.addEventListener("change", () => {
				for (const x of blocks) x.box.hidden = !!sel.value && x.name !== sel.value;
			});
			if (b.nitChampion) {
				out.appendChild(el("p", null, "NIT champion: " + b.nitChampion + "."));
			}
			return out;
		}

		function viewAwards(a) {
			const out = el("div");
			for (const b of a.ballots) {
				const card = el("div", "card");
				card.appendChild(el("h3", null, b.award));
				if (typeof b.resumeLean === "number") {
					card.appendChild(el("p", "dim", "résumé lean " + n2(b.resumeLean) + "."));
				}
				card.appendChild(mkTable([
					{ h: "#", get: (r) => r.rank, num: true },
					{ h: "Player", get: (r) => r.name,
						cell: (r) => {
							const span = el("span");
							span.appendChild(playerLink(r.id, r.name));
							if (!r.inClass) span.appendChild(el("span", "dim", " (not in the class)"));
							return span;
						} },
					{ h: "School", get: (r) => r.school },
					{ h: "Behind", get: (r) => r.behind,
						text: (r) => (r.rank === 1 ? "winner" : "−" + n2(r.behind)), num: true },
				], b.top, {}));
				out.appendChild(card);
			}
			if (a.coachHonors.length) {
				out.appendChild(el("h3", null, "Coaching honors"));
				out.appendChild(mkTable([
					{ h: "Award", get: (r) => r.award },
					{ h: "Coach", get: (r) => r.coach },
					{ h: "School", get: (r) => r.school },
					{ h: "Record", get: (r) => r.record },
				], a.coachHonors, {}));
			}
			if (a.players.length) {
				out.appendChild(el("h3", null, "Every honor in the class"));
				out.appendChild(mkTable([
					{ h: "Player", get: (r) => r.name, cell: (r) => playerLink(r.id, r.name) },
					{ h: "School", get: (r) => r.school },
					{ h: "Honors", get: (r) => r.honors.length,
						text: (r) => r.honors.join("; "), wrap: true, num: false },
				], a.players, { filter: "Filter honors…" }));
			}
			if (a.fieldHonors.length) {
				out.appendChild(el("h3", null, "Honors won outside the class"));
				out.appendChild(el("p", "dim",
					"Returning players the sim ran alongside the class."));
				out.appendChild(mkTable([
					{ h: "Award", get: (r) => r.award },
					{ h: "Player", get: (r) => r.name },
					{ h: "School", get: (r) => r.school },
					{ h: "Year", get: (r) => r.classYear },
				], a.fieldHonors, { filter: "Filter honors…" }));
			}
			return out;
		}

		function viewLeaders(boards) {
			const out = el("div");
			out.appendChild(el("p", "dim",
				"Rotation players only (15+ minutes a game). A rank is where he " +
				"finished against the whole of Division I, not only against this class."));
			const grid = el("div", "grid");
			for (const b of boards) {
				const card = el("div", "card");
				card.appendChild(el("h4", null, b.title));
				const fmt = (v) => (b.pct ? (b.key === "tpp" ? pct3(v) : pc(v))
					: b.digits === 3 ? pct3(v) : n1(v));
				for (const r of b.rows) {
					const line = el("div");
					line.appendChild(el("span", "dim", r.pos + ". "));
					line.appendChild(playerLink(r.id, r.name));
					line.appendChild(el("span", null, " " + fmt(r.value)));
					const rank = r.national ? ordinal(r.national) + " nationally"
						: r.conf ? ordinal(r.conf) + " in the " + r.confName : "";
					if (rank) line.appendChild(el("span", "dim", " · " + rank));
					card.appendChild(line);
				}
				grid.appendChild(card);
			}
			out.appendChild(grid);
			return out;
		}

		function viewProLeagues(leagues) {
			const out = el("div");
			for (const lg of leagues) {
				const card = el("div", "card");
				card.appendChild(el("h3", null, lg.name));
				const line = [];
				if (lg.champion) line.push("Champion: " + lg.champion);
				if (lg.cupChampion) line.push("Cup: " + lg.cupChampion);
				if (line.length) card.appendChild(el("p", "dim", line.join(" · ") + "."));
				card.appendChild(mkTable([
					{ h: "#", get: (c) => c.pos, text: (c) => c.pos + (c.relegated ? " ↓" : ""), num: true },
					{ h: "Club", get: (c) => c.club },
					{ h: "Record", get: (c) => (c.w || 0) - (c.l || 0), text: (c) => rec(c.w, c.l), num: true },
					{ h: "Prospects", get: (c) => c.prospects.map((p) => p.name).join(", "),
						cell: (c) => {
							const span = el("span");
							c.prospects.forEach((p, i) => {
								if (i) span.appendChild(document.createTextNode(", "));
								span.appendChild(playerLink(p.id, p.name));
								if (typeof p.ppg === "number") {
									span.appendChild(el("span", "dim", " (" + n1(p.ppg) + " ppg)"));
								}
							});
							return span;
						}, wrap: true },
				], lg.table, {}));
				out.appendChild(card);
			}
			return out;
		}

		function viewBoard(board) {
			const posSel = el("select");
			const confSel = el("select");
			const positions = [];
			const confs = [];
			for (const p of board) {
				if (p.pos && positions.indexOf(p.pos) === -1) positions.push(p.pos);
				if (p.conf && confs.indexOf(p.conf) === -1) confs.push(p.conf);
			}
			posSel.appendChild(new Option("Every position", ""));
			for (const p of positions.sort()) posSel.appendChild(new Option(p, p));
			confSel.appendChild(new Option("Every conference", ""));
			for (const c of confs.sort()) confSel.appendChild(new Option(c, c));
			const table = mkTable([
				{ h: "#", get: (p) => p.rank, num: true },
				{ h: "Player", get: (p) => p.name, cell: (p) => playerLink(p.id, p.name) },
				{ h: "Pos", get: (p) => p.pos },
				{ h: "Ovr", get: (p) => p.ovr, num: true },
				{ h: "Pot", get: (p) => p.pot, num: true },
				{ h: "School", get: (p) => p.school },
				{ h: "Conf", get: (p) => p.conf },
				{ h: "Year", get: (p) => p.classYear },
				{ h: "Archetype", get: (p) => p.archetype },
				{ h: "PPG", get: (p) => p.ppg, text: (p) => n1(p.ppg), num: true },
				{ h: "RPG", get: (p) => p.rpg, text: (p) => n1(p.rpg), num: true },
				{ h: "APG", get: (p) => p.apg, text: (p) => n1(p.apg), num: true },
				{ h: "Honors", get: (p) => p.honors, num: true },
				{ h: "Preseason", get: (p) => p.preseason, num: true },
				{ h: "Move", get: (p) => p.move,
					text: (p) => (typeof p.move === "number" && p.move !== 0
						? (p.move > 0 ? "+" + p.move : String(p.move)) : ""),
					cls: (p) => (typeof p.move === "number" && p.move > 0 ? "up"
						: typeof p.move === "number" && p.move < 0 ? "down" : ""),
					num: true },
				{ h: "Mock", get: (p) => p.mock },
			], board, {
				sort: 0,
				filter: "Search the board…",
				extra: [posSel, confSel],
				where: (p) => (!posSel.value || p.pos === posSel.value) &&
					(!confSel.value || p.conf === confSel.value),
			});
			posSel.addEventListener("change", table.redraw);
			confSel.addEventListener("change", table.redraw);
			return table;
		}

		/* The prospects: a filterable list on the left, one capsule on the
		   right. Every player link anywhere else on the page lands here. */
		let selectPlayer = null;

		function capsule(p) {
			const out = el("div", "card");
			out.appendChild(el("h3", null, (p.rank ? p.rank + ". " : "") + p.name));
			const bits = [p.pos, p.ovr + "/" + p.pot, p.archetype, p.classYear, p.school];
			if (typeof p.hgtInches === "number") {
				bits.push(Math.floor(p.hgtInches / 12) + "'" + (p.hgtInches % 12) +
					'" ' + p.weight + " lb");
			}
			if (p.mock) bits.push("mock " + p.mock);
			out.appendChild(el("p", "dim", bits.filter(Boolean).join(" · ")));
			if (p.skills && p.skills.length) {
				const row = el("p");
				for (const s of p.skills) {
					row.appendChild(el("span", "tag", s));
					row.appendChild(document.createTextNode(" "));
				}
				out.appendChild(row);
			}
			if (p.stats) {
				const s = p.stats;
				const cols = [
					["GP", s.gp], ["MPG", n1(s.mpg)], ["PPG", n1(s.ppg)], ["RPG", n1(s.rpg)],
					["APG", n1(s.apg)], ["SPG", n1(s.spg)], ["BPG", n1(s.bpg)],
					["TOPG", n1(s.topg)], ["FG%", pct3(s.fgp)], ["3P%", pct3(s.tpp)],
					["FT%", pct3(s.ftp)], ["TS%", pc(s.ts)], ["USG", pc(s.usg)],
				].filter((c) => c[1] !== undefined && c[1] !== "");
				const wrap = el("div", "tablewrap");
				const t = el("table");
				const thead = el("thead");
				const htr = el("tr");
				for (const c of cols) htr.appendChild(el("th", "num", c[0]));
				thead.appendChild(htr);
				t.appendChild(thead);
				const tb = el("tbody");
				const tr = el("tr");
				for (const c of cols) tr.appendChild(el("td", "num", c[1]));
				tb.appendChild(tr);
				t.appendChild(tb);
				wrap.appendChild(t);
				out.appendChild(wrap);
			}
			if (p.honors && p.honors.length) {
				out.appendChild(el("h4", null, "Honors"));
				out.appendChild(el("p", null, p.honors.join("; ") + "."));
			}
			if (p.ratings) {
				out.appendChild(el("h4", null, "Ratings"));
				const grid = el("div", "grid");
				for (const k of Object.keys(p.ratings).sort()) {
					if (typeof p.ratings[k] !== "number") continue;
					grid.appendChild(stat(k, p.ratings[k]));
				}
				out.appendChild(grid);
			}
			if (p.note) {
				out.appendChild(el("h4", null, "The note"));
				out.appendChild(el("p", "note", p.note));
			}
			return out;
		}

		function viewPlayers(list) {
			const out = el("div", "split");
			const left = el("div");
			const bar = el("div", "controls");
			const search = el("input");
			search.type = "search";
			search.placeholder = "Search prospects…";
			bar.appendChild(search);
			const posSel = el("select");
			const positions = [];
			for (const p of list) if (p.pos && positions.indexOf(p.pos) === -1) positions.push(p.pos);
			posSel.appendChild(new Option("Every position", ""));
			for (const p of positions.sort()) posSel.appendChild(new Option(p, p));
			bar.appendChild(posSel);
			left.appendChild(bar);
			const plist = el("div", "plist");
			left.appendChild(plist);
			const right = el("div");
			out.appendChild(left);
			out.appendChild(right);
			const buttons = new Map();
			let current = null;

			function show(id) {
				const p = byId.get(id);
				if (!p) return;
				current = id;
				right.textContent = "";
				right.appendChild(capsule(p));
				for (const [pid, b] of buttons) b.setAttribute("aria-current", pid === id ? "true" : "false");
				const b = buttons.get(id);
				if (b) b.scrollIntoView({ block: "nearest" });
			}
			selectPlayer = show;

			function drawList() {
				const q = search.value.trim().toLowerCase();
				plist.textContent = "";
				buttons.clear();
				let shown = 0;
				for (const p of list) {
					if (posSel.value && p.pos !== posSel.value) continue;
					if (q && [p.name, p.school, p.archetype, p.conf, p.classYear]
						.filter(Boolean).join(" ").toLowerCase().indexOf(q) === -1) continue;
					const b = el("button");
					b.appendChild(el("div", null, (p.rank ? p.rank + ". " : "") + p.name));
					b.appendChild(el("div", "meta",
						[p.pos, p.ovr + "/" + p.pot, p.school].filter(Boolean).join(" · ")));
					b.addEventListener("click", () => show(p.id));
					buttons.set(p.id, b);
					plist.appendChild(b);
					shown++;
				}
				if (!shown) plist.appendChild(note("Nobody matches that."));
				if (current && buttons.has(current)) {
					buttons.get(current).setAttribute("aria-current", "true");
				}
			}
			search.addEventListener("input", drawList);
			posSel.addEventListener("change", drawList);
			drawList();
			if (list.length) show(list[0].id);
			return out;
		}

		function segNodes(list) {
			const span = el("span");
			for (const s of list) {
				if (s.t === "player" && s.id && byId.has(s.id)) {
					span.appendChild(playerLink(s.id, s.v));
				} else {
					span.appendChild(document.createTextNode(s.v));
				}
			}
			return span;
		}

		/* The news feed. Eighty to a hundred and twenty articles, so it draws
		   a page at a time: the whole feed in the DOM at once is a second of
		   layout on a phone, and nobody reads article ninety first. */
		function viewNews(news) {
			const out = el("div");
			const bar = el("div", "controls");
			const search = el("input");
			search.type = "search";
			search.placeholder = "Search the feed…";
			bar.appendChild(search);
			const kindSel = el("select");
			const kinds = [];
			for (const a of news.articles) if (kinds.indexOf(a.kind) === -1) kinds.push(a.kind);
			kindSel.appendChild(new Option("Every kind of story", ""));
			for (const k of kinds.sort()) kindSel.appendChild(new Option(k, k));
			bar.appendChild(kindSel);
			out.appendChild(bar);
			const count = el("p", "dim");
			out.appendChild(count);
			const feed = el("div");
			out.appendChild(feed);
			const more = el("button", "btn", "Show more");
			out.appendChild(more);
			const PAGE = 25;
			let limit = PAGE;

			function matches() {
				const q = search.value.trim().toLowerCase();
				return news.articles.filter((a) => {
					if (kindSel.value && a.kind !== kindSel.value) return false;
					if (!q) return true;
					return (a.headlineText + " " + a.paras.join(" ") + " " + a.kind + " " +
						a.body.map((s) => s.v).join("")).toLowerCase().indexOf(q) !== -1;
				});
			}

			function draw() {
				const list = matches();
				feed.textContent = "";
				let lastDate = null;
				for (const a of list.slice(0, limit)) {
					if (a.dateline !== lastDate) {
						feed.appendChild(el("h3", null, a.dateline));
						lastDate = a.dateline;
					}
					const art = el("div", "article");
					const h = el("h4");
					h.appendChild(segNodes(a.headline));
					art.appendChild(h);
					const body = el("p");
					body.appendChild(segNodes(a.body));
					art.appendChild(body);
					for (const para of a.paras) art.appendChild(el("p", null, para));
					art.appendChild(el("div", "by", a.kind + (a.byline ? " · " + a.byline : "")));
					feed.appendChild(art);
				}
				if (!list.length) feed.appendChild(note("No article matches that."));
				count.textContent = Math.min(limit, list.length) + " of " + list.length +
					" articles" + (news.shown < news.total
						? " (" + news.shown + " of the season's " + news.total + " exported)" : "");
				more.hidden = list.length <= limit;
			}
			more.addEventListener("click", () => { limit += PAGE; draw(); });
			search.addEventListener("input", () => { limit = PAGE; draw(); });
			kindSel.addEventListener("change", () => { limit = PAGE; draw(); });
			draw();
			return out;
		}

		function viewEvents(e) {
			const out = el("div");
			if (e.events.length) {
				out.appendChild(el("h3", null, "Season events"));
				out.appendChild(mkTable([
					{ h: "When", get: (r) => r.when },
					{ h: "Kind", get: (r) => r.kind },
					{ h: "What happened", get: (r) => r.text, wrap: true },
				], e.events, { filter: "Filter events…" }));
			}
			if (e.carousel.length) {
				out.appendChild(el("h3", null, "The coaching carousel"));
				out.appendChild(mkTable([
					{ h: "School", get: (r) => r.school },
					{ h: "Coach", get: (r) => r.coach },
					{ h: "Record", get: (r) => (r.w || 0) - (r.l || 0), text: (r) => rec(r.w, r.l), num: true },
					{ h: "Why", get: (r) => r.reason, wrap: true },
					{ h: "Tenure", get: (r) => r.tenure,
						text: (r) => (r.tenure ? r.tenure + " years" : ""), num: true },
				], e.carousel, { filter: "Filter the carousel…" }));
			}
			return out;
		}

		function viewColophon(c) {
			const out = el("div");
			out.appendChild(el("p", null, "Written by the BBGM Draft Class Workshop " +
				"from seed “" + c.seed + "”. Every number here came out of one " +
				"run: re-running the same seed with the same settings writes the " +
				"same site."));
			if (c.warnings.length) {
				out.appendChild(el("h3", null, "Warnings from the run"));
				const ul = el("ul");
				for (const w of c.warnings) ul.appendChild(el("li", null, w));
				out.appendChild(ul);
			}
			if (c.settings.length) {
				out.appendChild(el("h3", null, "Settings"));
				out.appendChild(mkTable([
					{ h: "Setting", get: (r) => r.key },
					{ h: "Value", get: (r) => r.value, wrap: true },
				], c.settings, { filter: "Filter settings…" }));
			}
			return out;
		}

		const VIEWS = {
			front: viewFront, poll: viewPoll, standings: viewStandings,
			confTourneys: viewConfTourneys, bracket: viewBracket, awards: viewAwards,
			leaders: viewLeaders, proLeagues: viewProLeagues, board: viewBoard,
			capsules: viewPlayers, news: viewNews, events: viewEvents,
			colophon: viewColophon,
		};

		/* ---- assembly -------------------------------------------------- */

		const main = $("main");
		const tabs = $("tabs");
		const views = new Map();
		const built = new Set();

		function showSection(id) {
			if (!views.has(id)) return;
			for (const [key, node] of views) node.hidden = key !== id;
			for (const b of tabs.children) {
				b.setAttribute("aria-current", b.dataset.id === id ? "true" : "false");
			}
			/* Sections draw on first visit. The board and the news feed are
			   the two big ones, and building all thirteen up front is a
			   visible pause on a file opened from a phone. */
			if (!built.has(id)) {
				built.add(id);
				const sec = D.sections.filter((s) => s.id === id)[0];
				const view = VIEWS[id];
				const node = views.get(id);
				try {
					node.appendChild(view(D[sec.key]));
				} catch (err) {
					node.appendChild(note("This section could not be drawn: " +
						(err && err.message ? err.message : String(err))));
				}
			}
			if (location.hash !== "#" + id) {
				history.replaceState(null, "", "#" + id);
			}
			window.scrollTo({ top: 0 });
		}

		for (const s of D.sections) {
			if (!VIEWS[s.id] || D[s.key] === undefined) continue;
			const b = el("button", null, s.label);
			b.dataset.id = s.id;
			b.addEventListener("click", () => showSection(s.id));
			tabs.appendChild(b);
			const sec = el("section", "view");
			sec.id = "section-" + s.id;
			sec.hidden = true;
			sec.appendChild(el("h2", null, s.label));
			main.appendChild(sec);
			views.set(s.id, sec);
		}

		function showPlayer(id) {
			if (!views.has("capsules")) return;
			showSection("capsules");
			if (selectPlayer) selectPlayer(id);
		}

		/* The header search jumps straight to a prospect: the question a
		   finished season gets asked most often is "what did this guy do". */
		const jump = $("jump");
		const hits = $("hits");
		if (players.length) {
			jump.addEventListener("input", () => {
				const q = jump.value.trim().toLowerCase();
				hits.textContent = "";
				if (!q) { hits.hidden = true; return; }
				const list = players.filter((p) =>
					(p.name + " " + (p.school || "")).toLowerCase().indexOf(q) !== -1).slice(0, 8);
				for (const p of list) {
					const b = el("button", "pill",
						p.name + " — " + [p.pos, p.school].filter(Boolean).join(", "));
					b.addEventListener("click", () => {
						showPlayer(p.id);
						jump.value = "";
						hits.hidden = true;
					});
					const row = el("div");
					row.appendChild(b);
					hits.appendChild(row);
				}
				hits.hidden = !list.length;
			});
		} else {
			jump.hidden = true;
		}

		/* The JSON back out of the page. The site IS the data file: whoever
		   receives the .html can pull the season out of it and run their own
		   numbers without asking the sender for a second export. */
		$("dl").addEventListener("click", () => {
			const blob = new Blob([JSON.stringify(D, null, 2)], { type: "application/json" });
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = "season_" + D.season + "_" + D.seed + ".json";
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 5000);
		});

		const theme = $("theme");
		theme.addEventListener("click", () => {
			const light = document.documentElement.dataset.theme === "light";
			document.documentElement.dataset.theme = light ? "dark" : "light";
			theme.textContent = light ? "Light mode" : "Dark mode";
		});

		window.addEventListener("hashchange", () => {
			const id = location.hash.replace(/^#/, "");
			if (views.has(id)) showSection(id);
		});
		const first = location.hash.replace(/^#/, "");
		showSection(views.has(first) ? first : views.keys().next().value);
	}

	function html(result, options) {
		const opts = options || {};
		const json = result && result.format === FORMAT ? result : data(result, opts);
		const head = json.title;
		return [
			"<!doctype html>",
			"<html lang=\"en\" data-theme=\"dark\">",
			"<head>",
			"<meta charset=\"utf-8\">",
			"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
			"<title>" + escapeHtml(head) + "</title>",
			"<style>", CSS, "</style>",
			"</head>",
			"<body>",
			"<header class=\"top\">",
			"<div class=\"topline\">",
			"<h1>" + escapeHtml(head) + "</h1>",
			"<input id=\"jump\" type=\"search\" placeholder=\"Find a prospect…\">",
			"<button class=\"btn\" id=\"dl\">Download season.json</button>",
			"<button class=\"btn\" id=\"theme\">Light mode</button>",
			"</div>",
			"<div class=\"sub\">seed " + escapeHtml(json.seed) +
				(json.flavor ? " · " + escapeHtml(json.flavor) : "") + "</div>",
			"<div id=\"hits\" hidden></div>",
			"<nav class=\"tabs\" id=\"tabs\"></nav>",
			"</header>",
			"<main id=\"main\"></main>",
			"<footer>Every table on this page is read out of the JSON embedded in " +
				"it — “Download season.json” hands you the same data the page " +
				"is drawing.</footer>",
			/* The data goes in before the reader, so the reader can read it
			   the moment it runs and the page needs no load event. */
			"<script type=\"application/json\" id=\"season-data\">",
			embed(json),
			"<\/script>",
			"<script>",
			"(" + READER.toString() + ")();",
			"<\/script>",
			"</body>",
			"</html>",
			"",
		].join("\n");
	}

	global.SeasonSite = { data, html, SECTIONS, KEYS, FORMAT, VERSION, CSS };
})(typeof window !== "undefined" ? window : self);
