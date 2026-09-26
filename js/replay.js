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

	   Goals come from the reroll predicates, in two bands measured at the
	   default settings (tools/tests/replaychallenge.js): COMMON ones hold on
	   roughly half of all classes, so the day is never hopeless; STRETCH ones
	   hold on one in four to one in ten, and set the budget. */
	const DAILY_COMMON = ["freshmanNo1", "poyIsNo1", "unrankedTop10"];
	const DAILY_STRETCH = [
		// `lever`: one dial that makes the goal likely (the test solves with it).
		{ key: "unbeaten", budget: 3, lever: { teamMomentum: 2.5 } },
		{ key: "tallTop5", budget: 3, lever: { specialization: 2.5 } },
		{ key: "cinderella", budget: 4, lever: { upsetFactor: 2 } },
		{ key: "seniorTop3", budget: 4, lever: { freshmanShare: 5 } },
	];
	// Pairs that cannot both hold (one No. 1 pick, one player of the year).
	const CONFLICTS = [["freshmanNo1", "abroadNo1"], ["poyIsNo1", "poyOutsideClass"]];
	const conflicts = (a, b) => CONFLICTS.some((c) =>
		(c[0] === a && c[1] === b) || (c[0] === b && c[1] === a));

	const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
	// A local calendar date as YYYY-MM-DD; the caller owns the clock.
	function dateKey(d) {
		const p = (n) => (n < 10 ? "0" : "") + n;
		return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
	}

	function dailyChallenge(date) {
		if (!DATE_RE.test(String(date))) return null;
		const h = hash("daily|" + date);
		const stretch = DAILY_STRETCH[h() % DAILY_STRETCH.length];
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
			key: "daily-" + date,
			name: "Daily challenge " + date,
			blurb: "Today's class, fixed for everybody: hit every goal, moving as " +
				"few settings as you can.",
			seed: "daily-" + date,
			cfg: {},
			goals,
			lever: stretch.lever,
			budget: Math.max(3, Math.min(5, budget)),
			daily: true,
		};
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
		};
	}

	/* --------------------------------------------------- find-the-seed puzzle

	   A hidden config — the defaults with two or three dials set to values
	   on a coarse grid, so they are reachable by hand — at a fixed seed. The
	   app runs it once for the target headlines; the player reproduces them
	   with at most three settings moved. */
	const PUZZLE_DIALS = {
		upsetFactor: [0, 0.5, 1.5, 2],
		midMajorLift: [3, 6, 9, 12],
		freshmanShare: [10, 30, 70, 90],
		transferShare: [0, 20, 60, 80],
		classQuality: [-2, -1, 1, 2],
		variation: [1, 2, 3, 4],
		teamMomentum: [0, 0.5, 2, 2.5],
	};
	function puzzle(id) {
		const name = String(id);
		const h = hash("puzzle|" + name);
		const keys = Object.keys(PUZZLE_DIALS);
		const n = 2 + (h() % 2);
		const hidden = {};
		while (Object.keys(hidden).length < n) {
			const k = keys[h() % keys.length];
			if (k in hidden) continue;
			const vals = PUZZLE_DIALS[k].filter((v) => v !== global.Config.DEFAULTS[k]);
			hidden[k] = vals[h() % vals.length];
		}
		return {
			key: "puzzle:" + name,
			name: "Find the settings — " + name,
			blurb: "The seed is fixed. Reproduce the headlines below by moving at " +
				"most three settings from the defaults.",
			seed: "puzzle-" + name,
			cfg: {},
			hidden,
			dials: keys,
			budget: 3,
		};
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
	const HEADLINE_LABELS = { champion: "national champion", poy: "player of the year",
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

	global.Replay = {
		dateKey, dailyChallenge, DAILY_COMMON, DAILY_STRETCH,
		parScore, betterScore,
		campaignTier, campaignUnlocked,
		encodeCode, decodeCode, makeResult, readResult,
		puzzle, headlines, puzzleGoals, PUZZLE_DIALS,
		ghostCompare,
	};
})(typeof window !== "undefined" ? window : self);
