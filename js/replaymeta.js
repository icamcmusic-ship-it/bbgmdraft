/* The replay layer: strangeness bingo, mutators, the achievements ledger and
   what achievements unlock (audit section 4, ideas 6, 9, 10, 11 and 14).

   Pure data and pure functions. Nothing here touches the DOM or storage —
   js/app.js owns both — so the Node harness can check every rule without a
   browser, and every draw is seeded so a card or a pick replays. */
(function (global) {
	"use strict";

	const Rng = global.BBGMRng.Rng;

	/* --- bingo ----------------------------------------------------------- */

	// Every `kinds` key Engine.strangeness can return, with a square label.
	const BINGO_KINDS = [
		{ kind: "tallTop5", label: "7'2\"+ in the top five" },
		{ kind: "smallTop5", label: "6'1\" in the top five" },
		{ kind: "lowSeedChamp", label: "No. 6+ seed champion" },
		{ kind: "cinderellaFF", label: "Double-digit Final Four" },
		{ kind: "sleeperNo1", label: "No. 1 pick from outside the preseason 20" },
		{ kind: "nonNcaaNo1", label: "No. 1 pick never played college" },
		{ kind: "seniorNo1", label: "Senior No. 1 pick" },
		{ kind: "threeStories", label: "Three storylines" },
		{ kind: "manyAnomalies", label: "Five+ anomalies" },
		{ kind: "unbeaten", label: "An unbeaten regular season" },
		{ kind: "starStudded", label: "Six prospects at 55+" },
		{ kind: "noStars", label: "Nobody reaches 55" },
	];
	const BINGO_LINES = [
		[0, 1, 2], [3, 4, 5], [6, 7, 8],
		[0, 3, 6], [1, 4, 7], [2, 5, 8],
		[0, 4, 8], [2, 4, 6],
	];

	// Nine distinct kinds, a seeded Fisher-Yates prefix.
	function drawCard(seed) {
		const rng = new Rng("bingo|" + String(seed));
		const pool = BINGO_KINDS.map((k) => k.kind);
		for (let i = 0; i < 9; i++) {
			const j = i + Math.floor(rng.random() * (pool.length - i));
			const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
		}
		return { seed: String(seed), squares: pool.slice(0, 9),
			marked: new Array(9).fill(false) };
	}

	// A card read back from storage, or null when it is not one.
	function validCard(c) {
		if (!c || typeof c !== "object" || !Array.isArray(c.squares) ||
			c.squares.length !== 9 || !Array.isArray(c.marked) || c.marked.length !== 9) return null;
		const known = new Set(BINGO_KINDS.map((k) => k.kind));
		if (!c.squares.every((k) => known.has(k))) return null;
		return { seed: String(c.seed || ""), squares: c.squares.slice(),
			marked: c.marked.map(Boolean) };
	}

	// Marks the squares one run's kinds cover; returns the indices newly marked.
	function markCard(card, kinds) {
		const have = new Set(kinds || []);
		const fresh = [];
		card.squares.forEach((k, i) => {
			if (!card.marked[i] && have.has(k)) { card.marked[i] = true; fresh.push(i); }
		});
		return fresh;
	}

	function cardLines(card) {
		return BINGO_LINES.filter((l) => l.every((i) => card.marked[i])).length;
	}
	function cardFull(card) { return card.marked.every(Boolean); }

	/* --- mutators -------------------------------------------------------- */

	/* Named config patches, each built only from settings that already exist.
	   A mutator writes the key outright, so the flavor sees a value the user
	   moved and leaves it alone ("a flavor only moves settings you have left
	   alone" — applyFlavorConfig reads the handed-in cfg as the user's). */
	const MAX_MUTATORS = 3;
	const MUTATORS = [
		{ id: "no-bigs", label: "No bigs", note: "every big-man build weighted to zero",
			patch: (cfg, RB) => {
				const w = Object.assign({}, cfg.archetypeWeights || {});
				for (const a of (RB && RB.ARCHETYPES) || []) {
					if ((a.t || []).indexOf("big") !== -1) w[a.name] = 0;
				}
				return { archetypeWeights: w };
			} },
		{ id: "chaos-march", label: "Chaos March", note: "the upset factor at its maximum",
			patch: () => ({ upsetFactor: 2 }) },
		{ id: "portal-era", label: "Portal era", note: "a class of transfers and a busy portal",
			patch: () => ({ transferShare: 75, freshmanShare: 12, portalRate: 250 }) },
		{ id: "one-and-done", label: "One-and-done", note: "three freshmen in four",
			patch: () => ({ freshmanShare: 75, transferShare: 10 }) },
		{ id: "track-meet", label: "Track meet", note: "fast pace, high scoring",
			patch: () => ({ pace: 78, scoringEnv: 3 }) },
		{ id: "grind", label: "Grind", note: "slow pace, cold shooting",
			patch: () => ({ pace: 60, scoringEnv: -3, efficiencyEnv: -2 }) },
		{ id: "loaded", label: "Loaded class", note: "the top of the class stacked",
			patch: () => ({ classQuality: 2.5, eliteCount: 7 }) },
		{ id: "down-year", label: "Down year", note: "no stars at the top",
			patch: () => ({ classQuality: -2.5, eliteCount: 0 }) },
		{ id: "sick-bay", label: "Sick bay", note: "injuries at their maximum",
			patch: () => ({ injuryRate: 3 }) },
		{ id: "anomaly-storm", label: "Anomaly storm", note: "ten anomalies a class",
			patch: () => ({ surpriseBudget: 10 }) },
	];
	const MUTATOR_BY_ID = {};
	for (const m of MUTATORS) MUTATOR_BY_ID[m.id] = m;

	// Known ids only, no repeats, at most three, in the order given.
	function cleanMutators(ids) {
		if (!Array.isArray(ids)) return [];
		const out = [];
		for (const id of ids) {
			if (MUTATOR_BY_ID[id] && out.indexOf(id) === -1) out.push(id);
			if (out.length >= MAX_MUTATORS) break;
		}
		return out;
	}

	// Applied in order onto cfg (mutated and returned); a later one wins a clash.
	function applyMutators(cfg, ids, RB) {
		const list = cleanMutators(ids);
		for (const id of list) Object.assign(cfg, MUTATOR_BY_ID[id].patch(cfg, RB));
		if (list.length) cfg.mutators = list.slice();
		return cfg;
	}

	function mutatorLabel(ids) {
		return cleanMutators(ids).map((id) => MUTATOR_BY_ID[id].label).join(" + ");
	}

	/* --- achievements ---------------------------------------------------- */

	function tourneyGames(res) {
		const t = res && res.tourney;
		if (!t) return [];
		const out = [];
		for (const r of Object.values(t.regions || {})) {
			for (const round of (r && r.rounds) || []) {
				for (const g of round || []) if (g && g.a && g.b && g.winner) out.push(g);
			}
		}
		for (const g of (t.semis || [])) if (g && g.winner) out.push(g);
		if (t.final && t.final.winner) out.push(t.final);
		return out;
	}
	function seedBeat(res, lo, hi) {
		return tourneyGames(res).some((g) => {
			const loser = g.winner === g.a ? g.b : g.a;
			return g.winner.seed === lo && loser.seed === hi;
		});
	}
	const champ = (res) => (res && res.tourney && res.tourney.champion) || null;
	const no1 = (res) => (res && res.board && res.board[0]) || null;
	const ffSeeds = (res) => ((res && res.tourney && res.tourney.finalFour) || [])
		.map((x) => x && x.seed).filter(Number.isFinite);
	const eliteCount = (res) => ((res && res.players) || []).filter((p) => p.newOvr >= 55).length;

	// `test(res, sc)` where sc is Engine.strangeness(res). Bingo ones are awarded by the card.
	const ACHIEVEMENTS = [
		{ id: "sixteen-over-one", label: "Sixteen over one", desc: "a 16 seed beat a 1 seed",
			test: (res) => seedBeat(res, 16, 1) },
		{ id: "fifteen-over-two", label: "Fifteen over two", desc: "a 15 seed beat a 2 seed",
			test: (res) => seedBeat(res, 15, 2) },
		{ id: "unbeaten-champ", label: "Perfect season", desc: "an unbeaten national champion",
			test: (res) => { const c = champ(res); return !!(c && c.team && c.team.l === 0 && c.team.w >= 20); } },
		{ id: "unbeaten-regular", label: "Undefeated November to March",
			desc: "a team went unbeaten in the regular season",
			test: (res, sc) => !!(sc && sc.kinds && sc.kinds.indexOf("unbeaten") !== -1) },
		{ id: "giant-no1", label: "The tower", desc: "a 7'4\" or taller No. 1 pick",
			test: (res) => { const p = no1(res); return !!(p && p.newHgtInches >= 88); } },
		{ id: "small-no1", label: "Small ball", desc: "a No. 1 pick at 6'1\" or shorter",
			test: (res) => { const p = no1(res); return !!(p && p.newHgtInches > 0 && p.newHgtInches <= 73); } },
		{ id: "double-digit-champ", label: "Cinderella's ring", desc: "a double-digit seed won the title",
			test: (res) => { const c = champ(res); return !!(c && c.seed >= 10); } },
		{ id: "cinderella-ff", label: "Crashing the Final Four", desc: "an 11 seed or worse in the Final Four",
			test: (res) => ffSeeds(res).some((s) => s >= 11) },
		{ id: "all-ones", label: "Chalk", desc: "all four 1 seeds in the Final Four",
			test: (res) => { const s = ffSeeds(res); return s.length === 4 && s.every((x) => x === 1); } },
		{ id: "nowhere-no1", label: "Out of nowhere", desc: "a No. 1 pick outside the preseason top 50",
			test: (res) => { const p = no1(res); return !!(p && p.preseasonRank > 50); } },
		{ id: "overseas-no1", label: "From abroad", desc: "a No. 1 pick who never played college basketball",
			test: (res) => !!(no1(res) && no1(res).nonNcaa) },
		{ id: "senior-no1", label: "Old head", desc: "a senior or graduate No. 1 pick",
			test: (res) => { const p = no1(res); return !!(p && /Senior|Graduate/.test(p.classYear || "")); } },
		{ id: "strange-50", label: "Strange days", desc: "strangeness 50 or more",
			test: (res, sc) => !!(sc && sc.score >= 50) },
		{ id: "strange-70", label: "Twilight zone", desc: "strangeness 70 or more",
			test: (res, sc) => !!(sc && sc.score >= 70) },
		{ id: "loaded-class", label: "Stacked", desc: "eight prospects at 55+ overall",
			test: (res) => eliteCount(res) >= 8 },
		{ id: "anomaly-six", label: "Anomalous", desc: "six or more anomalies in one class",
			test: (res) => ((res && res.surprises) || []).length >= 6 },
		{ id: "bingo-line", label: "Bingo", desc: "a line on the strangeness bingo card", bingo: true },
		{ id: "bingo-full", label: "Blackout", desc: "a full strangeness bingo card", bingo: true },
	];
	const ACH_BY_ID = {};
	for (const a of ACHIEVEMENTS) ACH_BY_ID[a.id] = a;

	// Ids of the result-detectable achievements this result earns, in table order.
	function detect(res, sc) {
		const out = [];
		for (const a of ACHIEVEMENTS) {
			if (a.bingo) continue;
			let hit = false;
			try { hit = !!a.test(res, sc); } catch (e) { hit = false; }
			if (hit) out.push(a.id);
		}
		return out;
	}

	/* --- unlocks --------------------------------------------------------- */

	// Hidden until the achievement is on the ledger (or "show everything" is on).
	const UNLOCKS = [
		{ kind: "era", name: "1990s", requires: "strange-70" },
		{ kind: "flavor", name: "bloodlines", requires: "unbeaten-champ" },
		{ kind: "flavor", name: "reclassified", requires: "double-digit-champ" },
		{ kind: "flavor", name: "volatile", requires: "bingo-line" },
	];

	function lockFor(kind, name) {
		return UNLOCKS.filter((u) => u.kind === kind && u.name === name)[0] || null;
	}
	// `earned` is a set-like of achievement ids.
	function isUnlocked(kind, name, earned, showAll) {
		const u = lockFor(kind, name);
		if (!u || showAll) return true;
		return !!(earned && (earned.has ? earned.has(u.requires) : earned[u.requires]));
	}

	/* --- chaos draft ----------------------------------------------------- */

	/* The weirdest candidates on an anomaly shortlist: rarer kinds (a lower
	   draw weight) first, ties by table order, `n` of them. Deterministic. */
	function chaosPicks(shortlist, n, surprises) {
		const w = {};
		(surprises || []).forEach((s, i) => { w[s.name] = { w: s.w || 1, i }; });
		const rank = (c) => (w[c.name] ? 1 / w[c.name].w : 0);
		const order = (c) => (w[c.name] ? w[c.name].i : 1e9);
		return (shortlist || []).slice()
			.sort((a, b) => rank(b) - rank(a) || order(a) - order(b))
			.slice(0, Math.max(1, n | 0))
			.map((c) => c.name);
	}

	global.ReplayMeta = {
		BINGO_KINDS, BINGO_LINES, drawCard, validCard, markCard, cardLines, cardFull,
		MUTATORS, MAX_MUTATORS, cleanMutators, applyMutators, mutatorLabel,
		ACHIEVEMENTS, ACH_BY_ID, detect, tourneyGames,
		UNLOCKS, lockFor, isUnlocked, chaosPicks,
	};
})(typeof window !== "undefined" ? window : globalThis);
