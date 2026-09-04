/* UI: state, settings, staged runs, per-player and bulk editing, persistence
   and export. The views themselves live in js/views.js. */
(function (global) {
	"use strict";

	const CFG = global.Config;
	const C = global.Colleges;
	const RB = global.RatingsBuilder;
	const BB = global.BBGM;
	const V = global.Views;
	const el = V.el;
	const n1 = V.n1;
	const pc = V.pc;
	const $ = (id) => document.getElementById(id);

	const STORE_KEY = "bbgm-draft-workshop/v1";

	const state = {
		mergeIndices: null,
		cfg: CFG.make(),
		files: [],       // [{name, data, fingerprint}]
		runners: [],     // parallel to files
		results: [],     // parallel to files; entries may be null until needed
		active: 0,
		tab: "players",
		sort: [{ key: "newOvr", dir: -1 }],
		filter: {
			q: "", pos: "", conf: "", archetype: "", changedOnly: false, lockedOnly: false,
			// [{key, min, max}] — numeric range filters, see Views.rangeBar.
			ranges: [],
		},
		noteQuery: "",   // the Notes tab has its own search; it used to share one
		overrides: {},   // player key -> {ovr, pot, archetype, college, ratings, …}
		overrideFingerprint: null,
		selected: {},    // player key -> true, for bulk editing
		history: [],     // recent seeds, newest first
		// The build pools of the last few classes, newest first. See
		// rememberPool: the engine reads it and never writes it.
		poolHistory: [],
		/* The anomaly kinds the last few classes used, newest first. Same
		   mechanism as poolHistory, one layer down. */
		anomalyHistory: [],
		presetName: "default",
		presetDirty: false,
		customPresets: {},
		editing: null,   // player key currently open in the editor
		hiddenColumns: {},
		// Column ORDER, as a list of keys. See orderedColumns in js/views.js.
		columnOrder: null,
		statMode: "perGame",
		density: "normal",
		// "auto" | "on" | "off" — see cardMode() in js/views.js.
		cardView: "auto",
		cardAll: false,
		redo: [],
		// The two prospects the Compare tab is holding side by side.
		compare: [null, null, null, null],
		// The program whose page the Teams tab is showing, if any.
		team: null,
		/* The box score currently open, as "Team|gameIndex". A game is a
		   destination like a team or a player page. */
		game: null,
		standingsConf: null,
		compactBracket: false,
		theme: "system", // see THEMES below
		logPlayer: null,
		// Which season the Game log tab shows for him: null = the draft year.
		logSeason: null,
		pinned: null,
		undo: [],
		lastSeed: null,
		// The prospect whose page the Prospects tab is showing, if any.
		player: null,
		/* Universe mode: the timeline of the last universe run. rows are
		   compact summaries (seeds, champions, names), not simulated output —
		   a universe re-runs from its seeds. */
		/* `cfgs` is the load-bearing addition: fileIndex -> the exact config
		   the chain ran that file with (its universe seed, the carry-over
		   state handed to it, and the pool memory at that point). Without it
		   every other tab re-simulated the file from scratch — see
		   ensureResult. Not persisted: carryOver is a map of 368 programs and
		   it is cheap to rebuild by re-running the chain. */
		universe: {
			rows: [], threads: [], alumni: [], baseSeed: "", running: false,
			cfgs: {},
		},
		// The randomizer's scope select, persisted like every other control.
		randomScope: "gentle",
		// Settings the randomizer must not touch. {key: true}.
		settingLocks: {},
	};
	global.App = { state };

	// "system" follows the OS; the rest set data-theme and are defined in
	// css/style.css. Keep in sync with the <option> values in index.html.
	const THEMES = [
		"system", "light", "dark",
		"ledger-light", "draft-board", "fieldhouse", "scout-report",
		"twilight-court", "night-game",
	];

	/* ------------------------------------------------------------ persistence */

	/* Nothing survived a refresh: settings, locks and seed history were all
	   lost unless you happened to have copied the link first. The loaded FILE
	   cannot be stored (it is megabytes and it is the user's data), so it is
	   the one thing that has to be dropped in again. */
	/* Bumped whenever the shape of the persisted payload changes. STORE_KEY was
	   versioned and the payload inside it was not, so a future settings change
	   would read stale keys out of an old blob and silently half-apply them. */
	const STORE_VERSION = 3;

	/* MIGRATIONS.

	   The version existed and the only thing it did was throw the payload
	   away: a schema bump cost every user their presets, their locks, their
	   column layouts, their seed history and their pinned class, and the
	   settings themselves — which is a heavy price for adding a slider, and
	   heavy enough that it discourages adding one.

	   Each entry upgrades a payload from that version to the next. They are
	   deliberately tiny, because most schema changes are additive: `cfg` goes
	   through Config.make on the way in, so a config that predates a setting
	   simply gets its default. A migration is only needed when a key changes
	   MEANING or shape, and then it is a few lines here rather than a lost
	   session for everybody.

	   A payload from a version with no path (a downgrade, or a corrupted `v`)
	   still falls back to discarding it, which is the safe end. */
	const MIGRATIONS = {
		/* 2 -> 3: the audit release. Everything it added is additive — the
		   World and staleness settings, the trait count, the box-score route,
		   the anomaly memory — so nothing in the payload changes meaning and
		   the only work is stamping the new version. `anomalyHistory` is
		   absent in a v2 payload and an absent memory is the correct starting
		   state for one. */
		2: (payload) => Object.assign({}, payload, { v: 3 }),
	};

	function migrate(payload) {
		let p = payload;
		let guard = 0;
		while (Number(p.v || 1) !== STORE_VERSION && guard++ < 20) {
			const step = MIGRATIONS[Number(p.v || 1)];
			if (!step) return null;
			p = step(p);
		}
		return Number(p.v || 1) === STORE_VERSION ? p : null;
	}
	let quotaWarned = false;

	function persist() {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify({
				v: STORE_VERSION,
				cfg: state.cfg,
				overrides: state.overrides,
				overrideFingerprint: state.overrideFingerprint,
				history: state.history.slice(0, 12),
				poolHistory: state.poolHistory,
				anomalyHistory: state.anomalyHistory,
				presetName: state.presetName,
				presetDirty: state.presetDirty,
				customPresets: state.customPresets,
				hiddenColumns: state.hiddenColumns,
				columnOrder: state.columnOrder,
				statMode: state.statMode,
				compare: state.compare,
				columnLayouts: state.columnLayouts,
				standingsConf: state.standingsConf,
				player: state.player,
				team: state.team,
				game: state.game,
				universe: {
					rows: state.universe.rows, threads: state.universe.threads,
					alumni: state.universe.alumni, baseSeed: state.universe.baseSeed,
				},
				density: state.density,
				cardView: state.cardView,
				cardAll: state.cardAll,
				compactBracket: state.compactBracket,
				theme: state.theme,
				randomScope: state.randomScope,
				settingLocks: state.settingLocks,
				sort: state.sort,
				tab: state.tab,
				// Small (a name and six numbers per prospect) and the whole
				// point of pinning is that it outlives the class you pinned.
				// byKey is a lookup index rebuilt on restore, not state worth storing.
				pinned: state.pinned
					? Object.assign({}, state.pinned, { byKey: undefined })
					: null,
				open: openGroups(),
			}));
		} catch (e) {
			/* Private browsing and "no storage at all" are nothing to say
			   anything about — the tool works, settings just do not survive a
			   refresh. A full quota is different: it happens gradually, as
			   custom presets and pinned classes and a seed history accumulate,
			   and it is the user's own data that stops being saved. Say so
			   once. */
			const quota = e && (e.name === "QuotaExceededError" ||
				e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);
			if (quota && !quotaWarned) {
				quotaWarned = true;
				setStatus("Browser storage is full, so settings will not survive a " +
					"refresh. Clearing some saved presets or pinned classes will fix it.",
					true);
			}
		}
	}

	/* Every structured value read back out of localStorage, checked for the
	   SHAPE the code that consumes it assumes.

	   STORE_VERSION was the only protection, and a version number only catches
	   changes somebody remembered to bump it for. It does not catch a payload
	   truncated by a full quota, an entry a browser extension rewrote, a hand
	   edit, or a value written by a build that has since been reverted — and
	   `state.sort` in particular is destructured (`for (const {key, dir} of
	   keys)`) inside the render path, so a string or a null there is not a
	   degraded table, it is a TypeError with the whole app behind it and no
	   way for the user to get back except clearing site data they cannot be
	   expected to know about.

	   Anything that fails its check is dropped and the built-in default stands,
	   which is the same outcome as a first visit. */
	function validSortStack(v) {
		if (!Array.isArray(v) || !v.length) return null;
		const cols = {};
		for (const c of V.COLUMNS) cols[c.key] = true;
		const out = [];
		const seen = {};
		for (const s of v) {
			if (!s || typeof s !== "object") continue;
			if (typeof s.key !== "string" || !cols[s.key] || seen[s.key]) continue;
			const dir = Number(s.dir) < 0 ? -1 : 1;
			seen[s.key] = true;
			out.push({ key: s.key, dir });
		}
		return out.length ? out : null;
	}

	// A plain {string: true-ish} map, e.g. hiddenColumns and the saved layouts.
	function validFlagMap(v) {
		if (!v || typeof v !== "object" || Array.isArray(v)) return null;
		const out = {};
		for (const k of Object.keys(v)) if (v[k]) out[k] = true;
		return out;
	}

	function validString(v, allowed) {
		return typeof v === "string" && (!allowed || allowed.indexOf(v) !== -1) ? v : null;
	}

	function restore() {
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
		if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
		/* A payload from an older schema is MIGRATED. One that cannot be
		   migrated is discarded rather than half-applied, and only `theme` is
		   carried across, because it is a preference about the browser rather
		   than about a draft class and losing it is pure annoyance. */
		if (Number(saved.v || 1) !== STORE_VERSION) {
			const upgraded = migrate(saved);
			if (!upgraded) {
				if (saved.theme) state.theme = saved.theme;
				return null;
			}
			saved = upgraded;
		}
		if (saved.cfg && typeof saved.cfg === "object") state.cfg = CFG.make(saved.cfg);
		if (saved.overrides && typeof saved.overrides === "object" &&
			!Array.isArray(saved.overrides)) state.overrides = saved.overrides;
		if (validString(saved.overrideFingerprint)) {
			state.overrideFingerprint = saved.overrideFingerprint;
		}
		if (Array.isArray(saved.history)) {
			state.history = saved.history.filter((h) => typeof h === "string");
		}
		if (Array.isArray(saved.poolHistory)) {
			state.poolHistory = saved.poolHistory
				.filter(Array.isArray)
				.map((a) => a.filter((n) => typeof n === "string"));
		}
		if (Array.isArray(saved.anomalyHistory)) {
			state.anomalyHistory = saved.anomalyHistory
				.filter(Array.isArray)
				.map((a) => a.filter((n) => typeof n === "string"));
		}
		if (validString(saved.presetName)) state.presetName = saved.presetName;
		state.presetDirty = !!saved.presetDirty;
		if (saved.customPresets && typeof saved.customPresets === "object" &&
			!Array.isArray(saved.customPresets)) state.customPresets = saved.customPresets;
		state.hiddenColumns = validFlagMap(saved.hiddenColumns) || state.hiddenColumns;
		if (Array.isArray(saved.columnOrder)) {
			state.columnOrder = saved.columnOrder.filter((k) => typeof k === "string");
		}
		if (validString(saved.statMode, V.STAT_MODES.map((m) => m[0]))) {
			state.statMode = saved.statMode;
		}
		if (Array.isArray(saved.compare)) {
			state.compare = saved.compare
				.map((k) => (typeof k === "string" ? k : null))
				.slice(0, V.COMPARE_MAX || 4);
		}
		if (saved.columnLayouts && typeof saved.columnLayouts === "object" &&
			!Array.isArray(saved.columnLayouts)) {
			const layouts = {};
			for (const name of Object.keys(saved.columnLayouts)) {
				const m = validFlagMap(saved.columnLayouts[name]);
				if (m) layouts[name] = m;
			}
			state.columnLayouts = layouts;
		}
		if (validString(saved.standingsConf)) state.standingsConf = saved.standingsConf;
		if (validString(saved.player)) state.player = saved.player;
		if (saved.universe && typeof saved.universe === "object" &&
			Array.isArray(saved.universe.rows)) {
			state.universe = {
				rows: saved.universe.rows,
				threads: Array.isArray(saved.universe.threads) ? saved.universe.threads : [],
				alumni: Array.isArray(saved.universe.alumni) ? saved.universe.alumni : [],
				baseSeed: validString(saved.universe.baseSeed) || "",
				running: false,
			};
		}
		if (validString(saved.team)) state.team = saved.team;
		if (validString(saved.game)) state.game = saved.game;
		if (validString(saved.density, ["normal", "compact", "comfortable"])) state.density = saved.density;
		if (validString(saved.cardView, ["auto", "on", "off"])) state.cardView = saved.cardView;
		state.cardAll = !!saved.cardAll;
		state.compactBracket = !!saved.compactBracket;
		if (validString(saved.theme, THEMES)) state.theme = saved.theme;
		if (validString(saved.randomScope, ["gentle", "wide", "quality", "builds",
			"years", "destinations", "season", "awards"])) {
			state.randomScope = saved.randomScope;
		}
		state.settingLocks = validFlagMap(saved.settingLocks) || state.settingLocks;
		const sort = validSortStack(saved.sort);
		if (sort) state.sort = sort;
		if (saved.pinned && typeof saved.pinned === "object") {
			state.pinned = indexSnapshot(saved.pinned);
		}
		// Never land on a tab that has nothing to show.
		if (saved.tab && (saved.tab !== "compare" || state.pinned)) state.tab = saved.tab;
		return saved;
	}

	function openGroups() {
		const out = {};
		for (const d of document.querySelectorAll("details.grp")) out[d.id] = d.open;
		return out;
	}

	function applyOpenGroups(map) {
		if (!map) return;
		for (const d of document.querySelectorAll("details.grp")) {
			if (map[d.id] !== undefined) d.open = map[d.id];
		}
	}

	/* ------------------------------------------------------------------ undo */

	/* "Reset to defaults" and "Clear lock" were both irreversible, and the word
	   undo appeared nowhere in the codebase. */
	/* Named for what it is, and not `snapshot`: there is already a snapshot()
	   further down for the class-comparison panel, and a duplicate function
	   declaration silently hands both call sites the later one. */
	function undoSnapshot(label) {
		return {
			label,
			cfg: JSON.parse(JSON.stringify(state.cfg)),
			overrides: JSON.parse(JSON.stringify(state.overrides)),
			/* The drawn seed, which is NOT in cfg: a reroll blanks cfg.seed and
			   remembers the seed it drew in state.lastSeed. Without this an
			   undone reroll restored a blank seed and drew a THIRD class, so
			   the one thing users most want back — the class they just liked
			   and replaced — was the one thing undo could not return. */
			lastSeed: state.lastSeed || null,
			/* The pool memory, for the same reason lastSeed is here: it is a
			   build-phase input that lives outside cfg. Without it, undoing a
			   reroll restored the seed and left the history one class ahead, so
			   the restored class was rebuilt against a memory it had never
			   been drawn with and came back as somebody else's. */
			poolHistory: (state.poolHistory || []).map((a) => a.slice()),
			// The anomaly memory is undone with the pool memory, for exactly
			// the reason stated above: a restored class rebuilt against a
			// memory it was never drawn with comes back as somebody else.
			anomalyHistory: (state.anomalyHistory || []).map((a) => a.slice()),
		};
	}

	function pushUndo(label) {
		state.undo.push(undoSnapshot(label));
		if (state.undo.length > 40) state.undo.shift();
		// A new action forks the history: whatever was undone is no longer
		// reachable, which is what every undo stack does.
		state.redo = [];
		paintUndo();
	}

	function applySnapshot(snap, verb) {
		state.cfg = CFG.make(snap.cfg);
		state.overrides = snap.overrides;
		if (snap.lastSeed !== undefined) state.lastSeed = snap.lastSeed;
		if (Array.isArray(snap.poolHistory)) state.poolHistory = snap.poolHistory;
		if (Array.isArray(snap.anomalyHistory)) state.anomalyHistory = snap.anomalyHistory;
		// A restored class is a different class, so an editor open on somebody
		// who may not be in it any more has to close.
		state.editing = null;
		paintUndo();
		paintConfig();
		/* Through `after`: a message written before run() is overwritten by the
		   busy line a frame later and never seen. See beginBusy. */
		run(() => setStatus(verb + ": " + snap.label));
	}

	function undo() {
		const prev = state.undo.pop();
		if (!prev) return;
		// Ctrl+Z existed and Ctrl+Shift+Z did not, so an undo was a one-way
		// trip: the state you were in a moment ago was simply gone.
		state.redo.push(undoSnapshot(prev.label));
		if (state.redo.length > 40) state.redo.shift();
		applySnapshot(prev, "Undid");
	}

	function redo() {
		const next = state.redo.pop();
		if (!next) return;
		state.undo.push(undoSnapshot(next.label));
		if (state.undo.length > 40) state.undo.shift();
		applySnapshot(next, "Redid");
	}

	function paintUndo() {
		const b = $("btnUndo");
		b.disabled = !state.undo.length;
		// pushUndo("imported locks from a CSV") wrote a label that nothing ever
		// displayed. The button says what it will undo.
		b.textContent = state.undo.length
			? "Undo " + short(state.undo[state.undo.length - 1].label)
			: "Undo";
		b.title = state.undo.length
			? "Undo: " + state.undo[state.undo.length - 1].label + " (Ctrl+Z)"
			: "Nothing to undo";
		const r = $("btnRedo");
		if (!r) return;
		r.disabled = !state.redo.length;
		r.title = state.redo.length
			? "Redo: " + state.redo[state.redo.length - 1].label + " (Ctrl+Shift+Z)"
			: "Nothing to redo";
	}

	function short(text) {
		const t = String(text || "");
		return t.length > 22 ? t.slice(0, 21) + "…" : t;
	}

	/* ---------------------------------------------------------------- config */

	const SLIDERS = [
		"classQuality", "classDepth", "eliteCount", "potBias", "potSpread",
		"specialization", "archetypeDiversity", "classFlavor", "buildNoise",
		"freshmanShare", "transferShare", "redshirtShare", "reclassShare", "pDII",
		"pace", "scoringEnv", "efficiencyEnv", "statNoise", "upsetFactor",
		"archetypePool", "surpriseBudget", "injuryRate", "traitCount",
		"anomalyMemory", "flavorReach", "styleDrift",
		"realignmentRate", "bluebloodDownYears", "midMajorLift",
		"coachTurnover", "realignmentMemory", "starReturners", "portalRate",
		"awardStrictness", "confAwardStrictness", "proAwardStrictness",
		"variation", "poolMemory", "teamMomentum", "awardNoise",
		"seasonEvents", "draftEvents",
	];

	const FORMAT = {
		pDII: (v) => (v * 100).toFixed(1) + "%",
		specialization: (v) => v.toFixed(2) + "x",
		classFlavor: (v) => v.toFixed(2) + "x",
		statNoise: (v) => v.toFixed(2) + "x",
		upsetFactor: (v) => v.toFixed(2) + "x",
		awardStrictness: (v) => v.toFixed(2) + "x",
		confAwardStrictness: (v) => v.toFixed(2) + "x",
		proAwardStrictness: (v) => v.toFixed(2) + "x",
		archetypeDiversity: (v) => v + "%",
		poolMemory: (v) => v.toFixed(2) + "x",
		teamMomentum: (v) => v.toFixed(2) + "x",
		awardNoise: (v) => v.toFixed(2) + "x",
		freshmanShare: (v) => v + "%",
		transferShare: (v) => v + "%",
		redshirtShare: (v) => v + "%",
		reclassShare: (v) => v + "%",
		injuryRate: (v) => v.toFixed(2) + "x",
		archetypePool: (v) => (v ? v + " builds" : "off"),
		surpriseBudget: (v) => (v ? "about " + v : "none"),
		realignmentRate: (v) => (v ? Math.round(v * 100) + "%" : "off"),
		bluebloodDownYears: (v) => (v ? v + " program" + (v === 1 ? "" : "s") : "none"),
		midMajorLift: (v) => (v ? "+" + v : "off"),
	};

	/* What each slider actually does, in units. "Class quality 2" means nothing
	   on its own; "top prospect ~48 ovr" is a reference point. */
	const SLIDER_HINT = {
		archetypePool: (v) => (v
			? "this class is drawn from about " + v + " of the " +
				(global.RatingsBuilder ? global.RatingsBuilder.ARCHETYPES.length : 98) +
				" builds — " +
				"lower is more distinctive, higher is one of everything"
			: "off: every build is eligible in every class"),
		surpriseBudget: (v) => (v
			? "drawn from " +
				(global.Engine && global.Engine.SURPRISES
					? global.Engine.SURPRISES.length : "many") +
				" kinds: a five-star bust, a 24-year-old JUCO, " +
				"the coach's son, a season that ended in February…"
			: "no forced anomalies"),
		realignmentRate: (v) => (v
			? "the chance this season's map differs from last season's; a " +
				"realignment moves two to five programs one rung up"
			: "conference membership never changes"),
		bluebloodDownYears: (v) => (v
			? v + " of the twenty-four biggest programs has a bad year on top " +
				"of the ordinary roll"
			: "no forced down years"),
		midMajorLift: (v) => (v
			? "every program outside the power leagues is stronger by up to " + v
			: "the mid-majors are where the table says"),
		injuryRate: (v) => (v === 0
			? "nobody misses a game"
			: "drawn before the season, so a team's record responds to them"),
		classQuality: (v) => "top prospect ≈ " + Math.round(43 + v * 2.6) +
			" ovr, back of the class ≈ " + Math.round(18 + v * 2.0),
		classDepth: (v) => (v < 0 ? "top-heavy: stars, then a cliff"
			: v > 0 ? "deep: fewer stars, more rotation players" : "an even curve"),
		eliteCount: (v) => v === 0 ? "no genuine stars" : v + " prospect(s) get a star ceiling",
		potBias: (v) => "ovr→pot gap shifted " + (v >= 0 ? "+" : "") + (v * 2.2).toFixed(1) +
			" points (cosmetic: potential does not feed the season)",
		potSpread: (v) => "gap sd " + v + " points (higher = more boom/bust)",
		specialization: (v) => v < 0.4 ? "BBGM's samey builds"
			: v > 1.6 ? "extreme specialists" : "clear roles, real weaknesses",
		// True by construction now: the +0.05 / +0.02 fudge terms that made this
		// label a 30% overstatement are gone.
		archetypeDiversity: (v) => (v === 0
			? "0: every single player is Balanced — no builds at all. Legal, and probably not what you want."
			: "exactly " + Math.round(100 - v) + "% of the class stays Balanced"),
		classFlavor: (v) => v < 0.15 ? "every class has the same archetype mix"
			: v > 1.5 ? "a class is unmistakably one thing"
			: "each class leans guard-heavy, big-heavy, defensive…",
		buildNoise: (v) => "±" + v + " rating points of per-rating jitter",
		/* The seed's neighborhood. 0 is the class the seed has always
		   produced; anything else keeps its flavor, build pool and curve and
		   re-rolls the players inside it. */
		variation: (v) => (v === 0
			? "the class this seed has always produced"
			: "variation " + v + ": same flavor, pool and curve, different players"),
		poolMemory: (v) => (v <= 0
			? "each class draws its builds with no memory of the last"
			: "a build in the last three classes is " +
				Math.round(Math.pow(3, v)) + "x less likely to return"),
		teamMomentum: (v) => (v <= 0
			? "every game is an independent draw around the team's rating"
			: "a team on a run plays like one " + (2.6 * v).toFixed(1) +
				" rating points better"),
		awardNoise: (v) => (v <= 0
			? "every trophy goes to whoever the production model ranks first"
			: v > 1.5 ? "genuine splits, and the occasional snub"
			: "the trophies usually agree, and sometimes do not"),
		seasonEvents: (v) => (v <= 0 ? "no events during the season"
			: "up to " + v + " things happen during the season"),
		draftEvents: (v) => (v <= 0 ? "the board is a plain ranking"
			: "about " + v + " prospects move on draft day"),
		freshmanShare: (v) => "≈" + v + "% freshmen; the rest spread over So/Jr/Sr",
		transferShare: (v) => "≈" + v + "% of upperclassmen arrived from another program",
		redshirtShare: (v) => "≈" + v + "% of upperclassmen redshirted a year",
		reclassShare: (v) => "≈" + v + "% reclassified in or out of their year",
		pDII: (v) => (v <= 0 ? "no DII conversions" :
			"about " + (v * 100).toFixed(1) + "% of blank colleges become DII"),
		/* Derived from the selected era's own offensive rating rather than from
		   a constant: the hint said "≈70 points" whatever era was chosen,
		   because it was written when there was only one. */
		pace: (v) => {
			const era = global.Calibration.eraInfo(state.cfg.era);
			return "≈" + Math.round((v * era.rotation.ortg) / 100) +
				" team points per game (Division I only)";
		},
		scoringEnv: (v) => (v >= 0 ? "+" : "") + (v * 1.6).toFixed(1) + " possessions per 40",
		/* The efficiency dial that did not exist. Measured before it did:
		   dragging scoringEnv from -3 to +3 moved team points 66 -> 75 and left
		   true shooting at exactly 0.572 in every configuration, because pace
		   and scoringEnv are both possession dials and nothing in the tool
		   moved what a possession was worth. */
		efficiencyEnv: (v) => (v >= 0 ? "+" : "") + (v * 1.0).toFixed(1) +
			" points of shooting percentage — roughly " +
			(v >= 0 ? "+" : "") + (v * 2.2).toFixed(1) + " team points per game",
		statNoise: (v) => v < 0.3 ? "stat lines follow ratings exactly" : "season-to-season luck",
		upsetFactor: (v) => v < 0.6 ? "chalk: seeds mostly hold" : v > 1.4 ? "madness" : "a normal March",
		awardStrictness: (v) => v > 1.2 ? "fewer national honors reach this class"
			: v < 0.9 ? "more national honors reach this class" : "realistic national award volume",
		confAwardStrictness: (v) => v > 1.2 ? "fewer conference honors"
			: v < 0.9 ? "more conference honors" : "realistic conference award volume",
		proAwardStrictness: (v) => v > 1.2 ? "a higher bar for honors abroad"
			: v < 0.9 ? "a lower bar for honors abroad" : "a realistic bar abroad",
		anomalyMemory: (v) => (v <= 0
			? "each class draws its anomalies with no memory of the last"
			: "an anomaly used last class is " + Math.round(Math.pow(3, v)) +
				"x less likely to return"),
		flavorReach: (v) => (v <= 0
			? "a flavor only moves settings you have left alone"
			: "a flavor may also move about " + v + "% of the settings you have " +
				"changed, and only part of the way"),
		styleDrift: (v) => (v <= 0
			? "every team playing a given style plays it identically"
			: "two four-out teams are not the same four-out team, and neither is " +
				"the same one next season"),
		traitCount: (v) => (v <= 0
			? "no traits: a plain note, and no medical file, volatility or " +
				"offensive-glass bias"
			: "about " + v + " traits a prospect — frame, motor, hands, " +
				"medical, background, role"),
		coachTurnover: (v) => (v <= 0 ? "no sideline changes at all"
			: "about " + Math.round(v * 0.43) + " of " + C.names.length + " head coaches change job" +
				(v === 100 ? " — what Division I actually does" : "")),
		realignmentMemory: (v) => (v >= 100
			? "a program that moved conference stays moved, season after season"
			: v <= 0 ? "the map is redrawn from the base alignment every season"
			: "about " + v + "% of last season's map carries forward"),
		starReturners: (v) => (v <= 0
			? "no named non-prospect stars; the class wins every award by default"
			: "about " + Math.round(v * 0.26) + " named college stars who are not " +
				"in this draft class"),
		portalRate: (v) => (v <= 0 ? "every star returner comes back to the same program"
			: "about " + Math.round(v * 0.18) + "% of returning stars leave through " +
				"the portal each year (universe mode only)"),
	};

	/* What universe mode will actually do with what is loaded right now. A
	   checkbox that says "run every loaded file as one world" is a promise the
	   tool cannot keep with one file in it, and the old tab said so only after
	   you pressed the button. */
	function paintUniverseHint() {
		const hint = $("universeHint");
		if (!hint) return;
		const n = state.files.length;
		if (!state.cfg.universe) {
			hint.textContent = "Off: each loaded file is its own world, drawn " +
				"from the same settings and seed. Turn this on to chain them — " +
				"oldest season first, each one handing its conference map, " +
				"program strength, coaches and star returners to the next. Every " +
				"tab and the export then show that world.";
			return;
		}
		hint.textContent = n === 0
			? "On, but no class files are loaded yet."
			: n === 1
			? "On, with one file loaded: it runs as a single season with nothing " +
				"to carry over. Load more classes and they chain."
			: "On: " + n + " files run as one continuous world, oldest season " +
				"first, and the later classes' upperclassmen play the earlier " +
				"seasons on their real rosters. Every tab, the export and the " +
				"Timeline show that world.";
	}

	function awardInteractionHint() {
		const fresh = state.cfg.freshmanShare;
		const parts = [
			"These interact with settings elsewhere. " +
			(fresh < 20
				? "With only " + fresh + "% freshmen, the Freshman of the Year and " +
					"All-Freshman categories mostly dry up."
				: fresh > 70
				? "With " + fresh + "% freshmen, almost every honor in the class is " +
					"also a freshman honor."
				: "Freshman categories scale with the “Freshmen in the class” slider."),
			"Award strictness used to be one slider driving three different " +
			"mechanisms; it is three sliders now.",
		];
		return parts.join(" ");
	}

	function paintConfig() {
		for (const key of SLIDERS) {
			const input = $(key);
			if (!input) continue;
			input.value = state.cfg[key];
			// Sync numeric input
			const num = $(key + "Num");
			if (num) num.value = state.cfg[key];
			const ctl = input.closest(".ctl");
			const b = ctl.querySelector("label b");
			if (b) b.textContent = (FORMAT[key] || ((v) => String(v)))(Number(input.value));
			let hint = ctl.querySelector(".unit");
			if (SLIDER_HINT[key]) {
				if (!hint) {
					hint = el("p", "unit");
					ctl.appendChild(hint);
				}
				hint.textContent = SLIDER_HINT[key](Number(input.value));
			}
			// Per-setting modified marker + revert (Part 5C)
			paintModifiedMarker(ctl, key, Number(input.value));
		}
		// Also mark non-slider settings
		paintModifiedMarkerFor("ovrMode", state.cfg.ovrMode);
		paintModifiedMarkerFor("priorSeasons", state.cfg.priorSeasons);
		paintModifiedMarkerFor("varySize", state.cfg.varySize);
		paintModifiedMarkerFor("universe", state.cfg.universe);
		paintModifiedMarkerFor("narrative", state.cfg.narrative);
		$("flavorHint").value = state.cfg.flavorHint || "";
		paintModifiedMarkerFor("flavorHint", state.cfg.flavorHint || "");
		$("ovrMode").value = state.cfg.ovrMode;
		$("priorSeasons").value = state.cfg.priorSeasons;
		$("varySize").checked = !!state.cfg.varySize;
		$("universe").checked = !!state.cfg.universe;
		$("narrative").checked = !!state.cfg.narrative;
		paintUniverseHint();
		$("seed").value = state.cfg.seed;
		const curve = state.cfg.ovrMode === "curve";
		for (const n of document.querySelectorAll("[data-curve]")) {
			n.style.opacity = curve ? "1" : ".38";
			n.querySelectorAll("input").forEach((i) => (i.disabled = !curve));
		}
		$("ovrModeHint").textContent = curve
			? "Overalls are re-dealt along a configurable curve; the class can get better or worse."
			: "Each prospect keeps the overall BBGM gave him. Only his build changes.";
		$("awardInteractionHint").textContent = awardInteractionHint();
		/* The filter reads the labels and hints paintConfig just wrote, so it
		   runs after it rather than only on a keystroke. */
		applySettingFilter();
		paintEra();
		paintPhaseCosts();
		paintPresets();
		paintNoteLines();
		paintArchWeights();
		paintLeagueWeights();
		/* `cardtable` used to go on the BODY whenever the Prospects tab was
		   open, and did nothing on a desktop only because the rules it selects
		   were inside a `max-width: 700px` media query. Two things wrong with
		   that: the class said "this is a card layout" on every viewport while
		   meaning it on one, and the decision about WHEN to use cards was split
		   between a JS condition (which tab) and a CSS one (which width), so
		   neither could be read on its own and neither could be overridden.

		   viewPlayers puts the class on the table's own container instead (see
		   cardMode in js/views.js), which is both narrower — it cannot reach a
		   table that has no data-label attributes — and answerable: the user
		   can now ask for cards at any width. */
		document.body.className = "density-" + state.density;
		paintLockButtons();
	}

	/* The era selector. The stat model targets one of the anchor sets in
	   js/calibration.js, and which one it targets used to be a decision made
	   once, in a file nobody opens, in 2021. */
	function paintEra() {
		const sel = $("era");
		if (!sel) return;
		const eras = global.Calibration.ERAS;
		if (!sel.options.length) {
			for (const name of Object.keys(eras)) {
				sel.appendChild(new Option(eras[name].label, name));
			}
		}
		sel.value = state.cfg.era;
		const info = eras[state.cfg.era] || eras[global.Calibration.DEFAULT_ERA];
		$("eraNote").textContent = info.note + "  Target: " + info.team.pts +
			" team points per game at offensive rating " + info.rotation.ortg + ".";
	}

	/* Which phases a setting invalidates, and therefore what moving it costs.
	   PHASES has always known this exactly and the panel never said, so every
	   slider looked equally expensive — and a user with a big class learned to
	   be afraid of all of them rather than of the two that rebuild everything. */
	const PHASE_COST = {
		build: "everything (~210 ms)",
		regular: "the season onward (~180 ms)",
		postseason: "March onward (~150 ms — the NET, the weekly poll and the bracket)",
		stats: "stats onward (~40 ms)",
		pot: "potential onward (~3 ms)",
		awards: "awards onward (~2 ms)",
		stock: "the draft board (~1 ms)",
		notes: "notes only (~0.6 ms)",
	};
	function phaseCostFor(key) {
		/* The EARLIEST phase that declares the dep, explicitly: phases run
		   upstream-to-downstream, so the earliest is the costliest (everything
		   after it re-runs too). A first-match return happened to give the
		   same answer because PHASES is ordered — but that was the ordering
		   agreeing with the intent, not the code stating it, and a setting in
		   two phases (pace is in regular AND stats) deserves a mechanism
		   rather than a coincidence. */
		const phases = global.Engine.PHASES;
		let best = -1;
		for (let i = 0; i < phases.length; i++) {
			if ((phases[i].deps || []).indexOf(key) !== -1 && best === -1) best = i;
		}
		if (best === -1) return null;
		return {
			text: PHASE_COST[phases[best].name] || phases[best].name,
			phase: phases[best].name,
			/* Three bands, because a reader dragging a slider needs to know
			   which of three things happens and not a number of milliseconds:
			   green is a repaint, amber re-simulates the season, red rebuilds
			   the class. The text was there and it was text, which is not
			   something anybody reads while dragging. */
			band: phases[best].name === "build" ? "dear"
				: (phases[best].name === "regular" || phases[best].name === "postseason" ||
					phases[best].name === "stats") ? "mid" : "cheap",
		};
	}
	function paintPhaseCosts() {
		for (const key of SLIDERS.concat(
			["era", "ovrMode", "varySize", "priorSeasons", "universe", "narrative"])) {
			const input = $(key);
			if (!input) continue;
			const ctl = input.closest(".ctl");
			if (!ctl) continue;
			const cost = phaseCostFor(key);
			if (!cost) continue;
			let tag = ctl.querySelector(".rerun");
			if (!tag) {
				tag = el("p", "rerun");
				ctl.appendChild(tag);
			}
			tag.className = "rerun phasecost " + cost.band;
			tag.textContent = (cost.band === "cheap" ? "● " : cost.band === "mid" ? "◐ " : "○ ") +
				"re-runs: " + cost.text;
			tag.title = cost.band === "cheap"
				? "Milliseconds: nothing is re-simulated."
				: cost.band === "mid"
				? "The season is re-simulated — a few hundred milliseconds."
				: "The whole class is rebuilt, and every player in it changes.";
		}
	}

	function paintPresets() {
		const preset = $("preset");
		if (!preset) return;
		const want = state.presetName;
		preset.innerHTML = "";
		for (const name of Object.keys(CFG.PRESETS)) {
			preset.appendChild(new Option(name === "default" ? "— presets —" : name, name));
		}
		const custom = Object.keys(state.customPresets);
		if (custom.length) {
			const grp = document.createElement("optgroup");
			grp.label = "Saved";
			for (const name of custom) grp.appendChild(new Option(name, name));
			preset.appendChild(grp);
		}
		const opt = preset.querySelector('option[value="' + cssEscape(want) + '"]');
		if (opt) {
			const base = want === "default" ? "— presets —" : want;
			opt.textContent = base + (state.presetDirty ? " (modified)" : "");
			preset.value = want;
		}
		$("btnDeletePreset").disabled = !state.customPresets[want];
		/* WHAT is modified. The dropdown said "(modified)" and would not say
		   from what, so the only way to find out was to re-apply the preset and
		   watch which numbers jumped. */
		const diff = presetDiff();
		const note = $("presetDiff");
		if (note) {
			note.textContent = diff.length
				? "changed from the preset: " + diff.join(", ")
				: "";
			note.hidden = !diff.length;
		}
	}

	/* Every setting that differs from the selected preset, as "name: was → is".
	   Object-valued settings (the archetype and destination weight tables) are
	   summarized rather than dumped. */
	function presetDiff() {
		const preset = CFG.PRESETS[state.presetName] || state.customPresets[state.presetName];
		if (!preset) return [];
		return diffConfigs(CFG.make(preset), state.cfg);
	}

	/* The settings two configurations differ on, as "name: was → is".
	   Object-valued settings (the archetype and destination weight tables) are
	   summarized rather than dumped. */
	function diffConfigs(a, b) {
		const out = [];
		for (const k of Object.keys(CFG.DEFAULTS)) {
			if (k === "seed") continue;
			const x = a[k];
			const y = b[k];
			if (JSON.stringify(x) === JSON.stringify(y)) continue;
			if (x && typeof x === "object") { out.push(k + " (edited)"); continue; }
			out.push(k + " " + x + " → " + y);
		}
		return out;
	}

	/* Any two presets against each other. The dropdown told you what the
	   CURRENT settings changed from the selected preset, which answers one
	   question; "what is the difference between these two presets I saved" was
	   the other one, and it had no answer at all. */
	function comparePresets() {
		const names = Object.keys(CFG.PRESETS).concat(Object.keys(state.customPresets));
		const box = el("div");
		const bar = el("div", "filters");
		const pick = (which) => {
			const sel = el("select");
			sel.setAttribute("aria-label", "Preset " + which);
			for (const n of names) {
				sel.appendChild(new Option(n === "default" ? "Defaults" : n, n));
			}
			bar.appendChild(sel);
			return sel;
		};
		const left = pick("A");
		const right = pick("B");
		left.value = "default";
		right.value = state.presetName in CFG.PRESETS ||
			state.presetName in state.customPresets ? state.presetName : names[0];
		box.appendChild(bar);
		const out = el("div", "note");
		box.appendChild(out);
		const paint = () => {
			const cfgOf = (n) => CFG.make(CFG.PRESETS[n] || state.customPresets[n] || {});
			const rows = diffConfigs(cfgOf(left.value), cfgOf(right.value));
			out.textContent = rows.length
				? rows.join("\n")
				: "These two presets are identical.";
		};
		left.addEventListener("change", paint);
		right.addEventListener("change", paint);
		paint();
		modal("Compare presets", box, null, "Close");
	}

	function cssEscape(s) {
		return String(s).replace(/["\\]/g, "\\$&");
	}

	/* Repaint every archetype weight box, whether or not a custom set exists.
	   The old code only repainted when cfg.archetypeWeights was truthy, so
	   "Reset weights" followed by a preset change left stale numbers on screen. */
	let archFilterHook = null;
	function paintArchWeights() {
		const aw = $("archWeights");
		if (!aw) return;
		if (archFilterHook) archFilterHook();
		// Realized frequency from the last run, beside the weight that asked
		// for it.
		const res = state.results[state.active];
		const counts = {};
		if (res) {
			for (const p of res.players) counts[p.archetype] = (counts[p.archetype] || 0) + 1;
		}
		const n = res ? res.players.length : 0;
		for (const g of aw.querySelectorAll(".archgot")) {
			const c = counts[g.dataset.arch] || 0;
			g.textContent = n ? (c ? (100 * c / n).toFixed(1) + "%" : "—") : "";
			g.className = "archgot" + (c ? "" : " none");
		}
		const custom = state.cfg.archetypeWeights;
		for (const i of aw.querySelectorAll("input[data-arch]")) {
			const a = RB.ARCHETYPES.filter((x) => x.name === i.dataset.arch)[0];
			const fallback = a && a.w !== undefined ? a.w : 1;
			const v = custom && Number.isFinite(custom[i.dataset.arch])
				? custom[i.dataset.arch] : fallback;
			i.value = v;
		}
	}

	function paintLeagueWeights() {
		const box = $("leagueWeights");
		if (!box) return;
		const w = state.cfg.leagueWeights || {};
		for (const i of box.querySelectorAll("input")) {
			const v = w[i.dataset.league];
			i.value = Number.isFinite(v) ? v : 0;
		}
	}

	function markDirty() {
		state.presetDirty = true;
	}

	/* Describe an archetype's offset vector, so the sixty names in the sidebar
	   are not sixty names and a number box. */
	function archetypeTooltip(a) {
		const keys = Object.keys(a.o || {}).sort((x, y) => Math.abs(a.o[y]) - Math.abs(a.o[x]));
		const body = keys.length
			? keys.map((k) => k + " " + (a.o[k] > 0 ? "+" : "") + a.o[k]).join(", ")
			: "no offsets — the build BBGM would have produced";
		const hgt = (a.min > 0 || a.max < 100)
			? "\nheight rating " + a.min + "–" + a.max : "\nany height";
		return a.name + "\n" + body + hgt +
			"\nrarity weight " + (a.w === undefined ? 1 : a.w);
	}

	/* ---- settings search --------------------------------------------------

	   There were two of these: one injected an <input> at the top of the panel
	   and toggled a `settings-hidden` class, and the other (bindSettingFilter,
	   below) filters the same controls from a markup-declared box that also
	   carries "show only what I have changed". Two search boxes over one panel
	   is worse than either, and the second one is the one with the second
	   filter on it, so this became the shim that removes the first.

	   The `settings-hidden` CSS rule stays: it is what a stylesheet override or
	   a bookmarklet would target, and it costs one line. */
	function bindSettingsSearch() {
		const stale = document.getElementById("settingsSearch");
		if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
	}

	/* ---- numeric input for each slider (Part 5A) + modified markers (Part 5C) */

	/* Create a numeric <input> for each slider, placed inside a wrapper div. */
	function wrapSlidersWithNumbers() {
		for (const key of SLIDERS) {
			const range = $(key);
			if (!range || range.type !== "range") continue;
			const ctl = range.closest(".ctl");
			if (!ctl) continue;
			// Create wrapper
			const wrapper = el("div", "slider-with-number");
			range.parentNode.insertBefore(wrapper, range);
			wrapper.appendChild(range);
			// Create number input
			const num = el("input");
			num.type = "number";
			num.min = range.min;
			num.max = range.max;
			num.step = range.step;
			num.value = range.value;
			num.id = key + "Num";
			num.setAttribute("aria-label", (ctl.querySelector("label") || {}).textContent || key);
			wrapper.appendChild(num);
		}
	}

	/* Per-setting modified marker and revert (Part 5C). */
	function paintModifiedMarker(ctl, key, currentValue) {
		if (!ctl) return;
		const defaults = CFG.DEFAULTS;
		const defaultValue = defaults[key];
		const isModified = JSON.stringify(currentValue) !== JSON.stringify(defaultValue);
		// Remove existing marker elements
		const existing = ctl.querySelector(".modified-dot");
		if (existing) existing.remove();
		const existingBtn = ctl.querySelector(".revert-btn");
		if (existingBtn) existingBtn.remove();
		if (isModified) {
			const label = ctl.querySelector("label");
			if (label) {
				const dot = el("span", "modified-dot");
				dot.title = "Modified from default (" + defaultValue + ")";
				label.appendChild(dot);
				const revertBtn = el("button", "revert-btn", "↺");
				revertBtn.type = "button";
				revertBtn.title = "Revert to default (" + defaultValue + ")";
				revertBtn.setAttribute("aria-label", "Revert " + key + " to default");
				revertBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					pushUndo("reverted " + key + " to default");
					state.cfg[key] = typeof defaultValue === "number" ? Number(defaultValue) : defaultValue;
					markDirty();
					// Update checkboxes and selects that paintConfig reads
					const inp = $(key);
					if (inp) {
						if (inp.type === "checkbox") inp.checked = !!defaultValue;
						else inp.value = defaultValue;
					}
					paintConfig();
					scheduleRun();
				});
				label.appendChild(revertBtn);
			}
		}
	}

	function paintModifiedMarkerFor(key, currentValue) {
		const input = $(key);
		if (!input) return;
		const ctl = input.closest(".ctl");
		if (!ctl) return;
		paintModifiedMarker(ctl, key, currentValue);
	}

	/* Bind two-way sync between sliders and their number inputs. */
	function bindSliderNumbers() {
		for (const key of SLIDERS) {
			const range = $(key);
			const num = $(key + "Num");
			if (!range || !num) continue;
			// When slider moves, update number
			range.addEventListener("input", () => { num.value = range.value; });
			// When number is typed, update slider and trigger the same pipeline
			let numPushed = false;
			num.addEventListener("input", () => {
				if (!numPushed) { pushUndo("moved " + key); numPushed = true; }
				const v = Number(num.value);
				if (!Number.isFinite(v)) return;
				const clamped = Math.max(Number(range.min), Math.min(Number(range.max), v));
				range.value = clamped;
				state.cfg[key] = clamped;
				markDirty();
				paintConfig();
				scheduleRun();
			});
			num.addEventListener("change", () => {
				numPushed = false;
				// Clamp on blur
				const v = Number(num.value);
				if (Number.isFinite(v)) {
					num.value = Math.max(Number(range.min), Math.min(Number(range.max), v));
				}
				persist();
			});
		}
	}

	/* ------------------------------------------------------------ randomizer */

	/* One group per settings fieldset, plus the two whole-panel scopes. What
	   is deliberately NOT here:
	     - the seed: Reroll owns the seed. Randomizing both at once means you
	       cannot tell which produced what you are looking at.
	     - archetypeWeights: a curated 117-row table whose ordering is the
	       authored intent; a uniform draw over it destroys that invisibly.
	       Flavor, pool size and diversity are the supported ways to move
	       the mix, and they ARE randomized.
	     - variation: a seed-neighborhood explorer, not a class property.
	       Randomizing it does Reroll's job while making shared links
	       confusing. */
	const RANDOM_GROUPS = {
		quality: ["classQuality", "classDepth", "eliteCount", "potBias", "potSpread"],
		builds: ["specialization", "archetypeDiversity", "classFlavor",
			"archetypePool", "surpriseBudget", "buildNoise", "poolMemory"],
		years: ["freshmanShare", "transferShare", "redshirtShare", "reclassShare"],
		destinations: ["pDII"],
		season: ["pace", "scoringEnv", "efficiencyEnv", "statNoise", "injuryRate",
			"upsetFactor", "realignmentRate", "bluebloodDownYears", "midMajorLift",
			"teamMomentum", "seasonEvents", "draftEvents"],
		awards: ["awardStrictness", "confAwardStrictness", "proAwardStrictness",
			"awardNoise"],
	};
	const RANDOM_SCOPES = ["gentle", "wide"].concat(Object.keys(RANDOM_GROUPS));
	const RANDOM_KEYS = Object.keys(RANDOM_GROUPS)
		.reduce((a, g) => a.concat(RANDOM_GROUPS[g]), []);

	function stepDecimals(step) {
		const s = String(step);
		const i = s.indexOf(".");
		return i === -1 ? 0 : s.length - i - 1;
	}

	/* One draw for one slider. "gentle" is a triangular distribution centered
	   on the setting's own default, reaching ~34% of the slider's range each
	   way; "wide" is uniform across the declared min/max. Both snap to the
	   control's step and round off binary-float dust so the panel prints
	   clean numbers. */
	function randomSliderValue(key, mode) {
		const input = $(key);
		if (!input || input.type !== "range") return null;
		const min = Number(input.min);
		const max = Number(input.max);
		const step = Number(input.step) || 1;
		if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
		let v;
		if (mode === "gentle") {
			const d = Number(CFG.DEFAULTS[key]);
			const center = Number.isFinite(d) ? Math.min(max, Math.max(min, d)) : (min + max) / 2;
			v = center + (Math.random() - Math.random()) * 0.34 * (max - min);
		} else {
			v = min + Math.random() * (max - min);
		}
		v = min + Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step;
		v = Math.min(max, Math.max(min, v));
		return Number(v.toFixed(stepDecimals(step)));
	}

	function randomizeSettings(scope) {
		if (RANDOM_SCOPES.indexOf(scope) === -1) scope = "gentle";
		const mode = scope === "wide" ? "wide" : scope === "gentle" ? "gentle" : "wide";
		const groups = (scope === "gentle" || scope === "wide")
			? Object.keys(RANDOM_GROUPS) : [scope];
		pushUndo("randomized settings (" + scope + ")");
		let moved = 0;
		let locked = 0;
		for (const g of groups) {
			for (const key of RANDOM_GROUPS[g]) {
				if (state.settingLocks[key]) { locked++; continue; }
				const v = randomSliderValue(key, mode);
				if (v === null || v === state.cfg[key]) continue;
				state.cfg[key] = v;
				moved++;
			}
		}
		/* Destination weights are randomized MULTIPLICATIVELY off the
		   built-ins, so a randomized class is a different mix of the same 24
		   leagues rather than a uniform one. */
		if (groups.indexOf("destinations") !== -1 && !state.settingLocks.leagueWeights) {
			const base = CFG.defaultLeagueWeights();
			const spread = mode === "wide" ? Math.log(4) : Math.log(1.6);
			const lw = {};
			for (const k of Object.keys(base)) {
				lw[k] = Math.max(0, Number(
					(base[k] * Math.exp((Math.random() * 2 - 1) * spread)).toFixed(1)));
			}
			state.cfg.leagueWeights = lw;
			moved++;
		}
		/* Repair the one contradiction the draw can produce: classFlavor 0
		   disables the flavor system entirely, an explicitly named flavor
		   included. The engine now floors this itself (see pickFlavor), but
		   the panel should not display a contradiction either. */
		if (state.cfg.flavorHint && state.cfg.classFlavor === 0) {
			state.cfg.classFlavor = 0.5;
		}
		if (!moved) {
			// Undo entry stays — it is a no-op to undo — but say why nothing moved.
			setStatus(locked
				? "Nothing to randomize: every setting in that scope is locked."
				: "Nothing moved.");
			return;
		}
		markDirty();
		paintConfig();
		persist();
		scheduleRun();
		setStatus("Randomized " + moved + " setting" + (moved === 1 ? "" : "s") +
			(locked ? " (" + locked + " locked, untouched)" : "") +
			". Ctrl+Z restores them in one step.");
	}

	/* The randomizer's scopes, as chips rather than a <select>.

	   Eight scopes in a dropdown is two clicks and a menu to read every time,
	   for a control whose whole point is that you press it repeatedly. A row
	   of chips is one click and the current scope is visible without opening
	   anything. */
	const SCOPE_CHIPS = [
		["gentle", "gently", "Draw near each setting's default"],
		["wide", "wide open", "Draw across each slider's whole range"],
		["quality", "quality", "Class quality and depth only"],
		["builds", "builds", "Builds only"],
		["years", "years", "Class years and paths only"],
		["destinations", "destinations", "Destinations only"],
		["season", "season", "College season only"],
		["awards", "awards", "Awards only"],
	];
	function paintRandomScope() {
		const box = $("randomScope");
		if (!box) return;
		/* The button says what it will do, since the scope is now a chip row
		   rather than a labelled <select> and the button is what gets pressed. */
		const btn = $("btnRandomize");
		if (btn) {
			const row = SCOPE_CHIPS.filter((r) => r[0] === state.randomScope)[0];
			btn.title = "Randomize: " + (row ? row[2] : state.randomScope) +
				" (g). Ctrl+Z restores them in one step.";
		}
		/* The chips have to be the scopes the randomizer knows, or a chip is a
		   button that silently falls back to "gently". RANDOM_SCOPES is the
		   authority; this asserts the two agree rather than trusting them to.
		   Cheap, and the failure it prevents is invisible. */
		for (const [value] of SCOPE_CHIPS) {
			if (RANDOM_SCOPES.indexOf(value) === -1) {
				setStatus("Internal: unknown randomize scope " + value);
			}
		}
		box.innerHTML = "";
		for (const [value, label, title] of SCOPE_CHIPS) {
			const b = el("button", "chip" + (state.randomScope === value ? " on" : ""), label);
			b.type = "button";
			b.title = title;
			b.setAttribute("role", "radio");
			b.setAttribute("aria-checked", state.randomScope === value ? "true" : "false");
			b.dataset.scope = value;
			b.addEventListener("click", () => {
				state.randomScope = value;
				persist();
				paintRandomScope();
			});
			box.appendChild(b);
		}
	}

	function bindRandomize() {
		const btn = $("btnRandomize");
		if (!btn) return;
		paintRandomScope();
		btn.addEventListener("click", () => randomizeSettings(state.randomScope));
	}

	/* ------------------------------------------------- the settings filter

	   Eighty-odd controls in one column, and the only way to find one was to
	   scroll. Two filters, because they answer the two questions people
	   actually have: "where is the pace slider" and "what have I changed".

	   Implemented over the live DOM rather than by rebuilding the panel: the
	   panel carries open/closed state, focus and scroll position, and
	   rebuilding it would throw all three away every keystroke. */
	function settingText(ctl) {
		const label = ctl.querySelector("label");
		const input = ctl.querySelector("input, select");
		return ((label ? label.textContent : "") + " " +
			(input ? input.id : "") + " " +
			(ctl.querySelector(".unit") ? ctl.querySelector(".unit").textContent : ""))
			.toLowerCase();
	}
	function applySettingFilter() {
		const box = $("settingSearch");
		const onlyChanged = $("onlyChanged");
		const note = $("settingSearchNote");
		if (!box) return;
		const q = box.value.trim().toLowerCase();
		const changedOnly = onlyChanged && onlyChanged.checked;
		const D = CFG.DEFAULTS;
		let shown = 0;
		let total = 0;
		for (const grp of document.querySelectorAll("#settings details.grp")) {
			let any = 0;
			const ctls = grp.querySelectorAll(".ctl");
			for (const ctl of ctls) {
				const input = ctl.querySelector("input, select");
				const key = input && input.id;
				total++;
				let show = true;
				if (q && settingText(ctl).indexOf(q) === -1) show = false;
				if (show && changedOnly && key && key in D) {
					const cur = state.cfg[key];
					const def = D[key];
					const same = typeof cur === "object" || typeof def === "object"
						? JSON.stringify(cur) === JSON.stringify(def)
						: cur === def;
					if (same) show = false;
				}
				/* The stylesheet's own class, not the `hidden` attribute: a
				   .ctl inside a <details> that is closed is already not
				   rendered, and mixing the two mechanisms made "show only what
				   I changed" leave empty gaps where a control used to be. */
				ctl.classList.toggle("settings-hidden", !show);
				if (show) { any++; shown++; }
			}
			/* A group with nothing in it is hidden rather than left as an
			   empty heading, and a group with a match is opened — otherwise
			   searching finds a setting inside a collapsed section and shows
			   you the section's title. */
			/* A group with no .ctl children at all is not a group of settings
			   — the archetype panel is a weight table with its own search box
			   — and hiding it because "none of its controls matched" hid a
			   panel that has no controls to match. Only a group that HAS
			   controls and matched none of them is hidden. */
			grp.classList.toggle("settings-hidden", ctls.length > 0 && any === 0);
			if ((q || changedOnly) && any > 0) grp.open = true;
		}
		if (note) {
			note.textContent = (q || changedOnly)
				? shown + " of " + total + " settings" +
					(shown === 0 ? " — nothing matches" : "")
				: "";
		}
	}
	function bindSettingFilter() {
		const box = $("settingSearch");
		const onlyChanged = $("onlyChanged");
		if (box) {
			box.addEventListener("input", applySettingFilter);
			box.addEventListener("search", applySettingFilter);
		}
		if (onlyChanged) onlyChanged.addEventListener("change", applySettingFilter);
	}

	/* Per-setting locks. Locks existed per-player per-field and presets exist
	   for whole configurations; with the randomizer in place the thing in
	   between — "randomize everything except pace and era" — became the
	   natural next ask. A locked setting is skipped by the randomizer (and
	   only by the randomizer: the slider itself still moves by hand). */
	function paintLockButtons() {
		for (const key of RANDOM_KEYS) {
			const input = $(key);
			if (!input) continue;
			const ctl = input.closest(".ctl");
			if (!ctl) continue;
			const label = ctl.querySelector("label");
			if (!label) continue;
			let b = label.querySelector(".lock-btn");
			if (!b) {
				b = el("button", "lock-btn");
				b.type = "button";
				b.addEventListener("click", (e) => {
					e.stopPropagation();
					if (state.settingLocks[key]) delete state.settingLocks[key];
					else state.settingLocks[key] = true;
					persist();
					paintLockButtons();
				});
				label.appendChild(b);
			}
			const locked = !!state.settingLocks[key];
			b.textContent = locked ? "🔒" : "🔓";
			b.classList.toggle("locked", locked);
			b.title = locked
				? "Locked: the randomizer will not touch " + key
				: "Unlocked: the randomizer may move " + key;
			b.setAttribute("aria-label", (locked ? "Unlock " : "Lock ") + key +
				" against the randomizer");
			b.setAttribute("aria-pressed", locked ? "true" : "false");
		}
	}

	function bindConfig() {
		for (const key of SLIDERS) {
			const input = $(key);
			if (!input) continue;
			let pushed = false;
			input.addEventListener("pointerdown", () => { pushed = false; });
			input.addEventListener("input", () => {
				if (!pushed) { pushUndo("moved " + key); pushed = true; }
				state.cfg[key] = Number(input.value);
				markDirty();
				paintConfig();
				scheduleRun();
			});
			input.addEventListener("change", () => { pushed = false; persist(); });
		}
		/* The class flavor, as a choice rather than a draw. See
		   Config.DEFAULTS.flavorHint. */
		const fh = $("flavorHint");
		fh.appendChild(new Option("draw one at random", ""));
		for (const f of RB.CLASS_FLAVORS) {
			fh.appendChild(new Option(f.label || f.name, f.name));
		}
		fh.addEventListener("change", () => {
			pushUndo("changed the class flavor");
			state.cfg.flavorHint = fh.value;
			markDirty();
			paintConfig();
			persist();
			scheduleRun();
		});

		$("era").addEventListener("change", () => {
			pushUndo("changed the era");
			state.cfg.era = $("era").value;
			markDirty();
			paintConfig();
			scheduleRun();
		});
		$("priorSeasons").addEventListener("change", () => {
			pushUndo("changed how earlier seasons are produced");
			state.cfg.priorSeasons = $("priorSeasons").value;
			markDirty();
			scheduleRun();
		});
		$("ovrMode").addEventListener("change", () => {
			pushUndo("changed the overall mode");
			state.cfg.ovrMode = $("ovrMode").value;
			markDirty();
			paintConfig();
			scheduleRun();
		});
		$("varySize").addEventListener("change", () => {
			pushUndo("toggled Vary size");
			state.cfg.varySize = $("varySize").checked;
			markDirty();
			scheduleRun();
		});
		$("narrative").addEventListener("change", () => {
			pushUndo("toggled season storylines");
			state.cfg.narrative = $("narrative").checked;
			markDirty();
			scheduleRun();
		});
		$("universe").addEventListener("change", () => {
			pushUndo("toggled Universe mode");
			state.cfg.universe = $("universe").checked;
			/* Turning it off has to drop the chain's cached configs, or
			   ensureResult would keep handing back universe results for a
			   world the user has switched out of. */
			if (!state.cfg.universe) state.universe.cfgs = {};
			markDirty();
			paintConfig();
			run();
		});
		$("seed").addEventListener("change", () => {
			state.cfg.seed = $("seed").value.trim();
			run();
		});

		const preset = $("preset");
		preset.addEventListener("change", () => {
			const p = CFG.PRESETS[preset.value] || state.customPresets[preset.value];
			if (!p) return;
			pushUndo("applied the preset " + preset.value);
			const seed = state.cfg.seed;
			state.cfg = CFG.make(p);
			state.cfg.seed = seed;
			state.presetName = preset.value;
			state.presetDirty = false;
			paintConfig();
			run();
		});

		$("btnSavePreset").addEventListener("click", () => {
			const box = el("div");
			const input = el("input");
			input.type = "text";
			input.placeholder = "a name for these settings";
			input.style.width = "100%";
			input.value = state.presetName === "default" ? "" : state.presetName;
			box.appendChild(el("p", "hint",
				"Twenty tuned sliders used to be keepable only by copying a URL."));
			box.appendChild(input);
			modal("Save preset", box, () => {
				const name = input.value.trim();
				if (!name || CFG.PRESETS[name]) {
					showError(new Error(name
						? "“" + name + "” is a built-in preset name."
						: "Give the preset a name."));
					return;
				}
				const saved = {};
				for (const k of Object.keys(CFG.DEFAULTS)) {
					if (k === "seed") continue;
					if (JSON.stringify(state.cfg[k]) !== JSON.stringify(CFG.DEFAULTS[k])) {
						saved[k] = state.cfg[k];
					}
				}
				state.customPresets[name] = saved;
				state.presetName = name;
				state.presetDirty = false;
				persist();
				paintConfig();
				setStatus("Saved the preset “" + name + "”.");
			});
			setTimeout(() => input.focus(), 30);
		});

		$("btnDeletePreset").addEventListener("click", () => {
			const name = state.presetName;
			if (!state.customPresets[name]) return;
			delete state.customPresets[name];
			state.presetName = "default";
			persist();
			paintConfig();
			setStatus("Deleted the preset “" + name + "”.");
		});

		$("btnReset").addEventListener("click", () => {
			// What is actually about to be lost, counted, so the dialog is a
			// fact rather than a warning.
			const moved = Object.keys(CFG.DEFAULTS).filter((k) =>
				k !== "seed" &&
				JSON.stringify(state.cfg[k]) !== JSON.stringify(CFG.DEFAULTS[k]));
			if (!moved.length) {
				setStatus("Every setting is already at its default.");
				return;
			}
			confirmDestructive(
				"Reset every setting?",
				moved.length + " setting" + (moved.length === 1 ? " is" : "s are") +
					" away from the default and will be reset: " +
					moved.slice(0, 8).join(", ") +
					(moved.length > 8 ? " and " + (moved.length - 8) + " more" : "") +
					". Locks and the loaded file are kept.",
				"Reset everything",
				() => {
					pushUndo("reset every setting to the defaults");
					state.cfg = CFG.make();
					state.presetName = "default";
					state.presetDirty = false;
					paintConfig();
					run();
				});
		});

		/* Archetype rarity weights, grouped. Sixty ungrouped rows of name-and-a
		   number is a wall, not an editor: you could not see that you were
		   looking at the guards, you could not say "half as many bigs this
		   year" without editing seventeen boxes, and nothing told you whether
		   the edit you just made had done anything. */
		const aw = $("archWeights");
		const GROUPS = [
			["guard", "Guards"], ["wing", "Wings"], ["big", "Bigs"], ["", "Any size"],
		];
		const groupOf = (a) => {
			for (const [tag] of GROUPS) if (tag && (a.t || []).indexOf(tag) !== -1) return tag;
			return "";
		};
		const commitWeights = (label) => {
			pushUndo(label);
			const w = {};
			for (const i of aw.querySelectorAll("input[data-arch]")) {
				w[i.dataset.arch] = Number(i.value);
			}
			state.cfg.archetypeWeights = w;
			markDirty();
			scheduleRun();
		};
		for (const [tag, label] of GROUPS) {
			const members = RB.ARCHETYPES.filter((a) => groupOf(a) === tag);
			if (!members.length) continue;
			const head = el("div", "archgroup");
			head.dataset.group = tag;
			/* Collapsible. Four groups of thirty rows each is still a wall when
			   all four are open; a user who wants the bigs does not want to
			   scroll through the guards to reach them. Open by default, so
			   nothing a user could already see has moved. */
			const toggle = el("button", "tiny archfold", "▾");
			toggle.setAttribute("aria-expanded", "true");
			toggle.title = "Collapse the " + label.toLowerCase();
			toggle.addEventListener("click", () => {
				const open = toggle.getAttribute("aria-expanded") !== "true";
				toggle.setAttribute("aria-expanded", open ? "true" : "false");
				toggle.textContent = open ? "▾" : "▸";
				toggle.title = (open ? "Collapse the " : "Expand the ") + label.toLowerCase();
				for (const row of aw.querySelectorAll('.archrow[data-group="' +
					cssEscape(tag) + '"]')) {
					row.classList.toggle("arch-folded", !open);
				}
			});
			head.appendChild(toggle);
			head.appendChild(el("span", "archname", label + " (" + members.length + ")"));
			// One multiplier for the whole group, applied to what is on screen.
			const mult = el("button", "tiny", "×2");
			mult.title = "Double every weight in this group";
			const scaleGroup = (k) => {
				for (const a of members) {
					const i = aw.querySelector('input[data-arch="' + cssEscape(a.name) + '"]');
					if (i) i.value = Math.max(0, Math.round(Number(i.value) * k * 100) / 100);
				}
				commitWeights("scaled the " + label.toLowerCase() + " weights");
			};
			mult.addEventListener("click", () => scaleGroup(2));
			head.appendChild(mult);
			const half = el("button", "tiny", "×½");
			half.title = "Halve every weight in this group";
			half.addEventListener("click", () => scaleGroup(0.5));
			head.appendChild(half);
			aw.appendChild(head);
			for (const a of members) {
				const row = el("div", "archrow");
				row.dataset.group = tag;
				row.dataset.arch = a.name;
				// Searched against the name AND the tags, so "shooting" finds
				// the twenty builds that shoot rather than the one called it.
				row.dataset.search = (a.name + " " + (a.t || []).join(" ")).toLowerCase();
				const name = el("span", "archname", a.name);
				name.title = archetypeTooltip(a);
				row.appendChild(name);
				/* What this build actually came out at last run, so an edit has
				   visible consequences. A weight is a target share of the class
				   and there was no way to see the share. */
				const got = el("span", "archgot");
				got.dataset.arch = a.name;
				got.title = "Share of the last generated class that came out as " + a.name;
				row.appendChild(got);
				const inp = el("input");
				inp.type = "number";
				inp.step = "0.05";
				inp.min = "0";
				inp.max = "8";
				inp.dataset.arch = a.name;
				inp.value = a.w === undefined ? 1 : a.w;
				inp.title = archetypeTooltip(a);
				inp.setAttribute("aria-label", "Rarity weight for " + a.name);
				inp.addEventListener("change", () => commitWeights("changed archetype weights"));
				row.appendChild(inp);
				aw.appendChild(row);
			}
		}
		/* The build search. 117 rows in a fixed-height scroller with no way to
		   narrow them: finding one build meant knowing roughly where in the
		   height ordering it sat and scrolling to it. Matches the name and the
		   tags, and hides a group header whose whole group is filtered out so
		   the list does not end up as a column of empty headings. */
		/* The hint's numbers come from the table, not from the markup: the
		   prose said "117 builds" and "0.34 = the rarest" for a table of 121
		   whose floor was 0.45, on every page load, because nothing compared
		   the two. */
		const archHint = $("archHint");
		if (archHint) {
			const ws = RB.ARCHETYPES.filter((a) => a.name !== "Balanced")
				.map((a) => (a.w === undefined ? 1 : a.w));
			archHint.textContent = RB.ARCHETYPES.length + " builds. Rarity weight per " +
				"build (1 = common, " + Math.max.apply(null, ws) + " = the most common, " +
				Math.min.apply(null, ws) + " = the rarest), and beside it the share of " +
				"the last generated class that build actually came out as. Height " +
				"bands are fixed by the archetype. Hover a name to see what it does " +
				"to the ratings.";
		}
		/* Three filters that compose: the search (name or tag), a height
		   band (only builds a player of that height can draw — "make this a
		   rim-protector-heavy class" starts with the builds a seven-footer is
		   eligible for, not with 121 rows), and "in this class's pool" (only
		   the builds the current class actually drew from). */
		const archSearch = $("archSearch");
		const archNote = $("archSearchNote");
		const archBand = $("archBand");
		const archInPool = $("archInPool");
		const byName = {};
		for (const a of RB.ARCHETYPES) byName[a.name] = a;
		const applyArchFilter = () => {
			const q = archSearch.value.trim().toLowerCase();
			const band = archBand && archBand.value !== "" ? Number(archBand.value) : null;
			const res = state.results[state.active];
			const wantPool = !!(archInPool && archInPool.checked);
			const pool = wantPool && res && Array.isArray(res.archetypePool)
				? new Set(res.archetypePool) : null;
			const active = !!q || band !== null || wantPool;
			let shown = 0;
			const perGroup = {};
			for (const row of aw.querySelectorAll(".archrow")) {
				const a = byName[row.dataset.arch] || {};
				const hit = (!q || (row.dataset.search || "").indexOf(q) !== -1) &&
					(band === null || (band >= (a.min || 0) && band <= (a.max === undefined ? 100 : a.max))) &&
					(!pool || pool.has(a.name));
				row.classList.toggle("arch-filtered", !hit);
				if (hit) {
					shown++;
					perGroup[row.dataset.group] = true;
					// A search result must be visible even inside a group the
					// user collapsed, or the search silently finds nothing.
					if (active) row.classList.remove("arch-folded");
				}
			}
			for (const head of aw.querySelectorAll(".archgroup")) {
				head.classList.toggle("arch-filtered", active && !perGroup[head.dataset.group]);
			}
			archNote.hidden = !active;
			const what = [];
			if (q) what.push("match “" + archSearch.value.trim() + "”");
			if (band !== null) what.push("are eligible at hgt " + band);
			if (wantPool) what.push(pool ? "are in this class's pool" : "— the pool is off, so every build is eligible");
			archNote.textContent = active
				? shown + " build" + (shown === 1 ? "" : "s") + " " + what.join(" and ") +
					(shown || !q ? "" : " — try a tag: guard, wing, big, shooting, " +
						"defense, playmaking, rebounding, athletic, raw, scoring")
				: "";
		};
		archSearch.addEventListener("input", applyArchFilter);
		if (archBand) archBand.addEventListener("change", applyArchFilter);
		if (archInPool) archInPool.addEventListener("change", applyArchFilter);
		// The pool changes with every reroll; a filter on it has to follow.
		archFilterHook = applyArchFilter;

		$("btnArchReset").addEventListener("click", () => {
			pushUndo("reset the archetype weights");
			state.cfg.archetypeWeights = null;
			markDirty();
			paintArchWeights();
			run();
		});

		/* Destination weights, GROUPED BY REGION.

		   Twenty-three number boxes in one flat list, and the thing a user
		   actually wants from them is almost never one league — it is "more
		   Europe", "fewer prep and postgrad", "this is an international
		   class". So the leagues are grouped, each group collapses, and each
		   group carries the same x2 / x1/2 buttons the archetype weights have.

		   The grouping is DERIVED rather than authored: every league already
		   carries a `regions` map of birthplace multipliers, and the region it
		   most rewards is the region it belongs to. That means adding a league
		   to js/colleges.js puts it in the right group with no second edit —
		   which is the whole reason not to author a second table. */
		const lw = $("leagueWeights");
		const REGION_LABEL = {
			europe: "Europe", usa: "United States", canada: "Canada",
			oceania: "Australia and New Zealand", asia: "Asia",
			latam: "Latin America", africa: "Africa", other: "Everywhere else",
		};
		const regionOf = (lg) => {
			const r = lg.regions || {};
			let best = "other";
			let bestV = -Infinity;
			for (const k of Object.keys(r)) {
				// "other" is the fallback multiplier, not a place.
				if (k === "other") continue;
				if (r[k] > bestV) { bestV = r[k]; best = k; }
			}
			return bestV > 1.05 ? best : "other";
		};
		const commit = (label) => {
			pushUndo(label);
			const w = {};
			for (const i of lw.querySelectorAll("input")) w[i.dataset.league] = Number(i.value);
			state.cfg.leagueWeights = w;
			// The three legacy sliders are folded in by Config.make, so they
			// have to stop overriding once the user edits the table.
			state.cfg.wEuroLeague = null;
			state.cfg.wGLeague = null;
			state.cfg.wNBL = null;
			markDirty();
			scheduleRun();
		};
		const byRegion = {};
		for (const name of Object.keys(C.NON_NCAA)) {
			if (name === "DII NCAA") continue;
			const key = regionOf(C.NON_NCAA[name]);
			(byRegion[key] = byRegion[key] || []).push(name);
		}
		const order = Object.keys(byRegion)
			.sort((a, b) => byRegion[b].length - byRegion[a].length);
		for (const region of order) {
			const group = el("details", "leaguegroup");
			const sum = el("summary");
			sum.appendChild(document.createTextNode(
				(REGION_LABEL[region] || region) + " (" + byRegion[region].length + ")"));
			const scale = (k, verb) => {
				const b = el("button", "tiny", k > 1 ? "x2" : "x\u00bd");
				b.type = "button";
				b.title = verb + " every weight in this group";
				b.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					for (const i of lw.querySelectorAll("input")) {
						if (byRegion[region].indexOf(i.dataset.league) === -1) continue;
						i.value = String(Math.round(
							Math.max(0, Math.min(100, Number(i.value) * k))));
					}
					commit(verb + " the " + (REGION_LABEL[region] || region) + " weights");
				});
				sum.appendChild(b);
			};
			scale(2, "Doubled");
			scale(0.5, "Halved");
			group.appendChild(sum);
			for (const name of byRegion[region]) {
				const lg = C.NON_NCAA[name];
				const row = el("div", "archrow");
				const label = el("span", "archname", name);
				label.title = name + "\nstrength " + lg.strength +
					"\n" + (lg.pro ? "professional" : "amateur") +
					"\ndefault weight " + lg.w;
				row.appendChild(label);
				const inp = el("input");
				inp.type = "number";
				inp.step = "1";
				inp.min = "0";
				inp.max = "100";
				inp.dataset.league = name;
				inp.setAttribute("aria-label", "Weight for " + name);
				inp.addEventListener("change", () => commit("changed destination weights"));
				row.appendChild(inp);
				group.appendChild(row);
			}
			lw.appendChild(group);
		}
		$("btnLeagueReset").addEventListener("click", () => {
			pushUndo("reset the destination weights");
			state.cfg.leagueWeights = CFG.defaultLeagueWeights();
			state.cfg.wEuroLeague = null;
			state.cfg.wGLeague = null;
			state.cfg.wNBL = null;
			markDirty();
			paintLeagueWeights();
			run();
		});

		// Note template: which lines are written into each player's note.
		const box = $("noteLines");
		for (const [key, label] of global.Engine.NOTE_LINES) {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.value = key;
			cb.addEventListener("change", () => {
				pushUndo("changed the note template");
				state.cfg.noteLines = Array.from(box.querySelectorAll("input:checked"))
					.map((i) => i.value);
				markDirty();
				scheduleRun();
			});
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + label));
			box.appendChild(lab);
		}

		for (const d of document.querySelectorAll("details.grp")) {
			d.addEventListener("toggle", persist);
		}
	}

	function paintNoteLines() {
		const box = $("noteLines");
		if (!box) return;
		for (const cb of box.querySelectorAll("input")) {
			cb.checked = (state.cfg.noteLines || []).indexOf(cb.value) !== -1;
		}
	}

	let timer = null;
	function scheduleRun() {
		clearTimeout(timer);
		timer = setTimeout(run, 140);
	}

	/* ------------------------------------------------------- config sharing */

	function encodeConfig() {
		const out = {};
		for (const k of Object.keys(CFG.DEFAULTS)) {
			const v = state.cfg[k];
			const d = CFG.DEFAULTS[k];
			if (JSON.stringify(v) !== JSON.stringify(d)) out[k] = v;
		}
		if (Object.keys(state.overrides).length) {
			out.overrides = state.overrides;
			/* Locks are keyed by pid. Opening a shared link with a DIFFERENT
			   draft class loaded used to apply them to whichever players
			   happened to share those pids — silently, and to the wrong people.
			   The link now carries a fingerprint of the class the locks were
			   made against. */
			out.fp = state.overrideFingerprint || fingerprint(activeFile());
		}
		return out;
	}

	/* Roughly where browsers and the things people paste links into start
	   truncating. A class with 70 fully-locked players clears it easily, and a
	   silently truncated link is worse than no link: it opens, parses as far as
	   it got, and applies the wrong settings. */
	const HASH_LIMIT = 8000;
	let hashWarned = false;

	function writeHash() {
		try {
			const payload = encodeConfig();
			let body = Object.keys(payload).length
				? encodeURIComponent(JSON.stringify(payload))
				: "";
			if (body.length > HASH_LIMIT && payload.overrides) {
				/* Drop the locks rather than the settings: the settings are what
				   a shared link is usually for, and the locks are the part that
				   grows without bound. */
				const lean = Object.assign({}, payload);
				delete lean.overrides;
				delete lean.fp;
				body = encodeURIComponent(JSON.stringify(lean));
				if (!hashWarned) {
					hashWarned = true;
					setStatus("This class has too many locked players to fit in a " +
						"shareable link, so the link carries the settings only. " +
						"Export the locks as CSV to share those.", true);
				}
			}
			history.replaceState(null, "", body ? "#c=" + body : "#");
		} catch (e) { /* a hash that will not fit is not worth an error banner */ }
	}

	function readHash() {
		const m = /[#&]c=([^&]+)/.exec(location.hash || "");
		if (!m) return false;
		try {
			const payload = JSON.parse(decodeURIComponent(m[1]));
			if (payload.overrides) {
				state.overrides = payload.overrides;
				state.overrideFingerprint = payload.fp || null;
				delete payload.overrides;
				delete payload.fp;
			}
			state.cfg = CFG.make(payload);
			state.presetDirty = true;
			return true;
		} catch (e) {
			showError(new Error("Could not read the settings in this link."));
			return false;
		}
	}

	/* A short, stable identity for one GENERATED class. Built from what the
	   user actually sees — who each player is, what he was built into, where he
	   plays and what he averaged — so any difference that matters shows up and
	   a difference that does not (the order of a tab, a theme) does not. */
	function classFingerprint(res) {
		const parts = [];
		for (const p of res.players.slice().sort((a, b) => (a.key < b.key ? -1 : 1))) {
			parts.push(p.key + ":" + p.newOvr + "/" + p.newPot + ":" + p.archetype +
				":" + (p.proClub || p.newCollege) +
				":" + (p.stats ? p.stats.ppg.toFixed(1) : "-"));
		}
		const h = global.BBGMRng.hashSeed(parts.join("|"));
		return (h() >>> 0).toString(36).slice(0, 6);
	}

	/* A short, stable identity for one draft class file. */
	function fingerprint(file) {
		if (!file || !file.data) return null;
		const players = file.data.players || [];
		const sample = players.slice(0, 6).concat(players.slice(-3))
			.map((p) => (p.pid === undefined ? "?" : p.pid) + ":" +
				(p.firstName || "") + (p.lastName || "")).join("|");
		const h = global.BBGMRng.hashSeed(
			players.length + "/" + file.data.startingSeason + "/" + sample);
		return (h() >>> 0).toString(36);
	}

	function activeFile() { return state.files[state.active] || null; }

	/* ------------------------------------------------------------ file input */

	function summarize(data) {
		const players = data.players || [];
		const blank = players.filter((p) => !p.college || !String(p.college).trim()).length;
		return players.length + " players, season " + (data.startingSeason || "?") +
			", " + Math.round((100 * blank) / Math.max(1, players.length)) + "% blank colleges";
	}

	/* Reading a dropped file, gzip and all.

	   BBGM writes big league exports as .json.gz, and the browser will not
	   unzip one for us: a FileReader on a gzipped file returns the compressed
	   bytes, JSON.parse throws on the first one, and the user is told their
	   own league export is not valid JSON. So the bytes are read, the gzip
	   magic number (1f 8b) is checked — the extension is a hint, not the
	   truth — and DecompressionStream does the rest. Everything else is the
	   old path: decode UTF-8, drop a BOM, parse. */
	function readTextFile(f) {
		const buf = f.arrayBuffer
			? f.arrayBuffer()
			: new Promise((resolve, reject) => {
				const r = new FileReader();
				r.onerror = () => reject(new Error("could not be read from disk"));
				r.onload = () => resolve(r.result);
				r.readAsArrayBuffer(f);
			});
		return buf.then((raw) => {
			const head = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
			if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) return raw;
			if (typeof DecompressionStream === "undefined") {
				throw new Error("this browser cannot open a .gz file — unzip it first");
			}
			const stream = new Blob([raw]).stream()
				.pipeThrough(new DecompressionStream("gzip"));
			return new Response(stream).arrayBuffer();
		}).then((out) => new TextDecoder("utf-8").decode(out).replace(/^\ufeff/, ""));
	}

	function readFiles(fileList) {
		const problems = [];
		// A five-file drop used to just sit there with nothing on screen.
		$("empty").classList.add("busy");
		setStatus("Reading " + fileList.length + " file" +
			(fileList.length === 1 ? "" : "s") + "…", true);
		const jobs = Array.from(fileList).map(
			(f) => readTextFile(f).then(
				(text) => {
					const data = JSON.parse(text);
					// Full schema check up front, so a bad file is rejected
					// with a sentence instead of throwing a raw TypeError
					// out of the middle of the sim.
					const check = global.Engine.validateLeagueFile(data);
					/* validateLeagueFile is a check now, not a migration, so
					   the season it recovered is applied here. */
					data.startingSeason = check.season;
					/* A full league export is 5,000+ players. Rebuilding all
					   of them and simulating 368 programs with hundreds of
					   prospects apiece locks the tab with no progress bar and
					   no way out, so take the draft class inside the file
					   when there is one and say so. */
					if (check.oversized && check.classPids) {
						const keep = new Set(check.classPids);
						data.players = data.players.filter((p, i) =>
							keep.has(Number.isFinite(Number(p.pid)) ? Number(p.pid) : -1 - i));
					}
					return { name: f.name, data, warnings: check.warnings };
				},
			).catch((e) => {
				problems.push(f.name + ": " + (e && e.message ? e.message : e));
				return null;
			}),
		);
		Promise.all(jobs).then((loaded) => installFiles(loaded, problems));
	}

	/* A synthetic class for a visitor with nothing to drop. It goes through
	   exactly the path a real file does — validated, fingerprinted, run —
	   so everything a real class can do, the sample can too. */
	function loadSample() {
		if (!global.Sample) return;
		const seed = Date.now() % 100000;
		const data = global.Sample.makeClass(seed, 70, new Date().getFullYear() + 1);
		const check = global.Engine.validateLeagueFile(data);
		data.startingSeason = check.season;
		installFiles([{ name: "sample-class-" + seed + ".json", data, warnings: check.warnings }], []);
	}

	function installFiles(loaded, problems) {
		{
			$("empty").classList.remove("busy");
			const ok = loaded.filter(Boolean);
			if (problems.length) showError(new Error(problems.join("\n")));
			else clearError();
			if (!ok.length) { setStatus(""); return; }
			state.files = ok.sort((a, b) =>
				(a.data.startingSeason || 0) - (b.data.startingSeason || 0));
			for (const f of state.files) f.fingerprint = fingerprint(f);
			state.runners = state.files.map((f) => global.Engine.createRunner(f.data));
			state.results = [];
			state.active = 0;
			const sel = $("fileSelect");
			sel.innerHTML = "";
			state.files.forEach((f, i) => {
				sel.appendChild(new Option(
					(f.data.startingSeason || "?") + " — " + f.name, String(i)));
			});
			sel.hidden = state.files.length < 2;
			$("btnExportAll").hidden = state.files.length < 2;
			$("empty").hidden = true;
			$("app").hidden = false;
			$("fileSummary").textContent = state.files.map(
				(f) => f.name + ": " + summarize(f.data)).join("  ·  ");
			$("fileSummary").hidden = false;
			for (const id of ["btnReroll", "btnRerun", "btnExport", "btnExportMenu",
				"btnExportAll", "btnPin"]) $(id).disabled = false;
			checkLockFingerprint();
			const warns = state.files.flatMap((f) => (f.warnings || [])
				.map((w) => f.name + ": " + w));
			if (warns.length) showWarning(warns.join("\n"));
			setStatus("");
			run();
		}
	}

	/* Locks belong to the class they were made against. */
	function checkLockFingerprint() {
		const file = activeFile();
		if (!file) return;
		const n = Object.keys(state.overrides).length;
		if (!n) { state.overrideFingerprint = file.fingerprint; return; }
		if (!state.overrideFingerprint) {
			state.overrideFingerprint = file.fingerprint;
			return;
		}
		if (state.overrideFingerprint !== file.fingerprint) {
			state.overrides = {};
			state.overrideFingerprint = file.fingerprint;
			showWarning(n + " lock" + (n === 1 ? "" : "s") +
				" came from a different draft class and have been dropped. " +
				"Locks are tied to the file they were made against — applying " +
				"them by pid alone would silently lock the wrong players.");
			return;
		}
		reportUnmatchedLocks(file);
	}

	/* Locks whose key names no player in this file.

	   The fingerprint check above catches a lock made against a DIFFERENT
	   class. It cannot catch the case where there is no fingerprint to compare
	   — a shareable link written before links carried one, or a payload whose
	   fp was dropped — and that case has a specific and silent failure mode.

	   Engine.playerKey uses the pid when the file has one and "idx<n>" when it
	   does not. A link copied out of a session whose file HAD pids carries
	   keys like "512"; pasted into a session whose file does not, every key in
	   the class is "idx0", "idx1", … Nothing throws, nothing mismatches, and
	   nothing is locked: the user watches their locks evaporate on the first
	   reroll with no indication that anything happened. The validator warns
	   about the missing pids, which explains why the file is unusual and not
	   why the locks are gone.

	   So say so, and drop them, which is what happens to them anyway. */
	function reportUnmatchedLocks(file) {
		const keys = Object.keys(state.overrides);
		if (!keys.length || !file || !file.data) return;
		const players = file.data.players || [];
		const known = new Set(players.map((p, i) => global.Engine.playerKey(p, i)));
		const lost = keys.filter((k) => !known.has(k));
		if (!lost.length) return;
		for (const k of lost) delete state.overrides[k];
		const indexed = players.length &&
			!Number.isFinite(Number(players[0] && players[0].pid));
		showWarning(lost.length + " lock" + (lost.length === 1 ? "" : "s") +
			" name" + (lost.length === 1 ? "s" : "") + " a player who is not in " +
			"this file, and " + (lost.length === 1 ? "has" : "have") + " been dropped." +
			(indexed
				? " This file has no player ids, so locks in it are tied to row " +
					"order rather than to the player — a link copied from a file " +
					"that does have ids cannot be applied to it."
				: " They were probably made against a file with different player ids."));
	}

	function bindFiles() {
		$("btnLoad").addEventListener("click", () => $("file").click());
		if ($("btnSample")) $("btnSample").addEventListener("click", loadSample);
		$("file").addEventListener("change", (e) => readFiles(e.target.files));
		$("fileSelect").addEventListener("change", (e) => {
			state.active = Number(e.target.value);
			checkLockFingerprint();
			ensureResult(state.active);
			render();
		});
		let depth = 0;
		const body = document.body;
		body.addEventListener("dragenter", (e) => {
			e.preventDefault();
			depth++;
			$("empty").classList.add("over");
		});
		body.addEventListener("dragover", (e) => e.preventDefault());
		body.addEventListener("dragleave", () => {
			depth = Math.max(0, depth - 1);
			if (depth === 0) $("empty").classList.remove("over");
		});
		body.addEventListener("drop", (e) => {
			e.preventDefault();
			depth = 0;
			$("empty").classList.remove("over");
			if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
		});
	}

	/* ----------------------------------------------------------------- run */

	/* The banners carry a real close button now. They were dismiss-on-click
	   with the instruction hidden in a `title` and appended to the message
	   text, which is neither discoverable nor reachable from the keyboard. */
	function showError(err) {
		const b = $("errBanner");
		b.hidden = false;
		const text = err && err.message ? err.message : String(err);
		b.querySelector(".bannertext").textContent = text;
		// Banners are dismissible and a dismissed banner used to be gone for
		// good; everything said this session is kept (Tools → Message history).
		remember("Error: " + text);
	}
	function clearError() { $("errBanner").hidden = true; }
	function showWarning(text) {
		const b = $("warnBanner");
		b.hidden = false;
		b.querySelector(".bannertext").textContent = text;
		remember("Warning: " + text);
	}

	/* The settings actually handed to the engine.

	   `seed` is pinned to the last class generated whenever the seed box is
	   blank. Without that, an empty seed meant the engine drew a fresh random
	   one on every run — so moving a slider re-rolled the entire class under
	   you, and no two adjacent positions of the same slider were comparable.
	   It also defeated the staged pipeline completely: a new seed invalidates
	   the first phase, so every change re-simulated everything. Reroll is the
	   button that changes the seed. */
	function effectiveCfg() {
		const cfg = CFG.make(state.cfg);
		cfg.overrides = state.overrides;
		if (!cfg.seed && state.lastSeed) cfg.seed = state.lastSeed;
		/* The build pools the last few classes used, newest first. The engine
		   reads this and never writes it (see pickClassPool): a build that has
		   been in the pool three classes running is pushed toward the back of
		   the queue for this one, which is what stops the four heaviest builds
		   turning up in nearly every class. The UI owns it because it is the
		   only thing here that knows what "the last few classes" means — the
		   engine sees one run. */
		cfg.recentPools = (state.poolHistory || []).slice(0, POOL_HISTORY);
		// The same memory one layer down: the anomalies the last few classes
		// were given, so this one is unlikely to repeat them.
		cfg.recentAnomalies = (state.anomalyHistory || []).slice(0, ANOMALY_HISTORY);
		return cfg;
	}

	/* How many classes back the pool memory reaches. Matches
	   RatingsBuilder.POOL_MEMORY_DEPTH, which is what actually consumes it;
	   storing more would persist a list nothing reads. */
	const POOL_HISTORY = (RB.POOL_MEMORY_DEPTH || 3);
	/* Matches Engine.ANOMALY_MEMORY_DEPTH, which is what consumes it. */
	const ANOMALY_HISTORY = (global.Engine.ANOMALY_MEMORY_DEPTH || 3);

	/* Record what the class ON SCREEN was made of, so the NEXT one avoids it.

	   Called at the start of a reroll, before the new class is drawn, and
	   nowhere else. Two things follow from that and both are load-bearing:

	     - `recentPools` is a build-phase dependency, so it has to be constant
	       for as long as one class is on screen. Recording after the run
	       instead would leave the history disagreeing with the class it
	       produced, and the next re-apply — same seed, same settings — would
	       rebuild and hand back a DIFFERENT class. "Re-apply keeps the class
	       you are looking at" is the whole contract of that button.
	     - Only a reroll counts. A slider move or a staged re-run is the same
	       class again, and counting those would make the memory a record of
	       how much the user fiddled rather than of which classes they have
	       seen: the pool would drift off the heavy builds every time somebody
	       dragged a slider. */
	function rememberPool() {
		const res = state.results[state.active];
		if (!res) return;
		if (Array.isArray(res.archetypePool) && res.archetypePool.length) {
			const hist = (state.poolHistory || []).slice();
			if (!hist.length || hist[0].join("|") !== res.archetypePool.join("|")) {
				hist.unshift(res.archetypePool.slice());
				state.poolHistory = hist.slice(0, POOL_HISTORY);
			}
		}
		/* THE ANOMALY MEMORY, on exactly the same terms as the build pool's.

		   Thirty-two anomaly kinds and about four draws a class means the same
		   eight or ten turn up in most classes, and the feature that exists to
		   keep classes fresh was the first thing to go stale. Recorded here
		   and nowhere else, for the same two load-bearing reasons the pool
		   memory is: it has to be constant while one class is on screen, or
		   re-applying the same seed would hand back a different class; and
		   only a reroll counts, or the memory becomes a record of how much the
		   user fiddled with the sliders. */
		if (Array.isArray(res.surprises) && res.surprises.length) {
			const names = res.surprises.map((sp) => sp.name);
			const hist = (state.anomalyHistory || []).slice();
			if (!hist.length || hist[0].join("|") !== names.join("|")) {
				hist.unshift(names);
				state.anomalyHistory = hist.slice(0, ANOMALY_HISTORY);
			}
		}
	}

	/* THE FILE, AS THE WORLD SEES IT.

	   With universe mode on, a file is not a standalone class: it is one
	   season of a chain, run with that season's own seed and handed the state
	   the previous season produced. Every tab that renders a file has to run
	   it the same way the chain did, or the Timeline says Boston College won
	   the 2027 title while the Bracket tab for the same file shows Villanova —
	   which is exactly what happened, because the chain used to finish by
	   throwing its own results away (`state.results.map(() => null)`) and
	   leaving the next render to re-simulate with the plain config, no
	   carry-over and the wrong seed. Export then wrote the non-universe world.

	   universeCfgFor is the answer: the chain records what it ran each file
	   with, and this reads it back. */
	function universeCfgFor(i) {
		if (!state.cfg.universe) return null;
		const saved = state.universe.cfgs && state.universe.cfgs[i];
		if (!saved) return null;
		const cfg = CFG.make(state.cfg);
		cfg.overrides = state.overrides;
		cfg.seed = saved.seed;
		cfg.carryOver = saved.carryOver || null;
		cfg.recentPools = (saved.recentPools || []).map((a) => a.slice());
		cfg.universeRoster = saved.universeRoster || null;
		return cfg;
	}

	/* THE SAME MAN, ACROSS FILES.

	   After the chain has run, a player in the 2027 file who was on a 2025
	   roster (see cfg.universeRoster in js/engine.js) has two records of that
	   freshman year: the one 2025 actually played, with a team record, a
	   game log and whatever honors he took off the field, and the one his
	   own file simulated for him alone in a rotation of synthesized
	   teammates. The first is the world; the second was the best guess
	   before the world existed. So the played season replaces the guessed
	   one on his career page, in his honors, in the export and in the note,
	   and the earlier season's page links forward to the man he became. */
	function linkCareers(runnable) {
		const E = global.Engine;
		for (let j = 0; j < runnable.length; j++) {
			const dj = runnable[j];
			const resJ = state.results[dj.index];
			if (!resJ || !resJ.players) continue;
			const touched = new Set();
			for (let k = 0; k < j; k++) {
				const dk = runnable[k];
				const resK = state.results[dk.index];
				if (!resK || !resK.futurePlayers) continue;
				for (const fp of resK.futurePlayers) {
					if (fp.fileIndex !== dj.index || !fp.stats) continue;
					const p = resJ.players.filter((x) => x.key === fp.homeKey)[0];
					if (!p) continue;
					const team = resK.teams[fp.newCollege];
					if (!Array.isArray(p.priorSeasons)) p.priorSeasons = [];
					let row = p.priorSeasons.filter((r) => r.season === resK.season && !r.redshirt)[0];
					if (!row) {
						row = { season: resK.season, redshirt: false };
						p.priorSeasons.push(row);
						p.priorSeasons.sort((a, b) => a.season - b.season);
					}
					const gl = fp.gameLog || null;
					Object.assign(row, {
						team: fp.newCollege, classYear: fp.classYear, ovr: fp.newOvr,
						gp: Math.round(fp.stats.gp), mpg: fp.stats.mpg, ppg: fp.stats.ppg,
						rpg: fp.stats.rpg, apg: fp.stats.apg, usg: fp.stats.usg, ts: fp.stats.ts,
						line: fp.stats, box: team ? team.box : null, lines: team ? team.lines : null,
						pos: fp.newPos, gameLog: gl, highs: gl ? gl.highs : null, best: gl ? gl.best : null,
						twentyPointGames: gl ? gl.twentyPointGames : 0,
						doubleDoubles: gl ? gl.doubleDoubles : 0,
						record: team ? { w: team.w, l: team.l } : null,
						awards: (fp.awards || []).slice(),
						simulated: true, universe: true,
						universeFileIndex: dk.index, universeKey: fp.key,
						postseason: team ? (team.ncaaResult || team.nitResult || null) : null,
					});
					fp.laterKey = p.key;
					fp.laterFileIndex = dj.index;
					touched.add(p);
				}
			}
			for (const p of touched) {
				p.priorAwards = [];
				for (const r of p.priorSeasons) {
					for (const award of r.awards || []) {
						p.priorAwards.push({ season: r.season, classYear: r.classYear, award });
					}
				}
				p.betterEarlier = null;
				for (const r of p.priorSeasons) {
					if (r.redshirt || !(r.mpg >= 15) || !p.stats) continue;
					if (r.ppg > p.stats.ppg + 2 && (!p.betterEarlier || r.ppg > p.betterEarlier.ppg)) {
						p.betterEarlier = { season: r.season, classYear: r.classYear, ppg: r.ppg };
					}
				}
				try {
					p.note = E.buildNote(p, resJ.teams, resJ.season, resJ.cfg);
				} catch (e) { /* the note is a convenience; the page still renders */ }
			}
		}
	}

	/* A player page in ANOTHER loaded file: the later-class freshman on a
	   2025 team page is a prospect in the 2027 file, and his page is there. */
	function showPlayerInFile(fileIndex, key) {
		if (!Number.isFinite(fileIndex) || !state.files[fileIndex]) return;
		if (fileIndex !== state.active) {
			state.active = fileIndex;
			const sel = $("fileSelect");
			if (sel) sel.value = String(fileIndex);
			checkLockFingerprint();
			ensureResult(state.active);
		}
		showPlayer(key);
	}

	function ensureResult(i) {
		if (state.results[i]) return state.results[i];
		const runner = state.runners[i];
		if (!runner) return null;
		// Every file in a batch shares the seed, so they stay one set.
		state.results[i] = runner.run(universeCfgFor(i) || effectiveCfg());
		return state.results[i];
	}

	/* The engine is staged: a runner only redoes the phases whose settings
	   changed. Moving the note template or an award dial used to re-simulate
	   368 programs, 11,000 games and every stat line in the country — about
	   200ms of blocking work every 140ms while a slider was moving. */
	/* --- the busy indicator ---------------------------------------------

	   run() is synchronous and takes 300-600ms on a 70-player class, and the
	   status line was written AFTER it finished. So the sequence a user saw was
	   a click, then between a third and two thirds of a second of a completely
	   frozen page — no cursor change, no disabled button, nothing — and then a
	   new table. On a slower machine, or with the class-flavor dials pushed,
	   that is long enough to click twice.

	   The work cannot simply be moved off the main thread: js/worker.js exists
	   but the batch path is the only thing it can run, because the interactive
	   path needs the runner's staged state to live between calls and that state
	   is a graph of live objects, not a message. What CAN be fixed for free is
	   that the browser never got a chance to paint the "working" state before
	   the work started. beginBusy() sets it, and a double requestAnimationFrame
	   guarantees a frame is committed before the synchronous run begins — one
	   rAF fires before the paint, two fire after it.

	   Cheap, correct, and honest about what it is: the page still blocks, it
	   just no longer lies about blocking. */
	const BUSY_BUTTONS = ["btnReroll", "btnRerun", "btnExport", "btnExportMenu"];
	let busyDepth = 0;
	/* What the status line said before the busy message replaced it, so it can
	   be put back. Without this the busy text is simply left on screen: nothing
	   else writes the line on a plain run, and setStatus's own auto-hide timer
	   guards on `s.textContent === text`, which the busy message has already
	   made false — so "Generating the class…" stayed up for the rest of the
	   session, and any message written immediately BEFORE a run (bulkLockAsIs's
	   "Locked ovr on 3 prospects" is the one that matters) was wiped a frame
	   later and never seen. */
	let statusBeforeBusy = null;
	/* The message beginBusy wrote, so endBusy can tell "the line still says what
	   I put there" from "the work replaced it with something worth keeping". */
	let busyMessage = null;

	function beginBusy(what) {
		const s = $("status");
		if (!busyDepth) {
			statusBeforeBusy = { text: s.textContent, hidden: s.hidden };
		}
		busyDepth++;
		document.body.classList.add("busy");
		s.textContent = what;
		busyMessage = what;
		s.hidden = false;
		s.classList.add("working");
		for (const id of BUSY_BUTTONS) {
			const b = $(id);
			if (b) b.setAttribute("aria-busy", "true");
		}
	}

	function endBusy() {
		busyDepth = Math.max(0, busyDepth - 1);
		if (busyDepth) return;
		document.body.classList.remove("busy");
		const s = $("status");
		s.classList.remove("working");
		/* Restore, unless the work itself said something. A run that reports an
		   error, or a caller's `after` that reports a result, has written the
		   line during fn(); putting the previous message back would throw that
		   away. So restore only while the line still reads exactly what
		   beginBusy put on it. */
		if (statusBeforeBusy && s.textContent === busyMessage) {
			setStatus(statusBeforeBusy.hidden ? "" : statusBeforeBusy.text);
		}
		statusBeforeBusy = null;
		busyMessage = null;
		for (const id of BUSY_BUTTONS) {
			const b = $(id);
			if (b) b.removeAttribute("aria-busy");
		}
	}

	/* Show the busy state, let the browser paint it, then do the work.
	   Falls back to running inline where requestAnimationFrame does not exist
	   (a test harness), so run() is still safe to call synchronously. */
	function withBusy(what, fn) {
		if (typeof requestAnimationFrame !== "function") { fn(); return; }
		beginBusy(what);
		requestAnimationFrame(() => requestAnimationFrame(() => {
			try { fn(); } finally { endBusy(); }
		}));
	}

	/* `after` runs once the class exists. Everything that used to read
	   state.results on the line below run() has to go through it now, because
	   the work is deferred by a frame — see withBusy. */
	function run(after) {
		if (!state.files.length) return;
		withBusy("Generating the class…", () => {
			runNow();
			if (typeof after === "function") after();
		});
	}

	/* The header's seed pill and the browser tab title, for whichever result
	   is on screen. Split out of runNow because the universe chain has to
	   stamp it too — it produces the result the tabs are showing, and the pill
	   used to keep saying whatever the last standalone run had said. */
	function stampSeedPill(res, ms) {
		$("seedPill").hidden = false;
		/* A short hash OF THE CLASS, not of the seed. Two people can share a
		   seed and still be looking at different classes — a different source
		   file, a lock one of them set, a version of the tool with a different
		   model in it — and had no way to notice. Matching fingerprints mean
		   the same seventy players. */
		$("seedPill").textContent = "seed " + res.seed + " · " + classFingerprint(res);
		$("seedPill").dataset.seed = res.seed;
		/* The fingerprint and flavor in the tab title, so two browser tabs
		   comparing two classes are distinguishable from the tab strip. */
		document.title = classFingerprint(res) +
			(res.flavor && res.flavor.label ? " · " + res.flavor.label : "") +
			" — BBGM Draft Class Workshop";
		$("seedPill").title = "Seed and class fingerprint — two people with the same " +
			"fingerprint are looking at the same seventy players. " +
			"Click to copy the seed, shift-click or right-click to paste one" +
			(Number.isFinite(ms) ? " · " + Math.round(ms) + "ms (" +
				(res.phasesRun && res.phasesRun.length
					? res.phasesRun.join(" → ") : "nothing to redo") + ")" : "");
	}

	function runNow() {
		if (!state.files.length) return;
		/* Universe mode is a setting, not a tab. With it on, one file is one
		   season of a chain and running it alone would produce a world the
		   Timeline disagrees with, so the chain is what runs. It is async (a
		   season is ~330ms and fifty of them is a progress bar, not a click),
		   so this returns and the chain finishes the job. */
		if (state.cfg.universe && state.files.length && !state.universe.running) {
			state.results = new Array(state.files.length).fill(null);
			runUniverse();
			return;
		}
		let res;
		const t0 = performance.now();
		try {
			state.results = new Array(state.files.length).fill(null);
			res = state.runners[state.active].run(effectiveCfg());
			state.results[state.active] = res;
			state.lastSeed = res.seed;
			clearError();
		} catch (err) {
			showError(err);
			return;
		}
		const ms = performance.now() - t0;
		stampSeedPill(res, ms);
		if (state.history[0] !== res.seed) {
			state.history.unshift(res.seed);
			state.history = state.history.slice(0, 12);
			paintHistory();
		}
		writeHash();
		persist();
		/* The note text is only ever shown on the Notes tab, so a change that
		   rebuilt nothing but the notes does not need a 70-row table rebuilt
		   behind it. Everything else re-renders. */
		const notesOnly = res.phasesRun.length === 1 && res.phasesRun[0] === "notes";
		if (!(notesOnly && state.tab !== "notes")) render();
	}

	/* The seed history, with a way out of it.

	   Seeds accumulated to twelve and persisted, and the only way to remove a
	   stale one was to clear the site's storage — which also takes the
	   settings, the presets, the pinned class and the locks with it. The two
	   entries below are in the list itself rather than as extra buttons in a
	   header that is already full. */
	const HISTORY_FORGET = "\u0000forget";
	const HISTORY_CLEAR = "\u0000clear";

	function paintHistory() {
		const sel = $("seedHistory");
		sel.innerHTML = "";
		sel.appendChild(new Option("recent seeds…", ""));
		for (const s of state.history) sel.appendChild(new Option(s, s));
		if (state.history.length) {
			const sep = new Option("──────────", "");
			sep.disabled = true;
			sel.appendChild(sep);
			sel.appendChild(new Option(
				state.lastSeed && state.history.indexOf(state.lastSeed) !== -1
					? "forget “" + state.lastSeed + "”"
					: "forget the oldest seed",
				HISTORY_FORGET));
			sel.appendChild(new Option("clear the seed history", HISTORY_CLEAR));
		}
		sel.hidden = state.history.length < 2;
	}

	function historyCommand(value) {
		if (value === HISTORY_FORGET) {
			// The seed on screen if it is in the list, otherwise the oldest —
			// which is the one a user who just wants the list shorter means.
			const target = state.lastSeed &&
				state.history.indexOf(state.lastSeed) !== -1
				? state.lastSeed : state.history[state.history.length - 1];
			state.history = state.history.filter((s) => s !== target);
			persist();
			paintHistory();
			setStatus("Removed “" + target + "” from the seed history.");
			return true;
		}
		if (value === HISTORY_CLEAR) {
			const n = state.history.length;
			confirmDestructive(
				"Clear the seed history?",
				n + " seed" + (n === 1 ? "" : "s") + " will be forgotten. The " +
				"class you are looking at is not affected, and its seed is still " +
				"in the pill beside this menu.",
				"Clear " + n + " seeds",
				() => {
					state.history = [];
					persist();
					paintHistory();
					setStatus("Seed history cleared.");
				});
			paintHistory();
			return true;
		}
		return false;
	}

	function reroll() {
		const previous = state.lastSeed;
		pushUndo("rerolled the class");
		// Before the draw: the class being replaced is what the next one is
		// asked not to repeat. See rememberPool.
		rememberPool();
		state.cfg.seed = "";
		// Reroll is the only thing that changes a blank seed; everything else
		// keeps the class you are looking at.
		state.lastSeed = null;
		$("seed").value = "";
		// A reroll replaces every player, so an open editor showing the old one
		// is a stale panel over a class that no longer contains him.
		state.editing = null;
		state.selected = {};
		run(() => {
			const res = state.results[state.active];
			if (!res) {
				state.lastSeed = previous || null;
				return;
			}
			// The reroll's seed becomes the pinned one; the box stays blank so
			// the next reroll draws again.
			state.lastSeed = res.seed;
		});
	}

	/* ---------------------------------------------------------------- views */

	/* Grouped: nine flat peer tabs was the navigability complaint. The third
	   element is the group label the tab bar renders between clusters. */
	const TABS = [
		["players", "Prospects", "Class"],
		["board", "Draft board", "Class"],
		["compare", "Compare", "Class"],
		["distribution", "Distributions", "Class"],
		["teams", "AP Poll & Teams", "Season"],
		["bracket", "March Madness", "Season"],
		["awards", "Awards & leaders", "Season"],
		["news", "News", "Season"],
		["gamelog", "Game logs", "Season"],
		["notes", "Player notes", "Season"],
		["universe", "Universe", "Universe"],
	];

	/* ----------------------------------------------------------- universe */

	/* Run every loaded file as one continuous world, oldest season first,
	   handing carry-over state (conference map, program levels, coaches,
	   pool memory) from each season to the next. Asynchronous in slices so
	   the page stays alive; ~330ms a season means 50 classes is a progress
	   bar, not a click. */
	function runUniverse(after) {
		const U = global.Universe;
		if (!state.files.length) {
			setStatus("Load two or more class files to run a universe.");
			return;
		}
		if (state.universe.running) return;
		const diags = U.validate(state.files);
		state.universe.diags = diags;
		const runnable = diags.filter((d) => d.ok)
			.sort((a, b) => (a.season || 0) - (b.season || 0) || a.index - b.index);
		if (runnable.length < 1) {
			setStatus("No runnable files — see the Universe tab for per-file diagnostics.");
			state.tab = "universe";
			render();
			return;
		}
		const baseSeed = state.cfg.seed && state.cfg.seed.trim()
			? state.cfg.seed.trim()
			: "universe-" + Math.floor(Math.random() * 1e9);
		state.universe = {
			rows: [], threads: [], alumni: [], baseSeed, cfgs: {},
			running: true, diags, total: runnable.length, done: 0,
		};
		/* Only jump to the Timeline when the user asked for a universe
		   explicitly. With universe mode on as a SETTING the chain re-runs
		   whenever anything invalidates it, and stealing the tab every time
		   somebody moved a slider would make the tool unusable. */
		if (!state.cfg.universe) state.tab = "universe";
		render();
		/* PASS ONE: who is in every class, before any season is played.

		   The 2027 file's juniors were freshmen in 2025, and 2025 cannot put
		   them on its rosters without knowing who they are — class years,
		   colleges and builds are drawn in the build phase, from the seed and
		   the pool memory and nothing the season produces. So every file's
		   build phase runs first, in order (the pool memory chains through
		   it exactly as the full run will), and each earlier season is then
		   handed the underclassmen the later classes say were there. See
		   Engine.previewClass and Engine.futureRosterFor. */
		const previews = [];
		let previewPools = [];
		for (let k = 0; k < runnable.length; k++) {
			const d = runnable[k];
			let prev = null;
			try {
				const pcfg = CFG.make(state.cfg);
				pcfg.seed = baseSeed + "#" + (d.season || k);
				pcfg.overrides = {};
				pcfg.recentPools = previewPools.map((a) => a.slice());
				prev = global.Engine.previewClass(state.files[d.index].data, pcfg);
			} catch (e) {
				prev = null;
			}
			previews.push(prev);
			if (prev && prev.archetypePool) {
				previewPools.unshift(prev.archetypePool.slice());
				previewPools = previewPools.slice(0, 3);
			}
		}
		const rosterFor = (k) => {
			const season = runnable[k].season;
			if (!Number.isFinite(season)) return [];
			let out = [];
			for (let j = k + 1; j < runnable.length; j++) {
				if (!previews[j] || !(runnable[j].season > season)) continue;
				out = out.concat(global.Engine.futureRosterFor(
					previews[j], season, runnable[j].index));
			}
			return out;
		};
		let carry = null;
		let recentPools = [];
		const step = (k) => {
			if (k >= runnable.length) {
				state.universe.running = false;
				state.universe.threads = U.threads(state.universe.rows);
				/* PASS THREE: the seasons a player actually played, on his
				   own page. See linkCareers. */
				try { linkCareers(runnable); } catch (e) { showError(e); }
				persist();
				setStatus("Universe complete: " + state.universe.rows.length +
					" seasons, " + state.universe.threads.length + " threads.");
				/* The active file's seed pill and title describe the universe
				   run now, not a standalone re-simulation of it. */
				const active = state.results[state.active];
				if (active) stampSeedPill(active, null);
				render();
				if (typeof after === "function") after();
				return;
			}
			const d = runnable[k];
			try {
				const cfg = CFG.make(state.cfg);
				cfg.seed = baseSeed + "#" + (d.season || k);
				cfg.overrides = {};
				cfg.recentPools = recentPools.map((a) => a.slice());
				cfg.carryOver = carry;
				cfg.universeRoster = rosterFor(k);
				const res = state.runners[d.index].run(cfg);
				/* KEEP the result and the config that produced it. The chain
				   used to discard both, which is the whole of bug B1: every
				   other tab then re-simulated the file with no carry-over and
				   the base seed, and disagreed with the timeline it had just
				   drawn. */
				state.results[d.index] = res;
				state.universe.cfgs[d.index] = {
					seed: cfg.seed,
					carryOver: cfg.carryOver,
					recentPools: (cfg.recentPools || []).map((a) => a.slice()),
					universeRoster: cfg.universeRoster,
				};
				state.universe.rows.push(Object.assign(
					U.summarize(res, cfg.seed, d.name),
					{ fingerprint: state.files[d.index].fingerprint || null }));
				state.universe.alumni = state.universe.alumni
					.concat(U.alumniOf(res, d.season));
				carry = U.harvest(res);
				if (res.archetypePool) {
					recentPools.unshift(res.archetypePool.slice());
					recentPools = recentPools.slice(0, 3);
				}
			} catch (e) {
				state.universe.rows.push({
					season: d.season, fileName: d.name, seed: null,
					error: e && e.message ? e.message : String(e),
				});
			}
			state.universe.done = k + 1;
			setStatus("Universe: season " + (k + 1) + " of " + runnable.length + "…", true);
			render();
			setTimeout(() => step(k + 1), 0);
		};
		setTimeout(() => step(0), 0);
	}

	function exportUniverse(embedFiles) {
		const U = global.Universe;
		if (!state.universe.rows.length) {
			setStatus("Build a timeline first.");
			return;
		}
		/* Settings and biographies travel with the seeds now. A universe is
		   only reproducible if the settings it ran under are part of it —
		   replaying somebody's fifty-season world at your own coachTurnover
		   and your own era gives you a different world with the same seeds. */
		const payload = U.exportUniverse(Object.assign({}, state.universe, {
			settings: CFG.make(state.cfg),
			biography: U.biographyOf(state.results.filter(Boolean)),
		}), { embedFiles: !!embedFiles, files: state.files });
		const blob = new Blob([JSON.stringify(payload, null, "\t")],
			{ type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = embedFiles ? "universe-with-classes.json" : "universe.json";
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 5000);
		setStatus(embedFiles
			? "Exported the universe with its class files embedded."
			: "Exported the universe (seeds and settings; load the class files beside it).");
	}

	/* Re-import: a universe file carries seeds and file fingerprints, not
	   output. With the same class files loaded, replaying it reproduces the
	   same world exactly — that is what determinism buys. */
	function importUniverse(json) {
		if (!json || json.format !== "bbgm-draft-workshop/universe") {
			showError(new Error("Not a universe export."));
			return;
		}
		/* An embedded universe carries its own classes, so there is nothing to
		   go and find. */
		if (Array.isArray(json.files) && json.files.length) {
			const loaded = [];
			const problems = [];
			for (const f of json.files) {
				if (!f || !f.data) continue;
				try {
					const check = global.Engine.validateLeagueFile(f.data);
					loaded.push({ name: f.name || "embedded.json", data: f.data,
						warnings: check.warnings });
				} catch (e) {
					problems.push((f.name || "embedded file") + ": " +
						(e && e.message ? e.message : String(e)));
				}
			}
			if (loaded.length) installFiles(loaded, problems);
		}
		const have = new Set(state.files.map((f) => f.fingerprint));
		const missing = (json.seasons || []).filter(
			(s) => s.fingerprint && !have.has(s.fingerprint));
		/* PARTIAL IMPORT. Refusing outright was the wrong call: a fifty-season
		   universe whose 2031 class the user does not have is still forty-nine
		   seasons they can replay, and the old behaviour was to import none of
		   it and name the missing file. Now the seasons that are present run
		   and the ones that are not are reported. */
		if (missing.length && missing.length >= (json.seasons || []).length) {
			showError(new Error("None of this universe's class files are loaded. " +
				"Load them first: " + missing.map((m) => m.fileName).join(", ")));
			return;
		}
		/* The settings the universe was built under, if it carries them. A
		   version 1 export does not, and replaying it under the current
		   settings is the best that can be done — which is said out loud
		   rather than silently producing a different world. */
		let note = "";
		if (json.settings) {
			const seed = json.settings.seed;
			state.cfg = CFG.make(json.settings);
			state.cfg.seed = seed || state.cfg.seed;
			note = " Settings from the file were applied.";
		} else {
			note = " This export predates settings capture (version " +
				(json.version || 1) + "), so it replays under your current settings.";
		}
		state.cfg.universe = true;
		state.cfg.seed = json.baseSeed || state.cfg.seed;
		$("seed").value = state.cfg.seed;
		paintConfig();
		if (missing.length) {
			setStatus("Replaying " +
				((json.seasons || []).length - missing.length) + " of " +
				(json.seasons || []).length + " seasons — not loaded: " +
				missing.map((m) => m.fileName).join(", ") + "." + note);
		} else {
			setStatus("Replaying " + (json.seasons || []).length + " seasons." + note);
		}
		runUniverse();
	}

	/* ------------------------------------------------------------ routing */

	/* Player and team pages are real destinations: back/forward work, and a
	   page survives a refresh (state.player/state.team persist). The heavy
	   settings+seed payload stays in the hash exactly as before — this rides
	   on pushState so the two never fight over the URL. */
	function navState() {
		return {
			tab: state.tab, team: state.team || null, player: state.player || null,
			game: state.game || null,
		};
	}

	function pushNav() {
		try {
			history.pushState(Object.assign({ bbgmNav: true }, navState()), "");
		} catch (e) { /* file:// in some browsers */ }
	}

	function showPlayer(key) {
		state.player = key || null;
		if (key) state.tab = "players";
		pushNav();
		persist();
		render();
	}

	function showTeam(name) {
		state.team = name || null;
		// A team page and a box score are two destinations, not one nested in
		// the other: opening a team clears whatever game was open.
		state.game = null;
		if (name) state.tab = "teams";
		pushNav();
		persist();
		render();
	}

	function showGame(ref) {
		state.game = ref || null;
		if (ref) state.tab = "teams";
		pushNav();
		persist();
		render();
	}

	window.addEventListener("popstate", (e) => {
		const st = e.state;
		if (!st || !st.bbgmNav) return;
		state.tab = st.tab || state.tab;
		state.team = st.team;
		state.player = st.player;
		state.game = st.game || null;
		render();
	});

	function render() {
		const tabs = $("tabs");
		tabs.innerHTML = "";
		tabs.setAttribute("role", "tablist");
		let lastGroup = null;
		TABS.forEach(([key, label, group], i) => {
			if (group !== lastGroup) {
				tabs.appendChild(el("span", "tabgroup", group));
				lastGroup = group;
			}
			const b = el("button", key === state.tab ? "active" : "", label);
			b.setAttribute("role", "tab");
			b.setAttribute("aria-selected", key === state.tab ? "true" : "false");
			b.tabIndex = key === state.tab ? 0 : -1;
			b.addEventListener("click", () => { state.tab = key; persist(); render(); });
			b.addEventListener("keydown", (e) => {
				const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
				if (!d) return;
				e.preventDefault();
				state.tab = TABS[(i + d + TABS.length) % TABS.length][0];
				render();
				const next = tabs.querySelector("button.active");
				if (next) next.focus();
			});
			tabs.appendChild(b);
		});
		const view = $("view");
		/* Every interaction rebuilds this view from scratch — clicking a row to
		   open the editor, ticking a sort level, typing in a filter. With a
		   sticky name column and forty columns that threw the user back to the
		   left edge of the table on every single edit, which was the most-felt
		   defect in the tool.

		   Rebuilding is kept (it is what makes the render function simple and
		   correct), but the two pieces of state a rebuild destroys and the
		   browser cannot restore — where the scroll containers were, and what
		   was focused with what selected — are carried across it. Scroll
		   positions are keyed by the container's position in the view, so they
		   survive a rebuild that produces the same shape and are simply not
		   found when it does not. */
		const scrolls = captureScroll(view);
		const focus = captureFocus(view);
		view.innerHTML = "";
		const res = ensureResult(state.active);
		if (!res) return;
		// The archetype editor reports what the last run actually produced, so
		// it has to be repainted when there is a new run to report.
		paintArchWeights();
		(V[state.tab] || V.players)(view, res);
		restoreScroll(view, scrolls);
		restoreFocus(view, focus);
	}

	const SCROLLERS = ".scroll, .tablewrap, .drawer";

	function captureScroll(view) {
		const out = [];
		view.querySelectorAll(SCROLLERS).forEach((n, i) => {
			if (n.scrollLeft || n.scrollTop) out.push([i, n.scrollLeft, n.scrollTop]);
		});
		return { list: out, page: view.scrollTop, win: global.scrollY || 0 };
	}

	function restoreScroll(view, saved) {
		if (!saved) return;
		const nodes = view.querySelectorAll(SCROLLERS);
		for (const [i, left, top] of saved.list) {
			const n = nodes[i];
			if (!n) continue;
			n.scrollLeft = left;
			n.scrollTop = top;
		}
		if (saved.page) view.scrollTop = saved.page;
		if (saved.win) global.scrollTo(0, saved.win);
	}

	/* What was focused, and where the caret was in it.

	   Identified by an explicit data-focus key when the element has one and by
	   its index among focusables otherwise, so a rebuilt node gets the focus
	   back rather than the document body taking it — which is what made every
	   filter keystroke a fight. */
	function captureFocus(view) {
		const a = document.activeElement;
		if (!a || !view.contains(a)) return null;
		const key = a.getAttribute("data-focus");
		const all = Array.prototype.slice.call(
			view.querySelectorAll("input, select, textarea, button, [tabindex]"));
		const sel = {};
		try {
			if (a.selectionStart !== undefined && a.selectionStart !== null) {
				sel.start = a.selectionStart;
				sel.end = a.selectionEnd;
			}
		} catch (e) { /* selection is not available on every input type */ }
		return { key, index: all.indexOf(a), sel };
	}

	function restoreFocus(view, saved) {
		if (!saved) return;
		let node = null;
		if (saved.key) node = view.querySelector('[data-focus="' + saved.key + '"]');
		if (!node && saved.index >= 0) {
			node = view.querySelectorAll(
				"input, select, textarea, button, [tabindex]")[saved.index] || null;
		}
		if (!node) return;
		try {
			node.focus({ preventScroll: true });
			if (saved.sel && saved.sel.start !== undefined &&
				node.setSelectionRange && node.type !== "number") {
				node.setSelectionRange(saved.sel.start, saved.sel.end);
			}
		} catch (e) { /* focus can be refused; not worth an error */ }
	}

	/* The selection count lives in the bulk bar, so ticking a row has to
	   refresh it. Only that bar is rebuilt — not the whole table. */
	function refreshBulkBar() {
		const old = document.getElementById("bulkBar");
		const res = state.results[state.active];
		if (!old || !res) return;
		const fresh = global.Views.bulkBar(res);
		old.replaceWith(fresh);
	}

	/* ----------------------------------------------------- per-player editor */

	/* Shared with the lock badge in the table, so clearing a lock does not
	   require a round trip into the editor and back. */
	function clearLock(p) {
		if (!state.overrides[p.key]) return;
		pushUndo("cleared the lock on " + p.name);
		delete state.overrides[p.key];
		run();
	}

	function openEditor(p) {
		state.editing = state.editing === p.key ? null : p.key;
		render();
	}

	/* Show a specific prospect in the prospect table: clear whatever filter is
	   hiding him, open his editor and scroll his row into view.

	   Sending the user to the Prospects tab is not the same as showing them the
	   player. The table keeps a search, a position filter, a conference filter,
	   an archetype filter and any number of numeric ranges, and every one of
	   them can be hiding the man whose game log is on screen — so "back to the
	   table" without this lands on a table he is not in. */
	/* The prospects the table is showing, in the order it is showing them.
	   The Compare tab's "what the table shows" reads this, so a comparison can
	   follow a filter and a sort the user has already set up rather than
	   re-specifying both in a dropdown. */
	function visibleRows() {
		const res = state.results[state.active];
		if (!res) return [];
		const shown = res.players.filter((p) => V.matchesFilter(p, res));
		// sortRows needs the sortVals the table builds, which only exist after
		// a render; fall back to the board order, which is what the table shows
		// by default anyway.
		return shown.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
	}

	function revealPlayer(p) {
		if (!p) return;
		const f = state.filter;
		const hidden = !V.matchesFilter(p, state.results[state.active] || {});
		if (hidden) {
			state.filter = {
				q: "", pos: "", conf: "", archetype: "",
				changedOnly: false, lockedOnly: false, ranges: [],
			};
			setStatus("Cleared the table filters to show " + p.name + ".");
		}
		void f;
		state.editing = p.key;
		render();
		// After the render, because the row does not exist until then.
		requestAnimationFrame(() => {
			const row = document.querySelector(
				'tr[data-pkey="' + cssEscape(p.key) + '"]');
			if (!row) return;
			if (row.scrollIntoView) row.scrollIntoView({ block: "center" });
			row.tabIndex = 0;
			try { row.focus(); } catch (e) { /* not focusable in this layout */ }
		});
	}

	function editorPanel(p, res) {
		const panel = el("div", "editor");
		const head = el("div", "rowflex");
		head.appendChild(el("h3", null,
			p.name + " — " + p.newPos + " · " + p.newOvr + "/" + p.newPot +
			(p.boardRank ? " · board No. " + p.boardRank : "")));
		const close = el("button", null, "Close");
		close.addEventListener("click", () => { state.editing = null; render(); });
		head.appendChild(close);
		panel.appendChild(head);

		const ov = state.overrides[p.key] || {};

		/* engine.js carefully worked out that a locked overall was unreachable
		   for this player's height and stored it in p.lockUnreachable "so an
		   impossible lock can be reported instead of quietly ignored". Nothing
		   read it, so the editor just showed a different number. */
		if (p.lockUnreachable) {
			const u = p.lockUnreachable;
			panel.appendChild(el("div", "warnbox",
				"You asked for overall " + u.asked + ", but at " + p.newHgtInches +
				" inches this build can only reach " + u.range.min + "–" + u.range.max +
				". He came out at " + u.got + ". Height is never shifted, so a very " +
				"tall or very short player has a real floor and ceiling."));
		}
		// The achievable range used to live here, as a sentence above the form.
		// It belongs on the input it constrains — see the Overall field below.

		const grid = el("div", "editgrid");
		const controls = {};
		/* Every lock is opt-in. "Apply lock" used to write BOTH ovr and pot
		   unconditionally, so there was no way to lock only the archetype or
		   only the school without also freezing two numbers you did not mean
		   to touch. */
		const field = (key, label, node, current, unit) => {
			const w = el("div", "ctl");
			const row = el("div", "lockrow");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = ov[key] !== undefined && ov[key] !== null;
			cb.id = "lock-" + key;
			cb.setAttribute("aria-label", "Lock " + label);
			const l = el("label", null, label);
			l.htmlFor = cb.id;
			l.style.margin = "0";
			row.appendChild(cb);
			row.appendChild(l);
			/* Per-field revert. Ctrl+Z undid the last whole change; there was
			   no way to say "put this one box back" short of remembering what
			   was in it. */
			const revert = el("button", "tiny", "↺");
			revert.type = "button";
			revert.title = "Put this field back to what the generator produced";
			revert.setAttribute("aria-label", "Revert " + label);
			revert.addEventListener("click", () => {
				if (node.tagName === "SELECT") node.value = "";
				else node.value = current === undefined || current === null ? "" : String(current);
				cb.checked = false;
			});
			row.appendChild(revert);
			w.appendChild(row);
			w.appendChild(node);
			if (unit) w.appendChild(el("p", "unit", unit));
			grid.appendChild(w);
			node.addEventListener("input", () => { cb.checked = true; });
			node.addEventListener("change", () => { cb.checked = true; });
			controls[key] = { cb, node, current };
			return node;
		};

		const ovrIn = el("input");
		ovrIn.type = "number";
		/* The achievable range, on the input itself and BEFORE you type into
		   it. engine.js worked it out either way; it was only ever reported
		   after the fact, once the ask had already been silently clamped. */
		if (p.ovrRange) {
			ovrIn.min = p.ovrRange.min;
			ovrIn.max = p.ovrRange.max;
		} else {
			ovrIn.min = 0;
			ovrIn.max = 100;
		}
		ovrIn.value = Number.isFinite(ov.ovr) ? ov.ovr : p.newOvr;
		field("ovr", "Overall", ovrIn, p.newOvr, p.ovrRange
			? "reaches " + p.ovrRange.min + "–" + p.ovrRange.max +
				" at " + V.feet(p.newHgtInches)
			: null);

		const potIn = el("input");
		potIn.type = "number";
		potIn.min = 0;
		potIn.max = 100;
		potIn.value = Number.isFinite(ov.pot) ? ov.pot : p.newPot;
		field("pot", "Potential", potIn, p.newPot);

		const archSel = el("select");
		archSel.appendChild(new Option("(roll it)", ""));
		/* Gate on the height the build ACTUALLY uses. With Vary size on, the
		   rebuild works from a shifted hgt rating, so a list filtered on
		   origRatings.hgt offered the wrong archetypes at the boundaries. */
		const buildHgt = p.newRatings ? p.newRatings.hgt : p.origRatings.hgt;
		for (const a of RB.ARCHETYPES) {
			if (buildHgt < a.min || buildHgt > a.max) continue;
			const opt = new Option(a.name, a.name);
			opt.title = archetypeTooltip(a);
			archSel.appendChild(opt);
		}
		archSel.value = ov.archetype || "";
		field("archetype", "Archetype", archSel, "");

		const colSel = el("select");
		colSel.appendChild(new Option("(roll it)", ""));
		for (const name of C.names.concat(Object.keys(C.NON_NCAA)).sort()) {
			colSel.appendChild(new Option(name, name));
		}
		colSel.value = ov.college || "";
		field("college", "School / league", colSel, "");

		const nameIn = el("input");
		nameIn.type = "text";
		nameIn.value = ov.name || p.name;
		field("name", "Name", nameIn, p.name);

		const hgtIn = el("input");
		hgtIn.type = "number";
		hgtIn.min = 58;
		hgtIn.max = 96;
		hgtIn.value = Number.isFinite(ov.hgtInches) ? ov.hgtInches : p.newHgtInches;
		field("hgtInches", "Listed height (inches)", hgtIn, p.newHgtInches,
			"listed weight " + p.newWeight + " lb");
		panel.appendChild(grid);

		/* Individual ratings. Sometimes you just want to bump one guy's tp to
		   70, and there was no way to say so. A hand-set rating is pinned: the
		   solver leaves it alone and finds the target overall from the others. */
		panel.appendChild(el("h4", null, "Individual ratings (blank = let the solver decide)"));
		const rgrid = el("div", "ratinggrid");
		const ratingInputs = {};
		for (const k of BB.RATING_KEYS) {
			const cell = el("div");
			const lab = el("label", null, k);
			lab.htmlFor = "rating-" + k;
			const inp = el("input");
			inp.type = "number";
			inp.id = "rating-" + k;
			inp.min = 0;
			inp.max = 100;
			inp.placeholder = String(p.newRatings[k]);
			const pinnedVal = ov.ratings && Number.isFinite(ov.ratings[k]) ? ov.ratings[k] : "";
			inp.value = pinnedVal === "" ? "" : String(pinnedVal);
			if (pinnedVal !== "") cell.className = "changed";
			if (k === "hgt") {
				inp.disabled = true;
				inp.title = "Height comes from the listed height above.";
			}
			ratingInputs[k] = inp;
			cell.appendChild(lab);
			cell.appendChild(inp);
			rgrid.appendChild(cell);
		}
		panel.appendChild(rgrid);

		const buttons = el("div", "rowflex");
		const apply = el("button", "primary", "Apply lock");
		apply.addEventListener("click", () => {
			pushUndo("locked " + p.name);
			const next = {};
			if (controls.ovr.cb.checked) next.ovr = Number(ovrIn.value);
			if (controls.pot.cb.checked) next.pot = Number(potIn.value);
			if (controls.archetype.cb.checked && archSel.value) next.archetype = archSel.value;
			if (controls.college.cb.checked && colSel.value) next.college = colSel.value;
			if (controls.name.cb.checked && nameIn.value.trim()) next.name = nameIn.value.trim();
			if (controls.hgtInches.cb.checked) next.hgtInches = Number(hgtIn.value);
			const ratings = {};
			for (const k of BB.RATING_KEYS) {
				const raw = ratingInputs[k].value;
				if (raw !== "" && Number.isFinite(Number(raw))) ratings[k] = Number(raw);
			}
			if (Object.keys(ratings).length) next.ratings = ratings;
			// A per-player reroll is not a lock, but it is state: keep it.
			if (Number(ov.reroll)) next.reroll = Number(ov.reroll);
			if (!Object.keys(next).length) delete state.overrides[p.key];
			else state.overrides[p.key] = next;
			state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
			run();
		});
		buttons.appendChild(apply);
		const clear = el("button", null, "Clear lock");
		clear.addEventListener("click", () => clearLock(p));
		buttons.appendChild(clear);
		/* Reroll one player. It was the whole class or nothing: if you liked
		   sixty-nine of them and wanted one more look at the seventieth, the
		   only move was to reroll everybody and lock the sixty-nine first.

		   The trick is that every RNG stream is keyed off the player's key, so
		   giving him a salt gives him a different draw and leaves everybody
		   else's stream untouched. */
		const rerollAxis = (key, label, title) => {
			const b = el("button", null, label);
			b.title = title;
			b.addEventListener("click", () => {
				pushUndo(key ? "rerolled " + p.name + "'s " + key : "rerolled " + p.name);
				const cur = state.overrides[p.key] || {};
				const next = Object.assign({}, cur);
				const field = key ? "reroll_" + key : "reroll";
				next[field] = (Number(cur[field]) || 0) + 1;
				state.overrides[p.key] = next;
				state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
				run();
			});
			buttons.appendChild(b);
			return b;
		};
		rerollAxis(null, "Reroll just him",
			"Draw this prospect again. Nobody else in the class moves.");
		/* One axis at a time. Rerolling the whole player is a blunt instrument:
		   the thing you usually want is this build at a different school, or
		   this school with a different build, or the same player with the stat
		   noise redrawn. Each axis has its own counter, so the streams it does
		   not name are untouched. */
		rerollAxis("build", "↻ build",
			"Redraw his archetype and ratings. Same school, same season.");
		/* Only where the tool actually chooses the school. A player whose
		   college is in the league file keeps it — that is the whole point of
		   the college assignment — so the button would be a no-op, and a button
		   that does nothing is worse than no button. */
		const schoolIsOurs = !p.origCollege || !String(p.origCollege).trim();
		const sb = rerollAxis("school", "↻ school",
			schoolIsOurs
				? "Send him somewhere else. Same build."
				: "His school comes from the league file, so there is nothing to redraw. " +
					"Lock a school in the field above to move him.");
		if (!schoolIsOurs) sb.disabled = true;
		rerollAxis("stats", "↻ season",
			"Same player, a different set of nights.");
		panel.appendChild(buttons);

		panel.appendChild(el("h4", null, "Why this player looks like this"));
		const why = el("div", "note");
		const s = p.stats;
		const team = res.teams[p.newCollege];
		why.textContent = [
			"Archetype: " + p.archetype + (ov.archetype ? " (locked)" : "") +
				" — offsets are made ovr-neutral before the solver runs, so the",
			"  build changed his shape, not his overall.",
			res.flavor && res.flavor.name !== "balanced"
				? "Class flavor: " + res.flavor.label + " (archetype weights are tilted this year)"
				: "",
			"Overall: " + p.origOvr + " → " + p.newOvr +
				(state.cfg.ovrMode === "curve" ? " (re-dealt along the class curve)" : " (preserved)"),
			"Potential: " + p.origPot + " → " + p.newPot,
			p.potFactors ? potExplain(p) : "",
			"College: " + (p.origCollege || "(none in file)") + " → " + p.newCollege +
				(p.collegeChanged ? " (reassigned)" : ""),
			"Class year: " + p.classYear +
				(p.transfer ? " · " + p.transfer.kind + " from " + p.transfer.from : "") +
				(p.redshirt ? " · " + p.redshirt : "") +
				(p.reclassified ? " · " + p.reclassified : ""),
			p.recruiting ? "Recruiting: " + p.recruiting.stars + "-star, No. " +
				p.recruiting.rank + " nationally" +
				(p.recruiting.headliner ? ", headline signing of his class" : "") : "",
			s ? "Stat line comes from " + n1(s.mpg) + " MPG at USG " + pc(s.usg) +
				"% on a team rated " + (team ? team.rating.toFixed(1) : "—") : "",
			s && team && team.oppDefense
				? "Opponents faced: rim defense " + (team.oppDefense.rim >= 0 ? "+" : "") +
					(team.oppDefense.rim * 100).toFixed(1) + ", perimeter " +
					(team.oppDefense.perimeter >= 0 ? "+" : "") +
					(team.oppDefense.perimeter * 100).toFixed(1) : "",
			p.shareOf ? "Share of his team: " + pc(p.shareOf.pts) + "% of points, " +
				pc(p.shareOf.ast) + "% of assists, " + pc(p.shareOf.reb) + "% of rebounds" : "",
		].filter(Boolean).join("\n");
		panel.appendChild(why);

		panel.appendChild(el("h4", null, "Ratings: original → rebuilt"));
		const dw = el("div", "scroll");
		const dt = el("table");
		const dh = el("thead");
		const dhr = el("tr");
		dhr.appendChild(el("th", null, ""));
		for (const k of BB.RATING_KEYS) dhr.appendChild(el("th", "num", k));
		dh.appendChild(dhr);
		dt.appendChild(dh);
		const db = el("tbody");
		for (const [label, r] of [["original", p.origRatings], ["rebuilt", p.newRatings]]) {
			const tr = el("tr");
			tr.appendChild(el("td", null, label));
			for (const k of BB.RATING_KEYS) tr.appendChild(el("td", "num", String(r[k])));
			db.appendChild(tr);
		}
		const dtr = el("tr");
		dtr.appendChild(el("td", null, "change"));
		for (const k of BB.RATING_KEYS) {
			const d = p.newRatings[k] - p.origRatings[k];
			dtr.appendChild(el("td", "num " + (d > 0 ? "up" : d < 0 ? "down" : ""),
				d === 0 ? "" : (d > 0 ? "+" : "") + d));
		}
		db.appendChild(dtr);
		dt.appendChild(db);
		dw.appendChild(dt);
		panel.appendChild(dw);
		panel.appendChild(explainStats(p, res));
		panel.appendChild(explainBoard(p));
		panel.appendChild(priorSeasonsPanel(p, res));
		return panel;
	}

	/* Where this stat line came from.

	   Every input already existed on teamCtx and none of it surfaced, so the
	   answer to "why does this 45-overall prospect score seven points" was
	   unavailable inside the tool that produced the seven points — you had to
	   instrument the engine to find out. It is minutes, then share of the
	   offense, then the pace of the team he plays for, then the defenses he
	   faced, and every one of those is a number the sim already computed. */
	function explainStats(p, res) {
		const box = el("details", "explain");
		box.appendChild(el("summary", null, "Where this stat line comes from"));
		const s = p.stats;
		if (!s) {
			box.appendChild(el("p", "hint", "He did not play a season."));
			return box;
		}
		const t = res.teams[p.newCollege];
		const dl = el("dl", "shortcuts");
		const row = (k, v) => {
			dl.appendChild(el("dt", null, k));
			dl.appendChild(el("dd", null, v));
		};
		const n1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");
		row("Minutes", n1(s.mpg) + " a game over " + Math.round(s.gp) + " games" +
			(p.availability ? ", missing " + p.availability.games + " with " +
				p.availability.kind : ""));
		row("Share of the offense", (s.usg * 100).toFixed(1) + "% of his team's " +
			"chances while on the floor (" + (s.usgShare * 100).toFixed(1) +
			"% of all of them)");
		if (t) {
			row("Team tempo", n1(t.pace) + " possessions a game" +
				(t.style ? " — " + t.style.name : ""));
			row("Program", t.name + ", level " + Math.round(t.level) +
				", " + t.w + "-" + t.l +
				(t.coach ? " under " + t.coach.name + " (year " + t.coach.tenure + ")" : ""));
			if (t.oppDefense) {
				const d = t.oppDefense;
				const say = (v) => (v > 0.01 ? "tougher" : v < -0.01 ? "softer" : "average");
				row("Defenses faced", "at the rim " + say(d.rim) +
					", on the perimeter " + say(d.perimeter) +
					" than an average schedule");
			}
		}
		row("Shot mix", n1(s.fga) + " field goals, " + n1(s.tpa) + " of them threes, " +
			n1(s.fta) + " free throws");
		row("Efficiency", (s.ts * 100).toFixed(1) + "% true shooting on " +
			(s.fgp * 100).toFixed(1) + "% from the floor");
		row("The arithmetic", n1(s.fga - s.tpa) + " twos at " +
			(((s.fgp * s.fga - s.tpa * s.tpp) / Math.max(0.01, s.fga - s.tpa)) * 100)
				.toFixed(1) + "%, " +
			n1(s.tpa) + " threes at " + (s.tpp * 100).toFixed(1) + "%, " +
			n1(s.fta) + " free throws at " + (s.ftp * 100).toFixed(1) + "% = " +
			n1(s.ppg) + " points");
		box.appendChild(dl);
		return box;
	}

	/* Why he is where he is on the board. stockScore is six terms and the board
	   showed only the answer, so a prospect twelve places above where his
	   production said he should be had no explanation attached to him — the
	   potential tooltip already does exactly this for potential. */
	function explainBoard(p) {
		const box = el("details", "explain");
		box.appendChild(el("summary", null,
			"Why he is at No. " + (p.boardRank || "—") + " on the board"));
		if (!Number.isFinite(p.stockScore)) {
			box.appendChild(el("p", "hint", "No board score for this player."));
			return box;
		}
		const prod = p.stats ? (global.Awards.productionScore(p) || 0) : 0;
		const march = p.gameLog && p.gameLog.postseason
			? p.gameLog.postseason.ppg * 0.16 * Math.min(6, p.gameLog.postseason.gp)
			: 0;
		const terms = [
			["Overall rating", p.newOvr * 1.25],
			["Room to grow (pot − ovr)", (p.newPot - p.newOvr) * 0.65],
			["Production", prod * 0.30],
			["Awards (" + (p.awards || []).length + ")", (p.awards || []).length * 0.55],
			["March", march],
			["Played outside D-I", p.nonNcaa ? -1.2 : 0],
		];
		const known = terms.reduce((a, [, v]) => a + v, 0);
		terms.push(["Scouting noise", p.stockScore - known]);
		const dl = el("dl", "shortcuts");
		for (const [k, v] of terms) {
			if (Math.abs(v) < 0.05) continue;
			dl.appendChild(el("dt", null, (v > 0 ? "+" : "") + v.toFixed(1)));
			dl.appendChild(el("dd", null, k));
		}
		box.appendChild(dl);
		box.appendChild(el("p", "hint",
			"Total " + p.stockScore.toFixed(1) + ". Preseason he was No. " +
			p.preseasonRank + "; he has moved " +
			(p.stockMove > 0 ? "up " + p.stockMove : p.stockMove < 0
				? "down " + -p.stockMove : "not at all") + "."));
		return box;
	}

	/* The seasons before this one. Fabricated, and labeled as such — but "he
	   averaged 4, then 9, then 16" is a completely different scouting report
	   from "he averaged 16", and the tool had no way to say the first one. */
	function priorSeasonsPanel(p, res) {
		const box = el("details", "explain");
		box.appendChild(el("summary", null, "Career to date"));
		const rows = p.priorSeasons || [];
		if (!rows.length && !p.stats) {
			box.appendChild(el("p", "hint", "No season to show."));
			return box;
		}
		const table = el("table", "mini");
		const head = el("tr");
		// Overall is on the earlier rows now, because a simulated prior season
		// is a season of a DIFFERENT player: the number is the point.
		for (const h of ["Season", "Team", "Ovr", "GP", "MPG", "PPG", "RPG", "APG", "TS%", "Highs"]) {
			head.appendChild(el("th", null, h));
		}
		table.appendChild(head);
		const line = (season, team, r, now) => {
			const tr = el("tr", now ? "now" : "");
			tr.appendChild(el("td", null, String(season)));
			tr.appendChild(el("td", null, team));
			if (r.redshirt) {
				const td = el("td", null, r.reason || "redshirt");
				td.colSpan = 8;
				tr.appendChild(td);
				return tr;
			}
			tr.appendChild(el("td", "num",
				Number.isFinite(r.ovr) ? String(r.ovr) : (now ? String(p.newOvr) : "—")));
			tr.appendChild(el("td", "num", String(Math.round(r.gp))));
			for (const k of ["mpg", "ppg", "rpg", "apg"]) {
				tr.appendChild(el("td", "num", r[k].toFixed(1)));
			}
			tr.appendChild(el("td", "num", (r.ts * 100).toFixed(1)));
			const hi = now ? (p.gameLog && p.gameLog.highs) : r.highs;
			tr.appendChild(el("td", null, hi ? hi.pts + "/" + hi.reb + "/" + hi.ast : "—"));
			return tr;
		};
		for (const r of rows) table.appendChild(line(r.season, r.team, r, false));
		if (p.stats) {
			table.appendChild(line(res.season, p.proClub || p.newCollege, p.stats, true));
		}
		box.appendChild(table);
		if (rows.length) {
			const simulated = rows.some((r) => r.simulated);
			box.appendChild(el("p", "hint", simulated
				? "Earlier seasons are simulated: the same stat model, the player " +
					"at the ratings he had then, and a rotation with the men he " +
					"was behind actually on it. Nothing in the tool ranks on them."
				: "Earlier seasons are reconstructed by the model, not simulated — " +
					"the same way the recruiting ranking and the transfer history " +
					"are. Nothing in the tool ranks on them."));
		}
		return box;
	}

	function potExplain(p) {
		const f = p.potFactors;
		const bits = [];
		const add = (label, v) => {
			if (Math.abs(v) < 0.3) return;
			bits.push(label + " " + (v > 0 ? "+" : "") + v.toFixed(1));
		};
		add("archetype", f.arch);
		add("age", f.age);
		add("age in class", f.ageClass);
		add("shooting touch (FT%)", f.touch);
		add("frame", f.frame);
		add("role vs production", f.role);
		add("your bias slider", f.bias || 0);
		return "  potential built from: " + (bits.length ? bits.join(", ") : "nothing notable");
	}

	/* --------------------------------------------------------------- bulk */

	function bulkTargets() {
		return Object.keys(state.selected);
	}

	function bulkApply(patch, label) {
		const keys = bulkTargets();
		if (!keys.length) return;
		pushUndo(label);
		for (const key of keys) {
			state.overrides[key] = Object.assign({}, state.overrides[key] || {}, patch);
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		run();
	}

	function bulkShiftOvr(d) {
		const keys = bulkTargets();
		if (!keys.length) return;
		const res = state.results[state.active];
		pushUndo("shifted overall by " + d + " for " + keys.length + " prospects");
		for (const key of keys) {
			const p = res.players.filter((x) => x.key === key)[0];
			if (!p) continue;
			const base = Number.isFinite((state.overrides[key] || {}).ovr)
				? state.overrides[key].ovr : p.newOvr;
			state.overrides[key] = Object.assign({}, state.overrides[key] || {},
				{ ovr: Math.max(0, Math.min(100, base + d)) });
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		run();
	}

	/* Freeze what the selection already is. `bulkApply` sets a field to a value
	   the user chose, which cannot express "keep these exactly as they are" —
	   the value is different for every player. */
	function bulkLockAsIs(what) {
		const keys = bulkTargets();
		if (!keys.length) return;
		const res = state.results[state.active];
		if (!res) return;
		const nameOf = {
			all: "everything", ovr: "overall", archetype: "the archetype",
			college: "the school",
		};
		pushUndo("locked " + (nameOf[what] || what) + " on " + keys.length + " prospects");
		for (const key of keys) {
			const p = res.players.filter((x) => x.key === key)[0];
			if (!p) continue;
			const patch = {};
			if (what === "all" || what === "ovr") patch.ovr = p.newOvr;
			if (what === "all" || what === "archetype") patch.archetype = p.archetype;
			if (what === "all" || what === "college") patch.college = p.newCollege;
			state.overrides[key] = Object.assign({}, state.overrides[key] || {}, patch);
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		run(() => setStatus("Locked " + (nameOf[what] || what) + " on " + keys.length +
			" prospect" + (keys.length === 1 ? "" : "s") +
			" — a reroll now leaves them alone."));
	}

	function bulkClear() {
		const keys = bulkTargets();
		if (!keys.length) return;
		const locked = keys.filter((k) => state.overrides[k]);
		if (!locked.length) {
			setStatus("None of the selected prospects is locked.");
			return;
		}
		const go = () => {
			pushUndo("cleared locks on " + locked.length + " prospects");
			for (const key of keys) delete state.overrides[key];
			run();
		};
		/* One lock is a click to put back. Wiping the whole class's worth of
		   editing is not, and the button that does it sits next to the one that
		   clears a selection. */
		if (locked.length < 5) { go(); return; }
		confirmDestructive(
			"Clear " + locked.length + " locks?",
			"Every hand-edited rating, overall, potential, archetype and school " +
			"on those " + locked.length + " prospects is dropped, and the next " +
			"reroll will draw them again.",
			"Clear " + locked.length + " locks", go);
	}

	/* -------------------------------------------------------------- modal */

	/* Generic focus-trap utility. Returns a cleanup function. */
	const FOCUSABLE_SEL = 'a[href], button:not(:disabled), input:not(:disabled), ' +
		'select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

	function trapFocus(container) {
		function handler(e) {
			if (e.key !== "Tab") return;
			const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SEL))
				.filter((n) => n.offsetParent !== null);
			if (!focusables.length) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey) {
				if (document.activeElement === first) { e.preventDefault(); last.focus(); }
			} else {
				if (document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		}
		container.addEventListener("keydown", handler);
		return () => container.removeEventListener("keydown", handler);
	}

	let modalOk = null;
	let modalTrigger = null;      // the element that opened the modal
	let modalTrapCleanup = null;  // focus-trap teardown

	function modal(title, body, onOk, okLabel) {
		modalTrigger = document.activeElement;
		$("modalTitle").textContent = title;
		const b = $("modalBody");
		b.innerHTML = "";
		b.appendChild(body);
		$("modalOk").textContent = okLabel || "OK";
		modalOk = onOk;
		const m = $("modal");
		m.hidden = false;
		// Install focus trap
		if (modalTrapCleanup) modalTrapCleanup();
		modalTrapCleanup = trapFocus(m.querySelector(".modalbox"));
		// Move focus to the first focusable element inside the modal
		requestAnimationFrame(() => {
			const first = m.querySelector(FOCUSABLE_SEL);
			if (first) first.focus();
		});
	}
	/* A confirmation, for the actions that throw work away.

	   "Reset to defaults" and "Clear all locks" ran on the click. The undo
	   stack catches both, which is not the same as not needing a confirmation:
	   a user who clicks Reset expecting it to revert the ONE setting they just
	   moved loses every setting they have, plus the class they were looking at,
	   and then has to know that undo exists and that it covers this. The cost
	   of asking is one keystroke on an action taken deliberately once a
	   session; the cost of not asking is the whole configuration.

	   Deliberately NOT applied to anything reversible in one obvious step —
	   clearing one lock, changing a slider, removing a saved layout — because a
	   confirmation on every action is a confirmation on none. */
	function confirmDestructive(title, detail, okLabel, onOk) {
		const box = el("div");
		box.appendChild(el("p", null, detail));
		box.appendChild(el("p", "hint",
			"This can be undone with Ctrl+Z, or the Undo button in the header."));
		modal(title, box, onOk, okLabel);
	}

	function closeModal() {
		$("modal").hidden = true;
		modalOk = null;
		if (modalTrapCleanup) { modalTrapCleanup(); modalTrapCleanup = null; }
		// Restore focus to the element that triggered the modal
		if (modalTrigger && typeof modalTrigger.focus === "function") {
			try { modalTrigger.focus(); } catch (e) { /* element may be gone */ }
		}
		modalTrigger = null;
	}

	/* ------------------------------------------------------------- clipboard */

	function copyText(text, button, restore) {
		const done = () => {
			/* Announce it. The seed pill's copy changed the BUTTON's text and
			   nothing else, so a screen reader user pressing it got no
			   confirmation at all — and the pill itself is not a button, so
			   there was not even that. announce() is the tool's own live
			   region and costs nothing. */
			announce("Copied: " + String(text).slice(0, 60));
			if (!button) return;
			button.textContent = "Copied ✓";
			setTimeout(() => { button.textContent = restore; }, 1400);
		};
		function fallback() {
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); done(); } catch (e) { /* nothing to do */ }
			ta.remove();
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, fallback);
		} else fallback();
	}

	/* --------------------------------------------------------------- export */

	/* Everything the status line has said this session. Warnings and messages
	   were dismissible banners with no history, so a warning you dismissed — or
	   one that timed out while you were looking elsewhere — was simply gone.
	   Tools → Message history brings them back. */
	const messages = [];

	function remember(text) {
		messages.push({ at: new Date(), text: String(text) });
		if (messages.length > 200) messages.shift();
	}

	/* THE LIVE REGION.

	   #status carries role="status", and it is also hidden and unhidden — and
	   an assistive technology does not reliably announce text that appears in
	   an element that was `hidden` a moment ago, because the element was not in
	   the accessibility tree to be watched. So there is one region that is
	   always present, visually hidden, and only ever has text written into it.

	   Everything that used to be announced only by changing a button's label —
	   a copy, a sort level added or removed — goes through here too. */
	function announce(text) {
		let live = $("liveRegion");
		if (!live) {
			live = el("p", "visually-hidden");
			live.id = "liveRegion";
			live.setAttribute("role", "status");
			live.setAttribute("aria-live", "polite");
			document.body.appendChild(live);
		}
		/* Same string twice in a row is not announced twice by most screen
		   readers; a zero-width space makes it a new string without making it
		   a different sentence. */
		live.textContent = live.textContent === text ? text + "\u200b" : text;
	}

	function setStatus(text, sticky) {
		const s = $("status");
		s.textContent = text;
		s.hidden = !text;
		if (text) { remember(text); announce(text); }
		if (!sticky) setTimeout(() => { if (s.textContent === text) s.hidden = true; }, 3500);
	}

	function messageHistory() {
		const box = el("div");
		if (!messages.length) {
			box.appendChild(el("p", "hint", "Nothing has been reported yet."));
		} else {
			const list = el("dl", "shortcuts");
			for (const m of messages.slice().reverse()) {
				list.appendChild(el("dt", null, m.at.toLocaleTimeString()));
				list.appendChild(el("dd", null, m.text));
			}
			box.appendChild(list);
		}
		modal("Message history", box, null, "Close");
	}

	/* CSV gets a byte-order mark for the same reason the JSON export does:
	   Excel reads a BOM-less UTF-8 file as the system code page, so Doncic,
	   Saric, Jokic and Wembanyama all come out as mojibake in the one file
	   people actually open in a spreadsheet. text/csv is the only type that
	   needs it — JSON exports add their own at the call site. */
	function download(name, text, type) {
		const t = type || "text/plain";
		const body = t === "text/csv" && text.charAt(0) !== "\ufeff"
			? "\ufeff" + text
			: text;
		const blob = new Blob([body], { type: t });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
	}

	function exportOne(i, opts) {
		const res = ensureResult(i);
		if (!res) return false;
		try {
			const out = global.Engine.exportFile(res, opts);
			/* A player whose identity check failed passed through untouched;
			   that used to be silent, and then it was said and immediately
			   overwritten by the caller's "Exported" line. Left on the
			   function for the caller to fold into its own status. */
			exportOne.warning = global.Engine.exportFile.passthroughs
				? "Warning: " + global.Engine.exportFile.passthroughs +
					" player(s) could not be matched and were exported unmodified."
				: "";
			const base = state.files[i].name.replace(/\.json(\.gz)?$|\.gz$/i, "");
			// BBGM writes its exports with a BOM; match it.
			download(base + "_customized.json", "\ufeff" + JSON.stringify(out, null, 2),
				"application/json");
			return true;
		} catch (err) {
			showError(new Error("Could not export " + state.files[i].name + ": " + err.message));
			return false;
		}
	}

	const CSV_COLS = ["key", "name", "pos", "year", "ovr", "pot", "archetype", "college",
		"conf", "teamRecord", "apRank", "ncaaSeed", "hgtInches", "weight",
		"board", "preseason", "move", "gp", "mpg", "ppg", "rpg", "orpg", "drpg",
		"apg", "spg", "bpg", "topg", "pfpg", "cspg", "deflpg", "chgpg", "drtg",
		// The volume behind every percentage, which the table now shows too.
		"fga", "tpa", "fta", "tpar", "ftr", "efg", "astTo", "ortg", "prod",
		"usg", "fgp", "tpp", "ftp", "ts", "awards"];

	/* A field beginning =, +, - or @ is executed as a FORMULA when the file is
	   opened in Excel or Sheets. Names come from BBGM, but the lock-import
	   round trip means a user-authored CSV can come back in, and "it is only
	   our own data" is exactly the assumption that makes this class of bug
	   ship. A leading apostrophe is the standard neutralizer and is invisible
	   in the spreadsheet.

	   The escape test also missed a bare carriage return: a field containing
	   one (possible in a note, or in an imported name) broke the row. */
	function esc(v) {
		/* A non-finite number is an empty cell, not the text "NaN".
		   `Number(NaN.toFixed(3))` is NaN, `String(NaN)` is "NaN", and a
		   spreadsheet reading "NaN" in an otherwise numeric column silently
		   retypes the whole column as text. Infinity has the same problem. */
		if (typeof v === "number" && !Number.isFinite(v)) return "";
		let s = v === undefined || v === null ? "" : String(v);
		if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
		return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	}

	/* CSV line terminator. RFC 4180 says CRLF, and everything else in these
	   exports (the BOM, the formula-injection guard) is there for Excel's
	   benefit, so writing bare LF was the one inconsistency. */
	const CSV_EOL = "\r\n";
	function csvJoin(lines) { return lines.join(CSV_EOL) + CSV_EOL; }

	function exportCsv(res, everyone) {
		/* The CSV honours the award scope the export dialog is set to, for the
		   same reason the JSON does: a spreadsheet of prospects whose Awards
		   column runs to twenty-two conference rows is a spreadsheet nobody
		   reads either. */
		const scope = state.exportAwardsScope || "all";
		const confs = state.exportMajorConfs || null;
		const lines = [CSV_COLS.join(",")];
		let skipped = 0;
		for (const p of res.players) {
			if (!everyone && !V.matchesFilter(p, res)) { skipped++; continue; }
			const s = p.stats || {};
			const t = res.teams[p.newCollege];
			// Derived columns come from the same place the table reads them, so
			// the file and the screen can never disagree.
			const d = (k) => (p.stats ? V.derived(k, p.stats) : undefined);
			lines.push([
				p.key, p.name, p.newPos, p.classYear, p.newOvr, p.newPot, p.archetype,
				p.proClub || p.newCollege, t ? t.conf : p.newCollege,
				t ? t.w + "-" + t.l : "", t ? t.apRank : "", t ? t.ncaaSeed : "",
				p.newHgtInches, p.newWeight,
				p.boardRank, p.preseasonRank, p.stockMove,
				s.gp, s.mpg, s.ppg, s.rpg, s.orpg, s.drpg, s.apg, s.spg, s.bpg,
				s.topg, s.pfpg, s.cspg, s.deflpg, s.chgpg, s.drtg,
				s.fga, s.tpa, s.fta, d("tpar"), d("ftr"), d("efg"), d("astTo"),
				d("ortg"), d("prod"),
				s.usg, s.fgp, s.tpp, s.ftp, s.ts,
				global.Awards.scopeAwards(p.awards, scope, confs).join("; "),
			].map((v) => esc(typeof v === "number" && Number.isFinite(v)
				? Number(v.toFixed(3)) : v)).join(","));
		}
		/* The export silently obeyed the table filter and was still called
		   prospects.csv, so "Export CSV" on a filtered table quietly produced a
		   file missing most of the class with nothing to say so. The name now
		   tells the truth and the status line says how many rows were left
		   out. */
		download(skipped ? "prospects_filtered.csv" : "prospects.csv",
			csvJoin(lines), "text/csv");
		setStatus(skipped
			? "CSV exported — " + (res.players.length - skipped) + " of " +
				res.players.length + " prospects (the current filter). " +
				"Use “Prospect table as CSV (whole class)” for all of them."
			: "CSV exported — all " + res.players.length + " prospects.");
	}

	/* The whole simulated season was throwaway except for the note strings. */
	function exportSeasonJson(res) {
		download("season_" + res.seed + ".json",
			JSON.stringify(global.Engine.exportSeason(res), null, 2), "application/json");
		setStatus("Season exported.");
	}

	function exportLeagueFragment(res) {
		download(state.files[state.active].name.replace(/\.json(\.gz)?$|\.gz$/i, "") + "_league_fragment.json",
			JSON.stringify(global.Engine.exportLeagueFragment(res), null, 2), "application/json");
		setStatus("League fragment exported.");
	}

	function exportSeasonCsv(res) {
		const season = global.Engine.exportSeason(res);
		const lines = ["section,a,b,c,d,e"];
		for (const t of season.teams) {
			lines.push(["team", t.name, t.conf, t.w + "-" + t.l,
				t.ncaaResult || t.nitResult || "", t.apRank || ""].map(esc).join(","));
		}
		for (const g of season.bracket) {
			lines.push(["bracket", g.region, "round " + g.round,
				g.winnerSeed + " " + g.winner, g.loserSeed + " " + g.loser, g.score]
				.map(esc).join(","));
		}
		for (const a of season.awards) {
			const scoped = global.Awards.scopeAwards(
				a.awards, state.exportAwardsScope || "all", state.exportMajorConfs || null);
			if (!scoped.length) continue;
			lines.push(["award", a.name, a.school, scoped.join("; "), "", ""].map(esc).join(","));
		}
		for (const b of season.board) {
			lines.push(["board", b.rank, b.name, b.school, b.round || "", b.pick || ""]
				.map(esc).join(","));
		}
		download("season_" + res.seed + ".csv", csvJoin(lines), "text/csv");
		setStatus("Season CSV exported.");
	}

	function exportNotes(res) {
		const lines = ["name\tnote"];
		for (const p of res.players.slice().sort((a, b) => b.newOvr - a.newOvr)) {
			lines.push(p.name + "\t" + (p.note || "").replace(/\n/g, " · "));
		}
		download("notes.tsv", csvJoin(lines), "text/tab-separated-values");
		setStatus("Notes exported.");
	}

	/* The same notes as Markdown, so they survive a paste into a forum post or
	   an issue instead of arriving as one run-on paragraph per player. */
	function exportNotesMarkdown(res) {
		const out = ["# Draft class " + res.season + " — seed `" + res.seed + "`", ""];
		if (res.flavor && res.flavor.name !== "balanced") {
			out.push("_This class is " + res.flavor.label + "._", "");
		}
		if (res.surprises && res.surprises.length) {
			out.push("**Story of the class:** " +
				res.surprises.map((s) => s.player + ", " + s.label).join("; "), "");
		}
		const board = res.players.slice()
			.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
		for (const p of board) {
			out.push("## " + (p.boardRank ? p.boardRank + ". " : "") + p.name);
			out.push("");
			out.push("`" + p.newPos + "` **" + p.newOvr + "/" + p.newPot + "** · " +
				p.archetype + " · " + p.classYear + " · " +
				(p.proClub || p.newCollege));
			out.push("");
			for (const line of String(p.note || "").split("\n")) {
				if (line.trim()) out.push(line.trim());
			}
			out.push("");
		}
		download("notes.md", out.join("\n"), "text/markdown");
		setStatus("Notes exported as Markdown.");
	}

	/* Re-apply locks in bulk from a CSV. The natural workflow — export the
	   table, edit ovr/archetype/college in a spreadsheet, bring it back — had
	   no return path at all. */
	function importLocksCsv(text) {
		/* A preview first. This applied everything and reported the dropped
		   rows afterwards, so the way to find out what a spreadsheet was about
		   to do to a class was to let it. */
		const plan = planLockImport(text);
		if (!plan) return;
		if (!plan.applied.length) {
			showError(new Error("Nothing in that CSV matched a player in this class." +
				(plan.unmatched.length
					? " " + plan.unmatched.length + " row(s) named somebody else." : "")));
			return;
		}
		const box = el("div");
		box.appendChild(el("p", "hint",
			plan.applied.length + " of " + plan.total + " rows will lock settings on " +
			"this class" +
			(plan.unmatched.length
				? "; " + plan.unmatched.length + " matched nobody and will be skipped"
				: "") + "."));
		const wrap = el("div", "scroll");
		const table = el("table", "mini");
		const hr = el("tr");
		for (const h of ["Player", "Will lock"]) hr.appendChild(el("th", null, h));
		table.appendChild(hr);
		for (const a of plan.applied.slice(0, 200)) {
			const tr = el("tr");
			tr.appendChild(el("td", null, a.player.name));
			tr.appendChild(el("td", null, Object.keys(a.patch)
				.map((k) => k + " = " + a.patch[k]).join(", ")));
			table.appendChild(tr);
		}
		wrap.appendChild(table);
		box.appendChild(wrap);
		if (plan.unmatched.length) {
			box.appendChild(el("p", "hint",
				"Not matched: " + plan.unmatched.slice(0, 12).join(", ") +
				(plan.unmatched.length > 12 ? ", …" : "")));
		}
		modal("Import locks — preview", box, () => applyLockImport(plan), "Apply");
	}

	function applyLockImport(plan) {
		pushUndo("imported locks from a CSV");
		for (const a of plan.applied) {
			state.overrides[a.player.key] =
				Object.assign({}, state.overrides[a.player.key] || {}, a.patch);
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		run(() => setStatus("Applied " + plan.applied.length + " lock" +
			(plan.applied.length === 1 ? "" : "s") +
			(plan.unmatched.length
				? "; " + plan.unmatched.length + " row(s) matched nobody." : ".")));
	}

	function planLockImport(text) {
		const rows = parseCsv(text);
		if (!rows.length) { showError(new Error("That CSV has no rows.")); return null; }
		const head = rows[0].map((h) => h.trim().toLowerCase());
		const idx = (name) => head.indexOf(name);
		const res = state.results[state.active];
		if (!res) return null;
		const byKey = {};
		const byName = {};
		for (const p of res.players) {
			byKey[p.key] = p;
			byName[p.name.toLowerCase()] = p;
		}
		const cols = {
			key: idx("key"), name: idx("name"), ovr: idx("ovr"), pot: idx("pot"),
			archetype: idx("archetype"), college: idx("college"),
		};
		if (cols.key < 0 && cols.name < 0) {
			showError(new Error("The CSV needs a `key` or `name` column to match players."));
			return null;
		}
		const applied = [];
		const unmatched = [];
		let total = 0;
		for (let i = 1; i < rows.length; i++) {
			const r = rows[i];
			if (!r.length || r.every((c) => !c.trim())) continue;
			total++;
			const k = cols.key >= 0 ? String(r[cols.key]).trim() : null;
			const nm = cols.name >= 0 ? String(r[cols.name]).trim().toLowerCase() : null;
			const p = (k && byKey[k]) || (nm && byName[nm]);
			if (!p) { unmatched.push(k || nm); continue; }
			const patch = {};
			const num = (c) => {
				const v = Number(String(r[c]).trim());
				return Number.isFinite(v) ? v : null;
			};
			if (cols.ovr >= 0 && num(cols.ovr) !== null) patch.ovr = num(cols.ovr);
			if (cols.pot >= 0 && num(cols.pot) !== null) patch.pot = num(cols.pot);
			if (cols.archetype >= 0 && String(r[cols.archetype]).trim()) {
				patch.archetype = String(r[cols.archetype]).trim();
			}
			if (cols.college >= 0 && String(r[cols.college]).trim()) {
				patch.college = String(r[cols.college]).trim();
			}
			if (!Object.keys(patch).length) continue;
			applied.push({ player: p, patch });
		}
		return { applied, unmatched, total };
	}

	function parseCsv(text) {
		const rows = [];
		let row = [];
		let cell = "";
		let quoted = false;
		for (let i = 0; i < text.length; i++) {
			const c = text[i];
			if (quoted) {
				if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
				else if (c === '"') quoted = false;
				else cell += c;
			} else if (c === '"') quoted = true;
			else if (c === ",") { row.push(cell); cell = ""; }
			else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
			else if (c !== "\r") cell += c;
		}
		if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
		return rows;
	}

	/* The export options every route outside the menu uses: the toolbar
	   button, the `e` shortcut and Export all. They used to pass nothing,
	   which disagreed with the menu's own defaults (injuries on there, off
	   in the engine) and threw away whatever the user had just ticked in
	   the menu. The menu writes state.exportOpts on every change. */
	function currentExportOpts() {
		return state.exportOpts || { ages: true, injuries: true, jerseys: true };
	}

	/* One sequence at a time, driven from the button's single listener. A
	   second `onclick` handler beside the listener fired both on every
	   "Export next" click, so file 0 downloaded again each time. */
	function exportAll() {
		if (state.exportAllStep) { state.exportAllStep(); return; }
		let i = 0;
		const done = () => {
			state.exportAllStep = null;
			$("btnExportAll").textContent = "Export all";
		};
		const step = () => {
			if (i >= state.files.length) {
				setStatus("All " + state.files.length + " files exported.");
				done();
				return;
			}
			const ok = exportOne(i, currentExportOpts());
			i++;
			if (!ok) { done(); return; }
			if (i < state.files.length) {
				$("btnExportAll").textContent = "Export next (" + i + "/" + state.files.length + ")";
				setStatus("Exported " + i + " of " + state.files.length +
					". Your browser blocks bulk downloads without a click — " +
					"press the button again for the next file." +
					(exportOne.warning ? " " + exportOne.warning : ""), true);
				state.exportAllStep = step;
			} else step();
		};
		step();
	}

	/* Export the active class and say so, keeping any passthrough warning
	   in the status line instead of overwriting it a moment later. */
	function exportActive(opts) {
		if (!exportOne(state.active, opts)) return;
		setStatus("Exported " + state.files[state.active].name + "." +
			(exportOne.warning ? " " + exportOne.warning : ""));
	}

	function exportMenu() {
		const res = state.results[state.active];
		if (!res) return;
		const box = el("div");
		box.appendChild(el("p", "hint",
			"The simulated season used to be thrown away except for the note strings."));
		const list = el("div", "checks");
		const item = (label, fn) => {
			const b = el("button", null, label);
			b.addEventListener("click", () => { closeModal(); fn(); });
			list.appendChild(b);
		};
		/* §8.13: the simulated season, honors and career were computed and
		   then thrown away at export time. Opt-in, so the default file is
		   unchanged. */
		const optBox = el("div", "checks");
		const remembered = state.exportOpts || null;
		const opt = (key, label, dflt) => {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			/* The menu reopens the way it was left, and the toolbar export
			   uses the same choices (see currentExportOpts). */
			cb.checked = remembered && typeof remembered[key] === "boolean"
				? remembered[key] : !!dflt;
			cb.addEventListener("change", () => { state.exportOpts = exportOpts(); });
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + label));
			optBox.appendChild(lab);
			return () => cb.checked;
		};
		const oStats = opt("stats", "Include college statline (draft year)");
		const oPrior = opt("prior", "…and prior seasons");
		const oHighs = opt("highs", "…and game-log season highs");
		const oAwards = opt("awards", "Include college awards");
		/* WHICH awards. A good prospect finishes a season holding fifteen to
		   twenty-two honors and BBGM renders every one as its own row, so a
		   player page arrives buried under All-Sun Belt Newcomer Team and
		   conference all-freshman nods with the three lines a reader wants
		   somewhere in the middle. Measured over six classes: 114 distinct
		   types, 2.4 honors a player, 22 on the most decorated. "Major" is
		   the national trophies plus the power and named-conference rows —
		   see isMajorAward in js/awards.js for exactly what counts. */
		const scopeWrap = el("div", "ctl");
		const scopeLab = el("label", null, "Which awards");
		scopeLab.htmlFor = "exportAwardsScope";
		const scopeSel = el("select");
		scopeSel.id = "exportAwardsScope";
		scopeSel.appendChild(new Option("every honor (the default)", "all"));
		scopeSel.appendChild(new Option("major honors only", "major"));
		scopeSel.value = state.exportAwardsScope || "all";
		const scopeHint = el("p", "unit");
		const confWrap = el("div", "ctl");
		const confLab = el("label", null, "Conferences that count");
		confLab.htmlFor = "exportMajorConfs";
		const confInput = el("input");
		confInput.id = "exportMajorConfs";
		confInput.type = "text";
		confInput.value = (state.exportMajorConfs ||
			global.Awards.MAJOR_CONFERENCES).join(", ");
		confWrap.appendChild(confLab);
		confWrap.appendChild(confInput);
		confWrap.appendChild(el("p", "unit",
			"A conference player of the year, defensive player of the year, " +
			"freshman of the year, all-conference first team and tournament MVP " +
			"count for these; every other conference's rows are dropped."));
		const paintScope = () => {
			const major = scopeSel.value === "major";
			confWrap.hidden = !major;
			if (!res) { scopeHint.textContent = ""; return; }
			const conf = confInput.value.split(",").map((x) => x.trim()).filter(Boolean);
			let all = 0;
			let kept = 0;
			for (const p of res.players || []) {
				all += (p.awards || []).length;
				kept += global.Awards.scopeAwards(p.awards, "major", conf).length;
			}
			scopeHint.textContent = major
				? kept + " of " + all + " honor rows in this class survive."
				: all + " honor rows in this class.";
		};
		scopeSel.addEventListener("change", () => {
			state.exportAwardsScope = scopeSel.value;
			state.exportOpts = exportOpts();
			paintScope();
		});
		confInput.addEventListener("input", () => {
			state.exportMajorConfs = confInput.value.split(",")
				.map((x) => x.trim()).filter(Boolean);
			state.exportOpts = exportOpts();
			paintScope();
		});
		scopeWrap.appendChild(scopeLab);
		scopeWrap.appendChild(scopeSel);
		scopeWrap.appendChild(scopeHint);
		optBox.appendChild(scopeWrap);
		optBox.appendChild(confWrap);
		/* Age. Off is the old behaviour — every prospect keeps the birth year
		   BBGM gave the whole class, which puts a fifth-year senior on the
		   draft screen at 19 and hands him a nineteen-year-old's development
		   curve. See AGE_FOR_CLASS in js/engine.js. */
		const oAges = opt("ages", "Rewrite ages to match the class years", true);
		optBox.appendChild(el("p", "unit",
			"Every player in a BBGM draft class shares a birth year, so without " +
			"this a graduate transfer imports as a 19-year-old and BBGM develops " +
			"him like one. Skipped automatically when the source file's own ages " +
			"already vary."));
		const oInjuries = opt("injuries", "Write the season's injuries into BBGM's injuries[]", true);
		optBox.appendChild(el("p", "unit",
			"BBGM's player schema carries an injury history and the tool never " +
			"wrote one, so “injury-prone” was a sentence in a note and nothing " +
			"inside the game. Survives the draft-class import."));
		const oJerseys = opt("jerseys", "Assign jersey numbers by position", true);
		optBox.appendChild(el("p", "unit",
			"Guards take the single digits and low teens, wings the teens and " +
			"twenties, bigs the thirties and up — unique within the class, " +
			"because a class becomes a roster. Skipped for a player who already " +
			"has a number."));
		const oNoteAppend = opt("noteAppend", "Keep any note already in the file");
		optBox.appendChild(el("p", "unit",
			"The generated note replaces whatever the file carried. Tick this to " +
			"add it underneath instead, for a file whose notes you edited in BBGM."));
		list.appendChild(optBox);
		paintScope();
		const exportOpts = () => ({
			stats: oStats(), prior: oPrior(), highs: oHighs(), awards: oAwards(),
			ages: oAges(), noteAppend: oNoteAppend(),
			injuries: oInjuries(), jerseys: oJerseys(),
			awardsScope: scopeSel.value,
			majorConferences: confInput.value.split(",")
				.map((x) => x.trim()).filter(Boolean),
		});
		/* Every one of these sentences is a fixed fact about BBGM's own import
		   code, not a preference:

		     handleUploadedDraftClass (Draft -> [year] -> Import) runs
		     `delete p.stats` on every uploaded player, so no file shows a
		     statline through it. Awards and notes survive.

		     importPlayers (Tools -> Import players) builds the imported player
		     from a fixed list of fields. `stats` is on it, `awards` is not, so
		     that route is the mirror image: the statline arrives and the
		     honors do not (which is why the export folds them into the note,
		     and the note is on the list). It also stamps every imported stats
		     row's team as DOES_NOT_EXIST before saving it — "DNE" in the
		     table, whatever team the file named — and it adds players rather
		     than replacing the class.

		     A league file is the game's own save format and keeps everything.

		   So the dialog says which door gives you what rather than pretending
		   there is one right answer. */
		/* The three routes as a TABLE, beside the checkboxes rather than as a
		   paragraph above them: which checkbox matters depends entirely on
		   which door the user is about to walk through, and a reader deciding
		   between three doors should not have to parse a sentence to find the
		   column he is in. Every cell is a fixed fact about BBGM's own import
		   code (see the comment above), not a preference. */
		const routes = el("div", "scroll");
		const rt = el("table", "routes");
		const rhead = el("thead");
		const rhr = el("tr");
		for (const h of ["Route", "Statline", "Awards", "Note", "Replaces the class"]) {
			rhr.appendChild(el("th", null, h));
		}
		rhead.appendChild(rhr);
		rt.appendChild(rhead);
		const rtb = el("tbody");
		for (const row of [
			["Draft → [year] → Import", "no — deleted on upload", "yes", "yes", "yes"],
			["Tools → Import players", "yes, tick “Include stats”", "no — folded into the note",
				"yes", "no, it adds"],
			["Merge into a league file", "yes", "yes", "yes", "yes"],
		]) {
			const tr = el("tr");
			for (const c of row) tr.appendChild(el("td", null, c));
			rtb.appendChild(tr);
		}
		rt.appendChild(rtb);
		routes.appendChild(rt);
		list.appendChild(routes);
		list.appendChild(el("p", "hint",
			"Tools → Import players also stamps every imported season's team " +
			"“DNE” itself, whatever team the file named — that is BBGM, not " +
			"this export."));
		item("BBGM class file, with the options above", () => {
			exportActive(exportOpts());
		});
		item("Players file, for Tools → Import players (keeps the statline)", () => {
			const res2 = ensureResult(state.active);
			if (!res2) return;
			try {
				const out = global.Engine.exportPlayersFile(res2, exportOpts());
				const base = state.files[state.active].name.replace(/\.json(\.gz)?$|\.gz$/i, "");
				download(base + "_players.json", "\ufeff" + JSON.stringify(out, null, 2),
					"application/json");
				setStatus("Wrote " + out.players.length + " players. Load it with " +
					"Tools → Import players, select them all and tick “Include stats”.");
			} catch (err) {
				setStatus("Could not export: " + (err && err.message ? err.message : err));
			}
		});
		item("Merge into a league file… (keeps the statline AND the awards)", () => {
			state.mergeOpts = exportOpts();
			chooseMergeClasses();
		});
		item("Prospect table as CSV (the current filter)", () => exportCsv(res));
		item("Prospect table as CSV (whole class)", () => exportCsv(res, true));
		item("Season as JSON — records, bracket, awards, board", () => exportSeasonJson(res));
		item("Season as CSV", () => exportSeasonCsv(res));
		item("Season as a BBGM league fragment — teams, records, coaches", () => exportLeagueFragment(res));
		item("Note text only, for a spreadsheet", () => exportNotes(res));
		item("Notes as Markdown, for a forum post", () => exportNotesMarkdown(res));
		item("Import locks from a CSV…", () => $("csvFile").click());
		item("Message history", messageHistory);
		item("Compare two presets…", comparePresets);
		box.appendChild(list);
		modal("Export and import", box, null, "Close");
	}

	/* Which classes go into the league file.

	   One loaded class is the common case and asking about it would be noise,
	   so it goes straight to the file picker. With several loaded, a user
	   almost always means all of them — a 2027, 2028 and 2029 class merged
	   into one save is the whole reason for loading three files — so they are
	   all ticked and the dialog is a chance to untick one, not a form to
	   fill in. */
	function chooseMergeClasses() {
		if (state.files.length < 2) {
			state.mergeIndices = [state.active];
			$("leagueMergeFile").click();
			return;
		}
		const box = el("div");
		box.appendChild(el("p", null,
			"Merge these draft classes into the league file. Each one replaces " +
			"the generated class for its own draft year; the rest of the league " +
			"is left alone."));
		const list = el("div", "checklist");
		const boxes = [];
		state.files.forEach((f, i) => {
			const lab = el("label");
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.checked = true;
			cb.dataset.idx = String(i);
			boxes.push(cb);
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + f.name + " — " +
				(f.data.players || []).length + " players, " +
				(f.data.startingSeason || "?")));
			list.appendChild(lab);
		});
		box.appendChild(list);
		modal("Merge into a league file", box, () => {
			const picked = boxes.filter((c) => c.checked)
				.map((c) => Number(c.dataset.idx));
			if (!picked.length) {
				setStatus("No class was selected, so nothing was merged.");
				return;
			}
			state.mergeIndices = picked;
			$("leagueMergeFile").click();
		}, "Choose league file…");
	}

	/* ------------------------------------------------------------ comparison */

	function snapshot(res) {
		const withStats = res.players.filter((p) => p.stats);
		const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
		return {
			seed: res.seed,
			flavor: res.flavor ? res.flavor.label : null,
			avgOvr: mean(res.players.map((p) => p.newOvr)),
			avgPot: mean(res.players.map((p) => p.newPot)),
			avgPpg: mean(withStats.map((p) => p.stats.ppg)),
			avgMpg: mean(withStats.map((p) => p.stats.mpg)),
			topPpg: withStats.length ? Math.max.apply(null, withStats.map((p) => p.stats.ppg)) : 0,
			awards: res.players.reduce((a, p) => a + (p.awards || []).length, 0),
			archetypes: new Set(res.players.map((p) => p.archetype)).size,
			players: res.players.map((p) => ({
				key: p.key, name: p.name, ovr: p.newOvr, pot: p.newPot,
				archetype: p.archetype, college: p.proClub || p.newCollege,
				board: p.boardRank || 0,
				// Enough of the stat line for the main table to show a ± against
				// the baseline, not only the Compare tab.
				ppg: p.stats ? p.stats.ppg : 0,
				rpg: p.stats ? p.stats.rpg : 0,
				apg: p.stats ? p.stats.apg : 0,
				mpg: p.stats ? p.stats.mpg : 0,
				ts: p.stats ? p.stats.ts : 0,
			})),
		};
	}

	/* Index the pinned class by player key once, so the main table can put a
	   ± against the baseline on every row without an O(n^2) lookup. */
	function indexSnapshot(snap) {
		if (!snap) return snap;
		snap.byKey = {};
		for (const p of snap.players) snap.byKey[p.key] = p;
		return snap;
	}

	/* ----------------------------------------------------------- batch mode */

	let batchCancel = false;
	let batchWorker = null;
	// The seed the current batch was generated from, so it can be re-run.
	let batchBaseSeed = null;

	function batchProgress(done, total) {
		$("batchProgress").hidden = false;
		const p = Math.round((100 * done) / total);
		$("batchBar").style.width = p + "%";
		$("batchGauge").setAttribute("aria-valuenow", String(p));
		$("batchNote").textContent = done + " of " + total + " classes";
	}

	/* The classes a running batch has already finished. A cancelled sweep used
	   to report "Batch canceled" and show nothing, however far it had got —
	   180 of 200 simulated seasons discarded because the user decided at class
	   180 that 200 was too many. */
	let batchPartial = [];

	function batchDone(rows) {
		$("batchProgress").hidden = true;
		$("btnBatch").disabled = false;
		$("btnBatchCancel").hidden = true;
		batchWorker = null;
		const use = (rows && rows.length) ? rows : batchPartial;
		if (!use.length) { setStatus("Batch canceled before any class finished."); return; }
		renderBatch(use);
		setStatus(rows && rows.length
			? ""
			: "Cancelled — showing the " + use.length + " " +
				(use.length === 1 ? "class" : "classes") + " that finished.");
		batchPartial = [];
	}

	/* Held batches, for comparison. The whole point of running a calibration
	   sweep is the diff between settings, and a batch was a distribution with
	   nothing to hold it against: you read one panel, changed a slider, ran
	   again, and compared from memory.

	   There used to be exactly ONE slot, which makes a sweep a sequence of
	   pairwise comparisons that never meet — you cannot ask "how did those five
	   values of USG_EXP compare" when holding the third throws away the first.
	   A stack of up to five named batches turns the same work into one table.
	   Held in memory only: a batch is fifty simulated seasons and does not
	   belong in localStorage. */
	const BATCH_STACK_MAX = 5;
	let heldBatches = [];

	function renderBatch(rows) {
		const B = global.BatchStats;
		const view = $("view");
		view.innerHTML = "";
		const head = el("div", "rowflex");
		head.appendChild(el("h3", null, rows.length + " classes with these settings"));
		const hold = el("button", "tiny", "Hold this batch…");
		hold.title = "Keep this batch under a name; every held batch is compared side by side.";
		hold.disabled = heldBatches.length >= BATCH_STACK_MAX;
		if (hold.disabled) {
			hold.title = "Five batches are already held — drop one first.";
		}
		hold.addEventListener("click", () => {
			const suggested = String.fromCharCode(65 + heldBatches.length);
			const name = window.prompt("Name this batch:", suggested);
			if (name === null) return;
			const label = (name.trim() || suggested);
			heldBatches = heldBatches.filter((h) => h.label !== label);
			heldBatches.push({
				label, rows: rows.slice(), seed: batchBaseSeed, cfg: effectiveCfg(),
			});
			setStatus("Batch held as “" + label + "”. Change a setting and run another.");
			renderBatch(rows);
		});
		head.appendChild(hold);
		for (const h of heldBatches) {
			const drop = el("button", "tiny", "Forget " + h.label);
			drop.addEventListener("click", () => {
				heldBatches = heldBatches.filter((x) => x !== h);
				renderBatch(rows);
			});
			head.appendChild(drop);
		}
		view.appendChild(head);
		const col = (k) => rows.map((r) => r[k]);
		/* A batch of fifty classes exists to show a distribution, and the panel
		   showed one row of averages. p5 / p50 / p95 answers "how unusual was
		   the class I just generated?", which is the actual question. */
		const d = (k) => (k === "awards" || k === "honored" || k === "archetypes" ||
			k === "champSeed" || k === "ffOneSeeds" || k === "r64Upsets" ? 1 : 2);
		const line = (label, k) => {
			const v = col(k);
			const f = (x) => x.toFixed(d(k)).padStart(7);
			return label.padEnd(20) + f(B.mean(v)) + "   " + f(B.pct(v, 0.05)) +
				f(B.pct(v, 0.50)) + f(B.pct(v, 0.95));
		};
		view.appendChild(el("div", "note", [
			"".padEnd(20) + "   mean       p5     p50     p95",
			line("mean ovr", "ovr"),
			line("mean pot", "pot"),
			line("mean MPG", "mpg"),
			line("mean PPG", "ppg"),
			line("mean RPG", "rpg"),
			line("mean APG", "apg"),
			line("mean USG%", "usg"),
			line("mean TS%", "ts"),
			line("team PPG", "teamPpg"),
			line("team AST", "teamAst"),
			line("scoring leader", "topPpg"),
			line("assist leader", "topApg"),
			line("block leader", "topBpg"),
			line("awards/class", "awards"),
			line("honored players", "honored"),
			line("distinct archetypes", "archetypes"),
			line("champion's seed", "champSeed"),
			line("1 seeds in Final Four", "ffOneSeeds"),
			line("R64 upsets (gap ≥ 5)", "r64Upsets"),
			"",
			/* Which population each row describes. The per-player rows are the
			   NCAA prospects only; a teenager on a 22-minute cap at Real Madrid
			   is not comparable and used to be averaged in silently. */
			"Per-player rows cover the " + B.mean(col("nNcaa")).toFixed(1) +
				" NCAA prospects per class." +
				(B.mean(col("nAbroad")) >= 0.05
					? " The " + B.mean(col("nAbroad")).toFixed(1) + " playing abroad " +
						"averaged " + B.mean(col("abroadPpg")).toFixed(1) + " PPG and are " +
						"not included."
					: ""),
			"",
			"batch seed: " + (batchBaseSeed || "—") +
				"  (class i of this batch is seed “" + (batchBaseSeed || "") + "#i”)",
			"seeds: " + rows.map((r) => r.seed).join(", "),
		].join("\n")));
		if (heldBatches.length) view.appendChild(batchDiff(heldBatches, rows));
		const cards = el("div", "cards");
		cards.appendChild(V.histogram("Scoring leader per class", col("topPpg"), 10));
		cards.appendChild(V.histogram("Awards per class", col("awards"), 10));
		cards.appendChild(V.histogram("Mean PPG per class", col("ppg"), 10));
		cards.appendChild(V.histogram("Distinct archetypes per class", col("archetypes"), 10));
		/* Champion seed and Final Four composition as histograms: the reading
		   that says whether March is calibrated. Real modern-era figures:
		   1 seeds win 55-65% of titles and fill about 40% of the Final Four. */
		const seeds = col("champSeed").filter(Number.isFinite);
		if (seeds.length) {
			const sBox = el("div", "card");
			sBox.appendChild(el("h4", null, "Champion's seed"));
			const hist = {};
			for (const s of seeds) hist[s] = (hist[s] || 0) + 1;
			sBox.appendChild(el("div", "note", Object.keys(hist)
				.sort((a, b) => a - b)
				.map((k) => ("No. " + k).padStart(6) + "  " + "█".repeat(hist[k]) + " " + hist[k]).join("\n") +
				"\n\n1 seeds: " + (100 * (hist[1] || 0) / seeds.length).toFixed(0) +
				"% of titles (real: 55-65%) · seeds 5-11: " +
				(100 * seeds.filter((s) => s >= 5 && s <= 11).length / seeds.length).toFixed(0) +
				"% (real: under 10%)"));
			cards.appendChild(sBox);
			cards.appendChild(V.histogram("1 seeds in the Final Four", col("ffOneSeeds"), 5, (v) => String(Math.round(v))));
		}
		const flavors = {};
		for (const r of rows) flavors[r.flavor || "—"] = (flavors[r.flavor || "—"] || 0) + 1;
		const fBox = el("div", "card");
		fBox.appendChild(el("h4", null, "Class flavors drawn"));
		fBox.appendChild(el("div", "note", Object.keys(flavors)
			.sort((a, b) => flavors[b] - flavors[a])
			.map((k) => String(flavors[k]).padStart(3) + "  " + k).join("\n")));
		cards.appendChild(fBox);
		view.appendChild(cards);
	}

	function runBatch(n) {
		const file = activeFile();
		if (!file) return;
		batchCancel = false;
		batchPartial = [];
		$("btnBatch").disabled = true;
		$("btnBatchCancel").hidden = false;
		batchProgress(0, n);
		const cfg = effectiveCfg();
		// One seed for the whole batch, so the batch itself is reproducible.
		batchBaseSeed = global.BatchStats.batchSeed(cfg, null);

		/* A worker keeps the tab responsive. Opening index.html straight off
		   the disk blocks workers in most browsers, and that is the documented
		   way to use this tool, so the fallback below has to be just as usable:
		   it slices the work into single classes on a timer, which yields to
		   the UI between each one and can be canceled the same way. */
		try {
			batchWorker = new Worker("js/worker.js");
			batchWorker.onmessage = (e) => {
				const m = e.data;
				if (m.type === "progress") {
					// Keep the finished classes, so a cancel keeps its work.
					if (m.row) batchPartial.push(m.row);
					batchProgress(m.done, m.total);
				} else if (m.type === "done") batchDone(m.rows);
				else if (m.type === "error") {
					showError(new Error(m.message));
					batchDone(null);
				}
			};
			batchWorker.onerror = () => {
				if (batchWorker) { batchWorker.terminate(); batchWorker = null; }
				runBatchInline(file, cfg, n);
			};
			batchWorker.postMessage({
				type: "batch", leagueFile: file.data, cfg, n, baseSeed: batchBaseSeed,
			});
		} catch (cannotStartWorker) {
			batchWorker = null;
			runBatchInline(file, cfg, n);
		}
	}

	function runBatchInline(file, cfg, n) {
		const runner = global.Engine.createRunner(file.data);
		const rows = [];
		let i = 0;
		const step = () => {
			if (batchCancel) { batchDone(null); return; }
			if (i >= n) { batchDone(rows); return; }
			const c = CFG.make(cfg);
			// Same derivation the worker uses, so the two paths agree.
			c.seed = batchBaseSeed + "#" + i;
			c.overrides = cfg.overrides || {};
			try {
				rows.push(global.BatchStats.summarize(runner.run(c)));
				// The inline path keeps its own array, so partial results come
				// for free — but batchDone reads batchPartial, so it has to
				// see them too.
				batchPartial = rows.slice();
			} catch (err) {
				showError(err);
				batchDone(null);
				return;
			}
			i++;
			batchProgress(i, n);
			setTimeout(step, 0);
		};
		setTimeout(step, 0);
	}

	/* A against B, on every row the batch panel reports, plus which settings
	   differ between the two — because "the scoring leader moved 1.4 points"
	   only means something next to "because I moved pace and specialization". */
	const BATCH_ROWS = [
		["mean ovr", "ovr", 2], ["mean pot", "pot", 2], ["mean MPG", "mpg", 2],
		["mean PPG", "ppg", 2], ["mean RPG", "rpg", 2], ["mean APG", "apg", 2],
		["mean USG%", "usg", 2], ["mean TS%", "ts", 2],
		["team PPG", "teamPpg", 2], ["team AST", "teamAst", 2],
		["scoring leader", "topPpg", 2], ["assist leader", "topApg", 2],
		["block leader", "topBpg", 2], ["awards/class", "awards", 1],
		["honored players", "honored", 1], ["distinct archetypes", "archetypes", 1],
	];

	/* Every held batch beside the current one, in one table. The last column is
	   the current run's difference from the FIRST held batch, which is the
	   baseline a sweep is measured against. */
	function batchDiff(held, rows) {
		const B = global.BatchStats;
		const now = effectiveCfg();
		const cols = held.concat([{
			label: "now", rows, seed: batchBaseSeed, cfg: now,
		}]);
		const box = el("div", "card");
		box.appendChild(el("h4", null, "Held batches, side by side"));
		/* What actually differs between the runs. With more than two columns
		   the pairwise "A → B" reading stops working, so each setting that
		   moves anywhere is listed with its value in every column. */
		const base = cols[0].cfg;
		const changed = Object.keys(now).filter((k) => {
			if (k === "seed" || k === "overrides" || k === "leagueWeights" ||
				k === "archetypeWeights" || k === "noteLines") return false;
			return cols.some((c) => String(c.cfg[k]) !== String(base[k]));
		});
		box.appendChild(el("p", "hint", changed.length
			? "Settings that differ: " + changed.map((k) =>
				k + " " + cols.map((c) => c.cfg[k]).join(" / ")).join(" · ")
			: "Same settings in every column — the differences below are sampling noise."));
		const table = el("table", "mini");
		const hr = el("tr");
		hr.appendChild(el("th", null, ""));
		for (const c of cols) {
			hr.appendChild(el("th", "num",
				c.label + " (" + c.rows.length + ")"));
		}
		hr.appendChild(el("th", "num", "now − " + cols[0].label));
		table.appendChild(hr);
		for (const [label, key, digits] of BATCH_ROWS) {
			const vals = cols.map((c) => B.mean(c.rows.map((r) => r[key])));
			if (!vals.every(Number.isFinite)) continue;
			const tr = el("tr");
			tr.appendChild(el("td", null, label));
			for (const v of vals) tr.appendChild(el("td", "num", v.toFixed(digits)));
			const d = vals[vals.length - 1] - vals[0];
			const td = el("td", "num");
			td.appendChild(el("span", Math.abs(d) < Math.pow(10, -digits) ? ""
				: d > 0 ? "up" : "down",
				(d > 0 ? "+" : "") + d.toFixed(digits)));
			tr.appendChild(td);
			table.appendChild(tr);
		}
		box.appendChild(table);
		return box;
	}

	function cancelBatch() {
		batchCancel = true;
		if (batchWorker) {
			batchWorker.terminate();
			batchWorker = null;
			batchDone(null);
		}
	}

	/* ------------------------------------------------------------- theming */

	function applyTheme() {
		const root = document.documentElement;
		if (state.theme === "system") root.removeAttribute("data-theme");
		else root.setAttribute("data-theme", state.theme);
		$("themeSelect").value = state.theme;
	}

	/* ----------------------------------------------------------------- init */

	function syncHeaderHeight() {
		const h = document.querySelector("header");
		if (h) {
			document.documentElement.style.setProperty("--headerH", h.offsetHeight + "px");
		}
	}

	Object.assign(global.App, {
		state, render, run, persist, openEditor, revealPlayer, visibleRows,
		editorPanel, modal, closeModal,
		clearLock, showPlayer, showTeam, showGame,
		runUniverse, exportUniverse, importUniverse, showPlayerInFile,
		// Exposed for tools/uismoke.js, which loads files without a file input.
		installFiles, paintConfig,
		copyText, announce, bulkApply, bulkShiftOvr, bulkLockAsIs, bulkClear, refreshBulkBar,
		snapshot,
		exportCsv, setStatus, showError, indexSnapshot,
	});

	const saved = restore();
	const fromHash = readHash();
	if (fromHash) state.overrideFingerprint = state.overrideFingerprint || null;
	window.addEventListener("resize", syncHeaderHeight);
	syncHeaderHeight();

	bindSettingsSearch();
	wrapSlidersWithNumbers();
	bindConfig();
	bindSliderNumbers();
	bindRandomize();
	bindSettingFilter();
	bindFiles();
	applyTheme();
	paintConfig();
	paintHistory();
	paintUndo();
	if (saved) applyOpenGroups(saved.open);

	$("errClose").addEventListener("click", clearError);
	$("warnClose").addEventListener("click", () => { $("warnBanner").hidden = true; });
	/* The settings panel is a toggle at EVERY width now, not only narrow.
	   On a phone it starts closed — the first act is to look at the class,
	   not the sliders. On a desktop it starts open, and closing it hands
	   its 320px column to the forty-column table. The two states persist
	   separately, so closing it on a phone does not close it on a desktop. */
	/* One chip per fieldset. Clicking opens that group and scrolls to it, so a
	   phone user reaches "Awards" without dragging past fifty controls. */
	(function buildSettingsJump() {
		const nav = $("settingsJump");
		if (!nav) return;
		for (const grp of document.querySelectorAll("aside details.grp")) {
			const sum = grp.querySelector("summary");
			if (!sum || !grp.id) continue;
			const a = el("a", null, sum.textContent.trim());
			a.href = "#" + grp.id;
			a.addEventListener("click", (e) => {
				e.preventDefault();
				grp.open = true;
				grp.scrollIntoView({ behavior: "smooth", block: "start" });
			});
			nav.appendChild(a);
		}
	})();
	(function bindSettingsToggle() {
		const btn = $("btnSettings");
		if (!btn) return;
		const narrow = () => window.matchMedia("(max-width: 860px)").matches;
		const KEY = "bbgmdc.settingsPanel";
		let pref = {};
		try { pref = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) {}
		const isOpen = () => (narrow() ? pref.narrow === true : pref.wide !== false);
		const apply = () => {
			document.body.classList.toggle("settings-open", narrow() && isOpen());
			document.body.classList.toggle("settings-closed", !narrow() && !isOpen());
			btn.setAttribute("aria-expanded", isOpen() ? "true" : "false");
			btn.textContent = isOpen() ? "Hide settings" : "Settings";
		};
		const toggle = () => {
			if (narrow()) pref.narrow = !isOpen();
			else pref.wide = !isOpen();
			try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {}
			apply();
		};
		btn.addEventListener("click", toggle);
		document.addEventListener("keydown", (e) => {
			if (e.key !== "s" || e.ctrlKey || e.metaKey || e.altKey) return;
			const tag = (e.target && e.target.tagName) || "";
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			toggle();
		});
		window.addEventListener("resize", apply);
		apply();
	})();

	$("btnReroll").addEventListener("click", reroll);
	// Not `run` directly: run takes an `after` callback and a listener
	// would pass it the click event.
	$("btnRerun").addEventListener("click", () => run());
	$("btnUndo").addEventListener("click", undo);
	$("btnExport").addEventListener("click", () => {
		exportActive(currentExportOpts());
	});
	$("btnExportMenu").addEventListener("click", exportMenu);
	$("btnExportAll").addEventListener("click", exportAll);
	/* Merging the class into a whole league file. The file is the user's own
	   league export and can be very large, so the read is announced and the
	   parse failure is a sentence rather than a raw throw. */
	$("leagueMergeFile").addEventListener("change", (e) => {
		const f = e.target.files[0];
		e.target.value = "";
		if (!f) return;
		const picked = (state.mergeIndices && state.mergeIndices.length
			? state.mergeIndices
			: [state.active]).filter((i) => state.files[i]);
		state.mergeIndices = null;
		const results = [];
		for (const i of picked) {
			const r = ensureResult(i);
			if (r) results.push(r);
		}
		if (!results.length) return;
		setStatus("Reading " + f.name + "…", true);
		readTextFile(f).then((text) => {
			let out;
			try {
				const league = JSON.parse(text);
				out = global.Engine.mergeManyIntoLeague(results, league,
					state.mergeOpts || {});
			} catch (err) {
				setStatus("Could not merge: " + (err && err.message ? err.message : err));
				return;
			}
			/* No BOM here, unlike the CSV exports: this file is read back by
			   BBGM's own league loader, not by a spreadsheet. */
			const base = f.name.replace(/\.json(\.gz)?$/i, "").replace(/\.gz$/i, "");
			const years = out.seasons.slice().sort((a, b) => a - b).join("_");
			download(base + "_with_" + years + "_class.json",
				JSON.stringify(out.file), "application/json");
			setStatus("Merged " + (out.replaced + out.added) + " players into " +
				f.name + " (" + out.replaced + " replaced, " + out.added + " added, " +
				out.removed + " generated prospects dropped) for the " +
				out.seasons.slice().sort((a, b) => a - b).join(", ") + " draft" +
				(out.seasons.length === 1 ? "" : "s") + ". Load the new file with " +
				"Create New League → upload." +
				(out.warnings && out.warnings.length ? " " + out.warnings.join(" ") : ""));
		}).catch((err) => {
			setStatus(f.name + " could not be read: " +
				(err && err.message ? err.message : err));
		});
	});
	$("csvFile").addEventListener("change", (e) => {
		const f = e.target.files[0];
		if (!f) return;
		const r = new FileReader();
		r.onload = () => importLocksCsv(String(r.result));
		r.readAsText(f);
		e.target.value = "";
	});
	$("btnPin").addEventListener("click", () => {
		const res = state.results[state.active];
		if (!res) return;
		state.pinned = indexSnapshot(snapshot(res));
		state.tab = "compare";
		setStatus("Pinned seed " + res.seed + " as the comparison baseline.");
		render();
	});
	/* The card layout follows the viewport in "auto" mode, so a rotation or a
	   window resize has to re-render — otherwise a phone turned landscape keeps
	   the card stack and a desktop window dragged narrow keeps the forty-column
	   table. Debounced, and it only re-renders when the answer actually
	   changed, so dragging a window edge is not seventy table rebuilds. */
	let resizeTimer = null;
	let lastCardMode = null;
	window.addEventListener("resize", () => {
		if ((state.cardView || "auto") !== "auto") return;
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			const now = V.cardMode();
			if (now === lastCardMode) return;
			lastCardMode = now;
			if (state.results[state.active]) render();
		}, 180);
	});

	$("themeSelect").addEventListener("change", (e) => {
		if (!THEMES.includes(e.target.value)) return;
		state.theme = e.target.value;
		applyTheme();
		persist();
	});
	$("seedHistory").addEventListener("change", (e) => {
		const v = e.target.value;
		e.target.value = "";
		if (!v) return;
		if (historyCommand(v)) return;
		state.cfg.seed = v;
		$("seed").value = v;
		run();
	});
	$("seedPill").addEventListener("click", () => {
		copyText($("seedPill").dataset.seed || "", null, "");
		const p = $("seedPill");
		const was = p.textContent;
		p.textContent = "seed copied ✓";
		setTimeout(() => { p.textContent = was; }, 1200);
	});
	/* You could share a seed and not receive one: taking somebody else's meant
	   opening the settings panel and finding the field by hand. Shift-click (or
	   right-click) the pill and paste. */
	const pasteSeed = (e) => {
		e.preventDefault();
		const take = (text) => {
			const seed = String(text || "").trim();
			if (!seed) return;
			pushUndo("pasted a seed");
			state.cfg.seed = seed;
			$("seed").value = seed;
			state.presetDirty = true;
			run();
		};
		if (navigator.clipboard && navigator.clipboard.readText) {
			navigator.clipboard.readText().then(take, () => promptSeed(take));
		} else promptSeed(take);
	};
	$("seedPill").addEventListener("contextmenu", pasteSeed);
	$("seedPill").addEventListener("click", (e) => { if (e.shiftKey) pasteSeed(e); }, true);

	/* Clipboard read needs a permission the copy path does not, and it is
	   refused outright on file:// in most browsers — which is the documented
	   way to use this tool. Ask for the seed instead of failing silently. */
	function promptSeed(take) {
		const box = el("div");
		box.appendChild(el("p", "hint", "Paste a seed to load the class it produces."));
		const input = el("input");
		input.type = "text";
		input.value = "";
		input.setAttribute("aria-label", "Seed");
		box.appendChild(input);
		modal("Use a seed", box, () => take(input.value));
		setTimeout(() => input.focus(), 0);
	}
	$("btnCopyLink").addEventListener("click", () => {
		writeHash();
		copyText(location.href, $("btnCopyLink"), "Link");
	});
	$("btnBatch").addEventListener("click", () => {
		if (!state.files.length) return;
		runBatch(Math.max(2, Math.min(200, Number($("batchN").value) || 10)));
	});
	$("btnBatchCancel").addEventListener("click", cancelBatch);
	$("btnRedo").addEventListener("click", redo);
	$("btnKeys").addEventListener("click", shortcutSheet);
	$("btnHowTo").addEventListener("click", howToSheet);
	$("modalOk").addEventListener("click", () => {
		const fn = modalOk;
		closeModal();
		if (fn) fn();
	});
	$("modalCancel").addEventListener("click", closeModal);
	$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") V.closeRowMenu();
		if (e.key === "Escape" && !$("modal").hidden) closeModal();
		const tag = (e.target.tagName || "").toLowerCase();
		const typing = tag === "input" || tag === "textarea" || tag === "select";
		/* Ctrl+Enter / Cmd+Enter triggers generation (Part 5D). Works even
		   when typing, since Ctrl+Enter is not a standard text input combo. */
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			e.preventDefault();
			if (!$("btnReroll").disabled) reroll();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
			if (typing) return;
			e.preventDefault();
			if (e.shiftKey) redo(); else undo();
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
			e.preventDefault();
			redo();
		}
		// The shortcuts were documented in the README and nowhere the user
		// could see them.
		if (e.key === "?" && !typing && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			shortcutSheet();
		}
		if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
		if (!$("modal").hidden) return;
		/* The verbs. There were six shortcuts and every one of them was a way
		   to MOVE — j, k, Enter, Escape, Tab — so the things a user does fifty
		   times an hour (reroll, jump to a tab, search, lock the row in front
		   of them) all needed the mouse. */
		const k = e.key;
		if (k >= "1" && k <= "9") {
			const t = TABS[Number(k) - 1];
			if (t && (t[0] !== "compare" || state.pinned)) {
				e.preventDefault();
				state.tab = t[0];
				persist();
				render();
			}
			return;
		}
		if (k === "/") {
			const box = $("prospectSearch");
			if (box) { e.preventDefault(); box.focus(); box.select(); }
			return;
		}
		if (k === "r" && !$("btnReroll").disabled) { e.preventDefault(); reroll(); return; }
		if (k === "g") {
			e.preventDefault();
			randomizeSettings(($("randomScope") || {}).value || state.randomScope);
			return;
		}
		if (k === "e" && !$("btnExport").disabled) {
			e.preventDefault();
			exportActive(currentExportOpts());
			return;
		}
		if (k === "p" && !$("btnPin").disabled) { e.preventDefault(); $("btnPin").click(); return; }
		if (k === "l" || k === "L") {
			const row = document.activeElement && document.activeElement.closest
				? document.activeElement.closest("tr[data-pkey]") : null;
			if (!row) return;
			e.preventDefault();
			toggleLockFor(row.dataset.pkey);
			return;
		}
		if (k === "[" || k === "]") {
			const sel = $("archFilter");
			if (!sel) return;
			e.preventDefault();
			const i = sel.selectedIndex + (k === "]" ? 1 : -1);
			sel.selectedIndex = (i + sel.options.length) % sel.options.length;
			state.filter.archetype = sel.value;
			render();
		}
	});

	/* Lock (or unlock) one player from the keyboard. Locking is the tool's
	   central verb and it needed a mouse: open the editor, find the control,
	   click, close. */
	function toggleLockFor(key) {
		const res = state.results[state.active];
		const p = res && res.players.filter((x) => x.key === key)[0];
		if (!p) return;
		let said;
		if (state.overrides[key]) {
			pushUndo("cleared the lock on " + p.name);
			delete state.overrides[key];
			said = "Unlocked " + p.name + ".";
		} else {
			pushUndo("locked " + p.name);
			state.overrides[key] = {
				ovr: p.newOvr, archetype: p.archetype, college: p.newCollege,
			};
			said = "Locked " + p.name + " at ovr " + p.newOvr + ", " +
				p.archetype + ", " + p.newCollege + ".";
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		// Through `after`, so the busy line does not eat it. See beginBusy.
		run(() => setStatus(said));
	}

	const SHORTCUTS = [
		["?", "Show this list"],
		["Ctrl / Cmd + Enter", "Reroll the class (works anywhere)"],
		["1 – 9", "Jump to a tab"],
		["r", "Reroll the class"],
		["g", "Randomize the settings in the chosen scope"],
		["/", "Focus the prospect search"],
		["l", "Lock or unlock the focused row"],
		["[ / ]", "Previous / next archetype filter"],
		["p", "Pin this class as the comparison baseline"],
		["e", "Export the active file"],
		["s", "Show or hide the settings panel"],
		["Ctrl / Cmd + Z", "Undo the last change — a reroll included"],
		["Ctrl / Cmd + Shift + Z", "Redo it"],
		["j / ↓", "Next prospect in the table"],
		["k / ↑", "Previous prospect"],
		["Enter or Space", "Open the editor for the focused row"],
		["Escape", "Close the editor or a dialog"],
		["Tab", "Into the table, then arrow keys between rows"],
	];

	function shortcutSheet() {
		const box = el("div");
		const dl = el("dl", "shortcuts");
		for (const [keys, what] of SHORTCUTS) {
			dl.appendChild(el("dt", null, keys));
			dl.appendChild(el("dd", null, what));
		}
		box.appendChild(dl);
		modal("Keyboard shortcuts", box);
	}

	/* --------------------------------------------------------- how to play */

	/* A guided tour, in the app itself. The README explains the same things
	   at more length; this is the version you can read without leaving the
	   class you are working on. */
	const HOW_TO_PLAY = [
		["1. Load a class", "Export a draft class from Basketball GM " +
			"(Tools → Export → Draft class) and drop the .json here. Nothing " +
			"is uploaded; everything runs in your browser. You can load " +
			"several files and switch between them."],
		["2. Reroll until something catches your eye", "Reroll (r) draws a " +
			"new seed: a new class flavor, a new build pool, a new season. " +
			"The seed pill in the header reproduces the exact class — click " +
			"it to copy, shift-click to paste one in. Re-apply keeps the seed " +
			"and re-runs the current settings over it."],
		["3. Shape the class with the settings panel", "Each fieldset is one " +
			"idea. Quality & depth shapes the overall curve (switch to " +
			"“Rebuild the class curve” to unlock it). Builds decides how " +
			"specialized players are, how many archetypes one class draws " +
			"from, and its flavor — pick a flavor in the dropdown to keep " +
			"the seed and change what kind of class it is. Class years, " +
			"destinations, the college season, and awards each own their " +
			"corner. Every slider shows what it means in units underneath, " +
			"and what part of the pipeline it re-runs."],
		["4. Or let the dice do it", "The 🎲 Randomize control (g) draws new " +
			"settings in the chosen scope. “Everything, gently” stays near " +
			"the defaults; “everything, wide open” uses each slider's whole " +
			"range; the other scopes randomize one fieldset. It never touches " +
			"the seed (Reroll owns that), the per-build rarity table, or any " +
			"setting you lock with the padlock next to its name. Ctrl+Z puts " +
			"everything back in one step."],
		["5. Lock what must survive", "Open a prospect and lock his overall, " +
			"build, school or individual ratings — locks survive rerolls, so " +
			"you can keep the player you like while the class around him " +
			"changes. l locks the focused row as-is. The padlocks in the " +
			"settings panel are different: they guard a SETTING against the " +
			"randomizer."],
		["6. Read the season, not just the board", "The class plays a full " +
			"college season: standings, a bracket, awards, game logs, box " +
			"scores, events. A prospect's stat line, his awards and his draft " +
			"stock all come from games that were actually simulated, so the " +
			"Notes tab can defend every claim it makes."],
		["7. Compare, pin, and keep what you like", "Pin (p) keeps the " +
			"current class as a baseline and the Compare tab holds prospects " +
			"side by side. Save preset… names your slider setup; the Link " +
			"button copies a URL that reproduces the exact class, settings " +
			"and locks."],
		["8. Export back to BBGM", "Export JSON writes a draft class file " +
			"BBGM imports directly — every player re-solved against BBGM's " +
			"own formulas, so what you see here is what the game computes. " +
			"More ▾ has CSV, season data and the settings on their own."],
	];

	function howToSheet() {
		const box = el("div");
		box.appendChild(el("p", "hint",
			"The panel's own hints cover each slider; this is the shape of " +
			"the whole loop. Press ? for the keyboard shortcuts."));
		for (const [head, body] of HOW_TO_PLAY) {
			const h = el("h4", null, head);
			h.style.margin = "12px 0 4px";
			box.appendChild(h);
			box.appendChild(el("p", null, body));
		}
		modal("How to play", box);
	}
})(window);
