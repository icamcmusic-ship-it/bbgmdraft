/* Replayability (audit section 4, ideas 1, 2, 3, 7, 12, 13): the daily
   challenge, par and score, the campaign, short share codes, the "find the
   seed" puzzle and the ghost rival.

   Everything here is pure and deterministic — no DOM, no storage, no clock
   (callers pass the date) — so the harness can check it and app.js only
   wires it to the panel. */
(function (global) {
	"use strict";

	const hash = (s) => global.BBGMRng.hashSeed(String(s));

	/* ---------------------------------------------------- daily challenge

	   Goals come from the reroll predicates and the parametric clauses
	   (negations included), in two bands: COMMON ones hold on roughly half of
	   all classes, so the day is never hopeless; STRETCH ones hold on one in
	   four to one in ten, and set the budget. The vocabulary was 3 + 4 goals,
	   so a stretch goal came back every four days and its answer was learned
	   in a week (audit 2026-10-10, R6); it is now 6 + 10 under a weekly
	   theme, which is about 400 distinct days.

	   Every daily runs on a CANONICAL synthetic class (`classSeed`, built by
	   Sample.makeClass in the app) so "fixed for everybody" is true whatever
	   file a player has loaded (R5); "my own file" is the explicit opt-out. */
	/* Bands measured on the canonical class itself (ten daily classes at
	   the defaults, tools/tests/replaychallenge.js keeps the shape honest):
	   the common goals held on 30-70% of them, the stretch goals on 10-30%.
	   Goals that held on 90%+ (freshmanNo1, the negations of rare events)
	   or never (seniorTop3, abroadNo1) are out. */
	const DAILY_COMMON = ["tallTop5", "freshmen:5", "pos1:C", "!pos1:C", "topOvr:55",
		"!unrankedTop10"];
	const DAILY_STRETCH = [
		// `lever`: dials that make the goal likelier (the test tries them).
		{ key: "unbeaten", budget: 3, lever: { teamMomentum: 2.5 }, theme: "season" },
		{ key: "poyIsNo1", budget: 4, lever: { teamMomentum: 2.5, specialization: 2.5 }, theme: "season" },
		{ key: "poyOutsideClass", budget: 3, lever: { starReturners: 300 }, theme: "season" },
		{ key: "cinderella", budget: 4, lever: { upsetFactor: 2 }, theme: "march" },
		{ key: "midMajorChamp", budget: 4, lever: { midMajorLift: 12, upsetFactor: 2 }, theme: "march" },
		{ key: "strangeness:30", budget: 4, lever: { weirdness: 3, upsetFactor: 2 }, theme: "chaos" },
		{ key: "topOvr:58", budget: 4, lever: { ovrMode: "curve", classQuality: 3 }, theme: "draft" },
		{ key: "count50:8", budget: 4, lever: { ovrMode: "curve", classDepth: 3 }, theme: "draft" },
		{ key: "abroadLottery", budget: 4, lever: { collegeSource: "rewrite", wEuroLeague: 200 }, theme: "draft" },
		{ key: "pos1:PG", budget: 4, lever: { lockHeights: false, varySize: true, specialization: 2.5 },
			theme: "chaos" },
	];
	const WEEKLY_THEMES = [
		{ key: "march", name: "March week" },
		{ key: "draft", name: "Draft week" },
		{ key: "season", name: "Season week" },
		{ key: "chaos", name: "Chaos week" },
	];
	// Pairs that cannot both hold (one No. 1 pick, one player of the year).
	const CONFLICTS = [["freshmanNo1", "abroadNo1"], ["poyIsNo1", "poyOutsideClass"],
		["pos1:C", "!pos1:C"], ["pos1:C", "pos1:PG"], ["topOvr:55", "topOvr:58"]];
	const conflicts = (a, b) => a === b || CONFLICTS.some((c) =>
		(c[0] === a && c[1] === b) || (c[0] === b && c[1] === a));

	const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
	// A local calendar date as YYYY-MM-DD; the caller owns the clock.
	function dateKey(d) {
		const p = (n) => (n < 10 ? "0" : "") + n;
		return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
	}
	// The Monday of a date's week, as YYYY-MM-DD (UTC arithmetic on the date string).
	function weekKey(date) {
		if (!DATE_RE.test(String(date))) return null;
		const d = new Date(date + "T00:00:00Z");
		const dow = (d.getUTCDay() + 6) % 7;
		d.setUTCDate(d.getUTCDate() - dow);
		return d.toISOString().slice(0, 10);
	}
	function weeklyTheme(date) {
		const w = weekKey(date);
		if (!w) return null;
		return WEEKLY_THEMES[hash("week|" + w)() % WEEKLY_THEMES.length];
	}
	function shiftDate(date, days) {
		const d = new Date(date + "T00:00:00Z");
		d.setUTCDate(d.getUTCDate() + days);
		return d.toISOString().slice(0, 10);
	}

	/* "YYYY-MM-DD" or "YYYY-MM-DD#k": the k-th redraw of the day's goals,
	   same class and seed. The app redraws when the canonical class already
	   meets every goal at the defaults (a day solved by doing nothing). */
	function dailyChallenge(dateArg) {
		const m = /^(\d{4}-\d{2}-\d{2})(?:#(\d))?$/.exec(String(dateArg));
		if (!m) return null;
		const date = m[1];
		const k = m[2] ? Number(m[2]) : 0;
		const h = hash("daily|" + date + (k ? "|" + k : ""));
		const theme = weeklyTheme(date);
		const themed = DAILY_STRETCH.filter((g) => g.theme === theme.key);
		// Two days in three from the week's theme, the rest from anywhere.
		const from = themed.length && h() % 3 !== 0 ? themed : DAILY_STRETCH;
		const stretch = from[h() % from.length];
		const common = DAILY_COMMON.filter((k) => !conflicts(k, stretch.key));
		const goals = [common[h() % common.length], stretch.key];
		let budget = stretch.budget;
		// One day in three adds a second common goal and one more dial.
		if (h() % 3 === 0) {
			const more = common.filter((k) => goals.indexOf(k) === -1 &&
				!goals.some((g) => conflicts(g, k)));
			if (more.length) { goals.splice(1, 0, more[h() % more.length]); budget++; }
		}
		return {
			key: "daily-" + date + (k ? "#" + k : ""),
			date,
			attempt: k,
			name: "Daily challenge " + date,
			blurb: "Today's class, fixed for everybody: hit every goal, moving as " +
				"few settings as you can. " + theme.name + ".",
			seed: "daily-" + date,
			classSeed: "daily-" + date,
			classYear: Number(date.slice(0, 4)) + 1,
			cfg: {},
			goals,
			lever: stretch.lever,
			theme: theme.key,
			budget: Math.max(3, Math.min(5, budget)),
			daily: true,
		};
	}

	/* ---------------------------------------------- streaks and the ladder

	   `history` is {date: score} for completed dailies (Q22, R6). A streak
	   counts consecutive days ending today (or yesterday, so a streak is not
	   lost before today's is played). */
	function dailyStreak(history, today) {
		const h = history && typeof history === "object" ? history : {};
		const dates = Object.keys(h).filter((d) => DATE_RE.test(d)).sort();
		let longest = 0, run = 0, prev = null;
		for (const d of dates) {
			run = prev && shiftDate(prev, 1) === d ? run + 1 : 1;
			longest = Math.max(longest, run);
			prev = d;
		}
		let current = 0;
		if (DATE_RE.test(String(today))) {
			let d = h[today] !== undefined ? today : shiftDate(today, -1);
			while (h[d] !== undefined) { current++; d = shiftDate(d, -1); }
		}
		const strip = [];
		if (DATE_RE.test(String(today))) {
			for (let i = 29; i >= 0; i--) {
				const d = shiftDate(today, -i);
				strip.push({ date: d, score: Number.isFinite(h[d]) ? h[d] : null });
			}
		}
		return { current, longest, strip };
	}
	// The week's dailies summed Monday to Sunday (R12.5), and a code for it.
	function weeklyLadder(history, date) {
		const w = weekKey(date);
		if (!w) return null;
		const days = [];
		let total = 0;
		for (let i = 0; i < 7; i++) {
			const d = shiftDate(w, i);
			const sc = history && Number.isFinite(history[d]) ? history[d] : null;
			days.push(sc);
			if (sc !== null) total += sc;
		}
		return { week: w, days, total, code: encodeCode({ wk: w, d: days }) };
	}

	/* The spoiler-free share line (R6): goals as marks, the dial and run
	   counts, never the dial names. */
	function shareLine(ch, sc, runs, streak) {
		if (!ch || !sc) return "";
		const marks = (sc.goals || []).map((g) => (g.met ? "\u2713" : "\u00b7")).join("");
		return ch.name + " " + marks + " · " + (sc.solved ? "solved" : "not solved") +
			" · " + sc.moved.length + "/" + sc.budget + " dials · " +
			(runs | 0) + " run" + ((runs | 0) === 1 ? "" : "s") +
			(streak && streak.current > 1 ? " · streak " + streak.current : "");
	}

	/* ------------------------------------------------------- par and score

	   Par is the budget. Each setting under par is worth 10, each over costs
	   10, and every rerun after the first costs 1 — so the score rewards the
	   insight (fewer dials) far more than the grind (fewer tries), and never
	   goes below zero. Only a solved attempt has a score. */
	function parScore(moved, budget, reruns) {
		const m = Math.max(0, moved | 0);
		const r = Math.max(0, (reruns | 0) - 1);
		return Math.max(0, 100 + 10 * ((budget | 0) - m) - r);
	}
	function betterScore(a, b) {
		if (!Number.isFinite(b)) return true;
		return Number.isFinite(a) && a > b;
	}

	/* ------------------------------------------------------------ campaign

	   An ordered chain over the static challenges. Tier i opens once tier
	   i-1 is cleared, and it forbids the dials that cleared tier i-1: the
	   trick that worked last time is exactly the one you may not use. */
	function campaignTier(list, i, progress) {
		const base = list[i];
		if (!base) return null;
		const cleared = (progress && progress.cleared) || {};
		const prev = i > 0 ? cleared[list[i - 1].key] : null;
		if (i > 0 && !prev) return null;              // still locked
		const forbid = (base.forbid || []).slice();
		for (const k of (prev || [])) if (forbid.indexOf(k) === -1) forbid.push(k);
		return Object.assign({}, base, {
			key: "campaign:" + base.key,
			baseKey: base.key,
			name: "Campaign " + (i + 1) + " — " + base.name,
			tier: i,
			forbid,
		});
	}
	function campaignUnlocked(list, progress) {
		const cleared = (progress && progress.cleared) || {};
		let n = 1;
		while (n < list.length && cleared[list[n - 1].key]) n++;
		return n;
	}

	/* ---------------------------------------------------- short share codes

	   Crockford base32 of the JSON, grouped in fives, with a one-character
	   check. Readable aloud, case-blind, and I/L/O typed for 1/1/0 still
	   decode. Round-trips exactly: decode(encode(x)) deep-equals x. */
	const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	const PREFIX = "BB1";

	function utf8(s) {
		if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(s));
		return Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
	}
	function fromUtf8(bytes) {
		if (typeof TextDecoder !== "undefined") {
			return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
		}
		return decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
	}
	function b32(bytes) {
		let out = "", acc = 0, bits = 0;
		for (const b of bytes) {
			acc = (acc << 8) | b; bits += 8;
			while (bits >= 5) { bits -= 5; out += ALPHA[(acc >>> bits) & 31]; }
			acc &= (1 << bits) - 1;
		}
		if (bits) out += ALPHA[(acc << (5 - bits)) & 31];
		return out;
	}
	function unb32(str) {
		const bytes = [];
		let acc = 0, bits = 0;
		for (const ch of str) {
			const v = ALPHA.indexOf(ch);
			if (v < 0) return null;
			acc = (acc << 5) | v; bits += 5;
			if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); acc &= (1 << bits) - 1; }
		}
		return bytes;
	}
	const check = (s) => ALPHA[hash(s)() % 32];

	function encodeCode(obj) {
		const body = b32(utf8(JSON.stringify(obj)));
		const full = body + check(body);
		return PREFIX + "-" + full.replace(/(.{5})(?=.)/g, "$1-");
	}
	function decodeCode(code) {
		let s = String(code || "").toUpperCase().replace(/[\s-]/g, "")
			.replace(/[IL]/g, "1").replace(/O/g, "0");
		if (s.indexOf(PREFIX.replace(/O/g, "0")) !== 0) return null;
		s = s.slice(PREFIX.length);
		if (s.length < 2) return null;
		const body = s.slice(0, -1);
		if (check(body) !== s.slice(-1)) return null;
		const bytes = unb32(body);
		if (!bytes) return null;
		try {
			const obj = JSON.parse(fromUtf8(bytes));
			return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
		} catch (e) { return null; }
	}

	/* A result code: the settings payload (encodeConfig's shape, seed and
	   variation included) plus, when a challenge is on, what was played. */
	function makeResult(payload, extra) {
		const out = { p: payload || {} };
		if (extra && typeof extra.fp === "string" && extra.fp) out.f = extra.fp;
		if (extra && extra.challenge) {
			out.c = extra.challenge;
			if (Array.isArray(extra.moved)) out.m = extra.moved.slice();
			if (Number.isFinite(extra.score)) out.x = extra.score;
			if (extra.solved) out.ok = 1;
		}
		return encodeCode(out);
	}
	function readResult(code) {
		const o = decodeCode(code);
		if (!o || !o.p || typeof o.p !== "object" || Array.isArray(o.p)) return null;
		return {
			payload: o.p,
			challenge: typeof o.c === "string" ? o.c : null,
			moved: Array.isArray(o.m) ? o.m.filter((k) => typeof k === "string") : [],
			score: Number.isFinite(o.x) ? o.x : null,
			solved: !!o.ok,
			fp: typeof o.f === "string" ? o.f : null,
		};
	}

	/* --------------------------------------------------- find-the-seed puzzle

	   A hidden config — the defaults with two or three dials set to values
	   on a coarse grid, so they are reachable by hand — at a fixed seed. The
	   app runs it once for the target headlines; the player reproduces them
	   with at most three settings moved. */
	/* `variation` was a 1-in-4 per-player salt guess and `classQuality` a
	   no-op in preserve mode (audit 2026-10-10, R7); both are replaced by
	   dials whose effect shows in the four headlines. */
	const PUZZLE_DIALS = {
		upsetFactor: [0, 0.5, 1.5, 2],
		midMajorLift: [3, 6, 9, 12],
		freshmanShare: [10, 30, 70, 90],
		transferShare: [0, 20, 60, 80],
		injuryRate: [0, 2, 3],
		bluebloodDownYears: [2, 4, 6],
		teamMomentum: [0, 0.5, 2, 2.5],
	};
	// Which panel section a dial lives in, for the hint economy.
	const PUZZLE_SECTIONS = {
		upsetFactor: "the tournament", midMajorLift: "programs and conferences",
		freshmanShare: "who is in the class", transferShare: "who is in the class",
		injuryRate: "the season", bluebloodDownYears: "programs and conferences",
		teamMomentum: "the season",
	};
	const HINT_COST = 10;
	/* `attempt` redraws the hidden dials at the same seed: the app rejects a
	   draw whose target the defaults already reproduce (two or more of the
	   four headlines) and asks for the next one. */
	function puzzle(id, attempt) {
		const name = String(id);
		const k = attempt | 0;
		const h = hash("puzzle|" + name + (k ? "|" + k : ""));
		const keys = Object.keys(PUZZLE_DIALS);
		const n = 2 + (h() % 2);
		const hidden = {};
		while (Object.keys(hidden).length < n) {
			const key = keys[h() % keys.length];
			if (key in hidden) continue;
			const vals = PUZZLE_DIALS[key].filter((v) => v !== global.Config.DEFAULTS[key]);
			hidden[key] = vals[h() % vals.length];
		}
		return {
			key: "puzzle:" + name,
			name: "Find the settings — " + name,
			blurb: "The seed is fixed. Reproduce the headlines below by moving at " +
				"most three settings from the defaults.",
			seed: "puzzle-" + name,
			classSeed: "puzzle-" + name,
			classYear: 2027,
			cfg: {},
			hidden,
			attempt: k,
			dials: keys,
			budget: 3,
		};
	}
	// How many of the four headlines two classes share.
	function headlineMatches(a, b) {
		if (!a || !b) return 0;
		return Object.keys(HEADLINE_LABELS).filter((k) => a[k] === b[k]).length;
	}
	// A puzzle is degenerate when the untouched defaults already get 2+ headlines.
	function puzzleRejected(defaults, target) { return headlineMatches(defaults, target) >= 2; }
	// The n-th hint: the section the n-th hidden dial lives in.
	function puzzleHint(p, n) {
		const keys = Object.keys((p && p.hidden) || {});
		const k = keys[n | 0];
		return k ? "One hidden setting is in " + (PUZZLE_SECTIONS[k] || "the panel") + "." : null;
	}

	// What a class is remembered by: the four headlines a puzzle targets.
	function headlines(res) {
		if (!res) return null;
		const set = global.Universe && global.Universe.nationalPOYSet
			? global.Universe.nationalPOYSet() : new Set();
		const t = res.tourney;
		const poy = (res.players || []).filter((p) => (p.awards || []).some((a) => set.has(a)))[0];
		const field = !poy && (res.fieldHonors || []).filter((x) => x && set.has(x.award))[0];
		const no1 = res.board && res.board[0];
		return {
			champion: t && t.champion && t.champion.team ? t.champion.team.name : null,
			poy: poy ? poy.name : field ? field.name || null : null,
			no1: no1 ? no1.name : null,
			flavor: res.flavor && res.flavor.label ? res.flavor.label : null,
		};
	}
	var HEADLINE_LABELS = { champion: "national champion", poy: "player of the year",
		no1: "No. 1 pick", flavor: "class flavor" };
	// Predicate-shaped goals ({label, test}) so scoreChallenge grades them.
	function puzzleGoals(target) {
		return Object.keys(HEADLINE_LABELS).map((k) => ({
			key: "headline:" + k,
			label: HEADLINE_LABELS[k] + ": " + (target[k] == null ? "none" : target[k]),
			test: (res) => { const h = headlines(res); return !!h && h[k] === target[k]; },
		}));
	}

	/* ------------------------------------------------------------ ghost rival

	   Their dials against yours: shared, only theirs, only yours. */
	function ghostCompare(mine, theirs) {
		const a = mine || [], b = theirs || [];
		return {
			shared: a.filter((k) => b.indexOf(k) !== -1),
			onlyMine: a.filter((k) => b.indexOf(k) === -1),
			onlyTheirs: b.filter((k) => a.indexOf(k) === -1),
		};
	}

	/* ------------------------------------------------------ scenario packs

	   A challenge table as a share code (R12.2): community campaigns with
	   no engine work. Only the fields a challenge is made of survive, every
	   goal must parse, and a pack runs on the canonical class of its seed. */
	function encodePack(name, list) {
		return encodeCode({ pk: String(name || "pack"), l: (list || []).map((c) => cleanChallenge(c)).filter(Boolean) });
	}
	function cleanChallenge(c, parse) {
		if (!c || typeof c !== "object") return null;
		const goals = Array.isArray(c.goals) ? c.goals.filter((g) => typeof g === "string") : [];
		if (!goals.length || typeof c.seed !== "string" || !c.seed) return null;
		if (parse && !goals.every((g) => parse(g))) return null;
		const out = {
			key: String(c.key || c.seed).replace(/[^\w-]/g, "").slice(0, 40) || "c",
			name: String(c.name || c.seed).slice(0, 80),
			blurb: String(c.blurb || "").slice(0, 300),
			seed: c.seed.slice(0, 60),
			cfg: c.cfg && typeof c.cfg === "object" && !Array.isArray(c.cfg) ? c.cfg : {},
			goals,
			budget: Math.max(0, Math.min(10, Number(c.budget) | 0)),
		};
		if (Array.isArray(c.forbid)) out.forbid = c.forbid.filter((k) => typeof k === "string");
		return out;
	}
	function decodePack(code, parse) {
		const o = decodeCode(code);
		if (!o || typeof o.pk !== "string" || !Array.isArray(o.l)) return null;
		const list = o.l.map((c) => cleanChallenge(c, parse)).filter(Boolean)
			.map((c) => Object.assign(c, { key: "pack:" + o.pk.replace(/[^\w-]/g, "") + ":" + c.key,
				classSeed: "pack-" + c.seed, classYear: 2027 }));
		return list.length ? { name: o.pk, list } : null;
	}

	global.Replay = {
		dateKey, dailyChallenge, DAILY_COMMON, DAILY_STRETCH, WEEKLY_THEMES,
		weekKey, weeklyTheme, dailyStreak, weeklyLadder, shareLine,
		encodePack, decodePack, cleanChallenge,
		headlineMatches, puzzleRejected, puzzleHint, PUZZLE_SECTIONS, HINT_COST,
		parScore, betterScore,
		campaignTier, campaignUnlocked,
		encodeCode, decodeCode, makeResult, readResult,
		puzzle, headlines, puzzleGoals, PUZZLE_DIALS,
		ghostCompare,
	};
})(typeof window !== "undefined" ? window : self);
