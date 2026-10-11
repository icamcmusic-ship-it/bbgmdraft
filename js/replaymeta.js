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
		{ kind: "shortTop5", label: "A top-five pick 4\"+ under the class's median height" },
		{ kind: "lowSeedChamp", label: "No. 6+ seed champion" },
		{ kind: "cinderellaFF", label: "Double-digit Final Four" },
		{ kind: "sleeperNo1", label: "No. 1 pick from outside the preseason 20" },
		{ kind: "nonNcaaNo1", label: "No. 1 pick never played college" },
		{ kind: "seniorNo1", label: "Senior No. 1 pick" },
		{ kind: "threeStories", label: "Three storylines" },
		{ kind: "manyAnomalies", label: "Five+ anomalies" },
		{ kind: "unbeaten", label: "An unbeaten regular season" },
		/* Relative to the class on screen rather than absolute overall
		   cut-offs (audit 2026-10-10, R9): "Six at 55+" never fired and
		   "Nobody reaches 55" always did on a typical BBGM file, whose top
		   prospects sit around 50-56. See relativeKinds. */
		{ kind: "clearNo1", label: "A No. 1 pick 4+ overall clear of No. 2" },
		{ kind: "flatTop", label: "The top five within 2 overall" },
		{ kind: "bigCeiling", label: "A top-five pick with a ceiling 20+ above his overall" },
		{ kind: "freshmanNo1", label: "Freshman No. 1 pick" },
		{ kind: "midMajorChamp", label: "Mid-major champion" },
		{ kind: "abroadLottery", label: "Three abroad in the lottery" },
		{ kind: "unrankedTop10", label: "Two-star recruit in the top ten" },
		{ kind: "poyOutsideClass", label: "Player of the year not in the class" },
		{ kind: "sixteenOverOne", label: "A 16 seed wins" },
		{ kind: "allOnesFF", label: "All four 1 seeds in the Final Four" },
		{ kind: "unbeatenChamp", label: "Unbeaten national champion" },
	];

	/* Strangeness kinds that are not squares: absolute cut-offs that a
	   typical file always or never meets (R9). The score still counts them. */
	const RETIRED_KINDS = ["smallTop5", "starStudded", "noStars"];

	/* Bingo kinds read off the class itself, not off Engine.strangeness. */
	function relativeKinds(res) {
		const out = [];
		const board = (res && res.board) || [];
		const top = board.slice(0, 5);
		if (top.length >= 2 && board[0].newOvr >= board[1].newOvr + 4) out.push("clearNo1");
		if (top.length === 5) {
			const o = top.map((p) => p.newOvr);
			if (Math.max.apply(null, o) - Math.min.apply(null, o) <= 2) out.push("flatTop");
		}
		if (top.some((p) => p.newPot - p.newOvr >= 20)) out.push("bigCeiling");
		const h = ((res && res.players) || []).map((p) => p.newHgtInches)
			.filter((x) => x > 0).sort((a, b) => a - b);
		if (h.length) {
			const med = h[Math.floor(h.length / 2)];
			if (top.some((p) => p.newHgtInches > 0 && p.newHgtInches <= med - 4)) out.push("shortTop5");
		}
		return out;
	}
	// Everything a run marks on a card: the strangeness kinds plus the relative ones.
	function bingoKinds(res, sc) {
		const k = ((sc && sc.kinds) || []).slice();
		for (const x of relativeKinds(res)) if (k.indexOf(x) === -1) k.push(x);
		return k;
	}
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
		/* classQuality and eliteCount are read only by the curve rebuild, so
		   these two were no-ops in the default "preserve" mode (audit
		   2026-10-10, R1): they now switch the curve on and lean potential
		   the same way, which preserve mode also reads. */
		{ id: "loaded", label: "Loaded class", note: "the top of the class stacked (rebuilds the overall curve)",
			patch: () => ({ ovrMode: "curve", classQuality: 2.5, eliteCount: 7, potBias: 1.5 }) },
		{ id: "down-year", label: "Down year", note: "no stars at the top (rebuilds the overall curve)",
			patch: () => ({ ovrMode: "curve", classQuality: -2.5, eliteCount: 0, potBias: -1.5 }) },
		// Audit R2: the file's colleges are what make one program the favourite every reroll.
		{ id: "transfer-frenzy", label: "Transfer frenzy", note: "every prospect's school redrawn",
			patch: () => ({ collegeSource: "rewrite", talentCoupling: 1 }) },
		{ id: "sick-bay", label: "Sick bay", note: "injuries at their maximum",
			patch: () => ({ injuryRate: 3 }) },
		{ id: "anomaly-storm", label: "Anomaly storm", note: "ten anomalies a class",
			patch: () => ({ surpriseBudget: 10 }) },
		{ id: "small-ball", label: "Small ball", note: "centers weighted to zero, pace up",
			patch: (cfg, RB) => {
				const w = Object.assign({}, cfg.archetypeWeights || {});
				for (const a of (RB && RB.ARCHETYPES) || []) {
					if (a.max >= 80 && (a.t || []).indexOf("big") !== -1) w[a.name] = 0;
				}
				return { archetypeWeights: w, pace: 74 };
			} },
		{ id: "blue-blood-collapse", label: "Fallen giants", note: "five blue bloods have down years",
			patch: () => ({ bluebloodDownYears: 5, midMajorLift: 4 }) },
		{ id: "mid-major-march", label: "Mid-major March", note: "the small leagues at full lift",
			patch: () => ({ midMajorLift: 10, upsetFactor: 1.4 }) },
		{ id: "seniors-only", label: "Old heads", note: "almost no freshmen",
			patch: () => ({ freshmanShare: 5, transferShare: 55 }) },
		{ id: "realignment-chaos", label: "Map in pieces", note: "realignment at its maximum",
			patch: () => ({ realignmentRate: 1, realignmentMemory: 0 }) },
		{ id: "fired-everyone", label: "Carousel", note: "coach turnover at its maximum",
			patch: () => ({ coachTurnover: 200 }) },
		{ id: "abroad", label: "Passport class", note: "blank colleges lean to Europe and Australia",
			patch: () => ({ wEuroLeague: 70, wNBL: 30, pDII: 0 }) },
		{ id: "specialists", label: "Specialists", note: "one-skill builds everywhere",
			patch: () => ({ specialization: 2, archetypeDiversity: 98 }) },
		{ id: "iron-men", label: "Iron men", note: "nobody gets hurt",
			patch: () => ({ injuryRate: 0.2 }) },
		{ id: "noisy", label: "Static", note: "build and stat noise at their maximum",
			patch: () => ({ buildNoise: 12, statNoise: 1.6 }) },
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

	/* The settings a mutator list writes (audit R4): what a challenge counts
	   as moved, because a mutator is a set of dials moved at once. */
	function mutatorKeys(ids, cfg, RB) {
		const keys = [];
		for (const id of cleanMutators(ids)) {
			for (const k of Object.keys(MUTATOR_BY_ID[id].patch(cfg || {}, RB))) {
				if (keys.indexOf(k) === -1) keys.push(k);
			}
		}
		return keys;
	}

	/* FILE GRAVITY (audit R2). One program holding two or more of the file's
	   five best prospects is the favourite in nearly every reroll; the panel
	   says so. Returns {college, count, names} or null. */
	function fileGravity(players) {
		const top = (players || []).filter((p) => p && (p.origCollege || p.college))
			.slice().sort((a, b) => (b.origOvr || b.ovr || 0) - (a.origOvr || a.ovr || 0))
			.slice(0, 5);
		const by = {};
		for (const p of top) {
			const c = p.origCollege || p.college;
			(by[c] = by[c] || []).push(p.name);
		}
		let best = null;
		for (const c of Object.keys(by)) {
			if (by[c].length >= 2 && (!best || by[c].length > best.count)) {
				best = { college: c, count: by[c].length, names: by[c] };
			}
		}
		return best;
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
		{ id: "walk-on-first", label: "From the end of the bench", desc: "a walk-on went in the first round",
			test: (res) => ((res && res.board) || []).slice(0, 30).some((p) => p && p.transfer &&
				p.transfer.kind === "walk-on turned starter") },
		{ id: "juco-lottery", label: "Junior college to the lottery", desc: "a JUCO transfer in the top fourteen",
			test: (res) => ((res && res.board) || []).slice(0, 14).some((p) => p && p.transfer &&
				p.transfer.kind === "JUCO transfer") },
		{ id: "low-major-poy", label: "Small school, big trophy", desc: "the national POY plays in a one-bid league",
			test: (res) => ((res && res.players) || []).some((p) =>
				(p.awards || []).indexOf("Consensus National Player of the Year") !== -1 &&
				(global.Colleges.CONFERENCES[global.Colleges.conferenceOf(p.newCollege)] || {}).tier === "low") },
		{ id: "same-school-12", label: "One school, one and two", desc: "the top two picks played together",
			test: (res) => {
				const b = (res && res.board) || [];
				return !!(b[0] && b[1] && !b[0].nonNcaa && !b[1].nonNcaa && b[0].newCollege &&
					b[0].newCollege === b[1].newCollege);
			} },
		{ id: "no-ff-one-seed", label: "No 1s left", desc: "no 1 seed reached the Final Four",
			test: (res) => { const s = ffSeeds(res); return s.length === 4 && s.indexOf(1) === -1; } },
		{ id: "bingo-line", label: "Bingo", desc: "a line on the strangeness bingo card", bingo: true },
		{ id: "bingo-full", label: "Blackout", desc: "a full strangeness bingo card", bingo: true },
		// The build collection (R11): earned off the ledger, not off one result.
		{ id: "collector-50", label: "Collector", desc: "fifty builds seen in a top ten", ledger: true },
		{ id: "rare-hunter", label: "Rare hunter", desc: "ten rare builds seen in a top ten", ledger: true },
	];
	/* MEASURED RARITY (audit 2026-10-10, R9). Share of default-settings
	   classes that earn each one: 45 classes over three files (the harness's
	   realistic class and samples s1/s2), plus the audit's 100-run batch
	   for the ones that never fired there. Tiers: gold under 5%, silver
	   under 20%, bronze above. The ledger shows the tier, and unlocks are
	   gated on silver or gold feats only. */
	const RARITY = {
		"sixteen-over-one": 0.09, "fifteen-over-two": 0.33, "unbeaten-champ": 0.06,
		"unbeaten-regular": 0.09, "giant-no1": 0.07, "small-no1": 0.16,
		"double-digit-champ": 0.02, "cinderella-ff": 0.16, "all-ones": 0.02,
		"nowhere-no1": 0.01, "overseas-no1": 0.04, "senior-no1": 0.07,
		"strange-50": 0.03, "strange-70": 0.005, "loaded-class": 0.005,
		"anomaly-six": 0.01, "bingo-line": 0.3, "bingo-full": 0.01,
		// Not per-class rates: a collection takes many classes. Gold by fiat.
		"collector-50": 0.01, "rare-hunter": 0.01,
	};
	function tierOf(id) {
		const r = RARITY[id];
		if (!Number.isFinite(r)) return null;
		return r < 0.05 ? "gold" : r < 0.2 ? "silver" : "bronze";
	}
	for (const a of ACHIEVEMENTS) a.tier = tierOf(a.id);
	const ACH_BY_ID = {};
	for (const a of ACHIEVEMENTS) ACH_BY_ID[a.id] = a;

	// Ids of the result-detectable achievements this result earns, in table order.
	function detect(res, sc) {
		const out = [];
		for (const a of ACHIEVEMENTS) {
			if (a.bingo || a.ledger) continue;
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
		// "Perfect season" fired in 18% of classes on a dominant-program file (R9).
		{ kind: "flavor", name: "bloodlines", requires: "sixteen-over-one" },
		{ kind: "flavor", name: "reclassified", requires: "double-digit-champ" },
		{ kind: "flavor", name: "volatile", requires: "cinderella-ff" },
		{ kind: "flavor", name: "everything at once", requires: "strange-50" },
		{ kind: "flavor", name: "one-man class", requires: "same-school-12" },
		{ kind: "flavor", name: "walk-on year", requires: "walk-on-first" },
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

	/* --- the build collection (audit R11) -------------------------------- */

	/* Builds a top-ten pick was made of, collected across classes: name ->
	   {seed, at, n}. Rarity from the build's own draw weight (RB.ARCHETYPES
	   `w`): the bottom fifth of weights is "rare", the next two fifths
	   "uncommon", the rest "common". */
	function buildTiers(RB) {
		const list = ((RB && RB.ARCHETYPES) || []).filter((a) => a.name !== "Balanced");
		const ws = list.map((a) => a.w || 0).sort((a, b) => a - b);
		const q = (f) => ws[Math.min(ws.length - 1, Math.floor(ws.length * f))];
		const lo = q(0.2), mid = q(0.6);
		const out = {};
		for (const a of list) out[a.name] = (a.w || 0) <= lo ? "rare" : (a.w || 0) <= mid ? "uncommon" : "common";
		out.Balanced = "common";
		return out;
	}
	// Marks the top ten's builds; returns the names newly collected.
	function collectBuilds(ledger, res, at) {
		const fresh = [];
		for (const p of ((res && res.board) || []).slice(0, 10)) {
			const b = p && p.archetype;
			if (!b) continue;
			if (!ledger[b]) {
				ledger[b] = { seed: String((res && res.seed) || ""), at: String(at || ""), n: 0 };
				fresh.push(b);
			}
			ledger[b].n++;
		}
		return fresh;
	}
	function collectionProgress(ledger, RB) {
		const tiers = buildTiers(RB);
		const by = { rare: [0, 0], uncommon: [0, 0], common: [0, 0] };
		for (const name of Object.keys(tiers)) {
			const t = by[tiers[name]];
			t[1]++;
			if (ledger && ledger[name]) t[0]++;
		}
		const have = Object.keys(ledger || {}).filter((n) => tiers[n]).length;
		return { have, total: Object.keys(tiers).length, by };
	}
	/* The pool's rarest build when one of its men reaches the lottery (top
	   fourteen): the class name can carry it. */
	function buildOfTheYear(res, RB) {
		const w = {};
		for (const a of (RB && RB.ARCHETYPES) || []) w[a.name] = a.w || 0;
		const lot = ((res && res.board) || []).slice(0, 14).filter((p) => p && p.archetype &&
			p.archetype !== "Balanced" && Number.isFinite(w[p.archetype]));
		if (!lot.length) return null;
		const tiers = buildTiers(RB);
		const best = lot.slice().sort((a, b) => w[a.archetype] - w[b.archetype])[0];
		return tiers[best.archetype] === "rare" ? { build: best.archetype, player: best.name } : null;
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
		BINGO_KINDS, BINGO_LINES, RETIRED_KINDS, relativeKinds, bingoKinds, drawCard, validCard, markCard, cardLines, cardFull,
		MUTATORS, MAX_MUTATORS, cleanMutators, applyMutators, mutatorLabel, mutatorKeys, fileGravity,
		ACHIEVEMENTS, ACH_BY_ID, detect, tourneyGames, RARITY, tierOf,
		UNLOCKS, lockFor, isUnlocked, chaosPicks,
		buildTiers, collectBuilds, collectionProgress, buildOfTheYear,
	};
})(typeof window !== "undefined" ? window : globalThis);
