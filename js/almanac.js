/* THE ALMANAC.

   Everything the tool knows about one simulated season, written out as a
   single document: the final poll, every conference's standings, the bracket
   round by round, the honors, the leader boards, the pro leagues, the draft
   board, a capsule for every prospect, and the season's news feed in date
   order.

   The pieces were all there and every one of them lived on a different tab —
   the only way to keep a season was to visit nine views and copy each one, and
   the existing exports are shaped for machines (JSON for a re-import, CSV for
   a spreadsheet). This writes the season for a READER, in one file, the way an
   almanac does.

   Markdown is the source format and `html()` renders that same document for
   printing, so the PDF and the .md can never disagree — there is one section
   list, not two. No DOM anywhere in here: the tests run it in Node, and the
   markdown a browser downloads is the markdown CI checks. */
(function (global) {
	"use strict";

	/* ------------------------------------------------------------ helpers */

	const n1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "");
	const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : "");
	const pc = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) : "");
	/* Shooting percentages read .446, not 0.446, everywhere in the tool. */
	const pct3 = (v) => (Number.isFinite(v) ? v.toFixed(3).replace(/^0/, "") : "");

	/* A cell can carry a pipe (a note, a team style) or a newline (a note
	   again), and either one silently breaks the row it is in. */
	function cell(v) {
		return String(v === undefined || v === null ? "" : v)
			.replace(/\|/g, "\\|").replace(/\n/g, " ");
	}

	function table(heads, rows) {
		if (!rows.length) return "";
		return ["| " + heads.map(cell).join(" | ") + " |",
			"| " + heads.map(() => "---").join(" | ") + " |"]
			.concat(rows.map((r) => "| " + r.map(cell).join(" | ") + " |"))
			.join("\n");
	}

	function ordinal(n) {
		const v = n % 100;
		if (v >= 11 && v <= 13) return n + "th";
		return n + (["th", "st", "nd", "rd"][n % 10] || "th");
	}

	/* A news article's segments as plain text. The view turns a player or team
	   seg into a link; a document has no links to turn them into, and `v` is
	   the same string either way. */
	function segText(segs) {
		return (segs || []).map((s) => (s && s.v !== undefined ? s.v : "")).join("");
	}

	function schoolOf(p) { return p.proClub || p.newCollege; }

	function scoped(awards, opts) {
		const A = global.Awards;
		if (!A || !A.scopeAwards) return (awards || []).slice();
		return A.scopeAwards(awards || [], opts.awardsScope || "all",
			opts.majorConferences || null);
	}

	/* ------------------------------------------------------------ sections */

	/* Every section is { id, label, write(res, opts) -> markdown or "" }, in
	   the order they appear in the document. The dialog builds its checkbox
	   list off this array, so a section added here shows up in the UI, in the
	   contents and in the printed PDF with nothing else to edit. */

	function writeFront(res, opts) {
		const out = [];
		const t = res.tourney;
		out.push("# The " + res.season + " season");
		out.push("");
		const sub = ["seed `" + res.seed + "`"];
		if (res.flavor && res.flavor.label) sub.push(res.flavor.label);
		sub.push(res.players.length + " prospects");
		out.push("_" + sub.join(" · ") + "._");
		out.push("");
		const facts = [];
		if (t && t.champion) {
			facts.push(["National champion", t.champion.team.name +
				(t.champion.seed ? " (" + ordinal(t.champion.seed) + " seed)" : "")]);
		}
		if (t && t.runnerUp) facts.push(["Runner-up", t.runnerUp.team.name]);
		if (t && t.final && t.final.score) facts.push(["Final score", t.final.score]);
		if (t && t.nit && t.nit.champion) facts.push(["NIT champion", t.nit.champion.name]);
		if (res.poll && res.poll.length) {
			facts.push(["Final AP No. 1", res.poll[0].name + " (" +
				res.poll[0].w + "-" + res.poll[0].l + ")"]);
		}
		const poy = (res.poyBallots || [])[0];
		if (poy && poy.top && poy.top[0]) {
			facts.push([poy.award, poy.top[0].name + ", " + poy.top[0].school]);
		}
		const coy = (res.coachHonors || [])[0];
		if (coy) facts.push([coy.award, coy.coach + ", " + coy.school + " (" + coy.record + ")"]);
		const top = (res.board || [])[0];
		if (top) {
			facts.push(["No. 1 on the board", top.name + ", " + schoolOf(top) +
				" (" + top.newPos + " " + top.newOvr + "/" + top.newPot + ")"]);
		}
		/* A list, not a table: a two-column table of eight facts prints with
		   an empty header band above it, and there is nothing to put in the
		   header — these are labels and values, not columns. */
		if (facts.length) {
			for (const [label, value] of facts) out.push("- **" + label + "** — " + value);
			out.push("");
		}
		if (res.narrative && res.narrative.length) {
			out.push("**The year in a sentence:** " +
				res.narrative.map((n) => n.blurb).join("; ") + ".");
			out.push("");
		}
		if (res.surprises && res.surprises.length) {
			out.push("**Story of the class:** " +
				res.surprises.map((s) => s.player + ", " + s.label).join("; ") + ".");
			out.push("");
		}
		return out.join("\n");
	}

	function writePoll(res) {
		if (!res.poll || !res.poll.length) return "";
		const rows = res.poll.slice(0, 25).map((t, i) => [
			i + 1, t.name, t.conf, t.w + "-" + t.l,
			t.cw !== undefined ? t.cw + "-" + t.cl : "",
			t.apFirstPlace || "", t.apPreseason || "—",
			t.ncaaSeed ? ordinal(t.ncaaSeed) : "",
			t.ncaaResult || t.nitResult || "",
		]);
		return ["## Final AP poll", "",
			table(["#", "Team", "Conf", "Record", "Conf", "1st-place votes",
				"Preseason", "Seed", "Postseason"], rows), ""].join("\n");
	}

	/* Standings, conference by conference, the way a media guide prints them:
	   ordered by conference record and then overall, with the regular-season
	   and tournament champions marked. */
	function writeStandings(res) {
		const byConf = {};
		for (const t of Object.values(res.teams)) {
			if (!t.conf) continue;
			(byConf[t.conf] = byConf[t.conf] || []).push(t);
		}
		const names = Object.keys(byConf).sort();
		if (!names.length) return "";
		const out = ["## Conference standings", "",
			"_† regular-season champion · ‡ conference tournament champion._", ""];
		for (const conf of names) {
			const teams = byConf[conf].slice().sort((a, b) => {
				const ap = (a.cw || 0) - (a.cl || 0);
				const bp = (b.cw || 0) - (b.cl || 0);
				if (bp !== ap) return bp - ap;
				return (b.w || 0) - (b.l || 0) - ((a.w || 0) - (a.l || 0));
			});
			out.push("### " + conf);
			out.push("");
			out.push(table(["Team", "Conf", "Overall", "AP", "Postseason", "Prospects"],
				teams.map((t) => [
					t.name + (t.confRegularChamp ? " †" : "") + (t.confTourneyChamp ? " ‡" : ""),
					(t.cw || 0) + "-" + (t.cl || 0),
					(t.w || 0) + "-" + (t.l || 0),
					t.apRank || "",
					t.ncaaResult || t.nitResult || "",
					(t.prospects || []).map((p) => p.name).join(", "),
				])));
			out.push("");
		}
		return out.join("\n");
	}

	function writeConfTourneys(res) {
		const ct = res.confTourneys || {};
		const names = Object.keys(ct).sort();
		if (!names.length) return "";
		const rows = names.map((conf) => {
			const t = ct[conf];
			const champ = t.champ && t.champ.team ? t.champ.team.name
				: t.champ && t.champ.name ? t.champ.name : "";
			const reg = t.regularChamp && t.regularChamp.name ? t.regularChamp.name
				: t.regularChamp || "";
			return [conf, champ, reg, champ && reg && champ !== reg ? "yes" : ""];
		});
		return ["## Conference tournaments", "",
			table(["Conference", "Tournament champion", "Regular season", "Bid stolen"],
				rows), ""].join("\n");
	}

	/* A bracket entry is { seed, team }; a play-in game and the pro tables
	   carry the team itself. Both arrive here. */
	function teamName(x) {
		if (!x) return "";
		return x.team ? x.team.name : x.name || "";
	}

	const ROUND_NAMES = ["First round", "Second round", "Sweet 16", "Elite Eight"];

	function writeBracket(res) {
		const t = res.tourney;
		if (!t || !t.regions) return "";
		const out = ["## March Madness", ""];
		if (t.firstFour && t.firstFour.length) {
			out.push("### First Four", "");
			/* A play-in game carries the two TEAMS, where a bracket game
			   carries seeded entries — hence teamName rather than g.a.team. */
			out.push(table(["Seed", "Winner", "Loser", "Score"], t.firstFour.map((g) => [
				g.seed ? ordinal(g.seed) : "",
				teamName(g.winner),
				teamName(g.winner === g.a ? g.b : g.a),
				g.score,
			])));
			out.push("");
		}
		for (const region of Object.keys(t.regions)) {
			const r = t.regions[region];
			out.push("### " + region + " region");
			out.push("");
			if (r.seeds && r.seeds.length) {
				out.push("_Seeds: " + r.seeds.map((s, i) =>
					(i + 1) + " " + (s && s.team ? s.team.name : "")).join(" · ") + "._");
				out.push("");
			}
			r.rounds.forEach((games, i) => {
				const rows = games.map((g) => {
					const loser = g.winner === g.a ? g.b : g.a;
					return [
						(g.winner.seed ? g.winner.seed + " " : "") + g.winner.team.name,
						(loser.seed ? loser.seed + " " : "") + loser.team.name,
						g.score, g.upset ? "upset" : "",
					];
				});
				out.push("**" + (ROUND_NAMES[i] || "Round " + (i + 1)) + "**");
				out.push("");
				out.push(table(["Winner", "Loser", "Score", "Upset"], rows));
				out.push("");
			});
			if (r.champ && r.champ.team) {
				out.push("_" + region + " champion: " + r.champ.team.name + "._");
				out.push("");
			}
		}
		if (t.semis && t.semis.length) {
			out.push("### Final Four", "");
			out.push(table(["Winner", "Loser", "Score"], t.semis.map((g) => {
				const loser = g.winner === g.a ? g.b : g.a;
				return [g.winner.team.name, loser.team.name, g.score];
			})));
			out.push("");
		}
		if (t.final && t.final.winner) {
			const loser = t.final.winner === t.final.a ? t.final.b : t.final.a;
			out.push("### National championship", "");
			out.push("**" + t.final.winner.team.name + "** beat " +
				loser.team.name + ", " + t.final.score + ".");
			out.push("");
		}
		if (t.nit && t.nit.champion) {
			out.push("### NIT", "");
			out.push("Champion: **" + t.nit.champion.name + "**.");
			out.push("");
		}
		return out.join("\n");
	}

	function writeAwards(res, opts) {
		const out = ["## Honors", ""];
		for (const b of res.poyBallots || []) {
			out.push("### " + b.award);
			out.push("");
			out.push("_résumé lean " + n2(b.resumeLean) + "._");
			out.push("");
			out.push(table(["#", "Player", "School", "Behind"], (b.top || []).map((r) => [
				r.rank, r.name + (r.inClass ? "" : " (not in the class)"), r.school,
				r.rank === 1 ? "winner" : "−" + n2(r.behind),
			])));
			out.push("");
		}
		if (res.coachHonors && res.coachHonors.length) {
			out.push("### Coaching honors", "");
			out.push(table(["Award", "Coach", "School", "Record"],
				res.coachHonors.map((h) => [h.award, h.coach, h.school, h.record])));
			out.push("");
		}
		const winners = res.players
			.filter((p) => scoped(p.awards, opts).length)
			.sort((a, b) => scoped(b.awards, opts).length - scoped(a.awards, opts).length);
		if (winners.length) {
			out.push("### Every honor in the class", "");
			out.push(table(["Player", "School", "Honors"], winners.map((p) => [
				p.name, schoolOf(p), scoped(p.awards, opts).join("; "),
			])));
			out.push("");
		}
		if (res.fieldHonors && res.fieldHonors.length) {
			out.push("### Honors won outside the class", "");
			out.push("_Returning players the sim ran alongside the class — the field the " +
				"trophies are decided against._");
			out.push("");
			out.push(table(["Award", "Player", "School", "Year"],
				res.fieldHonors.map((h) => [h.award, h.name, h.school, h.classYear || ""])));
			out.push("");
		}
		return out.join("\n");
	}

	/* The leader boards, with the same 15-minute cutoff and the same national
	   ranks the Awards tab shows, so the almanac and the screen agree. */
	const LEADERS = [
		["Points", "ppg", n1], ["Rebounds", "rpg", n1], ["Assists", "apg", n1],
		["Steals", "spg", n1], ["Blocks", "bpg", n1],
		["True shooting", "ts", (v) => pc(v) + "%"],
		["Three-point percentage", "tpp", pct3],
		["Contested shots", "cspg", n1], ["Deflections", "deflpg", n1],
		["Charges drawn", "chgpg", n1],
		["Defensive rating (lowest)", "drtg", (v) => n1(v), true],
	];

	function writeLeaders(res) {
		const pool = res.players.filter((p) => p.stats && p.stats.mpg >= 15);
		if (!pool.length) return "";
		const out = ["## Statistical leaders", "",
			"_Rotation players only (15+ minutes a game). A national or conference " +
			"rank is where he finished against the whole of Division I, not only " +
			"against this class._", ""];
		for (const [title, key, fmt, low] of LEADERS) {
			const list = pool.filter((p) => Number.isFinite(p.stats[key]))
				.sort((a, b) => (low ? a.stats[key] - b.stats[key] : b.stats[key] - a.stats[key]))
				.slice(0, 10);
			if (!list.length) continue;
			out.push("**" + title + "**");
			out.push("");
			out.push(table(["#", "Player", "School", title, "Rank"], list.map((p, i) => {
				const r = p.statRanks && p.statRanks[key];
				return [i + 1, p.name, schoolOf(p), fmt(p.stats[key]),
					r && r.national ? ordinal(r.national) + " nationally"
						: r && r.conf ? ordinal(r.conf) + " in the " + r.confName : ""];
			})));
			out.push("");
		}
		return out.join("\n");
	}

	function writeProLeagues(res) {
		const leagues = res.proLeagues || {};
		const names = Object.keys(leagues).sort();
		if (!names.length) return "";
		const out = ["## The professional and non-NCAA leagues", ""];
		for (const name of names) {
			const lg = leagues[name];
			out.push("### " + name);
			out.push("");
			const line = [];
			if (lg.champion) line.push("Champion: **" + lg.champion.name + "**");
			if (lg.cup && lg.cup.champion) line.push("Cup: " + lg.cup.champion.name);
			if (line.length) { out.push(line.join(" · ") + "."); out.push(""); }
			out.push(table(["#", "Club", "Record", "Prospects"],
				(lg.table || []).map((c, i) => [
					(i + 1) + (c.relegated ? " ↓" : ""), c.name, c.w + "-" + c.l,
					(c.prospects || []).map((p) => p.name + " (" +
						n1(p.stats && p.stats.ppg) + " ppg)").join(", "),
				])));
			out.push("");
		}
		return out.join("\n");
	}

	function writeBoard(res) {
		const board = (res.board || []).length
			? res.board
			: res.players.slice().sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
		if (!board.length) return "";
		return ["## The draft board", "",
			table(["#", "Player", "Pos", "Ovr", "Pot", "School", "Year",
				"Archetype", "Preseason", "Move", "Mock"],
				board.map((p) => [
					p.boardRank || "", p.name, p.newPos, p.newOvr, p.newPot,
					schoolOf(p), p.classYear, p.archetype,
					p.preseasonRank || "", p.stockMove || "",
					p.mockRound ? p.mockRound + "-" + p.mockPick : "",
				])), ""].join("\n");
	}

	/* One capsule per prospect: the header line the board shows, his season
	   line, his honors and the scouting note, in board order. This is the part
	   that makes the file an almanac rather than a set of tables. */
	function writeCapsules(res, opts) {
		const board = res.players.slice()
			.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
		if (!board.length) return "";
		const out = ["## The prospects", ""];
		for (const p of board) {
			const s = p.stats || {};
			out.push("### " + (p.boardRank ? p.boardRank + ". " : "") + p.name);
			out.push("");
			out.push("`" + p.newPos + "` **" + p.newOvr + "/" + p.newPot + "** · " +
				p.archetype + " · " + p.classYear + " · " + schoolOf(p) +
				(Number.isFinite(p.newHgtInches)
					? " · " + Math.floor(p.newHgtInches / 12) + "'" +
						(p.newHgtInches % 12) + '" ' + p.newWeight + " lb"
					: ""));
			out.push("");
			if (p.stats) {
				out.push(table(
					["GP", "MPG", "PPG", "RPG", "APG", "SPG", "BPG", "TOPG",
						"FG%", "3P%", "FT%", "TS%", "USG"],
					[[s.gp, n1(s.mpg), n1(s.ppg), n1(s.rpg), n1(s.apg), n1(s.spg),
						n1(s.bpg), n1(s.topg), pct3(s.fgp), pct3(s.tpp), pct3(s.ftp),
						pc(s.ts) + "%", pc(s.usg) + "%"]]));
				out.push("");
			}
			const honors = scoped(p.awards, opts);
			if (honors.length) {
				out.push("**Honors:** " + honors.join("; ") + ".");
				out.push("");
			}
			for (const line of String(p.note || "").split("\n")) {
				if (line.trim()) { out.push(line.trim()); out.push(""); }
			}
		}
		return out.join("\n");
	}

	function writeNews(res, opts) {
		const articles = global.News && global.News.build ? global.News.build(res) : [];
		if (!articles.length) return "";
		const limit = Number.isFinite(opts.newsLimit) && opts.newsLimit > 0
			? opts.newsLimit : articles.length;
		const shown = articles.slice(0, limit);
		const out = ["## The season, as it happened", "",
			"_Every article is read off results the sim produced — nothing here " +
			"can contradict a box score._", ""];
		let lastDate = null;
		for (const a of shown) {
			if (a.dateline !== lastDate) {
				out.push("### " + a.dateline);
				out.push("");
				lastDate = a.dateline;
			}
			out.push("**" + segText(a.headline) + "**");
			out.push("");
			out.push(segText(a.body));
			out.push("");
			for (const para of a.paras || []) {
				const text = segText(para);
				if (text.trim()) { out.push(text); out.push(""); }
			}
			out.push("_" + a.kind + (a.byline ? " · " + a.byline : "") + "_");
			out.push("");
		}
		if (shown.length < articles.length) {
			out.push("_" + shown.length + " of " + articles.length +
				" articles; raise the limit in the almanac dialog for the rest._");
			out.push("");
		}
		return out.join("\n");
	}

	function writeEvents(res) {
		const out = [];
		if (res.seasonEvents && res.seasonEvents.length) {
			out.push("## Season events", "");
			out.push(table(["When", "Kind", "What happened"],
				res.seasonEvents.slice()
					.sort((a, b) => (a.when || 0) - (b.when || 0))
					.map((e) => [
						global.News && global.News.dateline
							? global.News.dateline(e.when || 0) : "",
						e.kind, e.text,
					])));
			out.push("");
		}
		if (res.coachingCarousel && res.coachingCarousel.length) {
			out.push("## The coaching carousel", "");
			out.push(table(["School", "Coach", "Record", "Why", "Tenure"],
				res.coachingCarousel.map((c) => [
					c.school, c.coach, c.w + "-" + c.l, c.reason,
					c.tenure ? c.tenure + " years" : "",
				])));
			out.push("");
		}
		return out.join("\n");
	}

	function writeColophon(res) {
		const cfg = res.effectiveCfg || res.cfg || {};
		const rows = Object.keys(cfg).sort()
			.filter((k) => typeof cfg[k] !== "object" || cfg[k] === null)
			.map((k) => [k, String(cfg[k])]);
		const out = ["## Colophon", "",
			"Written by the BBGM Draft Class Workshop from seed `" + res.seed +
			"`. Every number here came out of one run: re-running the same seed " +
			"with the same settings writes the same almanac.", ""];
		if (res.warnings && res.warnings.length) {
			out.push("**Warnings from the run:** " + res.warnings.join(" ") + "");
			out.push("");
		}
		if (rows.length) {
			out.push("### Settings", "");
			out.push(table(["Setting", "Value"], rows));
			out.push("");
		}
		return out.join("\n");
	}

	const SECTIONS = [
		{ id: "front", label: "Front page — champion, poll No. 1, player of the year", write: writeFront },
		{ id: "poll", label: "Final AP poll", write: writePoll },
		{ id: "standings", label: "Conference standings", write: writeStandings },
		{ id: "confTourneys", label: "Conference tournaments", write: writeConfTourneys },
		{ id: "bracket", label: "March Madness, round by round", write: writeBracket },
		{ id: "awards", label: "Honors and the player-of-the-year ballots", write: writeAwards },
		{ id: "leaders", label: "Statistical leaders", write: writeLeaders },
		{ id: "proLeagues", label: "Professional and non-NCAA leagues", write: writeProLeagues },
		{ id: "board", label: "The draft board", write: writeBoard },
		{ id: "capsules", label: "A capsule for every prospect", write: writeCapsules },
		{ id: "news", label: "The season as news", write: writeNews },
		{ id: "events", label: "Season events and the coaching carousel", write: writeEvents },
		{ id: "colophon", label: "Colophon — seed and settings", write: writeColophon },
	];

	/* ------------------------------------------------------------ document */

	function wanted(opts) {
		const pick = opts.sections;
		if (!pick) return SECTIONS;
		/* An object of booleans (what the dialog builds, one key per section)
		   or an array of ids. Either way a section is in only when it is named:
		   a map that read "absent means yes" put every section into a document
		   whose caller had asked for one. */
		if (Array.isArray(pick)) return SECTIONS.filter((s) => pick.indexOf(s.id) !== -1);
		return SECTIONS.filter((s) => !!pick[s.id]);
	}

	/* A contents list, because this document runs to a few hundred pages with
	   the capsules on and a reader landing in the middle of it needs to know
	   what else is in there. Anchors are GitHub's own slug rules, so the links
	   work in a rendered .md as well as in the printed HTML. */
	function slug(heading) {
		return heading.toLowerCase().replace(/[^\w\- ]+/g, "").trim().replace(/ /g, "-");
	}

	function contents(bodies) {
		const items = [];
		for (const md of bodies) {
			for (const line of md.split("\n")) {
				const m = /^## (.+)$/.exec(line);
				if (m) items.push("- [" + m[1] + "](#" + slug(m[1]) + ")");
			}
		}
		if (!items.length) return "";
		return ["## Contents", ""].concat(items).concat([""]).join("\n");
	}

	function markdown(result, options) {
		const opts = options || {};
		const bodies = [];
		for (const s of wanted(opts)) {
			const md = s.write(result, opts);
			if (md && md.trim()) bodies.push(md.replace(/\n+$/, "") + "\n");
		}
		/* The front page comes first and the contents go under it, not above
		   it: a document that opens with a list of its own sections tells the
		   reader nothing about the season. */
		const front = bodies.length && /^# /.test(bodies[0]) ? bodies.shift() : "";
		/* No contents list on a two-section document: a list of the two
		   headings a reader can already see is furniture. */
		const toc = opts.contents === false || bodies.length < 3
			? "" : contents(bodies);
		return [front, toc].concat(bodies)
			.filter((x) => x && x.trim()).join("\n") + "\n";
	}

	/* ---------------------------------------------------------------- html */

	/* Just enough markdown to render what the sections above emit — headings,
	   tables, paragraphs, bold, italic and code — because that is the whole
	   grammar of this document and pulling in a parser for it would be a
	   dependency in a tool that has none. Anything it does not know renders as
	   the paragraph it already is. */
	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}

	function inline(s) {
		/* Escaped pipes come back as pipes: the cell escaping above is a
		   markdown convention, not something a reader should see. */
		return escapeHtml(s)
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>")
			.replace(/\[([^\]]+)\]\(#([^)]+)\)/g, '<a href="#$2">$1</a>')
			.replace(/\\\|/g, "|");
	}

	function renderBody(md) {
		const lines = md.split("\n");
		const out = [];
		let i = 0;
		let para = [];
		const flush = () => {
			if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>");
			para = [];
		};
		const cells = (line) => line.replace(/^\||\|$/g, "")
			.split(/(?<!\\)\|/).map((c) => c.trim());
		while (i < lines.length) {
			const line = lines[i];
			const h = /^(#{1,4}) (.+)$/.exec(line);
			if (h) {
				flush();
				const level = h[1].length;
				out.push("<h" + level + ' id="' + slug(h[2]) + '">' +
					inline(h[2]) + "</h" + level + ">");
				i++;
				continue;
			}
			if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || "")) {
				flush();
				const heads = cells(line);
				i += 2;
				const rows = [];
				while (i < lines.length && /^\|/.test(lines[i])) {
					rows.push(cells(lines[i]));
					i++;
				}
				out.push("<table><thead><tr>" +
					heads.map((c) => "<th>" + inline(c) + "</th>").join("") +
					"</tr></thead><tbody>" +
					rows.map((r) => "<tr>" +
						r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") +
					"</tbody></table>");
				continue;
			}
			if (/^- /.test(line)) {
				flush();
				const items = [];
				while (i < lines.length && /^- /.test(lines[i])) {
					items.push("<li>" + inline(lines[i].slice(2)) + "</li>");
					i++;
				}
				out.push("<ul>" + items.join("") + "</ul>");
				continue;
			}
			if (!line.trim()) { flush(); i++; continue; }
			para.push(line);
			i++;
		}
		flush();
		return out.join("\n");
	}

	/* A print stylesheet, not a screen one: the reason this exists is "save as
	   PDF", so it is sized in points, every section starts on its own page and
	   a table never breaks across one mid-row. */
	const PRINT_CSS = [
		"@page { size: letter; margin: 18mm 16mm; }",
		"body { font: 10.5pt/1.45 Georgia, 'Times New Roman', serif; color: #111; " +
			"margin: 0 auto; max-width: 46em; padding: 1em; }",
		"h1 { font-size: 26pt; margin: 0 0 .2em; }",
		"h2 { font-size: 16pt; margin: 1.6em 0 .4em; border-bottom: 1px solid #999; " +
			"padding-bottom: .15em; break-before: page; }",
		"h1 + p + h2, h2:first-of-type { break-before: auto; }",
		"h3 { font-size: 12.5pt; margin: 1.1em 0 .3em; }",
		"h4 { font-size: 11pt; margin: .9em 0 .3em; }",
		"p { margin: .45em 0; }",
		"table { border-collapse: collapse; width: 100%; margin: .5em 0 1em; " +
			"font-size: 9pt; break-inside: auto; }",
		"th, td { border: 1px solid #bbb; padding: 2px 5px; text-align: left; " +
			"vertical-align: top; }",
		"th { background: #eee; }",
		"tr { break-inside: avoid; }",
		"thead { display: table-header-group; }",
		"code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; }",
		"ul { margin: .4em 0 1em 1.2em; padding: 0; }",
		"em { color: #444; }",
		"@media screen { body { background: #fff; } }",
	].join("\n");

	function html(result, options) {
		const opts = options || {};
		const md = typeof result === "string" ? result : markdown(result, opts);
		const title = opts.title ||
			(typeof result === "string" ? "Season almanac"
				: "The " + result.season + " season — almanac");
		return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
			"<title>" + escapeHtml(title) + "</title>\n<style>\n" + PRINT_CSS +
			"\n</style>\n</head>\n<body>\n" + renderBody(md) + "\n</body>\n</html>\n";
	}

	global.Almanac = { markdown, html, SECTIONS, renderBody, slug };
})(typeof window !== "undefined" ? window : self);
