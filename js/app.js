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
		// Active mutators (js/replaymeta.js), applied in effectiveCfg.
		mutators: [],
		mergeIndices: null,
		/* The league export the loaded classes came out of, if any. Kept in
		   memory (never persisted — it is megabytes) so a merge back into it
		   does not ask the user to find the same file on disk again. */
		leagueSource: null,
		cfg: CFG.make(),
		files: [],       // [{name, data, fingerprint}]
		runners: [],     // parallel to files
		results: [],     // parallel to files; entries may be null until needed
		active: 0,
		/* The Draft board is the front page: the question a class answers is
		   "who is good and in what order", and the forty-column editable
		   table is the power tool behind a toggle on it, not the thing the
		   tool opens on. */
		tab: "board",
		// "board" | "edit" — which face of the Draft board tab is showing.
		boardMode: "board",
		sort: [{ key: "newOvr", dir: -1 }],
		filter: {
			q: "", pos: "", conf: "", archetype: "", changedOnly: false, lockedOnly: false,
			/* Two questions, not one: "only the men who played" and "only the
			   men who did not". See matchesFilter in js/views.js. */
			playedOnly: false, didNotPlayOnly: false,
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
		/* And the class FLAVORS, newest first — the same mechanism one layer
		   UP, and the one axis of the three that never had it. See
		   rememberPool and flavorMemoryFactor in js/ratings.js. */
		flavorHistory: [],
		presetName: "default",
		presetDirty: false,
		customPresets: {},
		editing: null,   // player key currently open in the editor
		/* Seeded from the columns flagged `off` (see defaultHiddenColumns in
		   js/views.js); a saved preference replaces it in loadSettings. It
		   used to start {}, so a first visit showed all sixty-one columns. */
		hiddenColumns: V.defaultHiddenColumns ? V.defaultHiddenColumns() : {},
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
		   ensureResult. Not persisted: carryOver is a map of 364 programs and
		   it is cheap to rebuild by re-running the chain. */
		universe: {
			rows: [], threads: [], alumni: [], baseSeed: "", running: false,
			cfgs: {},
		},
		/* An imported universe's player biographies and its per-season result
		   fingerprints. Neither is a setting and neither is persisted: they
		   belong to the file that was imported, and they are consumed by the
		   chain it starts. */
		universeBiography: null,
		universeExpect: null,
		// The randomizer's scope select, persisted like every other control.
		randomScope: "gentle",
		/* Whether Randomize draws an independent settings patch for EACH
		   loaded file, rather than one shared draw applied to all of them.
		   Persisted like the scope it modifies; meaningless (and hidden)
		   with fewer than two files loaded. */
		randomizePerFile: false,
		/* One randomized-settings patch per file index, when randomizePerFile
		   is on: {key: value, ..., leagueWeights: {...}}, consumed by
		   fileCfgFor. NOT persisted — files themselves are not persisted
		   across a reload, so a patch keyed by file index would outlive the
		   files it was drawn for and silently apply to whatever loads into
		   that slot next. Reset whenever a new set of files is installed. */
		fileCfgs: {},
		// Settings the randomizer must not touch. {key: true}.
		settingLocks: {},
		/* The randomizer's own seed, so a draw can be reproduced: the one
		   action in a deterministic tool that used Math.random() was the one
		   that could not be shared. Set by randomizeSettings, shown in the
		   status line, replayable by shift-clicking Randomize. */
		lastRandomSeed: null,
		/* Which tier of the settings panel is shown: "shape" is the handful
		   of sliders a new user needs, "season" adds the college season and
		   awards, "model" is everything. Persisted like every other view
		   choice. The search box and "only what I changed" cut across it. */
		settingTier: "model",
		/* RUN HISTORY. The seed list remembers twelve seeds, and a seed is not
		   a run: the run is seed + settings + locks + the pool and anomaly
		   memories it was drawn against. One entry per reroll, labelled by
		   the class fingerprint and flavor, restorable in one step (through
		   the undo stack, so restoring is itself undoable). */
		sessions: [],
		/* The run the next one branches from. See rememberSession: this is
		   what turns the history into a lineage instead of a stack. */
		lastSessionId: null,
		/* The challenge currently being attempted, by key. See CHALLENGES:
		   a fixed seed and a settings budget, which is the inverse of
		   "Reroll until…". */
		challenge: null,
		/* Replayability (see js/replay.js): the campaign's cleared tiers and
		   the dials that cleared each, the reruns of the current attempt, an
		   imported rival's result, and the active puzzle's target headlines. */
		challengeProgress: { cleared: {} },
		replayRun: null,
		ghost: null,
		puzzle: null,
		/* Which season's carry-over the Universe tab's world table is showing.
		   See worldSection in js/views.js. */
		worldSeason: null,
		/* THE LAST SEARCH, SO IT CAN BE RUN AGAIN.

		   "Reroll until…" is the tool's one iterative verb — you run it,
		   look at what came back, and run it again with the same conditions
		   and a longer leash — and the dialog opened blank every time, so
		   every repeat meant re-picking the clauses off a list of twelve.
		   {keys: ["!tallTop5", …], tries: n}, persisted like every other
		   view choice. */
		lastUntil: null,
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
	// Bumped when the meaning of a saved hiddenColumns map changes; see restore.
	const HIDDEN_COLUMNS_SCHEME = 2;

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

	/* THE PERSISTENCE BUDGET.

	   A universe's rows, threads and alumni all grow with the timeline —
	   alumni at about five a season, threads with every repeat champion — and
	   a fifty-season universe plus a folder of overrides is a plausible quota
	   failure with no recovery path, because the thing that overflows is
	   written by the same call that writes the settings. So what is stored is
	   BOUNDED: the whole timeline (small, and the point of the tab), the most
	   recent alumni, and the threads. Anything dropped is one re-run away —
	   the chain rebuilds all of it from seeds — while settings, presets and
	   pinned classes are not, which is why they are the ones protected.

	   If it still does not fit, the second attempt drops the universe payload
	   entirely rather than losing everything else with it. */
	/* The registry is one row per person across every loaded file, which for a
	   forty-season universe is a few thousand small objects. Bounded like the
	   alumni index and for the same reason: this is a localStorage payload, and
	   the rows that matter are the careers rather than the one-season men. */
	const PERSIST_REGISTRY = 300;
	const PERSIST_ALUMNI = 400;
	const PERSIST_ROWS = 200;
	const PERSIST_THREADS = 120;

	function universeForStorage() {
		const u = state.universe;
		return {
			rows: u.rows.slice(-PERSIST_ROWS),
			/* Whether any bound below dropped something, so an export made
			   after a reload can say its early history is missing. */
			truncated: !!u.truncated || u.rows.length > PERSIST_ROWS ||
				(u.threads || []).length > PERSIST_THREADS ||
				(u.alumni || []).length > PERSIST_ALUMNI,
			threads: (u.threads || []).slice(0, PERSIST_THREADS),
			alumni: (u.alumni || []).slice(-PERSIST_ALUMNI),
			baseSeed: u.baseSeed,
			records: u.records || null,
			/* The careers, longest first, and only the multi-season ones: a
			   person who appears once is a draft prospect and his page already
			   says so. See PERSIST_REGISTRY. */
			registry: registryForStorage(),
			coachTree: u.coachTree || null,
			broken: u.broken || null,
			/* WHAT THE WORLD WAS BUILT UNDER, AND WHERE IT STOPPED.

			   None of these were persisted, so after a reload the export fell
			   back to the PANEL's settings, an extension had no tail to
			   continue from, and the order the seeds are keyed to was gone.
			   The tail is the carry (every programme, bounded), the pool and
			   anomaly memories and the returner window — tens of kilobytes,
			   and the one thing that turns "load a later class" into the next
			   link rather than a rebuild. */
			settings: u.settings || null,
			segments: (u.segments || []).map((g) => ({
				kind: g.kind, from: g.from, to: g.to, settings: g.settings || null,
			})),
			order: (u.order || []).map((d) => ({
				index: d.index, name: d.name || null, season: d.season,
				fingerprint: d.fingerprint || null, seed: d.seed || null, synth: d.synth || undefined,
			})),
			tail: u.running ? null : (u.tail || null),
			engineRev: u.engineRev || null,
			viewOnly: !!u.viewOnly,
			name: u.name || null,
			createdAt: u.createdAt || null,
			followed: u.followed || null,
			dynasty: u.dynasty || null,
			/* The imported biographies: a rebuilt season without them draws
			   different men. Held on state, not on the universe; see 6020. */
			biography: state.universeBiography || null,
		};
	}

	function registryForStorage() {
		const reg = state.universe.registry;
		if (!reg) return null;
		const keep = Object.keys(reg)
			.map((id) => reg[id])
			.filter((x) => x && x.span >= 2)
			.sort((a, b) => b.span - a.span)
			.slice(0, PERSIST_REGISTRY);
		if (!keep.length) return null;
		const out = {};
		for (const x of keep) out[x.id] = x;
		return out;
	}

	function persist() {
		scheduleAutosave();
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(payload()));
		} catch (e) {
			const quota = e && (e.name === "QuotaExceededError" ||
				e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);
			if (quota) {
				/* Shed the universe and try once more: a timeline is derived
				   state and re-runs from its seeds, and settings are not. */
				try {
					localStorage.setItem(STORE_KEY,
						JSON.stringify(Object.assign(payload(), { universe: null })));
					if (!quotaWarned) {
						quotaWarned = true;
						setStatus("Browser storage is full, so the saved timeline was " +
							"dropped to keep your settings. Rebuild it any time — a " +
							"universe re-runs from its seeds.", true);
					}
					return;
				} catch (e2) { /* fall through to the warning below */ }
			}
			persistFailed(e);
		}
	}

	function payload() {
		return {
			v: STORE_VERSION,
			cfg: state.cfg,
			overrides: state.overrides,
			overrideFingerprint: state.overrideFingerprint,
			history: state.history.slice(0, 12),
			poolHistory: state.poolHistory,
			anomalyHistory: state.anomalyHistory,
			flavorHistory: state.flavorHistory,
			mutators: state.mutators,
			presetName: state.presetName,
			presetDirty: state.presetDirty,
			customPresets: state.customPresets,
			hiddenColumns: state.hiddenColumns,
			/* Marks hiddenColumns as saved under the default-hidden scheme, so
			   an empty map here is a deliberate "show everything". */
			hiddenColumnsScheme: HIDDEN_COLUMNS_SCHEME,
			columnOrder: state.columnOrder,
			statMode: state.statMode,
			compare: state.compare,
			columnLayouts: state.columnLayouts,
			standingsConf: state.standingsConf,
			player: state.player,
			team: state.team,
			game: state.game,
			universe: universeForStorage(),
			density: state.density,
			cardView: state.cardView,
			cardAll: state.cardAll,
			compactBracket: state.compactBracket,
			theme: state.theme,
			randomScope: state.randomScope,
			randomizePerFile: state.randomizePerFile,
			settingLocks: state.settingLocks,
			settingTier: state.settingTier,
			challenge: state.challenge,
			challengeProgress: state.challengeProgress,
			replayRun: state.replayRun,
			ghost: state.ghost,
			puzzle: state.puzzle,
			lastUntil: state.lastUntil,
			sessions: state.sessions.slice(0, SESSIONS_MAX),
			// The branch point, so a reload continues the lineage rather than
			// starting a second root beside it. See rememberSession.
			lastSessionId: state.lastSessionId,
			sort: state.sort,
			tab: state.tab,
			boardMode: state.boardMode,
			// Small (a name and six numbers per prospect) and the whole
			// point of pinning is that it outlives the class you pinned.
			// byKey is a lookup index rebuilt on restore, not state worth storing.
			pinned: state.pinned
				? Object.assign({}, state.pinned, { byKey: undefined })
				: null,
			open: openGroups(),
		};
	}

	function persistFailed(e) {
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

	/* A stored universe (localStorage's bounded copy or an IndexedDB slot's
	   full one) back into state.universe's shape. */
	function universeFromSaved(su) {
		return {
			rows: su.rows,
			/* Threads used to be sentences and are objects now (see
			   Universe.threads). A stored timeline from before that is
			   still readable — the view renders either — so it is kept
			   rather than thrown away on a shape change that costs
			   nothing to tolerate. */
			threads: Array.isArray(su.threads) ? su.threads : [],
			alumni: Array.isArray(su.alumni) ? su.alumni : [],
			baseSeed: validString(su.baseSeed) || "",
			records: su.records && typeof su.records === "object"
				? su.records : null,
			coachTree: su.coachTree &&
				typeof su.coachTree === "object"
				? su.coachTree : null,
			/* THE REGISTRY WAS WRITTEN AND NEVER READ BACK.

			   universeForStorage() persists it — deliberately bounded to
			   the longest careers, for exactly the reason a persisted
			   payload is bounded — and this rebuilt state.universe
			   without the field, so every reload dropped it. The Careers
			   section renders off u.registry and returns early when it is
			   missing, so the one view in the tool that is about PEOPLE
			   rather than about programmes was empty after every refresh,
			   silently, while the data sat in localStorage. */
			registry: su.registry &&
				typeof su.registry === "object" &&
				!Array.isArray(su.registry)
				? su.registry : null,
			broken: su.broken || null,
			/* What universeForStorage now keeps so that an export after a
			   reload writes the world's own settings rather than the
			   panel's, and a later class extends the chain rather than
			   rebuilding it. Each is optional: an older payload has none. */
			settings: su.settings && typeof su.settings === "object"
				? su.settings : null,
			segments: Array.isArray(su.segments) ? su.segments : [],
			order: Array.isArray(su.order) ? su.order : [],
			tail: su.tail && typeof su.tail === "object"
				? su.tail : null,
			engineRev: su.engineRev || null,
			viewOnly: !!su.viewOnly,
			truncated: !!su.truncated,
			name: validString(su.name) || null,
			createdAt: validString(su.createdAt) || null,
			cfgs: {},
			running: false,
			/* Universe play (audit section 5): persisted and exported. */
			followed: validString(su.followed) || null,
			dynasty: su.dynasty && typeof su.dynasty === "object" &&
				validString(su.dynasty.program) ? su.dynasty : null,
			/* Only a full (IndexedDB) save carries these. */
			programs: su.programs && typeof su.programs === "object" ? su.programs : {},
			recruiting: Array.isArray(su.recruiting) ? su.recruiting : null,
		};
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
		if (saved.cfg && typeof saved.cfg === "object") state.cfg = fitEra(CFG.make(saved.cfg));
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
		// A flat list of names rather than a list of lists — one flavor a class.
		if (Array.isArray(saved.flavorHistory)) {
			state.flavorHistory = saved.flavorHistory
				.filter((n) => typeof n === "string");
		}
		state.mutators = global.ReplayMeta.cleanMutators(saved.mutators);
		if (validString(saved.presetName)) state.presetName = saved.presetName;
		state.presetDirty = !!saved.presetDirty;
		if (saved.customPresets && typeof saved.customPresets === "object" &&
			!Array.isArray(saved.customPresets)) state.customPresets = saved.customPresets;
		/* An EMPTY hidden-columns map from a build before the default-hidden
		   scheme is not a choice: it is what every install started with, so
		   such a user kept all sixty-one columns forever. Only a map saved
		   under the scheme marker is trusted when empty. */
		{
			const hc = validFlagMap(saved.hiddenColumns);
			const marked = Number(saved.hiddenColumnsScheme) >= HIDDEN_COLUMNS_SCHEME;
			if (hc && (Object.keys(hc).length || marked)) state.hiddenColumns = hc;
			else if (hc && V.defaultHiddenColumns) state.hiddenColumns = V.defaultHiddenColumns();
		}
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
			state.universe = universeFromSaved(saved.universe);
			state.universeBiography = saved.universe.biography &&
				typeof saved.universe.biography === "object"
				? saved.universe.biography : null;
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
		state.randomizePerFile = !!saved.randomizePerFile;
		state.settingLocks = validFlagMap(saved.settingLocks) || state.settingLocks;
		if (validString(saved.settingTier, SETTING_TIERS.map((t) => t[0]))) {
			state.settingTier = saved.settingTier;
		}
		if (Array.isArray(saved.sessions)) {
			state.sessions = saved.sessions.filter((x) => x && typeof x === "object" &&
				x.cfg && typeof x.cfg === "object" && typeof x.label === "string")
				.slice(0, SESSIONS_MAX);
			/* A session that predates the lineage has no id; give it one so it
			   can be a parent, and leave its own parent null, which makes it a
			   root of the tree rather than an orphan hanging off nothing. */
			state.sessions.forEach((x, i) => {
				if (!x.id) x.id = "legacy" + i + "/" + (x.at || 0);
				if (!Array.isArray(x.changed)) x.changed = [];
			});
			if (typeof saved.lastSessionId === "string") {
				state.lastSessionId = saved.lastSessionId;
			}
		}
		restoreReplay(saved);
		if (typeof saved.challenge === "string" && findChallenge(saved.challenge)) {
			state.challenge = saved.challenge;
		}
		/* Checked against the live predicate table, not trusted: a clause
		   whose predicate has since been renamed is dropped rather than
		   pre-filling a condition the dialog cannot show. */
		if (saved.lastUntil && typeof saved.lastUntil === "object" &&
			Array.isArray(saved.lastUntil.keys)) {
			const keys = saved.lastUntil.keys
				.filter((k) => typeof k === "string" &&
					global.Engine.parseRerollClause(k));
			if (keys.length) {
				state.lastUntil = {
					keys,
					tries: Number.isFinite(Number(saved.lastUntil.tries))
						? Number(saved.lastUntil.tries) : 25,
				};
			}
		}
		const sort = validSortStack(saved.sort);
		if (sort) state.sort = sort;
		// indexSnapshot walks players, and a malformed pin must not stop startup.
		if (saved.pinned && typeof saved.pinned === "object" &&
			Array.isArray(saved.pinned.players)) {
			state.pinned = indexSnapshot(saved.pinned);
		}
		// Never land on a tab that has nothing to show. A session saved before
		// the prospect table became a mode of the Draft board carries
		// tab: "players", which is no longer a tab — it is the board in edit
		// mode, which is what that session was actually looking at.
		let tab = saved.tab;
		if (tab === "players") { tab = "board"; state.boardMode = "edit"; }
		if (tab && (tab !== "compare" || state.pinned) &&
			TABS.some(([k]) => k === tab)) state.tab = tab;
		if (saved.boardMode === "edit" || saved.boardMode === "board") {
			state.boardMode = saved.boardMode;
		}
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
			// And the flavor memory, for the same reason.
			flavorHistory: (state.flavorHistory || []).slice(),
			/* Per-file randomized-settings patches (see randomizeSettings'
			   "draw separately for each loaded class"), for the same reason
			   lastSeed is here: it is an input that lives outside cfg, and an
			   undone per-file draw that left the old patches in place would
			   restore the settings panel without restoring what each file
			   actually ran with. */
			fileCfgs: JSON.parse(JSON.stringify(state.fileCfgs || {})),
			// An input outside cfg too: the biographies decide who is drawn.
			universeBiography: state.universeBiography || null,
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
		setSnapshot(snap);
		// A restored class is a different class, so an editor open on somebody
		// who may not be in it any more has to close.
		state.editing = null;
		paintUndo();
		paintConfig();
		/* Through `after`: a message written before run() is overwritten by the
		   busy line a frame later and never seen. See beginBusy. */
		run(() => setStatus(verb + ": " + snap.label));
	}

	// The state half of applySnapshot, with no re-run: undoTo steps several.
	function setSnapshot(snap) {
		state.cfg = CFG.make(snap.cfg);
		state.overrides = snap.overrides;
		if (snap.lastSeed !== undefined) state.lastSeed = snap.lastSeed;
		if (Array.isArray(snap.poolHistory)) state.poolHistory = snap.poolHistory;
		if (Array.isArray(snap.anomalyHistory)) state.anomalyHistory = snap.anomalyHistory;
		if (Array.isArray(snap.flavorHistory)) state.flavorHistory = snap.flavorHistory;
		state.fileCfgs = snap.fileCfgs && typeof snap.fileCfgs === "object"
			? snap.fileCfgs : {};
		if (snap.universeBiography !== undefined) state.universeBiography = snap.universeBiography;
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

	/* Jump back `n` steps in one re-run. Each step pushes onto redo exactly
	   as undo() would, so Redo walks forward through them one at a time. */
	function undoTo(n) {
		n = Math.min(Math.max(1, n | 0), state.undo.length);
		if (!n) return;
		let prev = null;
		for (let i = 0; i < n; i++) {
			prev = state.undo.pop();
			state.redo.push(undoSnapshot(prev.label));
			if (state.redo.length > 40) state.redo.shift();
			setSnapshot(prev);
		}
		applySnapshot(prev, n > 1 ? "Undid " + n + " steps, back to before" : "Undid");
	}

	/* The undo history: every label on the stack, newest first; a click jumps
	   back to just before that change. */
	function undoHistoryDialog() {
		const box = el("div");
		if (!state.undo.length) {
			box.appendChild(el("p", "hint", "Nothing to undo yet."));
			modal("Undo history", box);
			return;
		}
		box.appendChild(el("p", "hint", "Pick a change to go back to just before it. " +
			"Redo steps forward again, one change at a time."));
		const list = el("ol", "undohistory");
		for (let i = state.undo.length - 1, n = 1; i >= 0; i--, n++) {
			const li = el("li");
			const b = el("button", "tiny", state.undo[i].label);
			b.dataset.steps = String(n);
			b.title = "Undo " + n + (n === 1 ? " step" : " steps");
			const steps = n;
			b.addEventListener("click", () => { closeModal(); undoTo(steps); });
			li.appendChild(b);
			list.appendChild(li);
		}
		box.appendChild(list);
		modal("Undo history", box);
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
		// The history dropdown beside it, made here so the header markup
		// stays as it is.
		let h = $("btnUndoHistory");
		if (!h) {
			h = el("button", "iconbtn", "▾");
			h.id = "btnUndoHistory";
			h.setAttribute("aria-label", "Undo history");
			h.setAttribute("aria-haspopup", "dialog");
			h.addEventListener("click", undoHistoryDialog);
			b.after(h);
		}
		h.disabled = !state.undo.length;
		h.title = state.undo.length
			? "Undo history — " + state.undo.length + " step" +
				(state.undo.length === 1 ? "" : "s") + " (right-click Undo too)"
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
		"talentCoupling", "birthplaceWeight",
		"pace", "scoringEnv", "efficiencyEnv", "statNoise", "upsetFactor",
		"archetypePool", "surpriseBudget", "injuryRate", "traitCount",
		"anomalyMemory", "flavorReach", "styleDrift",
		"realignmentRate", "bluebloodDownYears", "midMajorLift",
		"coachTurnover", "realignmentMemory", "starReturners", "portalRate",
		"recruitMomentum",
		"awardStrictness", "confAwardStrictness", "proAwardStrictness",
		"variation", "poolMemory", "flavorMemory", "teamMomentum", "awardNoise",
		"seasonEvents", "draftEvents",
		/* The meta-dial, the anomaly shortlist and the flavor blend. See
		   applyWeirdness and assignSurprises in js/engine.js, and blendFlavor
		   in js/ratings.js. */
		"weirdness", "anomalyChoices", "flavorBlend", "extrapolateYears",
	];

	/* WHAT "AT ITS DEFAULT" MEANS.

	   Config.DEFAULTS is the raw table, and two of its entries are null where
	   make() expands them — leagueWeights into the full destination table,
	   archetypeWeights into {}. So every comparison against the raw table saw
	   both as changed on a fresh page: a 700-character link at defaults,
	   "[object Object]" in the copied text, a Reset that offered to reset
	   them. A weight table is compared by the weights it produces, missing
	   entries reading as the built-in weight, so key order and an explicit
	   copy of a built-in value are not "a change" either. */
	let normDefaults = null;
	function defaultCfg() { return normDefaults || (normDefaults = CFG.make()); }
	function defaultOf(k) {
		const d = defaultCfg()[k];
		return d && typeof d === "object" ? JSON.parse(JSON.stringify(d)) : d;
	}
	function builtinWeight(k, name) {
		if (k === "leagueWeights") return defaultCfg().leagueWeights[name];
		const a = RB.ARCHETYPES.filter((x) => x.name === name)[0];
		return a ? (a.w === undefined ? 1 : a.w) : undefined;
	}
	function isWeightTable(k) { return k === "leagueWeights" || k === "archetypeWeights"; }
	function sameSetting(k, a, b) {
		if (isWeightTable(k)) {
			const x = a || {};
			const y = b || {};
			const names = new Set(Object.keys(x).concat(Object.keys(y)));
			for (const n of names) {
				const vx = Number.isFinite(x[n]) ? x[n] : builtinWeight(k, n);
				const vy = Number.isFinite(y[n]) ? y[n] : builtinWeight(k, n);
				if (vx !== vy) return false;
			}
			return true;
		}
		return JSON.stringify(a === undefined ? null : a) ===
			JSON.stringify(b === undefined ? null : b);
	}
	function isDefaultSetting(k, v) { return sameSetting(k, v, defaultCfg()[k]); }
	/* The part of a setting worth writing down: a weight table as only the
	   entries that differ from the built-ins, anything else as itself.
	   Undefined when the setting is at its default. */
	function settingDelta(k, v) {
		if (isDefaultSetting(k, v)) return undefined;
		if (!isWeightTable(k)) return v;
		const out = {};
		for (const n of Object.keys(v || {})) {
			if (v[n] !== builtinWeight(k, n)) out[n] = v[n];
		}
		return out;
	}

	// The build table is the authority on how many builds there are; every
	// place that used to guess (98, 117, 121) has been wrong at some point.
	function archetypeTableSize() {
		return global.RatingsBuilder ? global.RatingsBuilder.ARCHETYPES.length : 205;
	}

	const FORMAT = {
		pDII: (v) => (v * 100).toFixed(1) + "%",
		talentCoupling: (v) => v.toFixed(1) + "x",
		birthplaceWeight: (v) => v.toFixed(1) + "x",
		specialization: (v) => v.toFixed(2) + "x",
		classFlavor: (v) => v.toFixed(2) + "x",
		statNoise: (v) => v.toFixed(2) + "x",
		upsetFactor: (v) => v.toFixed(2) + "x",
		awardStrictness: (v) => v.toFixed(2) + "x",
		confAwardStrictness: (v) => v.toFixed(2) + "x",
		proAwardStrictness: (v) => v.toFixed(2) + "x",
		archetypeDiversity: (v) => v + "%",
		poolMemory: (v) => v.toFixed(2) + "x",
		flavorMemory: (v) => v.toFixed(2) + "x",
		teamMomentum: (v) => v.toFixed(2) + "x",
		awardNoise: (v) => v.toFixed(2) + "x",
		freshmanShare: (v) => v + "%",
		transferShare: (v) => v + "%",
		redshirtShare: (v) => v + "%",
		reclassShare: (v) => v + "%",
		injuryRate: (v) => v.toFixed(2) + "x",
		/* Zero is off, and so is anything at or past the size of the build
		   table: a pool that can hold every build is not a restriction. The
		   label used to say "205 builds" for a setting that does nothing. */
		archetypePool: (v) => (v && v < archetypeTableSize() ? v + " builds" : "off"),
		surpriseBudget: (v) => (v ? "about " + v : "none"),
		realignmentRate: (v) => (v ? Math.round(v * 100) + "%" : "off"),
		bluebloodDownYears: (v) => (v ? v + " program" + (v === 1 ? "" : "s") : "none"),
		midMajorLift: (v) => (v ? "+" + v : "off"),
		// The five that printed a bare number in a panel of units.
		flavorBlend: (v) => (v ? Math.round(v * 100) + "%" : "off"),
		styleDrift: (v) => v.toFixed(2) + "x",
		anomalyMemory: (v) => v.toFixed(2) + "x",
		weirdness: (v) => (v === 0 ? "ordinary" : (v > 0 ? "+" : "") + v),
		variation: (v) => (v ? "#" + v : "the seed's own"),
	};

	/* What each slider actually does, in units. "Class quality 2" means nothing
	   on its own; "top prospect ~48 ovr" is a reference point. */
	/* WHEN A CONTROL CANNOT DO ANYTHING TO THIS CLASS.

	   A hint says what a value means. It could not say that the value means
	   nothing HERE — and two controls have a hard floor under them that has
	   nothing to do with their own range. applyDraftEvents returns early below
	   twenty prospects, so a user who lifted a sixteen-man class out of a
	   league export (the loader's own floor is fifteen) could drag "Draft-day
	   events" from 0 to 8 and watch the board not move, with nothing anywhere
	   to say why. Recruiting momentum and the three universe dials are the
	   same shape: real settings that need a world the current session has not
	   got.

	   A caveat is a function of the CLASS, not of the value, so it is painted
	   from the active result and cleared when there is none. Kept separate
	   from SLIDER_HINT because the two answer different questions and a reader
	   who is looking for "why is this doing nothing" should not have to find
	   it inside a sentence about units. */
	const DRAFT_EVENT_FLOOR = 20;
	const SLIDER_CAVEAT = {
		draftEvents: (v, res) => (v > 0 && res && res.players &&
			res.players.length < DRAFT_EVENT_FLOOR
			? "no effect on this class — draft night needs " + DRAFT_EVENT_FLOOR +
				"+ prospects and this one has " + res.players.length
			: null),
		recruitMomentum: (v) => (v > 0 && !state.cfg.universe
			? "no effect outside universe mode — it reads last season's programs, " +
				"and a single class file has no last season"
			: null),
		portalRate: (v, res) => (!state.cfg.universe
			? "only meaningful in universe mode, where there is a previous " +
				"season to leave" : null),
		realignmentMemory: () => (!state.cfg.universe
			? "only meaningful in universe mode: with one file there is no map " +
				"to remember" : null),
	};

	function caveatFor(key) {
		const fn = SLIDER_CAVEAT[key];
		if (!fn) return null;
		try {
			return fn(Number(state.cfg[key]), state.results[state.active] || null) || null;
		} catch (e) { return null; }
	}

	const SLIDER_HINT = {
		archetypePool: (v) => (v
			? "this class is drawn from about " + v + " of the " +
				archetypeTableSize() + " builds — " +
				"lower is more distinctive, higher is one of everything"
			: "off: every build is eligible in every class"),
		weirdness: (v) => (v === 0
			? "the ordinary world — every setting below is where you left it"
			: v < 0
			? "a quieter world: fewer anomalies, a flatter flavor, chalk in March"
			: "a stranger world: more anomalies, a louder flavor, more March, " +
				"a map that moves"),
		anomalyChoices: (v) => (v
			? "draws " + v + " more anomalies than the class keeps, and lets you " +
				"pick which ones it gets"
			: "off: the class takes the anomalies it drew"),
		extrapolateYears: (v) => (v <= 0
			? "the world ends with the last class file"
			: v + " more season" + (v === 1 ? "" : "s") + " drawn from the " +
				"carry-over alone — flagged as extrapolated, and never fed back " +
				"into the chain (universe mode only)"),
		flavorBlend: (v) => (v <= 0
			? "one flavor a class, as it always was"
			: Math.round(v * 100) + "% of classes draw a second flavor and stack " +
				"it — the second leans less than the first"),
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
		flavorMemory: (v) => (v <= 0
			? "each class draws its flavor with no memory of the last"
			: "a flavor drawn in the last three classes is " +
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
		talentCoupling: (v) => (v <= 0
			? "where a prospect goes ignores how good he is"
			: v < 1
				? "better prospects lean toward stronger programs and leagues"
				: "the best prospects go almost only to the strongest programs and leagues"),
		birthplaceWeight: (v) => (v <= 0
			? "birthplace does not affect where a prospect goes"
			: v < 1
				? "birthplace nudges a prospect toward his region's leagues"
				: v === 1
					? "the league table's own birthplace weighting"
					: "birthplace overrides talent — a Serbian goes to Europe, not to Kansas"),
		/* Derived from the selected era's own offensive rating rather than from
		   a constant: the hint said "≈70 points" whatever era was chosen,
		   because it was written when there was only one. */
		pace: (v) => {
			const CAL = global.Calibration;
			const era = CAL.eraInfo(state.cfg.era) || CAL.eraInfo(CAL.DEFAULT_ERA);
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
		recruitMomentum: (v) => (v <= 0
			? "last season's results do not affect where anybody is recruited"
			: "about " + v + "% of blank-college prospects are recruited by a " +
				"program in proportion to its level, its banners and last season's " +
				"title (universe mode only)"),
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

	/* WHAT THE SEASON WAS ACTUALLY PLAYED AT.

	   `result.effectiveCfg` is the settings panel plus three things the user
	   did not set: the class flavor's config bend, the season narrative's
	   bends, and the class-level environment jitter. It is the config the
	   season was genuinely simulated under — and nothing anywhere showed it.
	   So a user who turned on storylines got a season whose pace, upset
	   factor, injury rate and blue-blood down years were all different from
	   the numbers in front of them, with no way to see which, or by how much,
	   or which storyline did it. The most atmospheric system in the tool was
	   also the only invisible one.

	   Diffed against the config as SENT, not against the defaults: the
	   question is "what did the world do to my settings", and a setting the
	   user changed themselves is not an answer to it. */
	function effectiveDiff() {
		const res = state.results[state.active];
		if (!res || !res.effectiveCfg) return null;
		const sent = res.cfg || {};
		const eff = res.effectiveCfg;
		const rows = [];
		for (const key of Object.keys(CFG.DEFAULTS)) {
			const a = sent[key];
			const b = eff[key];
			if (typeof a !== "number" || typeof b !== "number") continue;
			if (Math.abs(a - b) < 1e-9) continue;
			rows.push({ key, from: a, to: b });
		}
		rows.sort((x, y) => {
			const rel = (r) => Math.abs(r.to - r.from) / (Math.abs(r.from) || 1);
			return rel(y) - rel(x);
		});
		return { rows, flavor: res.flavor || null, narrative: res.narrative || [] };
	}

	/* Painted under the narrative hint, where the storylines are switched on. */
	function paintEffective() {
		const host = $("narrativeHint");
		if (!host) return;
		let box = $("effectiveBox");
		const d = effectiveDiff();
		if (!d || (!d.rows.length && !d.narrative.length && !d.flavor)) {
			if (box) box.remove();
			return;
		}
		if (!box) {
			box = el("details", "grp effective");
			box.id = "effectiveBox";
			host.parentNode.insertBefore(box, host.nextSibling);
		}
		box.innerHTML = "";
		const sum = el("summary", null, "What this season was actually played at");
		box.appendChild(sum);
		if (d.flavor) {
			box.appendChild(el("p", "unit",
				"Class flavor: " + (d.flavor.label || d.flavor.name)));
		}
		if (d.narrative.length) {
			box.appendChild(el("p", "unit", "Storylines: " +
				d.narrative.map((x) => x.name + " (" + x.blurb + ")").join("; ")));
		}
		if (!d.rows.length) {
			box.appendChild(el("p", "hint",
				"Nothing moved: every setting the flavor and the storylines want " +
				"is already where you put it."));
			return;
		}
		const list = el("div", "efflist");
		for (const r of d.rows) {
			const fmt = FORMAT[r.key] || ((v) => String(Math.round(v * 100) / 100));
			const row = el("div", "effrow");
			row.appendChild(el("span", "effkey", r.key));
			row.appendChild(el("span", "effval",
				fmt(r.from) + " → " + fmt(r.to)));
			list.appendChild(row);
		}
		box.appendChild(list);
		box.appendChild(el("p", "hint",
			"The flavor bends the class, the storylines bend the season, and the " +
			"class-environment jitter moves pace, efficiency and stat randomness " +
			"a little on every draw. A setting you changed yourself is only " +
			"touched at all when “Flavor reaches settings you changed” is above 0."));
	}

	/* THE ANOMALY SHORTLIST, AS A CONTROL.

	   With "Extra anomalies to choose from" above zero the engine draws more
	   candidates than the class keeps and hands the whole shortlist back on
	   the result (see assignSurprises). This is where the user answers it:
	   every candidate with the prospect it would land on, and a tick for the
	   ones the class gets. Unticking everything is the same as answering
	   nothing, which takes the first few — an empty shortlist should not be an
	   empty class.

	   The picks are a build-phase input, so changing one re-runs the class
	   from the build phase down. That is correct and it is also why the row is
	   hidden entirely at zero: it would be a control that re-simulates a
	   season to change nothing. */
	function paintAnomalyPicks() {
		const row = $("anomalyPickRow");
		if (!row) return;
		const res = state.results[state.active];
		const shortlist = res && res.surprises && res.surprises.shortlist;
		if (!state.cfg.anomalyChoices || !shortlist || !shortlist.length) {
			row.hidden = true;
			row.innerHTML = "";
			return;
		}
		row.hidden = false;
		row.innerHTML = "";
		row.appendChild(el("span", "lbl", "Which anomalies this class gets"));
		const keep = Array.isArray(state.cfg.anomalyPicks) && state.cfg.anomalyPicks.length
			? new Set(state.cfg.anomalyPicks)
			: new Set(shortlist.filter((c) => c.chosen).map((c) => c.name));
		const list = el("div", "colpicker");
		for (const c of shortlist) {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = keep.has(c.name);
			cb.addEventListener("change", () => {
				const next = shortlist
					.filter((x) => (x.name === c.name ? cb.checked : keep.has(x.name)))
					.map((x) => x.name);
				pushUndo("changed which anomalies this class gets");
				state.cfg.anomalyPicks = next;
				markDirty();
				persist();
				scheduleRun();
			});
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + c.label + " — " + c.player));
			list.appendChild(lab);
		}
		row.appendChild(list);
		row.appendChild(el("p", "hint",
			"Drawn from the same stream in the same order, so the shortlist " +
			"replays with the seed. A candidate's eligibility is judged before " +
			"any of them are applied — which is the price of being offered a " +
			"choice, since one anomaly can change who is eligible for the next."));
	}

	/* HOW STRANGE THIS WORLD ACTUALLY CAME OUT.

	   The dial says what was asked for; this says what happened, with the
	   reasons beside it. See Engine.strangeness — a score with no ingredients
	   listed is a number nobody can act on. */
	function strangenessTip(res) {
		const sc = res && global.Engine.strangeness ? global.Engine.strangeness(res) : null;
		if (!sc) return "";
		return "\nStrangeness " + sc.score + "/100" +
			(sc.reasons.length ? ":\n· " + sc.reasons.join("\n· ") : " — nothing unusual.");
	}

	function paintStrangeness() {
		const host = $("weirdness");
		if (!host) return;
		const ctl = host.closest(".ctl");
		if (!ctl) return;
		let box = ctl.querySelector(".strangeness");
		const res = state.results[state.active];
		const sc = res && global.Engine.strangeness
			? global.Engine.strangeness(res) : null;
		if (!sc) { if (box) box.remove(); return; }
		if (!box) {
			box = el("p", "unit strangeness");
			ctl.appendChild(box);
		}
		box.textContent = "This world scored " + sc.score + "/100 for strangeness" +
			(sc.reasons.length ? ": " + sc.reasons.slice(0, 3).join("; ") +
				(sc.reasons.length > 3 ? "; +" + (sc.reasons.length - 3) + " more" : "")
				: " — nothing unusual happened.");
		box.title = sc.reasons.join("\n") || "Nothing unusual happened.";
	}

	/* A line in the status bar when a run comes out remarkable — once per
	   class, keyed by its fingerprint, so a repaint does not repeat it. */
	let lastAchievement = null;
	function noteAchievement(res) {
		if (!res || !global.Engine.strangeness) return;
		const key = res.seed + "|" + classFingerprint(res);
		if (key === lastAchievement) return;
		lastAchievement = key;
		const sc = global.Engine.strangeness(res);
		const champ = res.tourney && res.tourney.champion && res.tourney.champion.team;
		const perfect = champ && champ.regSnapshot && champ.regSnapshot.l === 0 &&
			champ.regSnapshot.w >= 20;
		const bits = [];
		if (perfect) bits.push(champ.name + " went unbeaten and won it all");
		if (sc && sc.score >= 50) bits.push("strangeness " + sc.score + "/100");
		if (bits.length) setStatus("\u2605 Achievement: " + bits.join(" · ") + ".");
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
		/* WHAT THE SEASON WAS ACTUALLY PLAYED AT, beside the dial that says
		   otherwise.

		   `effectiveDiff` already exists and already feeds a panel (see
		   paintEffective) — but that panel is a collapsed <details> in another
		   fieldset, so the one place a user is certainly looking when the
		   number is wrong, the control itself, still read 1.00x while the
		   season had been simulated at 1.45x. The panel keeps the whole story;
		   this puts the one fact next to the thing it contradicts. Computed
		   once for the whole repaint rather than per slider. */
		const bent = {};
		const ed = effectiveDiff();
		for (const r of (ed && ed.rows) || []) bent[r.key] = r.to;
		for (const key of SLIDERS) {
			const input = $(key);
			if (!input) continue;
			input.value = state.cfg[key];
			// Sync numeric input
			const num = $(key + "Num");
			// Never under the cursor: see bindSliderNumbers.
			if (num && num !== document.activeElement) num.value = state.cfg[key];
			const ctl = input.closest(".ctl");
			const shown = (FORMAT[key] || ((v) => String(v)))(Number(input.value));
			const b = ctl.querySelector("label b");
			if (b) b.textContent = shown;
			/* THE FORMATTED VALUE IS THE VALUE, for a screen reader too.

			   The readout above lives in a <b> inside the control's <label>,
			   so it is part of the accessible NAME — which means a slider
			   announced its formatted value and then its raw one, the same
			   quantity twice in two units: "Conference realignment 35%, 0.35".
			   On a dial whose units are not a number at all ("21 builds",
			   "2.60x") the raw figure is simply noise. aria-valuetext replaces
			   the raw value outright, which is exactly what it is for, and the
			   <b> stays as the visual readout it always was. */
			input.setAttribute("aria-valuetext", shown);
			let hint = ctl.querySelector(".unit");
			if (SLIDER_HINT[key]) {
				if (!hint) {
					hint = el("p", "unit");
					ctl.appendChild(hint);
				}
				/* The hint says what the value MEANS; it did not say what the
				   value would be if you had never touched it. "Have I moved
				   this?" was answerable only by hunting for the modified dot,
				   or by opening the only-changed filter and losing the rest of
				   the panel. The default rides along in the units the slider
				   already prints, so "21 builds · default 21 builds" answers it
				   in place. Suppressed when the value IS the default, where it
				   would only be the same string twice. */
				const fmt = FORMAT[key] || ((v) => String(v));
				const def = CFG.DEFAULTS[key];
				const atDefault = Number(input.value) === Number(def);
				/* One hint that throws must not take the rest of the paint —
				   and every binding after it at startup — down with it. */
				let said = "";
				try { said = SLIDER_HINT[key](Number(input.value)); } catch (e) { said = ""; }
				hint.textContent = said +
					(atDefault || !Number.isFinite(Number(def))
						? "" : " · default " + fmt(Number(def)));
			}
			/* The caveat, if this control cannot act on the class in front of
			   the user. Its own element, so it can be styled as a warning and
			   removed cleanly when the condition lifts. */
			let caveat = ctl.querySelector(".caveat");
			const text = caveatFor(key);
			if (text) {
				if (!caveat) {
					caveat = el("p", "caveat");
					ctl.appendChild(caveat);
				}
				caveat.textContent = text;
			} else if (caveat) {
				caveat.remove();
			}
			/* The ghost value: what the flavor, the storylines and the class
			   jitter actually ran this setting at. Its own element so it can
			   be styled apart from the value the user set and removed cleanly
			   the moment the two agree again. */
			let ghost = ctl.querySelector(".effghost");
			if (bent[key] !== undefined) {
				if (!ghost) {
					ghost = el("span", "effghost");
					const lbl = ctl.querySelector("label");
					if (lbl) lbl.appendChild(ghost);
					else ctl.appendChild(ghost);
				}
				const fmt = FORMAT[key] || ((v) => String(Math.round(v * 100) / 100));
				ghost.textContent = " played at " + fmt(bent[key]);
				ghost.title = "The class flavor, the season's storylines or the " +
					"class-environment jitter moved this setting. See “What this " +
					"season was actually played at”.";
			} else if (ghost) {
				ghost.remove();
			}
			// Per-setting modified marker + revert (Part 5C)
			paintModifiedMarker(ctl, key, Number(input.value));
		}
		paintEffective();
		paintChallenge();
		paintAnomalyPicks();
		paintStrangeness();
		// Also mark non-slider settings
		paintModifiedMarkerFor("ovrMode", state.cfg.ovrMode);
		paintModifiedMarkerFor("priorSeasons", state.cfg.priorSeasons);
		paintModifiedMarkerFor("potModel", state.cfg.potModel);
		paintModifiedMarkerFor("signatureSkills", state.cfg.signatureSkills);
		paintModifiedMarkerFor("collegeSource", state.cfg.collegeSource);
		$("collegeSource").value = state.cfg.collegeSource || "blanks";
		$("collegeSourceHint").textContent = state.cfg.collegeSource === "rewrite"
			? "Destructive: every prospect's college or league is redrawn and the " +
				"file's own colleges are overwritten in the export. Reroll draws a new map."
			: state.cfg.collegeSource === "respect"
				? "The file is taken as written. A prospect with no college did not play " +
					"a season and gets no stat line."
				: "Prospects the file sends nowhere are sent somewhere real; everyone " +
					"else keeps the college BBGM gave him.";
		paintModifiedMarkerFor("varySize", state.cfg.varySize);
		paintModifiedMarkerFor("universe", state.cfg.universe);
		paintModifiedMarkerFor("narrative", state.cfg.narrative);
		paintFlavorOptions();
		$("flavorHint").value = state.cfg.flavorHint || "";
		paintModifiedMarkerFor("flavorHint", state.cfg.flavorHint || "");
		$("ovrMode").value = state.cfg.ovrMode;
		$("priorSeasons").value = state.cfg.priorSeasons;
		$("potModel").value = state.cfg.potModel || "tool";
		$("signatureSkills").checked = !!state.cfg.signatureSkills;
		$("varySize").checked = !!state.cfg.varySize;
		$("lockHeights").checked = state.cfg.lockHeights !== false;
		$("universe").checked = !!state.cfg.universe;
		$("narrative").checked = !!state.cfg.narrative;
		$("extrapolateGaps").checked = state.cfg.extrapolateGaps !== false;
		paintUniverseHint();
		$("seed").value = state.cfg.seed;
		const curve = state.cfg.ovrMode === "curve";
		for (const n of document.querySelectorAll("[data-curve]")) {
			n.style.opacity = curve ? "1" : ".38";
			n.querySelectorAll("input").forEach((i) => (i.disabled = !curve));
		}
		$("ovrModeHint").textContent = curve
			? "Rebuild: overalls are re-dealt along a configurable curve, so the class can get better or worse."
			: "Preserve: each prospect keeps the overall BBGM gave him (never inflated). Only his build changes.";
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
		/* Only the density class: the body also carries settings-open,
		   settings-closed and busy, and assigning className wiped all three
		   on every repaint — closing the panel, then moving a slider, opened
		   it again. */
		for (const c of Array.from(document.body.classList)) {
			if (c.indexOf("density-") === 0 && c !== "density-" + state.density) {
				document.body.classList.remove(c);
			}
		}
		document.body.classList.add("density-" + state.density);
		paintLockButtons();
		paintGroupResets();
	}

	/* The era selector. The stat model targets one of the anchor sets in
	   js/calibration.js, and which one it targets used to be a decision made
	   once, in a file nobody opens, in 2021. */
	function paintEra() {
		const sel = $("era");
		if (!sel) return;
		const eras = global.Calibration.ERAS;
		/* An era the model is not calibrated to is not a choice (see
		   `unfitted` in js/calibration.js) — unless an achievement unlocked
		   it. Rebuilt each paint, since an unlock can land mid-session. */
		const names = pickableEras();
		if (Array.from(sel.options).map((o) => o.value).join("|") !== names.join("|")) {
			sel.innerHTML = "";
			for (const name of names) {
				sel.appendChild(new Option(eras[name].label +
					(eras[name].unfitted ? " — unlocked, uncalibrated" : ""), name));
			}
		}
		sel.value = state.cfg.era;
		const info = eras[state.cfg.era] || eras[global.Calibration.DEFAULT_ERA];
		paintShowAll(sel);
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
			["era", "ovrMode", "varySize", "lockHeights", "priorSeasons", "universe", "narrative",
				"collegeSource", "potModel", "signatureSkills"])) {
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
			if (sameSetting(k, x, y)) continue;
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

	/* Ranges that are facts about a table, not about the markup.

	   `archetypePool` is the size of the build pool a class is drawn from, and
	   its documented off switch is "set it to the size of the build table or
	   above". The slider was written with max="40" when the table held about
	   that many builds; the table holds 205 now, so the documented off switch
	   had been unreachable from the UI for a long time and every position on
	   the slider was somewhere in the bottom fifth of the range. The cap is
	   read off the table it caps. */
	function retuneSliderRanges() {
		const pool = $("archetypePool");
		if (pool && global.RatingsBuilder) {
			pool.max = String(global.RatingsBuilder.ARCHETYPES.length);
		}
	}

	/* One "reset this group" button per settings group.

	   There is a per-setting revert (the ↺ beside a modified label) and a
	   whole-panel reset, and nothing in between — so backing out of one
	   session of fiddling with the season meant finding every dot in the
	   group by eye. The button knows what is in its own group because it
	   reads the DOM: every control inside the <details> that has a config
	   key. It is hidden when nothing in the group is modified, so it is also
	   a group-level answer to "have I touched this?". */
	function groupKeys(details) {
		const keys = [];
		for (const node of details.querySelectorAll("input[id], select[id]")) {
			const key = node.id;
			if (key && Object.prototype.hasOwnProperty.call(CFG.DEFAULTS, key)) keys.push(key);
		}
		return keys;
	}

	function addGroupResets() {
		for (const details of document.querySelectorAll("details.grp")) {
			const summary = details.querySelector("summary");
			if (!summary || summary.querySelector(".grp-reset")) continue;
			const btn = el("button", "grp-reset", "Reset group");
			btn.type = "button";
			btn.hidden = true;
			btn.addEventListener("click", (e) => {
				// The summary is a toggle; resetting must not also collapse it.
				e.preventDefault();
				e.stopPropagation();
				const keys = groupKeys(details).filter(
					(k) => !isDefaultSetting(k, state.cfg[k]));
				if (!keys.length) return;
				pushUndo("reset " + (summary.dataset.label || "a group") + " to defaults");
				for (const k of keys) {
					const d = defaultOf(k);
					state.cfg[k] = d;
					const inp = $(k);
					if (inp) {
						if (inp.type === "checkbox") inp.checked = !!d;
						else inp.value = d;
					}
				}
				markDirty();
				paintConfig();
				persist();
				scheduleRun();
				setStatus("Reset " + keys.length + " setting" + (keys.length === 1 ? "" : "s") +
					" in " + (summary.dataset.label || "this group") + " to default.");
			});
			summary.dataset.label = (summary.firstChild && summary.firstChild.textContent || "")
				.trim() || details.id;
			btn.title = "Reset every setting in " + summary.dataset.label + " to its default";
			summary.appendChild(btn);
		}
	}

	function paintGroupResets() {
		for (const details of document.querySelectorAll("details.grp")) {
			const btn = details.querySelector(".grp-reset");
			if (!btn) continue;
			const n = groupKeys(details).filter(
				(k) => !isDefaultSetting(k, state.cfg[k])).length;
			btn.hidden = n === 0;
			/* The count lives in the "changed: N" badge beside it, so the
			   button itself stays a compact ↺ that still names the count to
			   a screen reader. */
			btn.textContent = "↺ Reset";
			btn.setAttribute("aria-label", n
				? "Reset " + n + " changed setting" + (n === 1 ? "" : "s") + " in " +
					(details.querySelector("summary").dataset.label || "this group")
				: "Reset group");
			/* A "changed: N" badge beside it, so a collapsed group still
			   says it has been touched. */
			const summary = details.querySelector("summary");
			let badge = summary && summary.querySelector(".grp-changed");
			if (!badge && summary) {
				badge = el("span", "grp-changed");
				summary.insertBefore(badge, btn);
			}
			if (badge) {
				badge.textContent = "changed: " + n;
				badge.hidden = n === 0;
			}
		}
	}

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
			/* The label also carries the readout, the padlock, the modified
			   dot and the revert button, all of which became part of the
			   slider's accessible NAME ("Pace 68 🔓 Lock pace against the
			   randomizer ↺ …"). The name is the label's own words, fixed here
			   before any of those are added. */
			const name = ((ctl.querySelector("label") || {}).textContent || key)
				.replace(/\s+/g, " ").trim() || key;
			range.setAttribute("aria-label", name);
			num.setAttribute("aria-label", name + " (number)");
			wrapper.appendChild(num);
		}
	}

	/* Per-setting modified marker and revert (Part 5C). */
	function paintModifiedMarker(ctl, key, currentValue) {
		if (!ctl) return;
		const defaultValue = defaultOf(key);
		const isModified = !isDefaultSetting(key, currentValue);
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
					state.cfg[key] = defaultOf(key);
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
			/* A keystroke is half a number. Clamping each one turned "7" of a
			   typed "70" into the pace floor of 58, painted 58 back into the
			   box under the cursor, and the "0" then made 580 -> 82. So a
			   keystroke only applies a value already inside the band and never
			   rewrites the box; the clamp happens once, on change/blur. */
			let numPushed = false;
			const applyNum = (v) => {
				if (!numPushed) { pushUndo("moved " + key); numPushed = true; }
				range.value = v;
				state.cfg[key] = Number(range.value);
				markDirty();
				paintConfig();
				scheduleRun();
			};
			num.addEventListener("input", () => {
				if (num.value.trim() === "") return;
				const v = Number(num.value);
				if (!Number.isFinite(v) || v < Number(range.min) || v > Number(range.max)) return;
				applyNum(v);
			});
			num.addEventListener("change", () => {
				const v = Number(num.value);
				if (num.value.trim() !== "" && Number.isFinite(v)) {
					const clamped = Math.max(Number(range.min), Math.min(Number(range.max), v));
					if (clamped !== state.cfg[key]) applyNum(clamped);
				}
				num.value = state.cfg[key];
				numPushed = false;
				persist();
			});
			/* DOUBLE-CLICK A SLIDER TO PUT IT BACK.

			   "Reset to defaults" is all-or-nothing and asks for confirmation,
			   because it throws away a session. Undoing ONE exploratory drag
			   had no gesture at all: the panel prints "· default 21 builds"
			   beside the hint, so the number you want is on screen, and the
			   only way to act on it was to drag back to it by hand. One undo
			   entry, so Ctrl+Z takes it back. */
			range.addEventListener("dblclick", () => {
				const def = Number(CFG.DEFAULTS[key]);
				if (!Number.isFinite(def) || Number(range.value) === def) return;
				pushUndo("reset " + key);
				range.value = def;
				num.value = def;
				state.cfg[key] = def;
				markDirty();
				paintConfig();
				scheduleRun();
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
			"archetypePool", "surpriseBudget", "buildNoise", "poolMemory",
			"flavorMemory"],
		years: ["freshmanShare", "transferShare", "redshirtShare", "reclassShare"],
		destinations: ["pDII", "talentCoupling", "birthplaceWeight"],
		season: ["pace", "scoringEnv", "efficiencyEnv", "statNoise", "injuryRate",
			"upsetFactor", "realignmentRate", "bluebloodDownYears", "midMajorLift",
			"teamMomentum", "seasonEvents", "draftEvents"],
		awards: ["awardStrictness", "confAwardStrictness", "proAwardStrictness",
			"awardNoise"],
	};
	/* `weirdness` and `anomalyChoices` are deliberately NOT in any group.
	   weirdness is a meta-dial over settings this table already draws, so
	   randomizing both would apply the same idea twice and the user would see
	   a wide draw land somewhere wider than "wide"; anomalyChoices is an
	   affordance (how long a shortlist to offer) rather than a fact about the
	   world, and a randomizer that keeps changing the length of a list you are
	   reading is an irritation rather than a surprise. */
	const RANDOM_SCOPES = ["gentle", "wide"].concat(Object.keys(RANDOM_GROUPS));
	// The controls marked data-curve in index.html.
	const CURVE_KEYS = ["classQuality", "classDepth", "eliteCount"];
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
	function randomSliderValue(key, mode, rng) {
		const input = $(key);
		if (!input || input.type !== "range") return null;
		const random = rng ? () => rng.random() : Math.random;
		const min = Number(input.min);
		const max = Number(input.max);
		const step = Number(input.step) || 1;
		if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
		let v;
		if (mode === "gentle") {
			const d = Number(CFG.DEFAULTS[key]);
			const center = Number.isFinite(d) ? Math.min(max, Math.max(min, d)) : (min + max) / 2;
			v = center + (random() - random()) * 0.34 * (max - min);
		} else {
			v = min + random() * (max - min);
		}
		v = min + Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step;
		v = Math.min(max, Math.max(min, v));
		return Number(v.toFixed(stepDecimals(step)));
	}

	/* One independent draw for a scope: every key the scope covers, at most
	   once, as a PATCH rather than an in-place mutation of state.cfg — so the
	   same draw logic can either be applied straight to the shared settings
	   (the original, one-class behavior) or stashed per file (see
	   randomizePerFile below) without duplicating the sampling rules in two
	   places that would drift apart the first time one of them changed. */
	/* SEEDED. Every other draw in the tool comes off a seed, and the
	   randomizer used Math.random(), so "🎲 Randomize" was the one thing that
	   could not be reproduced or shared. The draw now comes off a randomizer
	   seed — minted per press, or given back to replay one — which the
	   status line shows and shift-click on the button asks for. The keys are
	   drawn in a fixed order so the same seed gives the same patch. */
	function drawRandomPatch(scope, rseed) {
		const rng = rseed ? new global.BBGMRng.Rng("randomize|" + rseed) : null;
		const mode = scope === "wide" ? "wide" : scope === "gentle" ? "gentle" : "wide";
		const groups = (scope === "gentle" || scope === "wide")
			? Object.keys(RANDOM_GROUPS) : [scope];
		const patch = {};
		let moved = 0;
		let locked = 0;
		for (const g of groups) {
			for (const key of RANDOM_GROUPS[g]) {
				if (state.settingLocks[key]) { locked++; continue; }
				/* The curve dials do nothing while overalls are preserved —
				   the panel dims them — and a draw spent on one is a
				   "randomized 3 settings" that changed nothing. */
				if (CURVE_KEYS.indexOf(key) !== -1 && state.cfg.ovrMode !== "curve") continue;
				const v = randomSliderValue(key, mode, rng);
				if (v === null || v === state.cfg[key]) continue;
				patch[key] = v;
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
			const random = rng ? () => rng.random() : Math.random;
			for (const k of Object.keys(base).sort()) {
				lw[k] = Math.max(0, Number(
					(base[k] * Math.exp((random() * 2 - 1) * spread)).toFixed(1)));
			}
			patch.leagueWeights = lw;
			moved++;
		}
		/* Repair the one contradiction the draw can produce: classFlavor 0
		   disables the flavor system entirely, an explicitly named flavor
		   included. The engine now floors this itself (see pickFlavor), but
		   the panel should not display a contradiction either. flavorHint
		   itself is never randomized, so reading it off state.cfg is reading
		   the one thing this patch cannot have touched. */
		if (state.cfg.flavorHint && patch.classFlavor === 0) {
			patch.classFlavor = 0.5;
		}
		return { patch, moved, locked };
	}

	function mintRandomSeed() {
		return Math.floor(Math.random() * 0x7fffffff).toString(36);
	}

	function randomizeSettings(scope, givenSeed, noUndo) {
		if (RANDOM_SCOPES.indexOf(scope) === -1) scope = "gentle";
		if (!noUndo) pushUndo("randomized settings (" + scope + ")");
		const rseed = givenSeed && String(givenSeed).trim()
			? String(givenSeed).trim() : mintRandomSeed();
		state.lastRandomSeed = rseed;
		const seedNote = " Randomizer seed " + rseed +
			" — shift-click Randomize to replay one.";

		/* Several files loaded, and the box below the button checked: instead
		   of one shared draw applied to every class, each loaded file gets
		   its OWN independent draw, stashed in state.fileCfgs and read back
		   by fileCfgFor. The shared settings panel (state.cfg) is left alone
		   — it stays the template Randomize draws around, the same way the
		   panel already does not reflect what universe mode's carry-over
		   actually ran a season with (see universeCfgFor). Off by default and
		   forced off in universe mode, where a season's config is already
		   something else entirely (see fileCfgFor's own guard). */
		if (state.randomizePerFile && !state.cfg.universe && state.files.length > 1) {
			const patches = {};
			let moved = 0;
			let locked = 0;
			for (let i = 0; i < state.files.length; i++) {
				const draw = drawRandomPatch(scope, rseed + "/" + i);
				patches[i] = draw.patch;
				moved += draw.moved;
				// Every draw locks the same keys, so the count does not need summing.
				locked = draw.locked;
			}
			if (!moved) {
				setStatus(locked
					? "Nothing to randomize: every setting in that scope is locked."
					: "Nothing moved.");
				return;
			}
			state.fileCfgs = patches;
			/* Not markDirty(): the shared panel (state.cfg) was never
			   touched, so it still matches whatever preset it matched a
			   moment ago — the divergence lives in state.fileCfgs, which the
			   preset-dirty indicator has no business reporting on. */
			persist();
			scheduleRun();
			setStatus("Drew a separate " + scope + " randomization for each of " +
				state.files.length + " loaded classes" +
				(locked ? " (" + locked + " locked, untouched)" : "") +
				". Ctrl+Z restores them in one step." + seedNote);
			return;
		}

		const { patch, moved, locked } = drawRandomPatch(scope, rseed);
		if (!moved) {
			// Undo entry stays — it is a no-op to undo — but say why nothing moved.
			setStatus(locked
				? "Nothing to randomize: every setting in that scope is locked."
				: "Nothing moved.");
			return;
		}
		Object.assign(state.cfg, patch);
		markDirty();
		paintConfig();
		persist();
		scheduleRun();
		setStatus("Randomized " + moved + " setting" + (moved === 1 ? "" : "s") +
			(locked ? " (" + locked + " locked, untouched)" : "") +
			". Ctrl+Z restores them in one step." + seedNote);
	}

	/* SURPRISE ME.

	   The loop a new user actually wants — draw wide settings, reroll, and
	   look at what came out — is four separate actions spread across the panel
	   and the header, and every one of them has to be discovered first. The
	   pieces all existed; what was missing was the one control that chains
	   them, which is the first thing anybody tries and the last thing the
	   interface offered.

	   Deliberately a wide draw and not a gentle one: a surprise that lands
	   near the defaults is not a surprise, and the undo stack takes the whole
	   thing back in one step. It leaves the user on the anomaly list, because
	   the anomalies are the part of a class that is worth looking at first and
	   the part a reroll is usually FOR. */
	function surpriseMe() {
		if (!state.files.length) { setStatus("Load a class file first."); return; }
		/* ONE undo entry for the whole gesture, as the status line promises:
		   the randomizer and the reroll below are told not to push their own,
		   or Ctrl+Z took back the reroll and left the wide settings behind. */
		pushUndo("surprise me");
		randomizeSettings("wide", null, true);
		/* After the randomizer's own run, not instead of it: randomizeSettings
		   schedules a run and the reroll has to follow the settings it drew,
		   or the class on screen is the old settings with a new seed. */
		setTimeout(() => {
			reroll({ noUndo: true });
			setTimeout(() => {
				const res = state.results[state.active];
				if (!res) return;
				const list = (res.surprises || []).map((x) => x.label).join("; ");
				setStatus(className(res) + (list ? " · " + list : "") +
					" · Ctrl+Z takes all of it back.", true);
			}, 60);
		}, 0);
	}

	/* Today's seed: the same class for everyone on the same settings and
	   date, which is what makes a class something to compare notes on. */
	function dailySeed(d) {
		d = d || new Date();
		const pad = (n) => String(n).padStart(2, "0");
		return "daily-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
	}

	function dailyReroll() {
		if (!state.files.length) { setStatus("Load a class file first."); return; }
		const seed = dailySeed();
		pushUndo("rolled the daily seed " + seed);
		rememberSession();
		state.cfg.seed = seed;
		state.cfg.anomalyPicks = null;
		$("seed").value = seed;
		state.editing = null;
		state.selected = {};
		run(() => setStatus("Today's class: seed " + seed + "."));
	}

	/* CHAOS DRAFT (audit 4.14): Surprise me with an anomaly shortlist, the
	   weirdest candidates on it picked automatically. The picks go through
	   the same anomalyPicks path the shortlist row writes. */
	function chaosDraft() {
		if (!state.files.length) { setStatus("Load a class file first."); return; }
		pushUndo("chaos draft");
		randomizeSettings("wide", null, true);
		state.cfg.anomalyChoices = Math.max(4, state.cfg.anomalyChoices || 0);
		const before = state.results[state.active];
		setTimeout(() => {
			reroll({ noUndo: true });
			let tries = 0;
			const wait = () => {
				const res = state.results[state.active];
				if ((busyDepth > 0 || !res || res === before) && tries++ < 200) {
					setTimeout(wait, 50);
					return;
				}
				const shortlist = res && res.surprises && res.surprises.shortlist;
				if (!shortlist || !shortlist.length) return;
				// The shortlist is the class's own count plus the extra choices.
				const n = Math.max(1, shortlist.length - (state.cfg.anomalyChoices || 0));
				state.cfg.anomalyPicks = global.ReplayMeta.chaosPicks(
					shortlist, n, global.Engine.SURPRISES);
				paintConfig();
				persist();
				run(() => {
					const now = state.results[state.active];
					if (!now) return;
					const list = (now.surprises || []).map((x) => x.label).join("; ");
					setStatus("Chaos draft: " + className(now) + (list ? " · " + list : "") +
						" · Ctrl+Z takes all of it back.", true);
				});
			};
			wait();
		}, 0);
	}

	/* ------------------------------------------------ the replay layer */

	/* Bingo card, achievements ledger and the "show everything" override
	   (audit 4.6, 4.10, 4.11). Its own storage key: none of it is a class
	   setting, and a shared link must not carry anybody's ledger. */
	const REPLAY_KEY = "bbgm-draft-workshop/replay";
	let replayState = null;
	let replayLastKey = null;

	function replayStore() {
		if (replayState) return replayState;
		const RM = global.ReplayMeta;
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(REPLAY_KEY) || "null"); } catch (e) { saved = null; }
		const s = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
		const ledger = {};
		if (s.ledger && typeof s.ledger === "object") {
			for (const id of Object.keys(s.ledger)) {
				const e = s.ledger[id];
				if (RM.ACH_BY_ID[id] && e && typeof e === "object") {
					ledger[id] = { at: String(e.at || ""), seed: String(e.seed || ""),
						link: typeof e.link === "string" ? e.link : "", name: String(e.name || "") };
				}
			}
		}
		replayState = {
			card: RM.validCard(s.card) || RM.drawCard(mintRandomSeed()),
			ledger,
			// Gated by default; one tick shows every era and flavor.
			showAll: !!s.showAll,
		};
		return replayState;
	}

	function saveReplay() {
		try { localStorage.setItem(REPLAY_KEY, JSON.stringify(replayStore())); } catch (e) { /* storage off: the session keeps it */ }
	}

	function replayUnlocked(kind, name) {
		const r = replayStore();
		return global.ReplayMeta.isUnlocked(kind, name, r.ledger, r.showAll);
	}

	// The flavor dropdown, minus locked flavors (the one in use always shows).
	function paintFlavorOptions() {
		const fh = $("flavorHint");
		if (!fh) return;
		const cur = state.cfg.flavorHint || "";
		const names = RB.CLASS_FLAVORS
			.filter((f) => f.name === cur || replayUnlocked("flavor", f.name));
		const sig = names.map((f) => f.name).join("|");
		if (fh.dataset.sig === sig) return;
		fh.dataset.sig = sig;
		fh.innerHTML = "";
		fh.appendChild(new Option("draw one at random", ""));
		for (const f of names) fh.appendChild(new Option(f.label || f.name, f.name));
		fh.value = cur;
	}

	/* THE toast: separate from the status line (which other code writes
	   constantly). Achievements use it on unlock, and every copy action
	   names what it copied through it (see copyText). One polite live
	   region, so a screen reader hears each once. */
	function toast(text) {
		let box = $("replayToasts");
		if (!box) {
			box = el("div", "replaytoasts");
			box.id = "replayToasts";
			box.setAttribute("role", "status");
			box.setAttribute("aria-live", "polite");
			document.body.appendChild(box);
		}
		const t = el("div", "replaytoast", text);
		box.appendChild(t);
		setTimeout(() => t.remove(), 5000);
		return t;
	}
	const replayToast = toast;

	// A link that replays this result: its settings, its drawn seed, no locks.
	function replayLinkFor(res) {
		const p = encodeConfig(true);
		delete p.overrides;
		delete p.fp;
		if (res && res.seed) p.seed = String(res.seed);
		return "#c=" + encodeURIComponent(JSON.stringify(p));
	}

	function earn(r, id, res, fresh) {
		if (r.ledger[id]) return;
		r.ledger[id] = { at: new Date().toISOString().slice(0, 10),
			seed: res ? String(res.seed) : "", link: res ? replayLinkFor(res) : "",
			name: res ? className(res) : "" };
		fresh.push(id);
	}

	/* After every run: mark the bingo card and record firsts. Keyed by seed
	   and fingerprint, so a repaint of the same class does nothing twice. */
	function replayAfterRun(res) {
		if (!res || !global.ReplayMeta) return;
		const RM = global.ReplayMeta;
		const key = res.seed + ":" + classFingerprint(res);
		if (key === replayLastKey) return;
		replayLastKey = key;
		const r = replayStore();
		const sc = global.Engine.strangeness(res);
		const fresh = [];
		const linesBefore = RM.cardLines(r.card);
		const marked = RM.markCard(r.card, sc && sc.kinds);
		for (const id of RM.detect(res, sc)) earn(r, id, res, fresh);
		if (RM.cardLines(r.card) > 0) earn(r, "bingo-line", res, fresh);
		if (RM.cardFull(r.card)) earn(r, "bingo-full", res, fresh);
		if (!marked.length && !fresh.length) return;
		if (RM.cardLines(r.card) > linesBefore) replayToast("Bingo! A line on card " + r.card.seed + ".");
		for (const id of fresh) {
			const a = RM.ACH_BY_ID[id];
			const opens = RM.UNLOCKS.filter((u) => u.requires === id)
				.map((u) => (u.kind === "era"
					? global.Calibration.ERAS[u.name].label + " era"
					: u.name + " flavor"));
			replayToast("Achievement: " + a.label + " — " + a.desc +
				(opens.length && !r.showAll ? ". Unlocked: " + opens.join(", ") : ""));
		}
		saveReplay();
		if (fresh.length) { paintEra(); paintFlavorOptions(); }
	}

	function replayDialog() {
		const RM = global.ReplayMeta;
		const r = replayStore();
		const box = el("div", "replaybox");

		// Mutators.
		box.appendChild(el("h4", null, "Mutators (up to " + RM.MAX_MUTATORS + ")"));
		box.appendChild(el("p", "hint", "Stackable setting patches, shown in the class " +
			"name and carried in the link. A flavor still only moves settings left alone, " +
			"and a mutator's settings count as moved."));
		const mu = el("div", "mutatorlist");
		for (const m of RM.MUTATORS) {
			const lab = el("label", "check");
			lab.title = m.note;
			const cb = el("input");
			cb.type = "checkbox";
			cb.dataset.mutator = m.id;
			cb.checked = state.mutators.indexOf(m.id) !== -1;
			cb.addEventListener("change", () => {
				const next = state.mutators.filter((x) => x !== m.id);
				if (cb.checked) next.push(m.id);
				if (next.length > RM.MAX_MUTATORS) {
					cb.checked = false;
					setStatus("Three mutators at most.");
					return;
				}
				pushUndo("changed the mutators");
				state.mutators = RM.cleanMutators(next);
				markDirty();
				persist();
				scheduleRun();
			});
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + m.label + " — " + m.note));
			mu.appendChild(lab);
		}
		box.appendChild(mu);

		// Bingo.
		const lines = RM.cardLines(r.card);
		box.appendChild(el("h4", null, "Strangeness bingo — card " + r.card.seed +
			(RM.cardFull(r.card) ? " · blackout"
				: lines ? " · " + lines + " line" + (lines === 1 ? "" : "s") : "")));
		const grid = el("div", "bingogrid");
		const labels = {};
		for (const k of RM.BINGO_KINDS) labels[k.kind] = k.label;
		r.card.squares.forEach((k, i) => {
			const sq = el("div", "bingosq" + (r.card.marked[i] ? " on" : ""), labels[k]);
			sq.dataset.kind = k;
			grid.appendChild(sq);
		});
		box.appendChild(grid);
		const nb = el("button", null, "New card");
		nb.type = "button";
		nb.id = "btnNewBingo";
		nb.addEventListener("click", () => {
			r.card = RM.drawCard(mintRandomSeed());
			saveReplay();
			closeModal();
			replayDialog();
		});
		box.appendChild(nb);

		// Ledger.
		const got = Object.keys(r.ledger).length;
		box.appendChild(el("h4", null, "Achievements — " + got + " of " + RM.ACHIEVEMENTS.length));
		const list = el("ul", "ledger");
		for (const a of RM.ACHIEVEMENTS) {
			const e = r.ledger[a.id];
			const li = el("li", e ? "got" : "missing");
			li.dataset.ach = a.id;
			li.appendChild(el("b", null, a.label));
			li.appendChild(document.createTextNode(" — " + a.desc));
			const u = RM.UNLOCKS.filter((x) => x.requires === a.id)[0];
			if (u) li.appendChild(el("span", "hint", " (unlocks the " + u.name + " " + u.kind + ")"));
			if (e) {
				li.appendChild(document.createTextNode(" · " + e.at + " · seed " + e.seed + " "));
				if (e.link) {
					const go = el("button", "linkish", "replay");
					go.type = "button";
					go.addEventListener("click", () => {
						closeModal();
						if (location.hash === e.link) setStatus("That class is the one on screen.");
						else location.hash = e.link;
					});
					li.appendChild(go);
				}
			}
			list.appendChild(li);
		}
		box.appendChild(list);
		modal("Replay: bingo, mutators, achievements", box, null, "Close");
	}

	function bindReplay() {
		if ($("btnReplay")) return;
		const host = $("btnHowTo");
		if (host) {
			const b = el("button", "iconbtn", "\u{1F3C5}");
			b.id = "btnReplay";
			b.type = "button";
			b.title = "Bingo card, mutators and the achievements ledger";
			b.setAttribute("aria-label", "Replay goals");
			b.addEventListener("click", replayDialog);
			host.parentNode.insertBefore(b, host);
		}
		const sur = $("btnSurprise");
		if (sur && !$("btnChaos")) {
			const c = el("button", null, "\u{1F300} Chaos draft");
			c.id = "btnChaos";
			c.type = "button";
			c.title = "Surprise me, plus an anomaly shortlist with the weirdest " +
				"candidates picked for you. Ctrl+Z takes it all back.";
			c.addEventListener("click", chaosDraft);
			sur.parentNode.insertBefore(c, sur.nextSibling);
		}
	}

	/* "Show everything": turns off the achievement gating on eras and
	   flavors, so nothing is locked for anybody who does not want it. */
	function paintShowAll(sel) {
		if ($("replayShowAll")) { $("replayShowAll").checked = replayStore().showAll; return; }
		const lab = el("label", "check");
		const cb = el("input");
		cb.type = "checkbox";
		cb.id = "replayShowAll";
		cb.checked = replayStore().showAll;
		cb.addEventListener("change", () => {
			replayStore().showAll = cb.checked;
			saveReplay();
			paintEra();
			paintFlavorOptions();
		});
		lab.appendChild(cb);
		lab.appendChild(document.createTextNode(" Show everything (no unlocks needed)"));
		lab.title = "Eras and flavors that achievements unlock are listed from the start";
		sel.parentNode.insertBefore(lab, $("eraNote"));
	}

	/* Replay a randomizer draw by its seed. */
	function randomizeWithSeed() {
		const box = el("div");
		box.appendChild(el("p", null, "Every Randomize press draws from a randomizer " +
			"seed, shown in the status line afterwards. Paste one here to draw the " +
			"same settings again" + (state.lastRandomSeed
				? " (the last one was " + state.lastRandomSeed + ")" : "") + "."));
		const inp = el("input");
		inp.type = "text";
		inp.value = state.lastRandomSeed || "";
		inp.placeholder = "randomizer seed";
		inp.setAttribute("aria-label", "Randomizer seed");
		box.appendChild(inp);
		modal("Replay a randomizer seed", box, () => {
			closeModal();
			randomizeSettings(state.randomScope, inp.value);
		}, "Randomize");
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

	/* The one-press version of the whole loop. Placed beside Randomize
	   because that is where a user looking for "just show me something" is
	   already pointing. */
	function bindChallenges() {
		if ($("btnChallenge")) return;
		const host = $("btnHowTo");
		if (!host) return;
		const b = el("button", "iconbtn", "\u2691");
		b.id = "btnChallenge";
		b.type = "button";
		b.title = "Challenges — a fixed seed, a target, and a budget of settings " +
			"to reach it with";
		b.setAttribute("aria-label", "Challenges");
		b.addEventListener("click", challengeDialog);
		host.parentNode.insertBefore(b, host);
	}

	function bindSurprise() {
		if ($("btnSurprise")) return;
		const host = $("btnRandomize");
		if (!host) return;
		const b = el("button", null, "✨ Surprise me");
		b.id = "btnSurprise";
		b.type = "button";
		b.title = "Draw wide-open settings, reroll, and show what came out. " +
			"Ctrl+Z takes all of it back in one step.";
		b.addEventListener("click", surpriseMe);
		host.parentNode.insertBefore(b, host.nextSibling);
		const d = el("button", null, "📅 Daily seed");
		d.id = "btnDaily";
		d.type = "button";
		d.title = "Roll today's seed (daily-YYYY-MM-DD) on the current settings — " +
			"the same class for anyone with the same settings today.";
		d.addEventListener("click", dailyReroll);
		b.parentNode.insertBefore(d, b.nextSibling);
	}

	/* The "draw separately for each loaded class" checkbox: shown only when
	   there is a choice to make (more than one file loaded) and hidden with
	   exactly one, where it would be a control with nothing to control. Also
	   called whenever the file set changes (installFiles) since that is the
	   only thing that can make the choice appear or disappear. */
	function paintRandomPerFile() {
		const row = $("randomPerFileRow");
		const box = $("randomizePerFile");
		if (!row || !box) return;
		row.hidden = state.files.length < 2;
		box.checked = state.randomizePerFile;
	}

	function bindRandomize() {
		const btn = $("btnRandomize");
		if (!btn) return;
		paintRandomScope();
		paintRandomPerFile();
		btn.addEventListener("click", (e) => {
			if (e.shiftKey) randomizeWithSeed();
			else randomizeSettings(state.randomScope);
		});
		const perFile = $("randomizePerFile");
		if (perFile) {
			perFile.addEventListener("change", () => {
				state.randomizePerFile = perFile.checked;
				/* Unticking is "stop doing that", not "forget what I drew
				   until I press Randomize again" — a per-file patch left in
				   place after the box that turned it on is cleared would go
				   on silently overriding the shared settings for whichever
				   files it was drawn for. */
				if (!state.randomizePerFile && Object.keys(state.fileCfgs).length) {
					state.fileCfgs = {};
					scheduleRun();
				}
				persist();
			});
		}
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
	/* THREE TIERS OF THE PANEL.

	   Eight groups and forty-five controls, and no notion of which six a new
	   user needs. "Shape" is the class itself: how good, how deep, how
	   specialized, what flavor, how it got here. "Season" adds the college
	   year that gets played around it and the honors it hands out. "Model" is
	   everything — the memories, the noise dials, the calibration knobs. A
	   control not named in the first two sets is a model control. The search
	   box overrides the tier, so a setting you can name is always findable;
	   "only what I changed" does too, since a changed model dial is exactly
	   what you would want to see. */
	const SETTING_TIERS = [
		["shape", "Shape", "The class: quality, depth, builds, flavor, paths"],
		["season", "Season", "Plus the college season and its awards"],
		["model", "Model", "Everything, memories and noise dials included"],
	];
	const TIER_SHAPE = new Set([
		"preset", "seed", "ovrMode", "classQuality", "classDepth", "eliteCount",
		"specialization", "classFlavor", "flavorHint", "archetypePool",
		"freshmanShare", "transferShare", "varySize", "lockHeights", "universe", "era",
		"pDII", "collegeSource", "talentCoupling", "birthplaceWeight", "signatureSkills",
	]);
	const TIER_SEASON = new Set([
		"potBias", "potSpread", "surpriseBudget", "traitCount", "narrative",
		"pace", "scoringEnv", "efficiencyEnv", "upsetFactor", "injuryRate",
		"seasonEvents", "draftEvents", "awardStrictness", "priorSeasons", "potModel",
		"coachTurnover", "realignmentRate", "redshirtShare", "reclassShare",
		"archetypeDiversity",
	]);
	function tierOf(key) {
		if (!key) return "model";
		if (TIER_SHAPE.has(key)) return "shape";
		if (TIER_SEASON.has(key)) return "season";
		return "model";
	}
	const TIER_RANK = { shape: 0, season: 1, model: 2 };

	function paintSettingTier() {
		const row = $("settingTier");
		if (!row) return;
		row.innerHTML = "";
		for (const [value, label, title] of SETTING_TIERS) {
			const b = el("button", "chip" + (state.settingTier === value ? " on" : ""), label);
			b.type = "button";
			b.title = title;
			b.setAttribute("role", "radio");
			b.setAttribute("aria-checked", state.settingTier === value ? "true" : "false");
			b.addEventListener("click", () => {
				state.settingTier = value;
				persist();
				paintSettingTier();
				applySettingFilter();
			});
			row.appendChild(b);
		}
	}

	function bindSettingTier() {
		const anchor = $("settingSearchBox");
		if (!anchor || $("settingTier")) return;
		const ctl = el("div", "ctl");
		const lbl = el("span", "lbl", "Show settings about:");
		lbl.id = "settingTierLabel";
		ctl.appendChild(lbl);
		const chips = el("div", "chips");
		chips.id = "settingTier";
		chips.setAttribute("role", "radiogroup");
		chips.setAttribute("aria-labelledby", "settingTierLabel");
		ctl.appendChild(chips);
		// How many settings the chosen tier is hiding (applySettingFilter).
		const hid = el("p", "unit");
		hid.id = "settingTierHidden";
		ctl.appendChild(hid);
		anchor.parentNode.insertBefore(ctl, anchor);
		paintSettingTier();
	}

	function applySettingFilter() {
		const box = $("settingSearch");
		const onlyChanged = $("onlyChanged");
		const note = $("settingSearchNote");
		if (!box) return;
		const q = box.value.trim().toLowerCase();
		const changedOnly = onlyChanged && onlyChanged.checked;
		const D = CFG.DEFAULTS;
		const tierRank = TIER_RANK[state.settingTier] !== undefined
			? TIER_RANK[state.settingTier] : 2;
		let shown = 0;
		let total = 0;
		let tiered = 0;
		for (const grp of document.querySelectorAll("#settings details.grp")) {
			let any = 0;
			const ctls = grp.querySelectorAll(".ctl");
			for (const ctl of ctls) {
				const input = ctl.querySelector("input, select");
				const key = input && input.id;
				/* Only a control with a config key is a SETTING: the batch
				   row and the anomaly shortlist are rows in the panel, and
				   counting them made "only what I changed" read "2 of 62
				   settings" on a page at its defaults. */
				const isSetting = !!(key && key in D);
				const changed = isSetting && !isDefaultSetting(key, state.cfg[key]);
				if (isSetting) total++;
				let show = true;
				if (q && settingText(ctl).indexOf(q) === -1) show = false;
				// A setting you changed is never hidden behind a tier.
				if (show && !q && !changedOnly && !changed &&
					TIER_RANK[tierOf(key)] > tierRank) {
					show = false;
					if (isSetting) tiered++;
				}
				if (show && changedOnly && !changed) show = false;
				/* The stylesheet's own class, not the `hidden` attribute: a
				   .ctl inside a <details> that is closed is already not
				   rendered, and mixing the two mechanisms made "show only what
				   I changed" leave empty gaps where a control used to be. */
				ctl.classList.toggle("settings-hidden", !show);
				if (show) { any++; if (isSetting) shown++; }
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
		const hid = $("settingTierHidden");
		if (hid) {
			hid.textContent = tiered ? tiered + " hidden" : "";
			hid.hidden = !tiered;
		}
		// The re-run fine print is for the Model view (or a focused control).
		const aside = $("settings");
		if (aside) aside.classList.toggle("tier-model", state.settingTier === "model");
		if (note) {
			note.textContent = (q || changedOnly)
				? shown + " of " + total + " settings" +
					(shown === 0 ? " — nothing matches" : "")
				: tiered
					? tiered + " of " + total + " settings are behind the " +
						(state.settingTier === "shape" ? "Season and Model" : "Model") +
						" tier"
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
		paintFlavorOptions();
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
		$("collegeSource").addEventListener("change", () => {
			pushUndo("changed the college source");
			state.cfg.collegeSource = $("collegeSource").value;
			markDirty();
			paintConfig();
			scheduleRun();
		});
		$("potModel").addEventListener("change", () => {
			pushUndo("changed the potential model");
			state.cfg.potModel = $("potModel").value;
			markDirty();
			paintConfig();
			scheduleRun();
		});
		$("signatureSkills").addEventListener("change", () => {
			pushUndo(($("signatureSkills").checked ? "turned on" : "turned off") + " signature skills");
			state.cfg.signatureSkills = $("signatureSkills").checked;
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
		$("lockHeights").addEventListener("change", () => {
			pushUndo("toggled locked heights");
			state.cfg.lockHeights = $("lockHeights").checked;
			markDirty();
			scheduleRun();
		});
		$("narrative").addEventListener("change", () => {
			pushUndo("toggled season storylines");
			state.cfg.narrative = $("narrative").checked;
			markDirty();
			scheduleRun();
		});
		$("extrapolateGaps").addEventListener("change", () => {
			pushUndo("toggled filling in unplayed years");
			state.cfg.extrapolateGaps = $("extrapolateGaps").checked;
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
			const seed = $("seed").value.trim();
			if (seed === state.cfg.seed) return;
			// A typed seed replaces the class on screen, so it is undoable
			// like the reroll that does the same thing.
			pushUndo(seed ? "typed the seed " + seed : "cleared the seed");
			state.cfg.seed = seed;
			run();
		});

		const SESSION_TOGGLES = ["universe", "lockHeights", "narrative"];
		const preset = $("preset");
		preset.addEventListener("change", () => {
			const p = CFG.PRESETS[preset.value] || state.customPresets[preset.value];
			if (!p) return;
			pushUndo("applied the preset " + preset.value);
			const seed = state.cfg.seed;
			/* A preset is about the CLASS. Universe mode, the height lock and
			   the storylines are how this session runs, and a preset that
			   does not mention them used to switch all three back to their
			   defaults without a word. */
			const keep = {};
			for (const k of SESSION_TOGGLES) if (!(k in p)) keep[k] = state.cfg[k];
			const wasUniverse = !!state.cfg.universe;
			state.cfg = fitEra(CFG.make(Object.assign({}, p, keep)));
			state.cfg.seed = seed;
			if (!!state.cfg.universe !== wasUniverse) state.universe.cfgs = {};
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
				/* A preset is the settings, not this class: the seed and the
				   anomaly shortlist's answers (kind names drawn for ONE class)
				   stay out, and a weight table is kept as its edits only. */
				const saved = {};
				for (const k of Object.keys(CFG.DEFAULTS)) {
					if (k === "seed" || k === "anomalyPicks") continue;
					const d = settingDelta(k, state.cfg[k]);
					if (d !== undefined) saved[k] = d;
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
				k !== "seed" && !isDefaultSetting(k, state.cfg[k]));
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
				/* BALANCED HAS NO RARITY WEIGHT, AND HAD A BOX FOR ONE.

				   Every other build competes for the specialist mass by
				   weight; Balanced takes exactly (1 - archetypeDiversity) of
				   the draw whatever the table says, and calibrateWeights,
				   archetypeWeight and poolWeight all filter it out by name.
				   So this input was a control that did nothing at any value —
				   measured, a weight of 1e9 on it produces a byte-identical
				   class — sitting in the one panel whose whole promise is
				   that the number you type is the share you get. It is
				   replaced by the sentence that is true, and by the name of
				   the slider that does move it. The realized share beside it
				   stays, because that is a fact about the class either way. */
				if (a.name === "Balanced") {
					const note = el("span", "unit archnote",
						"set by Archetype diversity");
					note.title = "Balanced is not drawn by rarity weight: it takes " +
						"whatever share the Archetype diversity slider leaves to " +
						"it. Lower that slider for more Balanced players.";
					row.appendChild(note);
					aw.appendChild(row);
					continue;
				}
				const inp = el("input");
				inp.type = "number";
				inp.step = "0.05";
				inp.min = "0";
				inp.max = String(CFG.ARCH_WEIGHT_MAX || 8);
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

	function encodeConfig(withDrawnSeed) {
		const out = {};
		for (const k of Object.keys(CFG.DEFAULTS)) {
			const d = settingDelta(k, state.cfg[k]);
			if (d !== undefined) out[k] = d;
		}
		/* A rerolled class has no typed seed; the one it drew is the only
		   thing that reproduces it, and a link without it opened a
		   different class on another machine. */
		if (withDrawnSeed && !out.seed && state.lastSeed) out.seed = String(state.lastSeed);
		if (state.mutators && state.mutators.length) out.mu = state.mutators.slice();
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

	/* The same class, as prose you can paste into a forum post.

	   A link is the right thing to hand somebody who will click it, and the
	   wrong thing everywhere links get eaten, shortened or stripped — which is
	   most of the places people actually talk about draft classes. It also
	   answers nothing on its own: a reader cannot see from a URL that the
	   sender ran the class at specialization 2.4 unless they open it. This is
	   the same payload encodeConfig puts in the hash, written out as lines,
	   with the seed and the class fingerprint on top so the recipient can
	   check they are looking at the same seventy players. */
	function configAsText() {
		const payload = encodeConfig(true);
		delete payload.overrides;
		delete payload.fp;
		const lines = [];
		const res = state.results[state.active];
		lines.push("BBGM Draft Class Workshop");
		if (res) {
			lines.push("seed: " + res.seed + "  ·  fingerprint: " + classFingerprint(res));
			if (res.flavor && res.flavor.label) lines.push("flavor: " + res.flavor.label);
		} else if (payload.seed) {
			lines.push("seed: " + payload.seed);
		}
		delete payload.seed;
		const keys = Object.keys(payload).sort();
		lines.push("");
		if (!keys.length) {
			lines.push("settings: all defaults");
		} else {
			lines.push("settings changed from default (" + keys.length + "):");
			for (const k of keys) {
				const v = payload[k];
				if (isWeightTable(k)) {
					const names = Object.keys(v || {});
					lines.push("  " + k + ": " + (names.length
						? names.map((n) => n + " " + v[n] + " (default " +
							builtinWeight(k, n) + ")").join(", ")
						: "edited"));
					continue;
				}
				const shown = typeof v === "number" && FORMAT[k] ? FORMAT[k](v)
					: v && typeof v === "object" ? JSON.stringify(v) : String(v);
				const def = defaultOf(k);
				const defShown = typeof def === "number" && FORMAT[k] ? FORMAT[k](def)
					: def && typeof def === "object" ? JSON.stringify(def) : String(def);
				lines.push("  " + k + ": " + shown + "  (default " + defShown + ")");
			}
		}
		const locks = Object.keys(state.overrides).length;
		if (locks) lines.push("", locks + " locked player" + (locks === 1 ? "" : "s") +
			" — not carried by this text; share the link, or More ▾ → locked " +
			"prospects as CSV, for those.");
		return lines.join("\n");
	}

	/* Roughly where browsers and the things people paste links into start
	   truncating. A class with 70 fully-locked players clears it easily, and a
	   silently truncated link is worse than no link: it opens, parses as far as
	   it got, and applies the wrong settings. */
	const HASH_LIMIT = 8000;
	let hashWarned = false;
	// What writeHash last put in the address bar; see the hashchange listener.
	let lastWrittenHash = null;

	function writeHash(withDrawnSeed) {
		try {
			const payload = encodeConfig(withDrawnSeed);
			// The challenge being played (a daily's date is in its key) and its score.
			Object.assign(payload, challengeHashFields());
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
						"Export the locks as CSV (More ▾) to share those.", true);
				}
			}
			lastWrittenHash = body ? "#c=" + body : "";
			history.replaceState(null, "", body ? "#c=" + body : "#");
		} catch (e) { /* a hash that will not fit is not worth an error banner */ }
	}

	/* The era picker offers only the eras the model is fitted to. Config.make
	   accepts any era the table knows (the harness runs an unfitted one by
	   name), so a link or a stored session naming an unfitted era is brought
	   back to the default here, where the panel is the one reading it. */
	function fitEra(cfg) {
		const CAL = global.Calibration;
		if (cfg && pickableEras().indexOf(cfg.era) === -1) cfg.era = CAL.DEFAULT_ERA;
		return cfg;
	}

	// The fitted eras, plus any unfitted one an achievement has unlocked.
	function pickableEras() {
		const CAL = global.Calibration;
		const out = CAL.fittedEras().slice();
		for (const u of global.ReplayMeta.UNLOCKS) {
			if (u.kind === "era" && CAL.ERAS[u.name] && out.indexOf(u.name) === -1 &&
				replayUnlocked("era", u.name)) out.push(u.name);
		}
		return out;
	}

	function readHash() {
		const m = /[#&]c=([^&]+)/.exec(location.hash || "");
		if (!m) return false;
		let payload;
		try {
			payload = JSON.parse(decodeURIComponent(m[1]));
		} catch (e) {
			showError(new Error("Could not read the settings in this link."));
			return false;
		}
		/* `#c=null`, `#c=[]`, `#c=5`: valid JSON and not a settings object.
		   Nothing to apply, and nothing worth an error banner either. */
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
		/* A LINK IS THE WHOLE STATE IT DESCRIBES. A link without locks is a
		   class with no locks — keeping the ones localStorage remembered from
		   some other session applied them to the linked class, silently. */
		readChallengeHashFields(payload);
		const ov = payload.overrides;
		state.overrides = ov && typeof ov === "object" && !Array.isArray(ov) ? ov : {};
		state.overrideFingerprint = state.overrides === ov ? (payload.fp || null) : null;
		delete payload.overrides;
		delete payload.fp;
		// A link is the whole state: no `mu` means no mutators.
		state.mutators = global.ReplayMeta.cleanMutators(payload.mu);
		delete payload.mu;
		state.cfg = fitEra(CFG.make(payload));
		state.presetDirty = true;
		return true;
	}

	/* A short, stable identity for one GENERATED class. Built from what the
	   user actually sees — who each player is, what he was built into, where he
	   plays and what he averaged — so any difference that matters shows up and
	   a difference that does not (the order of a tab, a theme) does not. */
	/* A NAME, NOT A HASH.

	   A class already knows what kind of class it is — its flavor has a label,
	   its narrative has one or three, and its board has a No. 1 pick — and
	   everything that identified one to the user was an eight-character
	   fingerprint. So the run history read as a list of hashes, the tab title
	   was a hash, and a shared link arrived with nothing a person could
	   recognise. Every ingredient was already on the result.

	   Deliberately short and deliberately not unique: the fingerprint is the
	   identity and this is the label beside it. The season and the flavor are
	   what a user actually remembers a class by ("the 2027 class — the year of
	   the stretch bigs"), and the storyline is added only when the class has
	   one that is not implied by the flavor already. */
	function className(res) {
		if (!res) return "";
		const bits = [];
		if (Number.isFinite(res.season)) bits.push("The " + res.season + " class");
		else bits.push("This class");
		const flavor = res.flavor && res.flavor.label ? res.flavor.label : null;
		const story = Array.isArray(res.narrative) && res.narrative[0]
			? res.narrative[0].name : null;
		const tail = [];
		if (flavor) tail.push(flavor);
		/* Only when it says something the flavor did not. Two labels that
		   amount to the same sentence is how a generated name starts to read
		   as generated. */
		if (story && (!flavor || story.toLowerCase() !== flavor.toLowerCase())) {
			tail.push(story);
		}
		const mu = res.cfg && res.cfg.mutators && res.cfg.mutators.length
			? " [" + global.ReplayMeta.mutatorLabel(res.cfg.mutators) + "]" : "";
		return bits[0] + (tail.length ? " — " + tail.join(", ") : "") + mu;
	}

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
			/* A truncated or damaged archive fails inside the stream, and the
			   browser reports that as "Failed to fetch" — which reads like a
			   network fault in a tool that never touches the network. */
			return new Response(stream).arrayBuffer().catch(() => {
				throw new Error("the .gz file is incomplete or corrupt — download " +
					"or export it again");
			});
		}).then((out) => new TextDecoder("utf-8").decode(out).replace(/^\ufeff/, ""));
	}

	/* Every draft class a dropped file contains, as loadable classes.

	   A BBGM league export carries the next two or three draft classes inside
	   it as ordinary player rows with an UNDRAFTED tid and a future
	   `draft.year`, and this tool used to take exactly one of them — the year
	   matching the league's own season — and discard the rest of the file. So
	   the future classes, which are the ones a user has any business
	   reworking (the current one is already being drafted), could not be
	   reached at all without advancing the save in the game and exporting
	   again.

	   A league export now loads as one class PER draft year, which drops
	   straight into the multi-file machinery that already exists: the file
	   picker lists them, universe mode runs them as one continuous world
	   oldest first, and "Merge into a league file" writes all of them back
	   into the league they came from. */
	/* IS THIS A LEAGUE OR IS IT A CLASS?

	   The split used to be decided by size alone: a file above the class cap
	   was a league and everything else was a class. That is right about a
	   fifty-megabyte export and wrong about the common case it was written
	   for — a BBGM league in its first season, or a small custom league, is
	   under the cap and is still a league carrying three future draft classes
	   that the user wants split out. Dropping one loaded a single "class" of
	   two thousand men, which the tool then tried to simulate.

	   A league says so in its own structure: it carries teams, a schedule,
	   gameAttributes or draft picks, none of which a draft-class export has.
	   Size stays as a fallback for a file that carries only players. */
	/* One definition, in the engine, because the validator asks the same
	   question — a league is warned about a birth year a class file is
	   refused for. Two copies of it would drift. */
	function looksLikeLeague(data) {
		return global.Engine.isLeagueFile(data);
	}

	function classesFromFile(name, data, check) {
		const base = name.replace(/\.json(\.gz)?$|\.gz$/i, "");
		const found = global.Engine.draftClassesIn(data);
		/* Not a league export: an ordinary draft-class file, loaded as
		   itself. Either the file says it is a league (teams, schedule,
		   gameAttributes) or it is over the class cap; a class file's own
		   players carry UNDRAFTED tids too, so the tids alone cannot tell
		   the two apart. */
		const isLeague = looksLikeLeague(data) || check.oversized;
		if (!isLeague || found.length === 0) {
			/* The old fallback, for a big file whose prospects carry no tid
			   this tool recognizes: take the players drafted in the file's
			   own season rather than simulating five thousand men. */
			if (isLeague && check.classPids) {
				const keep = new Set(check.classPids);
				const players = data.players.filter((p, i) =>
					keep.has(Number.isFinite(Number(p.pid)) ? Number(p.pid) : -1 - i));
				return [{
					name, data: Object.assign({}, data, { players }),
					warnings: check.warnings, league: { name, data },
				}];
			}
			return [{ name, data, warnings: check.warnings }];
		}
		const years = found.map((c) => c.year);
		const note = "This is a full league export (" +
			((data.players || []).length) + " players" +
			(Array.isArray(data.teams) && data.teams.length
				? ", " + data.teams.length + " teams" : "") + "). " +
			(found.length === 1
				? "The " + years[0] + " draft class inside it (" + found[0].count +
					" players) was loaded; the rest of the league was left alone."
				: found.length + " draft classes were found inside it (" +
					years.join(", ") + ") and each is loaded as its own class. " +
					"Turn on universe mode under The world to run them as one " +
					"continuous world.") +
			" Export \u2192 Merge into a league file writes them back into it.";
		return found.map((c, i) => {
			const cls = global.Engine.extractDraftClass(data, c.year);
			const sub = global.Engine.validateLeagueFile(cls);
			cls.startingSeason = sub.season;
			return {
				name: base + " \u2014 " + c.year + " class",
				data: cls,
				// The note is about the FILE, so it is said once rather than
				// once per class it produced.
				warnings: (i === 0 ? [note] : []).concat(sub.warnings),
				league: { name, data },
			};
		});
	}

	function readFiles(fileList, opts) {
		const problems = [];
		// A five-file drop used to just sit there with nothing on screen.
		$("empty").classList.add("busy");
		setStatus("Reading " + fileList.length + " file" +
			(fileList.length === 1 ? "" : "s") + "…", true);
		/* Not every file the tool writes is a draft class, and each of the
		   others has its own door: a universe export, a settings JSON and
		   the locks CSV all came back through here and were rejected as
		   malformed classes. They are set aside and handed to their own
		   importer once the classes in the same drop are in. */
		const side = { universe: [], settings: [], csv: [] };
		const jobs = Array.from(fileList).map(
			(f) => readTextFile(f).then(
				(text) => {
					if (/\.csv$/i.test(f.name || "") || f.type === "text/csv") {
						side.csv.push(text);
						return null;
					}
					const data = JSON.parse(text);
					if (data && data.format === "bbgm-draft-workshop/universe") {
						side.universe.push(data);
						return null;
					}
					if (data && data.format === SETTINGS_FORMAT) {
						side.settings.push(data);
						return null;
					}
					// Full schema check up front, so a bad file is rejected
					// with a sentence instead of throwing a raw TypeError
					// out of the middle of the sim.
					const check = global.Engine.validateLeagueFile(data);
					/* validateLeagueFile is a check now, not a migration, so
					   the season it recovered is applied here. */
					data.startingSeason = check.season;
					return classesFromFile(f.name, data, check);
				},
			).catch((e) => {
				problems.push(f.name + ": " + (e && e.message ? e.message : e));
				return null;
			}),
		);
		Promise.all(jobs).then((loaded) => {
			const classes = loaded.filter(Boolean).reduce((a, b) => a.concat(b), []);
			const other = side.universe.length + side.settings.length + side.csv.length;
			if (classes.length || !other) installFiles(classes, problems, opts);
			else {
				$("empty").classList.remove("busy");
				if (problems.length) showError(new Error(problems.join("\n")));
				setStatus("");
			}
			for (const s of side.settings) applySettingsJson(s);
			for (const u of side.universe) importUniverse(u);
			for (const text of side.csv) {
				if (!state.files.length) {
					showError(new Error("Load a draft class first — a locks CSV is " +
						"applied to the class on screen."));
				} else if (state.results[state.active]) importLocksCsv(text);
				else run(() => importLocksCsv(text));
			}
		});
	}

	/* THE SETTINGS, AS A FILE. What "More ▾ → Export settings JSON" writes
	   and what a drop of one reads back: the same payload a shareable link
	   carries, without the locks, under a format tag so it is never taken
	   for a draft class. */
	const SETTINGS_FORMAT = "bbgm-draft-workshop/settings";
	function settingsJson() {
		const cfg = encodeConfig(true);
		delete cfg.overrides;
		delete cfg.fp;
		return { format: SETTINGS_FORMAT, v: 1, cfg };
	}
	function exportSettingsJson() {
		download("draft-workshop-settings.json", JSON.stringify(settingsJson(), null, 2),
			"application/json");
		exported("the settings — drop the file on the page to load them again");
	}
	function applySettingsJson(json) {
		const cfg = json && json.cfg;
		if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
			showError(new Error("That settings file carries no settings."));
			return;
		}
		pushUndo("loaded settings from a file");
		state.cfg = fitEra(CFG.make(cfg));
		state.presetDirty = true;
		paintConfig();
		persist();
		if (state.files.length) run(() => setStatus("Loaded the settings from the file."));
		else setStatus("Loaded the settings from the file.");
	}

	/* The locks, in exactly the shape importLocksCsv reads back: one row per
	   locked prospect, key and name to match him, and only the columns a lock
	   can carry. A per-rating lock has no column, so it is said, not lost
	   silently. */
	function exportLocksCsv() {
		const res = state.results[state.active];
		const keys = Object.keys(state.overrides);
		if (!res || !keys.length) { setStatus("No prospect in this class is locked."); return; }
		const byKey = {};
		for (const p of res.players) byKey[p.key] = p;
		const cols = ["key", "name", "ovr", "pot", "archetype", "college"];
		const lines = [cols.join(",")];
		let ratingsOnly = 0;
		for (const k of keys) {
			const o = state.overrides[k] || {};
			const p = byKey[k];
			const row = [k, p ? p.name : "", o.ovr, o.pot, o.archetype, o.college];
			if (row.slice(2).every((v) => v === undefined || v === null || v === "")) ratingsOnly++;
			lines.push(row.map(esc).join(","));
		}
		const base = ((activeFile() || {}).name || "class").replace(/\.json(\.gz)?$|\.gz$/i, "");
		download(base + "_locks.csv", "﻿" + csvJoin(lines), "text/csv");
		exported(keys.length + " locked prospect" + (keys.length === 1 ? "" : "s") +
			(ratingsOnly ? "; " + ratingsOnly + " of them lock only individual ratings, " +
				"which a CSV row has no column for" : ""));
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

	/* ADDING FILES TO A SESSION RATHER THAN REPLACING IT.

	   installFiles replaced state.files outright, which is right for a drop
	   that starts a session and wrong for every drop after it: a user who has
	   built a twenty-season universe and wants to add 2046 to it had exactly
	   one route, which was to drop all twenty-one files again and watch the
	   whole world be redrawn. Everything keyed by file index — results,
	   runners, per-file config patches, the universe's own cfgs and order —
	   made appending look harder than it is, so it was never done.

	   The index is the problem and the file object is the answer: the merged
	   list is sorted by season like any other, and every index-keyed map is
	   rebuilt through an old-index → new-index mapping taken from the file
	   objects themselves. A file already loaded (same fingerprint) is not
	   loaded twice. */
	function mergeFiles(existing, added) {
		const have = new Set(existing.map((f) => f.fingerprint).filter(Boolean));
		const fresh = [];
		const dupes = [];
		for (const f of added) {
			if (!f.fingerprint) f.fingerprint = fingerprint(f);
			if (have.has(f.fingerprint)) { dupes.push(f.name); continue; }
			have.add(f.fingerprint);
			fresh.push(f);
		}
		const merged = existing.concat(fresh).sort((a, b) =>
			(a.data.startingSeason || 0) - (b.data.startingSeason || 0));
		const oldIndex = new Map();
		existing.forEach((f, i) => oldIndex.set(f, i));
		const remap = {};
		merged.forEach((f, i) => {
			if (oldIndex.has(f)) remap[oldIndex.get(f)] = i;
		});
		return { merged, fresh, dupes, remap };
	}

	function remapByIndex(map, remap) {
		const out = {};
		for (const k of Object.keys(map || {})) {
			const to = remap[Number(k)];
			if (to !== undefined) out[to] = map[k];
		}
		return out;
	}

	function installFiles(loaded, problems, opts) {
		const append = !!(opts && opts.append) && state.files.length > 0;
		if (append) { appendFiles(loaded, problems, opts); return; }
		{
			$("empty").classList.remove("busy");
			const ok = loaded.filter(Boolean);
			if (problems.length) showError(new Error(problems.join("\n")));
			else clearError();
			if (!ok.length) { setStatus(""); return; }
			state.files = ok.sort((a, b) =>
				(a.data.startingSeason || 0) - (b.data.startingSeason || 0));
			/* The league export these classes were lifted out of, kept so the
			   merge does not have to ask the user to find the same file on
			   disk a second time. */
			state.leagueSource = (ok.filter((f) => f.league)[0] || {}).league || null;
			// A synthetic file keeps its seed-derived fingerprint.
			for (const f of state.files) if (!f.synthetic) f.fingerprint = fingerprint(f);
			state.runners = state.files.map((f) => global.Engine.createRunner(f.data));
			state.results = [];
			state.active = 0;
			/* Patches keyed by file index, and this is a new set of files —
			   keeping the old map would silently hand a randomized-settings
			   patch drawn for somebody else's third file to whatever loads
			   into that slot now. */
			state.fileCfgs = {};
			// Biographies belong to the universe they were imported with.
			state.universeBiography = null;
			/* The undo history belongs to the classes it was made on. Undoing
			   across a replacing load restored the old class's locks — keyed
			   by pid — onto whoever holds those pids in the new one. */
			state.undo = [];
			state.redo = [];
			paintUndo();
			paintRandomPerFile();
			const sel = $("fileSelect");
			sel.innerHTML = "";
			state.files.forEach((f, i) => {
				sel.appendChild(new Option(
					(f.data.startingSeason || "?") + " — " + f.name, String(i)));
			});
			sel.hidden = state.files.length < 2;
			if ($("btnAddFiles")) $("btnAddFiles").hidden = false;
			$("btnExportAll").hidden = state.files.length < 2;
			$("empty").hidden = true;
			$("app").hidden = false;
			$("fileSummary").textContent = state.files.map(
				(f) => f.name + ": " + summarize(f.data)).join("  ·  ");
			$("fileSummary").hidden = false;
			for (const id of ["btnReroll", "btnRerollUntil", "btnRerun", "btnExport", "btnExportMenu",
				"btnExportAll", "btnPin"]) $(id).disabled = false;
			checkLockFingerprint();
			const warns = state.files.flatMap((f) => (f.warnings || [])
				.map((w) => f.name + ": " + w));
			if (warns.length) showWarning(warns.join("\n"));
			setStatus("");
			if (!(opts && opts.noRun)) run();
		}
	}

	/* Add classes to the session, keeping everything already loaded.

	   The universe is the reason this exists, so it is the case handled most
	   carefully: if every added class is later than the last season the chain
	   played, the chain is EXTENDED (see canExtendUniverse) and the seasons
	   already simulated are untouched — same seeds, same men, same results,
	   same player pages. If one of them lands in the middle of the timeline
	   the chain has to be rebuilt, because a class inserted at 2031 changes
	   the pool memory and the carry for every season after it, and that is
	   said out loud rather than done silently. */
	function appendFiles(loaded, problems, opts) {
		$("empty").classList.remove("busy");
		const ok = loaded.filter(Boolean);
		if (problems && problems.length) showError(new Error(problems.join("\n")));
		else clearError();
		if (!ok.length) { setStatus(""); return; }
		for (const f of ok) if (!f.fingerprint) f.fingerprint = fingerprint(f);
		const before = state.files.slice();
		const { merged, fresh, dupes, remap } = mergeFiles(before, ok);
		if (!fresh.length) {
			setStatus(dupes.length
				? "Already loaded: " + dupes.join(", ") + ". Nothing was added."
				: "Nothing was added.");
			return;
		}
		const activeFileObj = before[state.active] || null;
		/* Every index-keyed map moves with its file. */
		const results = [];
		const runners = [];
		merged.forEach((f, i) => {
			const from = before.indexOf(f);
			results[i] = from === -1 ? null : (state.results[from] || null);
			runners[i] = from === -1
				? global.Engine.createRunner(f.data)
				: state.runners[from];
		});
		state.files = merged;
		state.results = results;
		state.runners = runners;
		state.fileCfgs = remapByIndex(state.fileCfgs, remap);
		if (state.universe) {
			state.universe.cfgs = remapByIndex(state.universe.cfgs || {}, remap);
			state.universe.order = (state.universe.order || []).map((d) =>
				Object.assign({}, d, { index: remap[d.index] })).filter(
				(d) => d.index !== undefined);
			state.universe.careers = null;
		}
		state.active = activeFileObj ? merged.indexOf(activeFileObj) : 0;
		if (state.active < 0) state.active = 0;
		state.leagueSource = (ok.filter((f) => f.league)[0] || {}).league ||
			state.leagueSource || null;
		paintRandomPerFile();
		const sel = $("fileSelect");
		sel.innerHTML = "";
		state.files.forEach((f, i) => {
			sel.appendChild(new Option(
				(f.data.startingSeason || "?") + " — " + f.name, String(i)));
		});
		sel.value = String(state.active);
		sel.hidden = state.files.length < 2;
		if ($("btnAddFiles")) $("btnAddFiles").hidden = false;
		$("btnExportAll").hidden = state.files.length < 2;
		$("empty").hidden = true;
		$("app").hidden = false;
		$("fileSummary").textContent = state.files.map(
			(f) => f.name + ": " + summarize(f.data)).join("  ·  ");
		$("fileSummary").hidden = false;
		for (const id of ["btnReroll", "btnRerollUntil", "btnRerun", "btnExport", "btnExportMenu",
			"btnExportAll", "btnPin"]) $(id).disabled = false;
		const warns = fresh.flatMap((f) => (f.warnings || []).map((w) => f.name + ": " + w));
		if (dupes.length) {
			warns.push(dupes.length + " file" + (dupes.length === 1 ? " was" : "s were") +
				" already loaded and " + (dupes.length === 1 ? "was" : "were") +
				" skipped: " + dupes.join(", "));
		}
		if (warns.length) showWarning(warns.join("\n"));
		const added = fresh.length + " class" + (fresh.length === 1 ? "" : "es") + " added";
		// The caller runs the chain itself (a synthetic extension or an import).
		if (opts && opts.noRun) { setStatus(added + "."); return; }
		if (state.cfg.universe && state.universe.rows.length && canExtendUniverse()) {
			setStatus(added + " — extending the universe from " +
				state.universe.tail.lastSeason + "…", true);
			runUniverse(null, { extend: true });
			return;
		}
		if (state.cfg.universe && state.universe.rows.length) {
			const tail = universeTail();
			setStatus(added + ". " + (tail
				? "One of them is not later than " + tail.lastSeason +
					", so the chain cannot be extended — re-run the universe to " +
					"fold them in, which redraws every season."
				: "Re-run the universe to fold them in."));
			render();
			return;
		}
		if (state.cfg.universe && state.files.length > 1) { runUniverse(); return; }
		setStatus(added + ".");
		run();
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
		/* The same seen-set the engine uses, so a duplicate pid's second row
		   gets the same distinct key here as it does there. */
		const seen = new Set();
		const known = new Set(players.map((p, i) => global.Engine.playerKey(p, i, seen)));
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
		if ($("btnSynthUniverse")) $("btnSynthUniverse").addEventListener("click", syntheticUniverseDialog);
		$("file").addEventListener("change", (e) => {
			/* Copied before the reset: a FileList is live, and a value left
			   in place meant picking the same file again (after fixing it on
			   disk, say) fired no change and did nothing. */
			const files = Array.from(e.target.files || []);
			e.target.value = "";
			if (files.length) readFiles(files);
		});
		if ($("btnAddFiles")) {
			$("btnAddFiles").addEventListener("click", () => $("addFile").click());
		}
		if ($("addFile")) {
			$("addFile").addEventListener("change", (e) => {
				readFiles(e.target.files, { append: true });
				e.target.value = "";
			});
		}
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
			/* A DROP ONTO A LIVE SESSION ADDS.

			   Dropping a file used to discard everything already loaded,
			   including a finished universe, with no warning and no undo. A
			   drop with nothing loaded still starts a session; a drop on top
			   of one adds to it, which is what the gesture means once there is
			   something on screen. "Load file…" is still the replace. */
			if (e.dataTransfer.files.length) {
				readFiles(e.dataTransfer.files,
					state.files.length ? { append: true } : null);
			}
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
		// And one layer up: the flavors the last few classes drew. Sixty-six
		// flavors and one draw a class repeats sooner than a pool of
		// forty-six builds does; this is the same memory on that axis.
		cfg.recentFlavors = (state.flavorHistory || []).slice(0, POOL_HISTORY);
		/* A challenge is the same class for everybody, so this browser's
		   memory of its last few classes stays out of it. */
		if (state.challenge) {
			cfg.recentPools = [];
			cfg.recentAnomalies = [];
			cfg.recentFlavors = [];
		}
		// Mutators last: explicit choices, so the flavor treats them as touched.
		global.ReplayMeta.applyMutators(cfg, state.mutators, RB);
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
		/* And the flavor, on exactly the same terms. It is recorded by NAME
		   rather than by label because the name is what pickFlavor draws on
		   and what a shareable link carries; the label is prose. */
		if (res.flavor && res.flavor.name) {
			const hist = (state.flavorHistory || []).slice();
			if (hist[0] !== res.flavor.name) {
				hist.unshift(res.flavor.name);
				state.flavorHistory = hist.slice(0, POOL_HISTORY);
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
		/* The settings the season RAN under, recorded per season: after a
		   partial re-run the held seasons ran under different ones from the
		   panel, and rebuilding an evicted one under the panel's gave a
		   different season from the one on the timeline. */
		const cfg = CFG.make(saved.settings || state.cfg);
		cfg.overrides = state.overrides;
		cfg.seed = saved.seed;
		cfg.carryOver = saved.carryOver || null;
		cfg.recentPools = (saved.recentPools || []).map((a) => a.slice());
		cfg.recentAnomalies = (saved.recentAnomalies || []).map((a) => a.slice());
		cfg.universeRoster = saved.universeRoster || null;
		cfg.pastRoster = saved.pastRoster || null;
		cfg.universeRecruiting = saved.universeRecruiting || null;
		cfg.universeAlumni = saved.universeAlumni || null;
		cfg.universeTitles = saved.universeTitles || null;
		cfg.universeDigest = saved.universeDigest || null;
		cfg.biography = global.Universe.biographyForFile(state.universeBiography,
			state.files[i] && state.files[i].fingerprint);
		return cfg;
	}

	/* The per-file counterpart to universeCfgFor, for randomizeSettings'
	   "draw separately for each loaded class" option: a file with its own
	   randomized-settings patch runs with the shared config PLUS that patch
	   on top, rather than the shared config alone. Returns null exactly when
	   there is nothing file-specific to apply, so every call site can fall
	   back to effectiveCfg() unconditionally. Guarded off in universe mode,
	   where universeCfgFor already owns what a file runs with — the two are
	   never meant to combine, since a season's config there already comes
	   from carry-over rather than from this panel. */
	function fileCfgFor(i) {
		if (state.cfg.universe || !state.randomizePerFile) return null;
		const patch = state.fileCfgs && state.fileCfgs[i];
		if (!patch) return null;
		const cfg = effectiveCfg();
		Object.assign(cfg, patch);
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
	/* `onlyIndex`, when given, links just that file — which is what a
	   rehydrated result needs. A result rebuilt from its recorded config is
	   the RAW season: the linking pass is not part of the engine, so a file
	   evicted to bound memory and re-run on demand would come back with the
	   freshman year its own file guessed rather than the one the universe
	   played, which is the same disagreement between tabs that keeping the
	   results was meant to end. See ensureResult. */
	function linkCareers(order, onlyIndex) {
		const u = state.universe;
		const inChain = new Set((order || []).map((d) => d.index));
		/* READ FROM WHAT THE CHAIN RECORDED, NOT FROM EVERY EARLIER RESULT.

		   This used to walk every target file and, for each, rehydrate every
		   EARLIER season with ensureResult to read its futurePlayers — which
		   at the end of a long chain re-simulated every evicted season and
		   held all of them at once, undoing the memory bound the chain had
		   just kept. The chain now records, as each season runs, the rows it
		   produced for men from other files (state.universe.links, keyed by
		   the file each man belongs to — see Universe.beginChain), so linking
		   a file needs that file and nothing else.

		   And BOTH directions are applied. The returner branch (a man from an
		   EARLIER class playing a LATER season) sat inside a loop over the
		   seasons BEFORE each file, where no returner can be, so it never
		   ran: laterSeasons was only ever empty. */
		const targets = onlyIndex !== undefined ? [onlyIndex] : Array.from(inChain);
		/* The earlier season's page links forward to the man he became. The
		   fields it needs are on the row itself, so a rehydrated source gets
		   its links back without the target file being live. */
		for (const i of targets) {
			const res = state.results[i];
			if (!res) continue;
			for (const fp of res.futurePlayers || []) {
				if (!fp || !fp.stats || !inChain.has(fp.fileIndex)) continue;
				const key = fp.past ? (fp.homeKey || fp.key) : fp.homeKey;
				if (!key) continue;
				fp.laterKey = key;
				fp.laterFileIndex = fp.fileIndex;
			}
		}
		for (const j of targets) {
			const resJ = state.results[j];
			if (!resJ || !resJ.players) continue;
			const entries = (u && u.links && u.links[j]) || [];
			if (!entries.length) continue;
			const byKey = new Map();
			for (const p of resJ.players) if (p && p.key !== undefined) byKey.set(p.key, p);
			const touched = new Set();
			for (const x of entries) {
				const fp = x.fp;
				const team = x.team;
				if (!fp || !fp.stats) continue;
				/* THE SEASONS AFTER HIS DRAFT YEAR. A returner went undrafted
				   and came back; it belongs on his career table and NOT in his
				   priorSeasons, because exportFile writes those as BBGM stats
				   rows dated before the draft. */
				if (fp.past) {
					const owner = byKey.get(fp.homeKey || fp.key);
					if (!owner) continue;
					if (!Array.isArray(owner.laterSeasons)) owner.laterSeasons = [];
					const row = {
						season: x.season, team: fp.newCollege,
						classYear: fp.classYear, ovr: fp.newOvr,
						gp: Math.round(fp.stats.gp), mpg: fp.stats.mpg,
						ppg: fp.stats.ppg, rpg: fp.stats.rpg, apg: fp.stats.apg,
						ts: fp.stats.ts,
						record: team ? { w: team.w, l: team.l } : null,
						awards: (fp.awards || []).slice(),
						universeFileIndex: x.source, universeKey: fp.key,
						after: true,
					};
					/* REFRESHED, not only added: a warm re-run produces a new
					   line for the same season, and the old code kept the first
					   one it ever saw. */
					const at = owner.laterSeasons.findIndex((r) => r.season === x.season);
					if (at >= 0) owner.laterSeasons[at] = row;
					else owner.laterSeasons.push(row);
					owner.laterSeasons.sort((a, b) => a.season - b.season);
					touched.add(owner);
					continue;
				}
				const p = byKey.get(fp.homeKey);
				if (!p) continue;
				if (!Array.isArray(p.priorSeasons)) p.priorSeasons = [];
				let row = p.priorSeasons.filter((r) => r.season === x.season && !r.redshirt)[0];
				if (!row) {
					row = { season: x.season, redshirt: false };
					p.priorSeasons.push(row);
					p.priorSeasons.sort((a, b) => a.season - b.season);
				}
				const gl = fp.gameLog || null;
				/* THE SEASON THIS ROW EXPORTS AS: the absolute season, computed
				   where the file it was played in is known (see
				   Universe.beginChain), so exportFile does not shift it by this
				   file's own startingSeason-to-draft-year difference. */
				Object.assign(row, {
					exportSeason: x.exportSeason,
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
					universeFileIndex: x.source, universeKey: fp.key,
					postseason: team ? team.postseason : null,
				});
				touched.add(p);
			}
			for (const p of touched) {
				p.priorAwards = [];
				for (const r of p.priorSeasons || []) {
					for (const award of r.awards || []) {
						p.priorAwards.push({ season: r.season, classYear: r.classYear, award,
							exportSeason: r.exportSeason });
					}
				}
				try {
					p.note = global.Engine.buildNote(p, resJ.teams, resJ.season, resJ.cfg);
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

	/* Guard against re-entry: linkCareers rehydrates the earlier seasons it
	   reads, and each of those would otherwise ask to be linked in turn. The
	   earlier seasons are read for their `futurePlayers`, which the raw
	   simulation produces, so an unlinked one is the right input. */
	let linking = false;

	function ensureResult(i) {
		if (state.results[i]) return state.results[i];
		const runner = state.runners[i];
		if (!runner) return null;
		/* UNIVERSE MODE NEVER SHOWS A STANDALONE WORLD.

		   universeCfgFor is null until the chain has recorded what it ran
		   this file with — during the run, and after a reload (cfgs are not
		   persisted; the files are re-dropped and the chain re-runs). Falling
		   through to the plain config here re-simulated the file with no
		   carry-over and the wrong seed, so a tab opened in that window
		   showed a world the Timeline disagrees with — bug B1 back for the
		   length of a chain. The result is simply not there yet; render()
		   says so instead. */
		const ucfg = universeCfgFor(i);
		if (state.cfg.universe && !ucfg) return null;
		// Every file in a batch shares the seed, so they stay one set —
		// unless it has its own randomized-settings patch (fileCfgFor), or
		// is a universe-mode season with its own carry-over (universeCfgFor).
		state.results[i] = runner.run(ucfg || fileCfgFor(i) || effectiveCfg());
		/* WHICH FILE THIS RESULT IS. Universe.biographyOf and
		   Universe.registryOf are handed a LIST of results beside
		   state.files, and liveResults() skips any file the chain did not
		   run — so the list's positions are not file indices and the two
		   were being used interchangeably. Stamped here and at the chain's
		   own store, read by Universe.fileIndexOf. */
		if (state.results[i]) state.results[i].fileIndex = i;
		/* A universe result rebuilt after eviction is the RAW season; the
		   career links are a pass the chain runs on top of it. Relink it, or
		   a rehydrated file shows the freshman year its own file guessed
		   rather than the one the universe played. */
		if (!linking && state.cfg.universe && !state.universe.running &&
			Array.isArray(state.universe.order)) {
			linking = true;
			try { linkCareers(state.universe.order, i); }
			catch (e) { /* the page still renders without the links */ }
			finally { linking = false; }
		}
		return state.results[i];
	}

	/* The engine is staged: a runner only redoes the phases whose settings
	   changed. Moving the note template or an award dial used to re-simulate
	   364 programs, 11,000 games and every stat line in the country — about
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
	const BUSY_BUTTONS = ["btnReroll", "btnRerollUntil", "btnRerun", "btnExport", "btnExportMenu"];
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
		// The view being rebuilt says so, and shows a thin bar (see CSS).
		const v = $("view");
		if (v) v.setAttribute("aria-busy", "true");
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
		const v = $("view");
		if (v) v.removeAttribute("aria-busy");
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
		/* THE LABEL IS DATA, not whatever the element happens to be showing.

		   The copy confirmation used to capture `p.textContent` and put it
		   back 1.2 seconds later. A reroll that finished inside that window —
		   which is most rerolls — repainted the pill with the NEW seed and the
		   timer then overwrote it with the old one, so the header sat there
		   claiming a seed the class on screen was not built from. The label is
		   stored, the flash restores from the store, and a repaint cancels a
		   flash that is still pending. */
		const pill = $("seedPill");
		if (pill.dataset.flashTimer) {
			clearTimeout(Number(pill.dataset.flashTimer));
			delete pill.dataset.flashTimer;
		}
		paintExportLabel();
		pill.dataset.label = "seed " + res.seed + " · " + classFingerprint(res);
		pill.textContent = pill.dataset.label;
		pill.dataset.seed = res.seed;
		/* The fingerprint and flavor in the tab title, so two browser tabs
		   comparing two classes are distinguishable from the tab strip. */
		document.title = className(res) + " · " + classFingerprint(res) +
			" — BBGM Draft Class Workshop";
		$("seedPill").title = "Seed and class fingerprint — two people with the same " +
			"fingerprint are looking at the same seventy players. " +
			"Click to copy the seed, double-click to type one, shift-click or right-click to paste one" +
			(Number.isFinite(ms) ? " · " + Math.round(ms) + "ms (" +
				(res.phasesRun && res.phasesRun.length
					? res.phasesRun.join(" → ") : "nothing to redo") + ")" : "") +
			strangenessTip(res);
	}

	/* With several classes loaded, Export JSON names which one it writes. */
	function paintExportLabel() {
		const b = $("btnExport");
		if (!b) return;
		const f = activeFile();
		if (state.files.length < 2 || !f) {
			b.textContent = "Export JSON";
			b.removeAttribute("title");
			return;
		}
		const base = f.name.replace(/\.json(\.gz)?$|\.gz$/i, "");
		const yr = f.data && f.data.startingSeason;
		b.textContent = "Export " + (yr ? yr : base.length > 16 ? base.slice(0, 15) + "…" : base);
		b.title = "Export " + base + "_customized.json" + (yr ? " (season " + yr + ")" : "");
	}

	/* Whether the config changed since the universe's last full run is
	   nothing but a new note template — the one setting that changes
	   nothing pass one reads (no build, no roster, no honors) and is
	   handled entirely inside each file's own cached runner. See
	   phaseNotes/PHASES in js/engine.js: its only dep is noteLines. */
	function universeNotesOnlyChange() {
		const u = state.universe;
		if (!u || !u.settings || !u.rows || !u.rows.length || u.running) return false;
		if (!Array.isArray(u.order) || u.order.length !== state.files.length) return false;
		const a = Object.assign({}, u.settings);
		const b = CFG.make(state.cfg);
		delete a.noteLines; delete b.noteLines;
		delete a.biography; delete b.biography;
		return JSON.stringify(a) === JSON.stringify(b);
	}

	function runNow() {
		if (!state.files.length) return;
		/* Universe mode is a setting, not a tab. With it on, one file is one
		   season of a chain and running it alone would produce a world the
		   Timeline disagrees with, so the chain is what runs. It is async (a
		   season is ~330ms and fifty of them is a progress bar, not a click),
		   so this returns and the chain finishes the job. */
		if (state.cfg.universe && state.files.length && !state.universe.running) {
			/* EXCEPT for a note-template change. Rebuilding the whole chain
			   for that used to mean replaying every season in the universe —
			   pass one's cross-file previews, every program, every game —
			   to change a handful of sentences nothing else reads. Evicting
			   the cached results instead lets ensureResult rebuild each one
			   lazily, through the same per-file runner whose phase cache
			   already knows only "notes" needs rerunning (universeCfgFor
			   reads the live noteLines, not the frozen settings). */
			if (universeNotesOnlyChange()) {
				state.universe.settings = Object.assign({}, state.universe.settings,
					{ noteLines: (state.cfg.noteLines || []).slice() });
				state.results = new Array(state.files.length).fill(null);
				persist();
				render();
				return;
			}
			state.results = new Array(state.files.length).fill(null);
			runUniverse();
			return;
		}
		let res;
		const t0 = performance.now();
		try {
			state.results = new Array(state.files.length).fill(null);
			res = state.runners[state.active].run(
				fileCfgFor(state.active) || effectiveCfg());
			res.fileIndex = state.active;
			state.results[state.active] = res;
			state.lastSeed = res.seed;
			clearError();
		} catch (err) {
			showError(err);
			return;
		}
		const ms = performance.now() - t0;
		stampSeedPill(res, ms);
		/* The effective-settings box describes the RESULT, so it is repainted
		   when there is a new one — paintConfig alone fires on the way IN to a
		   run and would show the previous season's bends. The challenge bar is
		   the same: it scores the class that just came out. */
		paintEffective();
		paintChallenge();
		paintAnomalyPicks();
		paintStrangeness();
		noteAchievement(res);
		replayAfterRun(res);
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
		/* SAY WHAT THE STAGING ACTUALLY SAVED.

		   The engine's whole shape is that a slider re-runs only the phases it
		   invalidates — the note template no longer replays 364 programs — and
		   the only place that fact was visible was a tooltip on the seed pill
		   that nobody hovers. A user dragging "Award strictness" had no way to
		   know they were paying one awards phase rather than a whole season,
		   which makes the most expensive piece of engineering in the tool read
		   as if it were not there.

		   Printed only for a WARM run: a cold one re-runs all eight phases and
		   "re-ran build → regular → …" is noise. */
		if (res.phasesRun && res.phasesRun.length &&
			res.phasesRun.length < (state.runners[state.active].phases || []).length) {
			setStatus("Re-ran " + res.phasesRun.join(" → ") + " · " +
				Math.round(ms) + "ms");
		}
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

	/* ------------------------------------------------------------ sessions */

	const SESSIONS_MAX = 24;

	/* Record the class on screen as a restorable run: everything undoSnapshot
	   carries (settings, locks, the drawn seed, both memories) plus a label
	   made of what the class IS — fingerprint and flavor — rather than the
	   seed alone. Called before a reroll replaces it, and never twice for
	   the same fingerprint under the same settings. */
	function rememberSession() {
		const res = state.results[state.active];
		if (!res) return;
		const fp = classFingerprint(res);
		const snap = undoSnapshot(fp);
		snap.fingerprint = fp;
		snap.seed = res.seed;
		snap.flavor = res.flavor ? res.flavor.label : null;
		snap.at = Date.now();
		snap.file = activeFile() ? activeFile().name : null;
		snap.name = className(res);
		snap.season = res.season;
		snap.label = snap.name + " · " + fp;
		/* WHERE THIS RUN CAME FROM.

		   The history was twenty-four restorable snapshots in the order they
		   happened, and nothing related any of them to any other — so a
		   session spent exploring read as a stack of hashes and the question a
		   user actually has ("go back to where it was still good, then try the
		   other thing") meant scrolling a list and guessing.

		   Every snapshot now records the one it branched from and how far it
		   moved, which is enough to draw the exploration as a tree. `parent`
		   is the entry that was on screen when this one was recorded, matched
		   by its own id, so a restore followed by a reroll hangs the new run
		   off the one restored rather than off whatever happened to be newest.
		   `changed` is the settings diff against the parent, which is what
		   makes a branch describable: "from the 2027 class, 3 settings". */
		snap.id = fp + "/" + res.seed + "/" + (state.sessions.length ?
			state.sessions[0].id ? state.sessions.length : 0 : 0) + "/" + snap.at;
		snap.parent = state.lastSessionId || null;
		const parent = state.sessions.filter((x) => x.id === snap.parent)[0];
		snap.changed = parent
			? Object.keys(diffConfigs(parent.cfg || {}, snap.cfg || {}))
			: [];
		const dup = state.sessions.findIndex((x) => x.fingerprint === fp &&
			JSON.stringify(x.cfg) === JSON.stringify(snap.cfg) &&
			JSON.stringify(x.overrides) === JSON.stringify(snap.overrides));
		if (dup !== -1) {
			/* A duplicate keeps its place in the lineage: children already
			   point at its id, and replacing the id would orphan them. */
			snap.id = state.sessions[dup].id;
			snap.parent = state.sessions[dup].parent;
			state.sessions.splice(dup, 1);
		}
		state.lastSessionId = snap.id;
		state.sessions.unshift(snap);
		state.sessions = state.sessions.slice(0, SESSIONS_MAX);
		paintSessions();
	}

	function restoreSession(i) {
		const snap = state.sessions[i];
		if (!snap) return;
		pushUndo("returned to " + snap.label);
		applySnapshot(JSON.parse(JSON.stringify(snap)), "Returned to");
		/* The next class recorded branches from THIS one, not from whatever
		   was newest — which is what makes the history a lineage rather than
		   a stack. See rememberSession. */
		state.lastSessionId = snap.id || null;
		persist();
	}

	/* The history as a tree: depth by how far a run is from the root, and the
	   settings that were moved to get there. Rendered in the select as an
	   indent, which is as much structure as a <select> can carry — the Compare
	   tab is where a fuller view belongs, and this is the control people
	   actually use. */
	function sessionDepths() {
		const byId = {};
		for (const x of state.sessions) if (x.id) byId[x.id] = x;
		const depth = {};
		const depthOf = (x, guard) => {
			if (!x || !x.id) return 0;
			if (depth[x.id] !== undefined) return depth[x.id];
			if (guard > 40) return 0;
			const d = x.parent && byId[x.parent]
				? depthOf(byId[x.parent], guard + 1) + 1 : 0;
			depth[x.id] = d;
			return d;
		};
		for (const x of state.sessions) depthOf(x, 0);
		return depth;
	}

	function paintSessions() {
		const sel = $("sessionHistory");
		if (!sel) return;
		sel.innerHTML = "";
		sel.appendChild(new Option("recent classes…", ""));
		const depth = sessionDepths();
		state.sessions.forEach((x, i) => {
			const indent = "\u00a0\u00a0".repeat(Math.min(6, depth[x.id] || 0));
			const branch = x.changed && x.changed.length
				? " · " + x.changed.length + " setting" +
					(x.changed.length === 1 ? "" : "s") + " from the one before"
				: "";
			sel.appendChild(new Option(
				indent + (depth[x.id] ? "\u21b3 " : "") + x.label + branch +
				(x.file ? " (" + x.file + ")" : ""), String(i)));
		});
		if (state.sessions.length) {
			const sep = new Option("──────────", "");
			sep.disabled = true;
			sel.appendChild(sep);
			sel.appendChild(new Option("clear the run history", SESSIONS_CLEAR));
		}
		sel.hidden = !state.sessions.length;
	}
	const SESSIONS_CLEAR = "\u0000clearSessions";

	function bindSessions() {
		const hist = $("seedHistory");
		if (!hist || $("sessionHistory")) return;
		const sel = el("select");
		sel.id = "sessionHistory";
		sel.setAttribute("aria-label", "Recent classes: seed, settings and locks together");
		sel.title = "Every class you rerolled away from, restorable with its settings, " +
			"locks and memories — not only its seed";
		hist.parentNode.insertBefore(sel, hist.nextSibling);
		sel.addEventListener("change", () => {
			const v = sel.value;
			sel.value = "";
			if (v === SESSIONS_CLEAR) {
				state.sessions = [];
				state.lastSessionId = null;
				persist();
				paintSessions();
				setStatus("Run history cleared.");
				return;
			}
			if (v === "") return;
			restoreSession(Number(v));
		});
		paintSessions();
	}

	/* ------------------------------------------------------- reroll until */

	/* CONSTRAINT-DRIVEN REROLLING.

	   The batch engine generates and summarizes N classes; this wires a
	   predicate to the same loop and stops at the first class that satisfies
	   it. Seeds are derived from a base so the search is reproducible, and
	   the class it lands on is an ordinary reroll: its seed is in the pill,
	   the history and the undo stack. Predicates are named rather than
	   typed, since a class is a structured thing and "the champion is a
	   mid-major" is not a number. */
	/* The predicates live in js/engine.js now, so the worker that runs a
	   search, the main-thread fallback and the challenge scorer all share one
	   definition — and CI can reach them, which it could not while they were
	   in a UI module. See REROLL_PREDICATES there. */
	const REROLL_PREDICATES = global.Engine.REROLL_PREDICATES;
	const REROLL_UNTIL_MAX = 60;

	function rerollUntilDialog() {
		if (!state.files.length) return;
		const box = el("div");
		box.appendChild(el("p", null, "Reroll the class — new seed, same settings — " +
			"until the first one that satisfies every condition ticked below, " +
			"or the try limit is reached. The search is seeded, so the same " +
			"conditions from the same class find the same seed again."));
		const list = el("div", "colpicker");
		const rows = [];
		/* The last search's clauses, so running it again is one click rather
		   than twelve. See state.lastUntil. */
		const was = {};
		for (const k of (state.lastUntil && state.lastUntil.keys) || []) {
			was[k.charAt(0) === "!" ? k.slice(1) : k] = k.charAt(0) === "!" ? "no" : "yes";
		}
		for (const pr of REROLL_PREDICATES) {
			const row = el("div", "untilrow");
			/* Three states in one control, because two checkboxes per
			   condition would double the height of a dialog that is already a
			   list: off, must, must not. */
			const sel = el("select", "untilsense");
			sel.setAttribute("aria-label", pr.label);
			sel.appendChild(new Option("—", ""));
			sel.appendChild(new Option("must", "yes"));
			sel.appendChild(new Option("must not", "no"));
			if (was[pr.key]) sel.value = was[pr.key];
			row.appendChild(sel);
			row.appendChild(el("span", "untillabel", pr.label));
			list.appendChild(row);
			rows.push({ sel, key: pr.key });
		}
		box.appendChild(list);
		box.appendChild(el("p", "hint",
			"Conditions combine with AND. “Must not” is the negation — " +
			"a class with no seven-footer at the top, a year the mid-majors " +
			"did not win — which the tick boxes could not express. If the " +
			"search fails it reports how often each condition matched on its " +
			"own, so you can see which one is the expensive one."));
		const triesRow = el("div", "ctl");
		const tl = el("label", null, "Give up after");
		tl.htmlFor = "rerollUntilTries";
		triesRow.appendChild(tl);
		const tries = el("input");
		tries.type = "number";
		tries.id = "rerollUntilTries";
		tries.min = "1";
		tries.max = String(REROLL_UNTIL_MAX);
		tries.value = String(state.lastUntil && Number.isFinite(state.lastUntil.tries)
			? state.lastUntil.tries : 25);
		triesRow.appendChild(tries);
		triesRow.appendChild(el("span", "unit", " tries (about a third of a second each)"));
		box.appendChild(triesRow);
		modal("Reroll until…", box, () => {
			const picked = rows.filter((r) => r.sel.value)
				.map((r) => (r.sel.value === "no" ? "!" : "") + r.key);
			const n = Math.max(1, Math.min(REROLL_UNTIL_MAX, Number(tries.value) || 25));
			closeModal();
			if (!picked.length) { setStatus("Tick at least one condition."); return; }
			state.lastUntil = { keys: picked.slice(), tries: n };
			persist();
			rerollUntil(picked, n);
		}, "Search");
	}

	/* A clause is a predicate and a sense — "must" or "must not". Same
	   reasoning as the table above: one definition, in the engine. */
	const parseClause = global.Engine.parseRerollClause;

	/* THE SEARCH IN FLIGHT, if any: { cancel }. One at a time — a second
	   search used to start a second worker beside the first, and whichever
	   finished last decided the class. */
	let untilSearch = null;
	/* What a search's answer is only valid for. A seed is found under one set
	   of settings and locks; applied under another it is just a seed. */
	function untilKey() {
		return JSON.stringify([state.cfg, state.overrides, state.active, state.fileCfgs]);
	}

	function rerollUntil(keys, maxTries) {
		if (untilSearch) {
			setStatus("A search is already running — press Esc or its Cancel button first.");
			return;
		}
		const preds = keys.map(parseClause).filter(Boolean);
		if (!preds.length || !state.files.length) return;
		const runner = state.runners[state.active];
		if (!runner) return;
		pushUndo("rerolled until " + preds.map((p) => p.label).join(" and "));
		rememberSession();
		rememberPool();
		const base = (state.lastSeed || state.cfg.seed || mintRandomSeed()) +
			"|until|" + keys.join("+");
		const searchRng = new global.BBGMRng.Rng(base);
		const cfg = fileCfgFor(state.active) || effectiveCfg();
		const searchedFor = untilKey();
		const said = preds.map((p) => p.label).join(" and ");
		/* One counter array for both paths. Every candidate is tested against
		   every clause rather than short-circuited — the classes are already
		   simulated, so the extra tests are free — and the per-clause counts
		   turn a dead end into a fact about the settings. */
		const hits = preds.map(() => 0);
		let k = 0;
		let found = null;
		let timer = null;
		let searchWorker = null;
		let inline = false;

		/* PROGRESS AND A WAY OUT. The Until… button becomes the search's
		   Cancel for as long as it runs, with the count on it; Esc does the
		   same. Progress is written straight to the status line rather than
		   through setStatus, so sixty "try n of 60" lines do not bury the
		   message history. */
		const untilBtn = $("btnRerollUntil");
		const restLabel = untilBtn ? untilBtn.textContent : "";
		const restTitle = untilBtn ? untilBtn.title : "";
		function progress(done, total) {
			const s = $("status");
			s.textContent = "Reroll until: try " + done + " of " + total + "… (Esc cancels)";
			s.hidden = false;
			if (untilBtn) untilBtn.textContent = "Cancel " + done + "/" + total;
		}
		function end() {
			untilSearch = null;
			clearTimeout(timer);
			if (searchWorker) { searchWorker.terminate(); searchWorker = null; }
			document.body.classList.remove("searching");
			if (untilBtn) {
				untilBtn.textContent = restLabel;
				untilBtn.title = restTitle;
				untilBtn.removeAttribute("aria-pressed");
			}
		}
		function cancel() {
			end();
			setStatus("Search cancelled after " + k + " tr" + (k === 1 ? "y" : "ies") +
				". The class on screen is unchanged.");
			// The inline path left the runner's cache on its last candidate.
			if (inline) run();
		}
		untilSearch = { cancel };
		document.body.classList.add("searching");
		if (untilBtn) {
			untilBtn.title = "Cancel the search (Esc)";
			untilBtn.setAttribute("aria-pressed", "true");
		}
		progress(0, maxTries);

		/* The answer, applied only to the settings it answers. A seed found
		   and then run against settings moved in the meantime is a class
		   that was never tested against the conditions at all. */
		function apply(seed) {
			end();
			if (untilKey() !== searchedFor) {
				setStatus("Found seed " + seed + " on try " + k + ", but the settings " +
					"or locks changed during the search, so it was not applied — it " +
					"satisfies " + said + " only under the settings it was searched with.",
					true);
				if (inline) run();
				return;
			}
			state.cfg.seed = "";
			$("seed").value = "";
			state.lastSeed = seed;
			state.editing = null;
			state.selected = {};
			run(() => setStatus("Found it on try " + k + ": seed " + seed +
				" satisfies " + said + "." +
				(preds.length > 1 ? " On the way: " + preds
					.map((p, i) => p.label + " " + hits[i] + "/" + k).join("; ") + "." : "")));
		}
		/* WHAT THE SEARCH LEARNED ON THE WAY.

		   A failed search said "no class in 40 tries", which tells the user
		   that something is unlikely and nothing about WHICH something. The
		   per-clause hit counts turn a dead end into a fact about the
		   settings: "the 7'2" clause matched 2 of 40; the mid-major champion
		   matched 19". Named worst-first, because the rarest clause is the one
		   to drop and the one the user most wants named. */
		function finish() {
			if (found) { apply(found.seed); return; }
			end();
			const breakdown = preds
				.map((p, i) => ({ label: p.label, n: hits[i] }))
				.sort((a, b) => a.n - b.n)
				.map((x) => x.label + " matched " + x.n + " of " + k)
				.join("; ");
			setStatus("No class in " + k + " tries satisfied " + said + ". " + breakdown +
				". The class on screen is unchanged; raise the try limit, " +
				"drop the rarest condition, or change the settings that make " +
				"it unlikely.");
			/* The runner's cached state belongs to the last candidate;
			   re-run the class that was on screen so the phase cache and the
			   page agree again. */
			run();
		}
		/* Declared, not assigned: the worker's onerror falls back to it, and
		   as a `const` below the worker's early return it was never
		   initialised on that path — the fallback threw instead of running. */
		function step() {
			if (untilSearch === null) return;
			if (found || k >= maxTries) { finish(); return; }
			const seed = "u" + Math.floor(searchRng.random() * 1e9).toString(36);
			k++;
			try {
				const res = runner.run(Object.assign({}, cfg, { seed }));
				let all = true;
				preds.forEach((p, i) => {
					let hit = false;
					try { hit = !!p.test(res); } catch (e) { hit = false; }
					if (hit) hits[i]++; else all = false;
				});
				if (all) found = res;
			} catch (e) { /* a failed candidate is just not the one */ }
			progress(k, maxTries);
			timer = setTimeout(step, 0);
		}
		function startInline() {
			inline = true;
			timer = setTimeout(step, 0);
		}
		function finishFound(seed, tries, got) {
			k = tries;
			for (let i = 0; i < got.length && i < hits.length; i++) hits[i] = got[i];
			if (seed) apply(seed);
			else finish();
		}

		/* OFF THE MAIN THREAD, WHERE A SEARCH BELONGS.

		   The interactive run cannot move: the staged runner keeps its state
		   between calls as a graph of live objects and that is not a message.
		   A SEARCH is the opposite shape — up to sixty full simulations that
		   need one boolean each and hand back a seed — so it is all cost and
		   no payload, which is exactly what a worker is for.

		   The worker gets the seed, not the class. The main thread re-runs it
		   through its own runner, which is what puts it in the pill, the
		   history and the undo stack. The inline path stays, for the same
		   reason the batch runner's does: opening index.html off the disk
		   blocks workers in most browsers, and that is the documented way to
		   use this tool. */
		try {
			const w = new Worker("js/worker.js");
			searchWorker = w;
			w.onmessage = (e) => {
				if (searchWorker !== w) return;
				const m = e.data || {};
				if (m.type === "searchProgress") {
					progress(m.done, m.total);
				} else if (m.type === "searchDone") {
					w.terminate();
					searchWorker = null;
					finishFound(m.found, m.tries, m.hits || []);
				} else if (m.type === "error") {
					end();
					showError(new Error(m.message));
					run();
				}
			};
			w.onerror = () => {
				if (searchWorker !== w) return;
				w.terminate();
				searchWorker = null;
				startInline();
			};
			w.postMessage({
				type: "search", leagueFile: activeFile().data, cfg,
				base, keys, maxTries,
			});
		} catch (cannotStartWorker) {
			searchWorker = null;
			startInline();
		}
	}

	/* ------------------------------------------------------------ challenges

	   REROLLING WITH A TARGET.

	   "Reroll until…" wires a predicate to the reroll loop and searches for a
	   class that satisfies it. A challenge inverts that: the seed is FIXED, so
	   rerolling is not available, and the only way to hit the target is to
	   work out which settings produce it. That turns a sandbox into something
	   with a right answer — and every piece it needs already existed (the
	   predicates, the settings diff, the shareable link), which is why this is
	   a table and a scoring function rather than a subsystem.

	   Each challenge names a seed, the settings it starts you on, the goals,
	   and a budget: how many settings you may move. The budget is what makes
	   it a puzzle instead of a slider hunt — every goal is reachable by
	   pushing one dial to its limit, and doing that to six dials at once is
	   not an interesting answer. */
	const CHALLENGES = [
		{
			key: "cinderella",
			name: "Cinderella",
			blurb: "Put a No. 11 seed or worse in the Final Four, and keep the " +
				"No. 1 pick a freshman.",
			seed: "challenge-cinderella",
			cfg: { upsetFactor: 1.0, midMajorLift: 0, freshmanShare: 32 },
			goals: ["cinderella", "freshmanNo1"],
			budget: 4,
		},
		{
			key: "toolsy",
			name: "The seven-footer nobody can pass on",
			blurb: "A 7'2\" or taller prospect in the top five, on a board that " +
				"still has ten men at 50+ overall.",
			seed: "challenge-toolsy",
			cfg: { ovrMode: "curve", classQuality: 0, eliteCount: 2 },
			goals: ["tallTop5", "deepClass"],
			budget: 5,
		},
		{
			key: "oldheads",
			name: "The veterans' draft",
			blurb: "A senior in the top three and the player of the year going " +
				"first overall.",
			seed: "challenge-oldheads",
			cfg: { freshmanShare: 32, transferShare: 34 },
			goals: ["seniorTop3", "poyIsNo1"],
			budget: 4,
		},
		{
			key: "nomajors",
			name: "The year the map broke",
			blurb: "A mid-major national champion, without a mid-major surge.",
			seed: "challenge-nomajors",
			cfg: { midMajorLift: 0, upsetFactor: 1.0 },
			goals: ["midMajorChamp"],
			budget: 3,
			forbid: ["midMajorLift"],
		},
		{
			key: "strange",
			name: "A very strange year",
			blurb: "Make the world score 50 or more for strangeness, moving " +
				"no more than two settings.",
			seed: "challenge-weird",
			cfg: {},
			goals: ["strangeness:50"],
			budget: 2,
		},
		{
			key: "perfect",
			name: "The perfect season",
			blurb: "A team goes unbeaten in the regular season and no " +
				"double-digit seed reaches the Final Four — without a mid-major surge.",
			seed: "undefeated",
			cfg: {},
			goals: ["unbeaten", "!cinderella"],
			budget: 3,
			forbid: ["midMajorLift"],
		},
	];

	/* How a challenge attempt stands right now: which goals the class on
	   screen meets, how many settings have been moved, and whether any
	   forbidden dial was touched. Pure — it reads the result and the config
	   and changes nothing — so it can be called on every render. */
	function scoreChallenge(ch, res) {
		if (!ch || !res) return null;
		const goals = ch.goals.map((key) => {
			// A goal is a predicate key, or (a puzzle's headlines) a {label, test}.
			const clause = key && typeof key === "object" ? key : parseClause(key);
			let met = false;
			try { met = !!(clause && clause.test(res)); } catch (e) { met = false; }
			return { label: clause ? clause.label : key, met };
		});
		const start = CFG.make(Object.assign({}, ch.cfg, { seed: ch.seed }));
		// diffConfigs returns "key was → is" lines; the setting is the first word.
		const changes = diffConfigs(start, CFG.make(state.cfg))
			.filter((line) => line.split(" ")[0] !== "seed");
		const moved = changes.map((line) => line.split(" ")[0]);
		const broke = (ch.forbid || []).filter((k) => moved.indexOf(k) !== -1);
		return {
			goals,
			met: goals.filter((g) => g.met).length,
			total: goals.length,
			moved,
			changes,
			budget: ch.budget,
			overBudget: Math.max(0, moved.length - ch.budget),
			broke,
			solved: goals.every((g) => g.met) && moved.length <= ch.budget && !broke.length,
		};
	}

	function challengeReport(ch, res) {
		const sc = scoreChallenge(ch, res);
		const box = el("div");
		if (!sc) {
			box.appendChild(el("p", null, "Run a class first."));
			return box;
		}
		box.appendChild(el("p", null, ch.blurb));
		const list = el("div", "colpicker");
		for (const g of sc.goals) {
			list.appendChild(el("p", g.met ? "goal met" : "goal",
				(g.met ? "\u2713 " : "\u00b7 ") + g.label));
		}
		box.appendChild(list);
		box.appendChild(el("p", "unit",
			"Settings moved: " + sc.moved.length + " of " + sc.budget +
			(sc.overBudget ? " — " + sc.overBudget + " over budget" : "") +
			(sc.moved.length ? " (" + sc.moved.slice(0, 8).join(", ") +
				(sc.moved.length > 8 ? ", …" : "") + ")" : "")));
		if (sc.broke.length) {
			box.appendChild(el("p", "unit",
				"Off limits for this challenge: " + sc.broke.join(", ")));
		}
		box.appendChild(el("p", sc.solved ? "goal met" : "hint",
			sc.solved
				? "Solved. The link button copies the settings that did it."
				: "Not yet. The seed is fixed — the only way through is the panel."));
		return box;
	}

	function challengeDialog() {
		if (!state.files.length) { setStatus("Load a class file first."); return; }
		const box = el("div");
		box.appendChild(el("p", null,
			"A challenge fixes the seed, so rerolling is not the answer: the " +
			"only way to hit the target is to work out which settings produce " +
			"it, inside a budget of how many you may move."));
		const sel = el("select");
		sel.setAttribute("aria-label", "Challenge");
		for (const ch of CHALLENGES) sel.appendChild(new Option(ch.name, ch.key));
		if (state.challenge) sel.value = state.challenge;
		box.appendChild(sel);
		const detail = el("div");
		const paint = () => {
			detail.innerHTML = "";
			const ch = CHALLENGES.filter((c) => c.key === sel.value)[0];
			if (!ch) return;
			detail.appendChild(el("p", null, ch.blurb));
			detail.appendChild(el("p", "unit", "Seed " + ch.seed +
				" · move at most " + ch.budget + " settings" +
				(ch.forbid ? " · " + ch.forbid.join(", ") + " is off limits" : "")));
			if (state.challenge === ch.key) {
				detail.appendChild(challengeReport(ch, state.results[state.active]));
			}
		};
		sel.addEventListener("change", paint);
		paint();
		box.appendChild(detail);
		box.appendChild(replayPanel());
		modal("Challenges", box, () => {
			const ch = CHALLENGES.filter((c) => c.key === sel.value)[0];
			closeModal();
			if (!ch) return;
			startChallenge(ch);
		}, "Start");
	}

	function startChallenge(ch) {
		pushUndo("started the " + ch.name + " challenge");
		state.challenge = ch.key;
		state.replayRun = { key: ch.key, runs: 0 };
		Object.assign(state.cfg, CFG.make(Object.assign({}, ch.cfg)));
		state.cfg.seed = ch.seed;
		state.lastSeed = ch.seed;
		$("seed").value = ch.seed;
		state.overrides = {};
		markDirty();
		paintConfig();
		persist();
		run(() => {
			const res = state.results[state.active];
			const sc = scoreChallenge(ch, res);
			setStatus(ch.name + ": " + ch.blurb + " — " +
				(sc ? sc.met + " of " + sc.total + " goals met, " +
					sc.moved.length + " of " + ch.budget + " settings used." : ""), true);
		});
	}

	/* Reported after every run while a challenge is active, so the panel is
	   the game board rather than something to reopen a dialog to check. */
	function paintChallenge() {
		const host = $("presetDiff");
		if (!host) return;
		let bar = $("challengeBar");
		const ch = findChallenge(state.challenge);
		const res = state.results[state.active];
		if (!ch || !res) { if (bar) bar.remove(); return; }
		if (!bar) {
			bar = el("div", "challengebar");
			bar.id = "challengeBar";
			host.parentNode.insertBefore(bar, host.nextSibling);
		}
		bar.innerHTML = "";
		const sc = scoreChallenge(ch, res);
		bar.appendChild(el("b", null, ch.name));
		bar.appendChild(el("span", sc.solved ? "goal met" : "unit",
			" " + sc.met + "/" + sc.total + " goals · " + sc.moved.length + "/" +
			sc.budget + " settings" + (sc.solved ? " · solved" : "")));
		paintReplayBar(bar, ch, sc, res);
		const give = el("button", "linky", "give up");
		give.type = "button";
		give.addEventListener("click", () => {
			state.challenge = null;
			persist();
			paintChallenge();
			setStatus("Challenge abandoned; the settings stay where you left them.");
		});
		bar.appendChild(give);
		const copy = el("button", "linky", "copy result");
		copy.id = "btnCopyChallenge";
		copy.type = "button";
		copy.addEventListener("click", () => copyText(challengeResultText(ch, sc), copy, null, "challenge result"));
		bar.appendChild(copy);
	}

	/* One line to paste into a chat: the challenge, how it stands, and
	   which dials moved from where the challenge started them. */
	function challengeResultText(ch, sc) {
		return ch.name + ": " + (sc.solved ? "solved" : "not solved") + " · " +
			sc.met + "/" + sc.total + " goals · " + sc.moved.length + "/" + sc.budget +
			" settings" + (sc.changes.length ? " (" + sc.changes.join(", ") + ")" : "") +
			" · seed " + ch.seed;
	}

	/* ------------------------------------------------------- replayability

	   Audit section 4, ideas 1, 2, 3, 7, 12 and 13. The rules live in
	   js/replay.js (pure, tested in tools/tests/replaychallenge.js); this is
	   the wiring. Everything here is its own function so the challenge bar
	   and dialog each gain one line. */
	const RP = global.Replay;
	const BEST_KEY = "bbgm-draft-workshop/challenge-best";
	let lastCountedRes = null;

	/* Any challenge by key: the static table, a daily ("daily-YYYY-MM-DD"),
	   a campaign tier ("campaign:<key>", null while locked) or the puzzle in
	   progress ("puzzle:<id>", which needs its target from state.puzzle). */
	function findChallenge(key) {
		if (typeof key !== "string") return null;
		const fixed = CHALLENGES.filter((c) => c.key === key)[0];
		if (fixed) return fixed;
		if (/^daily-/.test(key)) return RP.dailyChallenge(key.slice(6));
		if (/^campaign:/.test(key)) {
			const i = CHALLENGES.findIndex((c) => "campaign:" + c.key === key);
			return i < 0 ? null : RP.campaignTier(CHALLENGES, i, state.challengeProgress);
		}
		if (/^puzzle:/.test(key) && state.puzzle && "puzzle:" + state.puzzle.id === key) {
			const p = RP.puzzle(state.puzzle.id);
			p.goals = RP.puzzleGoals(state.puzzle.target);
			return p;
		}
		return null;
	}

	function readBest() {
		try {
			const b = JSON.parse(localStorage.getItem(BEST_KEY) || "{}");
			return b && typeof b === "object" ? b : {};
		} catch (e) { return {}; }
	}
	function writeBest(key, score) {
		try {
			const b = readBest();
			if (!RP.betterScore(score, b[key])) return false;
			b[key] = score;
			localStorage.setItem(BEST_KEY, JSON.stringify(b));
			return true;
		} catch (e) { return false; }
	}

	// The current attempt's score, or null while it is unsolved.
	function attemptScore(ch, sc) {
		if (!sc || !sc.solved) return null;
		const runs = state.replayRun && state.replayRun.key === ch.key ? state.replayRun.runs : 1;
		return RP.parScore(sc.moved.length, ch.budget, runs);
	}

	function challengeHashFields() {
		const ch = findChallenge(state.challenge);
		if (!ch || /^puzzle:/.test(ch.key)) return {};
		const sc = scoreChallenge(ch, state.results[state.active]);
		const score = attemptScore(ch, sc);
		return score === null ? { ch: ch.key } : { ch: ch.key, sc: score };
	}
	// Takes the challenge fields out of a link payload; they are not settings.
	function readChallengeHashFields(payload) {
		const key = payload.ch;
		delete payload.ch;
		delete payload.sc;
		if (typeof key === "string" && findChallenge(key) && key !== state.challenge) {
			state.challenge = key;
			state.replayRun = { key, runs: 0 };
		}
	}

	function restoreReplay(saved) {
		const pr = saved.challengeProgress;
		if (pr && pr.cleared && typeof pr.cleared === "object") {
			state.challengeProgress = { cleared: pr.cleared };
		}
		const rr = saved.replayRun;
		if (rr && typeof rr.key === "string" && Number.isFinite(rr.runs)) state.replayRun = rr;
		const pz = saved.puzzle;
		if (pz && typeof pz.id === "string" && pz.target && typeof pz.target === "object") {
			state.puzzle = pz;
		}
		if (saved.ghost && typeof saved.ghost === "object") state.ghost = saved.ghost;
	}

	/* The bar's second line: par and score, the campaign, and the rival. */
	function paintReplayBar(bar, ch, sc, res) {
		if (!state.replayRun || state.replayRun.key !== ch.key) {
			state.replayRun = { key: ch.key, runs: 0 };
		}
		if (res !== lastCountedRes) { lastCountedRes = res; state.replayRun.runs++; }
		const runs = state.replayRun.runs;
		const score = attemptScore(ch, sc);
		if (score !== null) {
			writeBest(ch.key, score);
			if (Number.isFinite(ch.tier) &&
				!state.challengeProgress.cleared[ch.baseKey]) {
				state.challengeProgress.cleared[ch.baseKey] = sc.moved.slice();
			}
		}
		const best = readBest()[ch.key];
		const line = el("span", "unit replayscore",
			" · par " + ch.budget + " · " + runs + " run" + (runs === 1 ? "" : "s") +
			(score !== null ? " · score " + score : "") +
			(Number.isFinite(best) ? " · best " + best : ""));
		line.id = "challengeScore";
		bar.appendChild(line);
		if (ch.forbid && ch.forbid.length && Number.isFinite(ch.tier)) {
			bar.appendChild(el("span", "unit", " · off limits: " + ch.forbid.join(", ")));
		}
		const g = state.ghost;
		if (g && g.challenge === ch.key) {
			const cmp = RP.ghostCompare(sc.moved, g.moved);
			const rival = el("div", "unit replayghost",
				"Rival: " + (g.moved.length ? g.moved.join(", ") : "no settings moved") +
				(Number.isFinite(g.score) ? " · score " + g.score : g.solved ? "" : " · unsolved") +
				(cmp.shared.length ? " · same dials: " + cmp.shared.join(", ") : "") +
				(cmp.onlyMine.length ? " · only you: " + cmp.onlyMine.join(", ") : ""));
			rival.id = "challengeGhost";
			bar.appendChild(rival);
		}
		const code = el("button", "linky", "code");
		code.type = "button";
		code.title = "Copy a short code for this attempt (settings, dials and score)";
		code.addEventListener("click", () => copyText(resultCode(), code, null, "result code"));
		bar.appendChild(code);
	}

	/* A short code for the class on screen: the link's settings (seed and
	   variation included) plus the attempt, when a challenge is on. */
	function resultCode() {
		const payload = encodeConfig(true);
		delete payload.overrides;
		delete payload.fp;
		const ch = findChallenge(state.challenge);
		if (!ch) return RP.makeResult(payload);
		const sc = scoreChallenge(ch, state.results[state.active]);
		return RP.makeResult(payload, { challenge: ch.key, moved: sc ? sc.moved : [],
			score: attemptScore(ch, sc), solved: !!(sc && sc.solved) });
	}

	function applyCode(code) {
		const r = RP.readResult(code);
		if (!r) { setStatus("That code did not read — check it was copied whole."); return false; }
		pushUndo("loaded a share code");
		state.cfg = fitEra(CFG.make(r.payload));
		state.overrides = {};
		state.overrideFingerprint = null;
		state.presetDirty = true;
		if (r.challenge && findChallenge(r.challenge)) {
			state.challenge = r.challenge;
			state.replayRun = { key: r.challenge, runs: 0 };
		}
		state.lastSeed = state.cfg.seed || state.lastSeed;
		$("seed").value = state.cfg.seed || "";
		markDirty();
		paintConfig();
		persist();
		run(() => setStatus("Loaded the code."));
		return true;
	}

	function importGhost(code) {
		const r = RP.readResult(code);
		if (!r || !r.challenge) {
			setStatus("A rival needs a code copied from a challenge attempt.");
			return false;
		}
		state.ghost = { challenge: r.challenge, moved: r.moved, score: r.score, solved: r.solved };
		persist();
		paintChallenge();
		setStatus("Rival loaded for " + r.challenge + ".");
		return true;
	}

	function startDaily(date) {
		const ch = RP.dailyChallenge(date || RP.dateKey(new Date()));
		if (ch) startChallenge(ch);
	}

	function startCampaign(i) {
		const ch = RP.campaignTier(CHALLENGES, i, state.challengeProgress);
		if (!ch) { setStatus("Clear the previous tier first."); return; }
		startChallenge(ch);
	}

	/* The target is run once, from the runner directly, so the hidden
	   settings never reach the panel, the hash or the history. */
	function startPuzzle(id) {
		if (!state.files.length) { setStatus("Load a class file first."); return; }
		const p = RP.puzzle(id || RP.dateKey(new Date()));
		const was = state.challenge;
		state.challenge = p.key;   // blanks the class memory; see effectiveCfg
		let target;
		try {
			const cfg = effectiveCfg();
			Object.assign(cfg, CFG.make(Object.assign({}, p.hidden, { seed: p.seed })));
			cfg.overrides = {};
			target = RP.headlines(state.runners[state.active].run(cfg));
		} catch (e) {
			state.challenge = was;
			showError(e);
			return;
		}
		state.puzzle = { id: p.key.slice(7), target };
		p.goals = RP.puzzleGoals(target);
		startChallenge(p);
	}

	function replayPanel() {
		const box = el("div", "replaypanel");
		const row = (label) => {
			const r = el("div", "filters");
			if (label) r.appendChild(el("span", "unit", label));
			box.appendChild(r);
			return r;
		};
		const button = (id, text, fn) => {
			const b = el("button", null, text);
			b.type = "button";
			b.id = id;
			b.addEventListener("click", fn);
			return b;
		};
		const today = RP.dateKey(new Date());
		const daily = RP.dailyChallenge(today);
		row("Daily (" + today + ", budget " + daily.budget + "):")
			.appendChild(button("replayDaily", "Play today's", () => {
				closeModal(); startDaily(today);
			}));
		const unlocked = RP.campaignUnlocked(CHALLENGES, state.challengeProgress);
		const tier = el("select");
		tier.id = "replayTier";
		tier.setAttribute("aria-label", "Campaign tier");
		CHALLENGES.forEach((c, i) => {
			const o = new Option((i + 1) + ". " + c.name +
				(state.challengeProgress.cleared[c.key] ? " ✓" : i >= unlocked ? " (locked)" : ""), i);
			o.disabled = i >= unlocked;
			tier.appendChild(o);
		});
		tier.value = String(Math.min(unlocked, CHALLENGES.length) - 1);
		const camp = row("Campaign:");
		camp.appendChild(tier);
		camp.appendChild(button("replayCampaign", "Play tier", () => {
			closeModal(); startCampaign(Number(tier.value));
		}));
		const pid = el("input");
		pid.id = "replayPuzzleId";
		pid.value = today;
		pid.setAttribute("aria-label", "Puzzle name");
		const puz = row("Find the settings (≤3 dials, seed fixed):");
		puz.appendChild(pid);
		puz.appendChild(button("replayPuzzle", "Start puzzle", () => {
			closeModal(); startPuzzle(pid.value.trim() || today);
		}));
		const paste = el("input");
		paste.id = "replayPaste";
		paste.placeholder = "BB1-…";
		paste.setAttribute("aria-label", "Share code");
		const codes = row("Code:");
		codes.appendChild(paste);
		codes.appendChild(button("replayLoad", "Load", () => {
			if (applyCode(paste.value)) closeModal();
		}));
		codes.appendChild(button("replayRival", "Set as rival", () => {
			if (importGhost(paste.value)) closeModal();
		}));
		codes.appendChild(button("replayCopy", "Copy mine", (e) => copyText(resultCode(), e.target, null, "result code")));
		return box;
	}

	function reroll(opts) {
		/* A second reroll inside the busy window of the first one read a
		   lastSeed the first had blanked, and pushed an undo entry that
		   restored nothing. One at a time. */
		if (busyDepth > 0 || untilSearch) return;
		const previous = state.lastSeed;
		if (!(opts && opts.noUndo)) pushUndo("rerolled the class");
		// The class being replaced goes into the run history, with everything
		// needed to come back to it. See rememberSession.
		rememberSession();
		// Before the draw: the class being replaced is what the next one is
		// asked not to repeat. See rememberPool.
		rememberPool();
		state.cfg.seed = "";
		/* The anomaly shortlist belongs to ONE class. Carrying the answers
		   into the next one matches a few kind names by coincidence and drops
		   the rest, so a reroll would quietly produce a class with two
		   anomalies in it and nothing to say why. */
		state.cfg.anomalyPicks = null;
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
		// Prediction, bracket pool and blind scout; see js/play.js.
		["play", "Play", "Play"],
	];

	/* ----------------------------------------------------------- universe */

	/* Run every loaded file as one continuous world, oldest season first,
	   handing carry-over state (conference map, program levels, coaches,
	   pool memory) from each season to the next. Asynchronous in slices so
	   the page stays alive; ~330ms a season means 50 classes is a progress
	   bar, not a click. */
	/* Cancellation. Fifty seasons at ~550ms cold is close to a minute, and
	   the chain used to have `running` and no way out — the batch runner has
	   had a cancel button since it existed (see cancelBatch). Set by the
	   button, read at the top of every step, and the seasons already finished
	   are KEPT, exactly as a cancelled batch keeps its finished classes. */
	let universeCancel = false;

	function cancelUniverse() {
		if (!state.universe.running) return;
		universeCancel = true;
		setStatus("Stopping the universe after this season…", true);
	}

	/* MEMORY.

	   state.results holds a live result object per file — teams, box scores,
	   game logs, every player's season — and a fifty-file chain held fifty of
	   them at once. Everything needed to rebuild one on demand is already in
	   state.universe.cfgs (see universeCfgFor), so past a budget the older
	   ones are dropped and rehydrated lazily by ensureResult. The active file
	   and the files linkCareers still needs are never evicted. */
	const UNIVERSE_LIVE_RESULTS = 15;

	/* What a whole draft class is, for the purpose of deciding whether a file
	   carried one. A BBGM class is sixty to eighty men; a league export's
	   future class is often half that, and the season it produces has honours
	   drawn from a field that thin. See Universe.topUpPartialSeason. */
	const UNIVERSE_FULL_CLASS = 65;

	/* How long a season costs, and how many of them are worth warning about.
	   The figure is measured (tools/bench.js reports the staged timings); it
	   only has to be right to the order of magnitude, because it is spent on a
	   sentence rather than on a decision. */
	const SEASON_MS = 330;
	const UNIVERSE_SLOW_SEASONS = 12;

	function evictUniverseResults(keepIndices) {
		const keep = new Set(keepIndices || []);
		keep.add(state.active);
		const held = [];
		for (let i = 0; i < state.results.length; i++) {
			if (state.results[i] && !keep.has(i)) held.push(i);
		}
		const over = held.length - UNIVERSE_LIVE_RESULTS;
		for (let i = 0; i < over; i++) releaseUniverseResult(held[i]);
	}

	/* THE RUNNER GOES WITH THE RESULT.

	   Nulling state.results[i] freed nothing: the file's runner keeps the
	   whole staged state of its last run (players, teams, game logs — the
	   same objects the result pointed at) so that a later run can skip the
	   phases whose inputs did not change. Measured at about sixteen megabytes
	   a season, held for every season the chain had ever played. An evicted
	   season gets a FRESH runner: rebuilding it on demand (ensureResult, from
	   the config the chain recorded) is a cold run either way, and a re-run
	   of the chain simply runs it cold. */
	function releaseUniverseResult(i) {
		state.results[i] = null;
		const f = state.files[i];
		if (f && f.data && state.runners[i]) {
			try { state.runners[i] = global.Engine.createRunner(f.data); }
			catch (e) { /* keep the old runner rather than none */ }
		}
	}

	/* Run every loaded file as one continuous world, oldest season first,
	   handing carry-over state (conference map, program levels, coaches,
	   pool memory) from each season to the next. Asynchronous in slices so
	   the page stays alive; ~330ms a season means 50 classes is a progress
	   bar, not a click. */
	/* EXTENDING A UNIVERSE RATHER THAN REBUILDING IT.

	   Loading more classes into a finished chain used to mean one thing:
	   every season re-ran from season one. That is correct — a class file
	   inserted anywhere changes the pool memory, the future rosters and the
	   carry from that point on — and it is also the reason nobody added a
	   file to a forty-season universe: twenty minutes of simulation, a new
	   world, and every player page the user had open now describes somebody
	   else.

	   A chain can be EXTENDED instead when the new files are all strictly
	   later than every season already played. Then nothing before them
	   changes: the carry, the pool memory, the anomaly memory and the coach
	   tree are exactly what the last played season handed forward, and the new
	   seasons are the next links on the same chain. What is given up is stated
	   rather than hidden — the underclassmen in an appended 2038 class do not
	   retro-appear on the 2035 rosters that were already played, because those
	   seasons are not being re-simulated. `Re-run the whole universe` does
	   that and says so.

	   The tail is what makes it possible: everything step() carries from one
	   season to the next, saved when the chain finishes. */
	function universeTail() {
		return state.universe && state.universe.tail ? state.universe.tail : null;
	}

	/* Whether the loaded files can extend the chain rather than replace it:
	   there is a finished chain with a tail, and every file that is not
	   already part of it is later than the last season it played. */
	function canExtendUniverse(only) {
		const tail = universeTail();
		if (!tail || !state.universe.rows.length || state.universe.running) return false;
		if (state.universe.broken) return false;
		const known = new Set(tail.fingerprints || []);
		const fresh = state.files.filter((f) => !known.has(f.fingerprint) &&
			(!only || only.has(f.fingerprint)));
		if (!fresh.length) return false;
		return fresh.every((f) => Number.isFinite(f.data && f.data.startingSeason) &&
			f.data.startingSeason > tail.lastSeason);
	}

	/* HOLDING THE SEASONS THAT ARE ALREADY RIGHT.

	   A chain re-runs from season one whenever anything invalidates it, which
	   is correct — a setting that changes 2025 changes everything after it —
	   and it is also the reason nobody iterates on the END of a long universe.
	   You get 2029 the way you want it, reach for a dial that only matters in
	   2031, and pay for thirty seasons to find out.

	   `resumeFrom` is the escape: the seasons before it keep the rows, the
	   alumni and the carry-over the chain already recorded, and the run starts
	   from the state that season was actually handed. It is the same move the
	   extend path makes for APPENDED files, generalised to an index — and it
	   rests on the same thing: state.universe.cfgs records exactly what each
	   season ran with, so the state going into season k is not reconstructed,
	   it is read back.

	   What it does not do is re-do the cross-file passes over the held
	   seasons: an underclassman from a class file whose settings you have just
	   changed still appears on the held rosters as the man the previous run
	   built. That is stated in the control rather than discovered, exactly as
	   the extend path states its own version of it. */
	function universeResumeState(from) {
		const u = state.universe;
		if (!u || !u.cfgs || !Array.isArray(u.order) || u.running) return null;
		if (!(from > 0) || from >= u.order.length) return null;
		const at = u.order[from];
		const saved = at && u.cfgs[at.index];
		if (!saved || !saved.carryOver) return null;
		return { from };
	}

	/* THE CHAIN ITSELF LIVES IN js/universe.js (Universe.beginChain), so the
	   harness in tools/universe.js runs the same code this does: the state
	   going in (cold, an extension's tail, or a held season's recorded
	   config), both passes of previews and recruiting cohorts, both roster
	   links, the step and the tail. What stays here is what is the app's:
	   which files, which settings, the slices and the progress bar, memory,
	   the career links, persistence and the import check. */
	/* AN IMPORT'S REPLAY IS SEVERAL RUNS, AND NOTHING MAY CUT IN.

	   Importing applies the file's settings to the panel, and a settings
	   change schedules a re-run of the whole universe. With one cold replay
	   that re-run found the chain running and returned; with a replay in
	   several runs it lands in the gap between two of them, starts a cold
	   chain, and the replay's next run then finds THAT running and stops —
	   a world that is neither. Held until the last run of the replay ends. */
	let universeReplay = false;
	/* Measured ms per season of the last chain, for the estimate below. */
	let universeSeasonMs = 0;
	// At most one render per this many ms while a chain runs.
	const UNIVERSE_RENDER_MS = 300;

	function runUniverse(after, opts) {
		opts = opts || {};
		const U = global.Universe;
		if (!state.files.length) {
			setStatus("Load two or more class files to run a universe, or start a " +
				"synthetic one (Universe tab → New synthetic universe).");
			return;
		}
		if (state.universe.running) return;
		if (universeReplay && opts.replaying === undefined) return;
		// A replay run that returns early below must not leave the gate shut.
		if (opts.replaying !== undefined) universeReplay = false;
		/* `only`: the files this run may touch, by fingerprint — how an import
		   replays the runs a universe was built in (see importUniverse). */
		const only = Array.isArray(opts.only) ? new Set(opts.only) : null;
		const tail = opts.extend ? universeTail() : null;
		const extend = !!tail && canExtendUniverse(only);
		if (opts.extend && opts.replaying !== undefined && !extend) {
			/* A replayed extension that cannot extend must not silently turn
			   into a cold chain of just the appended files. */
			setStatus("The imported universe's extension could not be replayed " +
				"(the chain before it did not finish).", true);
			universeReplay = false;
			state.universeExpect = null;
			state.universeImported = null;
			return;
		}
		/* Resuming from a season the user has held. Never combined with an
		   extension: an extension appends to the END of a finished chain and a
		   resume re-runs its tail. */
		const resume = !extend && Number.isFinite(opts.resumeFrom)
			? universeResumeState(opts.resumeFrom) : null;
		if (Number.isFinite(opts.resumeFrom) && opts.replaying !== undefined && !resume) {
			setStatus("The imported universe's partial re-run could not be replayed.", true);
			state.universeExpect = null;
			state.universeImported = null;
			return;
		}
		const diags = U.validate(state.files);
		state.universe.diags = diags;
		let runnable = diags.filter((d) => d.ok)
			.sort((a, b) => (a.season || 0) - (b.season || 0) || a.index - b.index);
		if (only && !resume) {
			runnable = runnable.filter((d) => {
				const f = state.files[d.index];
				return f && only.has(f.fingerprint);
			});
		}
		if (extend) {
			const known = new Set(tail.fingerprints || []);
			runnable = runnable.filter((d) => {
				const f = state.files[d.index];
				return f && !known.has(f.fingerprint) &&
					Number.isFinite(d.season) && d.season > tail.lastSeason;
			});
			if (!runnable.length) {
				setStatus("Nothing to add — every loaded class is already in this universe.");
				return;
			}
		}
		if (resume) {
			/* The files this run touches are the ones from the held season
			   onward, in the order the chain already established — which is
			   the order the seeds are keyed to, so a resumed season draws the
			   seed it drew before. */
			const want = new Set(state.universe.order.slice(resume.from)
				.map((d) => d.index));
			runnable = runnable.filter((d) => want.has(d.index));
			if (!runnable.length) {
				setStatus("Nothing to re-run from there.");
				return;
			}
		}
		/* THE "LOAD JUST THE CLASS" OFFER, HONOURED. See Universe.validate:
		   a whole-league file becomes the class it contains, once, and the
		   runner is rebuilt on it. */
		for (const d of runnable) {
			if (!d.classPids || !d.classPids.length) continue;
			const f = state.files[d.index];
			if (!f || !f.data || !Array.isArray(f.data.players)) continue;
			const keep = new Set(d.classPids);
			const players = f.data.players.filter((p, i) =>
				keep.has(Number.isFinite(Number(p.pid)) ? Number(p.pid) : -1 - i));
			if (!players.length || players.length === f.data.players.length) continue;
			f.data = Object.assign({}, f.data, { players });
			f.fingerprint = fingerprint(f);
			state.runners[d.index] = global.Engine.createRunner(f.data);
			state.results[d.index] = null;
			d.classPids = null;
		}
		if (runnable.length < 1) {
			setStatus("No runnable files — see the Universe tab for per-file diagnostics.");
			state.tab = "universe";
			render();
			return;
		}
		/* SAY HOW LONG THIS WILL TAKE, BEFORE IT STARTS. Not a confirmation
		   dialog: the chain is cancellable (see cancelUniverse). */
		if (runnable.length >= UNIVERSE_SLOW_SEASONS) {
			// The last chain's measured pace when there is one.
			const secs = Math.max(1, Math.round(runnable.length *
				(universeSeasonMs || SEASON_MS) / 1000));
			setStatus((extend ? "Extending" : "Running") + " " + runnable.length +
				" seasons — about " + (secs >= 90
					? Math.round(secs / 60) + " minutes" : secs + " seconds") +
				". Cancel on the Universe tab at any point; finished seasons are kept.",
				true);
		}
		/* The seed is part of the world's identity: an extension and a resume
		   keep the one the chain was built on, whatever the panel says now. A
		   resume used to take the PANEL's seed, so a panel with the seed box
		   cleared re-ran the held world's later seasons under a random one. */
		const baseSeed = extend ? tail.baseSeed
			: resume && state.universe.baseSeed ? state.universe.baseSeed
			: (state.cfg.seed && state.cfg.seed.trim()
				? state.cfg.seed.trim()
				: "universe-" + Math.floor(Math.random() * 1e9));
		/* THE CONFIG IS FROZEN BEFORE SEASON ONE. One config object is built
		   here and handed down; a change made mid-run re-invalidates and
		   restarts the chain.

		   An extension runs under the settings the chain's LAST run was
		   frozen with (a resume may have changed them for the later seasons,
		   and those are the world the new season follows). A resume runs
		   under the CURRENT settings — that is the point of it — and records
		   them for the seasons it re-runs only (see the segments in
		   Universe.beginChain), not for the held ones. An import's replay
		   hands each run the settings that run was recorded with. */
		const lastSettings = U.segmentSettings(state.universe,
			(state.universe.order || []).length - 1);
		const frozen = opts.settings ? CFG.make(opts.settings)
			: extend && lastSettings ? CFG.make(lastSettings)
			: CFG.make(state.cfg);
		/* An imported universe's own biographies are held universe-wide and
		   projected per file at the point of use. */
		frozen.biography = null;
		universeReplay = !!opts.replaying;
		universeCancel = false;
		/* Only jump to the Timeline when the user asked for a universe
		   explicitly (see the universe setting). */
		if (!state.cfg.universe) state.tab = "universe";
		const chain = U.beginChain({
			mode: extend ? "extend" : resume ? "resume" : "cold",
			from: resume ? resume.from : undefined,
			universe: extend || resume ? state.universe : null,
			files: state.files,
			runnable,
			settings: frozen,
			baseSeed,
			diags,
			name: opts.identity ? opts.identity.name : state.universe.name || null,
			createdAt: opts.identity ? opts.identity.createdAt : null,
			make: (s) => CFG.make(s),
			runnerFor: (i) => state.runners[i],
			store: (i, res) => { state.results[i] = res; },
			// A synthetic class gained or lost named returners: a fresh runner.
			dataChanged: (i) => {
				state.runners[i] = global.Engine.createRunner(state.files[i].data);
				state.results[i] = null;
			},
			biographyFor: (fp) => U.biographyForFile(state.universeBiography, fp),
			extrapolateGaps: state.cfg.extrapolateGaps !== false,
			fullClass: UNIVERSE_FULL_CLASS,
			anomalyHistory: ANOMALY_HISTORY,
		});
		const keepPlay = { followed: state.universe.followed || null,
			dynasty: state.universe.dynasty || null };
		state.universe = chain.universe;
		if (!state.universe.followed) state.universe.followed = keepPlay.followed;
		if (!state.universe.dynasty) state.universe.dynasty = keepPlay.dynasty;
		render();
		const total = chain.runnable.length;
		const started = Date.now();
		let lastRender = 0;
		const finish = (cancelled) => {
			const out = chain.finish({
				cancelled, extrapolateYears: state.cfg.extrapolateYears || 0,
			});
			const u = state.universe;
			if (total > 0) universeSeasonMs = (Date.now() - started) / total;
			/* PASS THREE: the seasons a player actually played, on his own
			   page — for the results that are live; an evicted one is linked
			   when it is rebuilt. See linkCareers. */
			linking = true;
			try { linkCareers(u.order); }
			catch (e) { showError(e); }
			finally { linking = false; }
			evictUniverseResults(chain.runnable.slice(-UNIVERSE_LIVE_RESULTS)
				.map((d) => d.index));
			/* A replay stopped part-way is not the imported world, and the
			   next unrelated run must not be checked against it. */
			if (u.cancelled && opts.replaying !== undefined) {
				state.universeExpect = null;
				state.universeImported = null;
				universeReplay = false;
			}
			persist();
			const diverged = opts.replaying ? null : checkUniverseDivergence();
			if (diverged) showError(new Error(diverged));
			const forwardNote = out.guessed
				? " " + out.guessed + " further season" +
					(out.guessed === 1 ? " was" : "s were") +
					" extrapolated past the last file, and are flagged as such."
				: "";
			/* Only worth saying when the staging saved something. */
			const saved = out.touched > out.resimulated
				? " Re-simulated " + out.resimulated + " of " + out.touched +
					" season" + (out.touched === 1 ? "" : "s") +
					"; the rest were served from the phase cache." : "";
			setStatus((u.cancelled ? "Universe stopped: "
				: extend ? "Universe extended by " + total + " season" +
					(total === 1 ? "" : "s") + ": "
				: "Universe complete: ") +
				u.rows.length + " seasons, " +
				u.threads.length + " threads." + forwardNote + saved +
				(u.broken
					? " Season " + u.broken + " failed; the world was aged " +
						"across it rather than frozen."
					: "") +
				(u.importNote ? " " + u.importNote : ""));
			u.importNote = null;
			/* The active file's seed pill and title describe the universe
			   run now, not a standalone re-simulation of it. */
			const active = state.results[state.active];
			if (active) stampSeedPill(active, null);
			paintEffective();
			render();
			if (typeof after === "function" && !u.cancelled) after();
		};
		const step = (k) => {
			if (k >= total || universeCancel) {
				const cancelled = universeCancel && k < total;
				universeCancel = false;
				finish(cancelled);
				return;
			}
			chain.step(k);
			evictUniverseResults(chain.runnable.slice(Math.max(0, k - UNIVERSE_LIVE_RESULTS + 1), k + 1)
				.map((x) => x.index));
			setStatus("Universe: season " + (k + 1) + " of " + total + "…", true);
			// finish() always renders, so the last season is never skipped.
			if (Date.now() - lastRender >= UNIVERSE_RENDER_MS) {
				render();
				lastRender = Date.now();
			}
			setTimeout(() => step(k + 1), 0);
		};
		setTimeout(() => step(0), 0);
	}

	/* The control for it. Offered only on a finished chain of three or more
	   seasons, because holding one season of two is not a saving worth a
	   control, and never while the chain is running. */
	function resumeUniverseDialog() {
		const u = state.universe;
		if (!u || u.running || !Array.isArray(u.order) || u.order.length < 3) {
			setStatus("Run a universe of three or more seasons first.");
			return;
		}
		const box = el("div");
		box.appendChild(el("p", null,
			"Hold the seasons before the one you pick and re-run the rest under " +
			"the current settings. The held seasons keep the world they played: " +
			"the chain starts again from exactly the state that season was " +
			"handed, which is recorded rather than reconstructed."));
		const sel = el("select");
		sel.setAttribute("aria-label", "Re-run from");
		u.order.forEach((d, i) => {
			if (i === 0) return;
			sel.appendChild(new Option("re-run from " + d.season + " onwards (hold " +
				i + " season" + (i === 1 ? "" : "s") + ")", String(i)));
		});
		box.appendChild(sel);
		box.appendChild(el("p", "hint",
			"What this does not do: re-run the cross-file passes over the held " +
			"seasons. An underclassman from a class whose settings you have just " +
			"changed still appears on those rosters as the man the previous run " +
			"built. Re-run the whole universe for that."));
		modal("Re-run part of the universe", box, () => {
			const from = Number(sel.value);
			closeModal();
			if (!Number.isFinite(from)) return;
			if (!universeResumeState(from)) {
				setStatus("That season has no recorded world to resume from — " +
					"re-run the whole universe.");
				return;
			}
			runUniverse(null, { resumeFrom: from });
		}, "Re-run");
	}

	/* A UNIVERSE FROM NOTHING. N consecutive synthetic classes, each drawn
	   from hash(seed + season) (Universe.synthFile), run through the same
	   cold chain as real files. Nothing is stored but the seed: a reload or
	   an import regenerates the classes (see restoreSyntheticUniverse). */
	const SYNTH_MAX_SEASONS = 60;
	function newSyntheticUniverse(n, first) {
		const U = global.Universe;
		n = Math.max(2, Math.min(SYNTH_MAX_SEASONS, Math.round(Number(n) || 10)));
		first = Number.isFinite(Number(first)) && Number(first) > 1900
			? Math.round(Number(first)) : new Date().getFullYear() + 1;
		if (state.universe.running) return;
		pushUndo("started a synthetic universe");
		const seed = state.cfg.seed && state.cfg.seed.trim()
			? state.cfg.seed.trim() : "synth-" + Math.floor(Math.random() * 1e9);
		state.cfg.seed = seed;
		state.cfg.universe = true;
		if ($("seed")) $("seed").value = seed;
		paintConfig();
		state.universeBiography = null;
		installFiles(U.synthFiles(seed, first, n), [], { noRun: true });
		state.tab = "universe";
		runUniverse();
	}

	function syntheticUniverseDialog() {
		const box = el("div");
		box.appendChild(el("p", null,
			"Start a universe with no class files: each season is a synthetic " +
			"class drawn from the seed, so the same seed and settings rebuild the " +
			"same world. The panel's seed is used when set."));
		const mk = (label, value, min, max) => {
			const row = el("label", "ctl", label + " ");
			const inp = el("input");
			inp.type = "number";
			inp.min = String(min);
			inp.max = String(max);
			inp.value = String(value);
			row.appendChild(inp);
			box.appendChild(row);
			return inp;
		};
		const nIn = mk("Seasons", 10, 2, SYNTH_MAX_SEASONS);
		nIn.id = "synthSeasons";
		const yIn = mk("First season", new Date().getFullYear() + 1, 1950, 2200);
		yIn.id = "synthFirst";
		modal("New synthetic universe", box, () => {
			const n = Number(nIn.value);
			const y = Number(yIn.value);
			closeModal();
			newSyntheticUniverse(n, y);
		}, "Start");
	}

	/* REAL FORWARD SIMULATION. N more seasons past the last one played, as
	   synthetic classes appended to the chain (an extension, so everything
	   before stays put). Keyed on the world's own seed, so the same world
	   simulated forward twice is the same future. extrapolateYears remains
	   the cheap guess for when this is not wanted. */
	function simulateForward(n) {
		const U = global.Universe;
		const u = state.universe;
		const tail = universeTail();
		if (!tail || u.running || !Number.isFinite(tail.lastSeason)) {
			setStatus("Run a universe first — there is no finished season to continue from.");
			return;
		}
		n = Math.max(1, Math.min(SYNTH_MAX_SEASONS, Math.round(Number(n) || 5)));
		const files = U.synthFiles(tail.baseSeed || u.baseSeed, tail.lastSeason + 1, n);
		state.cfg.universe = true;
		if (state.files.length) installFiles(files, [], { append: true, noRun: true });
		else installFiles(files, [], { noRun: true });
		state.tab = "universe";
		runUniverse(null, { extend: true });
	}

	function simulateForwardDialog() {
		const box = el("div");
		box.appendChild(el("p", null,
			"Play more seasons past the last one, each on a synthetic class " +
			"drawn from this world's seed — real games, not the extrapolated " +
			"guesses of “Years past the last class”. The seasons already played " +
			"are kept as they are."));
		const row = el("label", "ctl", "Seasons ");
		const inp = el("input");
		inp.type = "number";
		inp.id = "synthForward";
		inp.min = "1";
		inp.max = String(SYNTH_MAX_SEASONS);
		inp.value = "5";
		row.appendChild(inp);
		box.appendChild(row);
		modal("Simulate more seasons", box, () => {
			const n = Number(inp.value);
			closeModal();
			simulateForward(n);
		}, "Simulate");
	}

	/* Regenerate a saved synthetic universe's classes and replay it run by
	   run, exactly as an import does, so a reload gets back the same world
	   (with its results, not only its timeline). Only when every season in
	   it is synthetic; a world with real classes waits for them. */
	function restoreSyntheticUniverse() {
		const U = global.Universe;
		const u = state.universe;
		if (state.files.length || !u || u.running || !Array.isArray(u.order) ||
			!u.order.length || !u.order.every((o) => o && o.synth) || !u.settings) return false;
		importUniverse(U.exportUniverse(Object.assign({}, u, {
			biography: state.universeBiography || null,
		})));
		return true;
	}

	function exportUniverse(embedFiles) {
		const U = global.Universe;
		const u = state.universe;
		if (!u.rows.length) {
			setStatus("Build a timeline first.");
			return;
		}
		/* A view has no class results of its own: embedding would write
		   whatever standalone classes happen to be loaded. */
		if (embedFiles && u.viewOnly) {
			setStatus("This universe is a view — load its class files and import it " +
				"again before exporting it with class files.", true);
			return;
		}
		/* WHAT THE WORLD WAS BUILT UNDER, EVEN AFTER A RELOAD.

		   The settings, the tail, the order and the registry are persisted
		   with the timeline now (see universeForStorage). The export used to
		   read the frozen settings off the live chain and fall back to the
		   PANEL — so a universe exported after a reload carried whatever the
		   sliders said that day as the world's own settings, an empty
		   biography and an empty registry. With neither recorded settings nor
		   a live chain there is nothing honest to write, so it says so. */
		const hasCfgs = !!(u.cfgs && Object.keys(u.cfgs).length);
		if (!u.settings && !hasCfgs) {
			setStatus("This timeline was saved without the settings it ran under — " +
				"re-run the universe (load its class files) before exporting it.", true);
			return;
		}
		const live = hasCfgs ? liveResults() : [];
		const payload = U.exportUniverse(Object.assign({}, u, {
			settings: u.settings || CFG.make(state.cfg),
			/* Keyed by a cross-file identity (see Universe.playerId). Built
			   from the live chain when there is one; otherwise the imported
			   map this universe came with, rather than nothing. */
			biography: live.length ? U.biographyOf(live, state.files)
				: state.universeBiography || null,
			/* THE REGISTRY: built as the chain ran (see Universe.beginChain),
			   persisted, and never replaced by an empty rebuild. */
			registry: u.registry && Object.keys(u.registry).length ? u.registry
				: live.length ? U.registryOf(live, state.files, u.rows) : null,
		}), { embedFiles: !!embedFiles, files: state.files });
		// Rebuilding evicted seasons for the export must not keep them all.
		if (live.length) evictUniverseResults([]);
		/* SIZE.

		   The seeds-and-fingerprints file is a kilobyte and is pretty-printed
		   for the person who opens it in an editor. The embedded variant is
		   every class file inlined, and tab-indenting thirty megabytes of
		   generated JSON is thirty megabytes nobody will send: it is read by
		   this tool, not by a human. So the embedded variant is written
		   compactly, and gzipped where the browser has CompressionStream —
		   which is every browser this tool supports except older Safari, where
		   it falls back to the plain file rather than failing. */
		const text = JSON.stringify(payload, null, embedFiles ? 0 : "\t");
		const base = U.exportBaseName(u);
		const done = (blob, name, note) => {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = name;
			markExported();
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 5000);
			setStatus(note + (u.truncated ? " Warning: this timeline was reloaded " +
				"from browser storage, which keeps only the latest seasons, so its " +
				"early history is missing from the file. Re-run it for a full export." : ""),
				!!u.truncated);
		};
		if (!embedFiles) {
			done(new Blob([text], { type: "application/json" }), base + ".json",
				"Exported the universe (seeds and settings; load the class files beside it).");
			return;
		}
		const plain = () => done(
			new Blob([text], { type: "application/json" }), base + "-with-classes.json",
			"Exported the universe with its class files embedded.");
		if (typeof CompressionStream !== "function") { plain(); return; }
		try {
			new Response(new Blob([text]).stream()
				.pipeThrough(new CompressionStream("gzip"))).blob()
				.then((gz) => done(gz, base + "-with-classes.json.gz",
					"Exported the universe with its class files embedded, gzipped (" +
					Math.round(gz.size / 1024) + " KB from " +
					Math.round(text.length / 1024) + " KB)."))
				.catch(plain);
		} catch (e) { plain(); }
	}

	/* The timeline or the records book as CSV, through esc() and its
	   formula guard. */
	function exportUniverseCsv(what) {
		const U = global.Universe;
		const u = state.universe;
		if (!u.rows.length) { setStatus("Build a timeline first."); return; }
		const records = what === "records";
		const table = records ? U.recordsTable(u.records) : U.timelineTable(u.rows);
		download(U.exportBaseName(u) + (records ? "-records.csv" : "-timeline.csv"),
			csvJoin(table.map((r) => r.map(esc).join(","))), "text/csv");
	}

	/* A new world name, drawn from the programs and flavors in the code. */
	let worldNameDraws = 0;
	function randomizeUniverseName() {
		const u = state.universe;
		const flavors = (global.RatingsBuilder && global.RatingsBuilder.CLASS_FLAVORS || [])
			.map((f) => f.label);
		const schools = (u.rows || []).map((r) => r && r.champion).filter(Boolean);
		u.name = global.Universe.randomName((u.baseSeed || "world") + "|" + (++worldNameDraws),
			schools.length ? schools : (global.Colleges && global.Colleges.names) || [], flavors);
		persist();
		render();
	}

	/* ------------------------------------------ universe play (audit §5)

	   Item 4, following a program; item 5, the dynasty goal; item 8, the
	   IndexedDB saves; item 10, the season drawer. The pure parts live in
	   js/universe.js (followedCard, dynastyProgress, seasonDetail). */

	function followProgram(name) {
		state.universe.followed = name || null;
		persist();
		render();
		setStatus(name ? "Following " + name + ": its seasons are marked on the " +
			"timeline and it leads the paper when it has news." : "No longer following a program.");
	}

	/* DYNASTY GOAL. The budget counts dials moved from the settings the
	   goal started on, with the challenges' diff; the universe switch and
	   the seed are not dials. */
	function dynastyMoved(goal) {
		if (!goal || !goal.startCfg) return 0;
		return diffConfigs(CFG.make(goal.startCfg), CFG.make(state.cfg))
			.filter((line) => !/^(universe|seed) /.test(line)).length;
	}

	function dynastyStatus() {
		const U = global.Universe;
		const u = state.universe;
		const g = u && u.dynasty;
		if (!g || !U) return null;
		let hist = [];
		try { hist = U.programHistory(u, g.program, (state.results || []).filter(Boolean)); }
		catch (e) { hist = []; }
		return U.dynastyProgress(g, hist, dynastyMoved(g));
	}

	function dynastyDialog() {
		const U = global.Universe;
		const u = state.universe;
		const box = el("div");
		box.appendChild(el("p", null,
			"Take a program to a level, or to a title, within a number of seasons " +
			"— moving at most a budget of settings from where you start. Rebuild " +
			"the universe as you tune; the goal is scored off its program history."));
		const results = (state.results || []).filter(Boolean);
		let low = [];
		try { low = U.lowPrestige(u, results, 60); } catch (e) { low = []; }
		const prog = el("select");
		prog.setAttribute("aria-label", "Program");
		for (const x of low) prog.appendChild(new Option(x.name + " (level " + x.level + ")", x.name));
		if (!low.length) {
			box.appendChild(el("p", "hint", "Build a timeline first: the program list " +
				"comes from its history."));
		}
		const kind = el("select");
		kind.setAttribute("aria-label", "Goal");
		kind.appendChild(new Option("reach a level", "level"));
		kind.appendChild(new Option("win a national title", "title"));
		const num = (label, v, lo, hi) => {
			const lab = el("label", "check", label + " ");
			const inp = el("input");
			inp.type = "number";
			inp.min = String(lo);
			inp.max = String(hi);
			inp.value = String(v);
			lab.appendChild(inp);
			return [lab, inp];
		};
		const [levLab, lev] = num("level", 70, 10, 99);
		const [seaLab, sea] = num("within seasons", 5, 1, 60);
		const [budLab, bud] = num("settings budget", 3, 0, 20);
		for (const n of [prog, kind, levLab, seaLab, budLab]) {
			const row = el("div", "filters");
			row.appendChild(n);
			box.appendChild(row);
		}
		modal("Dynasty goal", box, () => {
			closeModal();
			if (!prog.value) return;
			const clamp = (x, lo, hi, d) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
			startDynasty({
				program: prog.value, kind: kind.value,
				level: clamp(Number(lev.value), 10, 99, 70),
				seasons: clamp(Math.round(Number(sea.value)), 1, 60, 5),
				budget: clamp(Math.round(Number(bud.value)), 0, 20, 3),
			});
		}, "Start");
	}

	function startDynasty(goal) {
		pushUndo("started a dynasty goal");
		goal.startCfg = JSON.parse(JSON.stringify(CFG.make(state.cfg)));
		goal.startedAt = new Date().toISOString();
		state.universe.dynasty = goal;
		state.universe.followed = goal.program;
		persist();
		render();
		const st = dynastyStatus();
		setStatus("Dynasty goal: " + goal.program + " — " + (goal.kind === "title"
			? "a national title" : "level " + goal.level) + " within " + goal.seasons +
			" seasons, " + goal.budget + " settings to move." + (st ? " Now: " + st.status + "." : ""));
	}

	function abandonDynasty() {
		state.universe.dynasty = null;
		persist();
		render();
		setStatus("Dynasty goal abandoned.");
	}

	/* THE SEASON DRAWER: one timeline row, its config and carry snapshot,
	   and the threads that touch it. */
	function seasonDrawer(i) {
		const U = global.Universe;
		const d = U.seasonDetail(state.universe, i);
		if (!d) return;
		const r = d.row;
		const box = el("div", "season-drawer");
		const dl = el("div", "note");
		const line = (k, v) => dl.appendChild(el("div", null, k + ": " + v));
		line("Champion", (r.champion || "—") + (r.champSeed ? " (No. " + r.champSeed + ")" : "") +
			(r.runnerUp ? ", over " + r.runnerUp : ""));
		line("AP No. 1", r.apOne || "—");
		if (r.finalFour && r.finalFour.length) {
			line("Final Four", r.finalFour.map((x) => (x && typeof x === "object" ? x.team || x.name : x)).join(", "));
		}
		line("Player of the year", r.poy ? r.poy.name + " (" + (r.poy.school || r.poy.club || "?") + ")" : "—");
		line("No. 1 pick", r.no1 ? r.no1.name + " (" + (r.no1.school || r.no1.club || "?") + ")" : "—");
		line("Flavor", r.flavor || "—");
		line("Sideline changes", String(r.coachChanges || 0));
		if (r.realignment && r.realignment.length) line("Realignment", r.realignment.join("; "));
		line("Seed", String(r.seed || "—") + (r.fileName ? " · " + r.fileName : ""));
		if (r.extrapolated) line("Note", "extrapolated: no class file for this season");
		box.appendChild(dl);
		box.appendChild(el("h5", null, "What the season was handed"));
		if (d.cfg) {
			const c = el("div", "note");
			c.appendChild(el("div", null, "Chain position " + d.cfg.position + ", seed " + d.cfg.seed));
			c.appendChild(el("div", null, d.cfg.returners + " returner sources, " +
				d.cfg.pastRoster + " past-roster entries, " + d.cfg.alumni + " alumni in memory"));
			if (d.carry) {
				c.appendChild(el("div", null, "Carry: " + d.carry.programs + " programs, " +
					d.carry.coaches + " coaches"));
				c.appendChild(el("div", null, "Strongest going in: " + d.carry.topLevels
					.map((x) => x.team + " " + x.level).join(", ")));
				const t = Object.keys(d.carry.titles).sort((a, b) => d.carry.titles[b] - d.carry.titles[a]);
				if (t.length) {
					c.appendChild(el("div", null, "Banners going in: " + t.slice(0, 6)
						.map((k) => k + " " + d.carry.titles[k]).join(", ")));
				}
			} else c.appendChild(el("div", null, "First season: no carry-over."));
			if (d.cfg.settings) {
				const moved = diffConfigs(CFG.make({}), CFG.make(d.cfg.settings));
				c.appendChild(el("div", null, "Settings vs defaults: " +
					(moved.length ? moved.slice(0, 12).join("; ") + (moved.length > 12 ? "; …" : "")
						: "all defaults")));
			}
			box.appendChild(c);
		} else {
			box.appendChild(el("p", "hint", r.extrapolated
				? "An extrapolated season has no config: nothing was simulated."
				: "The config snapshot is held for the session only; re-run the universe to see it."));
		}
		box.appendChild(el("h5", null, "Threads touching " + r.season));
		box.appendChild(d.threads.length
			? el("div", "note", d.threads.map((t) => t.text).join("\n"))
			: el("p", "hint", "None."));
		modal("Season " + r.season, box);
	}

	/* INDEXEDDB SAVES (item 8).

	   The whole universe, untruncated, in IndexedDB: an autosave written
	   whenever persist() runs, and UNIVERSE_SLOTS named slots. Settings stay
	   in localStorage, and so does the bounded universe copy, which is what
	   a browser without IndexedDB (or with it blocked) falls back to. Every
	   access is wrapped; a failure resolves to null rather than throwing. */
	const IDB_NAME = "bbgm-draft-workshop";
	const IDB_STORE = "universes";
	const UNIVERSE_SLOTS = 5;
	const AUTO_SLOT = "autosave";
	let idbPromise = null;
	let idbOk = null;
	let autosaveReady = false;
	let autosaveTimer = null;

	function idbOpen() {
		if (idbPromise) return idbPromise;
		idbPromise = new Promise((resolve) => {
			try {
				if (typeof indexedDB === "undefined" || !indexedDB) { resolve(null); return; }
				const req = indexedDB.open(IDB_NAME, 1);
				req.onupgradeneeded = () => {
					try { req.result.createObjectStore(IDB_STORE, { keyPath: "slot" }); } catch (e) { /* exists */ }
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
				req.onblocked = () => resolve(null);
			} catch (e) { resolve(null); }
		}).then((db) => { idbOk = !!db; return db; });
		return idbPromise;
	}

	// One request in its own transaction; resolves with its result, or null.
	function idbRequest(mode, make) {
		return idbOpen().then((db) => new Promise((resolve) => {
			if (!db) { resolve(null); return; }
			try {
				const tx = db.transaction(IDB_STORE, mode);
				const req = make(tx.objectStore(IDB_STORE));
				tx.oncomplete = () => resolve(req && req.result !== undefined ? req.result : null);
				tx.onerror = () => resolve(null);
				tx.onabort = () => resolve(null);
			} catch (e) { resolve(null); }
		})).catch(() => null);
	}

	// The universe in full: no row, thread, alumni or registry cap.
	function universeFull() {
		const u = state.universe;
		return JSON.parse(JSON.stringify(Object.assign(universeForStorage(), {
			rows: u.rows.slice(),
			threads: (u.threads || []).slice(),
			alumni: (u.alumni || []).slice(),
			registry: u.registry || null,
			programs: u.programs || null,
			recruiting: u.recruiting || null,
			truncated: !!u.truncated,
			tail: u.running ? null : (u.tail || null),
		})));
	}

	function slotRecord(slot, name) {
		const u = state.universe;
		return { slot, name: name || u.name || "Universe", savedAt: new Date().toISOString(),
			seasons: u.rows.length, universe: universeFull() };
	}

	function applyUniverseSave(su) {
		state.universe = universeFromSaved(su);
		state.universeBiography = su.biography && typeof su.biography === "object"
			? su.biography : null;
	}

	function scheduleAutosave() {
		if (!autosaveReady || idbOk === false) return;
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(() => {
			try {
				const u = state.universe;
				if (u.running) return;
				if (!u.rows.length) {
					idbRequest("readwrite", (s) => s.delete(AUTO_SLOT));
					return;
				}
				idbRequest("readwrite", (s) => s.put(slotRecord(AUTO_SLOT)));
			} catch (e) { /* the localStorage copy still stands */ }
		}, 600);
	}

	/* At startup: the autosave replaces the bounded localStorage copy. No
	   autosave is written until this has run, so a truncated copy never
	   overwrites a full one. */
	function loadAutosave() {
		return idbRequest("readonly", (s) => s.get(AUTO_SLOT)).then((rec) => {
			try {
				/* Only the same world, and no less of it: the autosave is
				   debounced, so a reload straight after persist() can find the
				   PREVIOUS universe there, which would replace this one. */
				const cur = state.universe;
				const same = rec && rec.universe &&
					(rec.universe.createdAt || null) === (cur.createdAt || null) &&
					(rec.universe.baseSeed || null) === (cur.baseSeed || null) &&
					Array.isArray(rec.universe.rows) &&
					rec.universe.rows.length >= (cur.rows || []).length;
				if (same && !cur.running && !(cur.cfgs && Object.keys(cur.cfgs).length)) {
					applyUniverseSave(rec.universe);
				}
			} catch (e) { /* keep the localStorage copy */ }
			autosaveReady = true;
			render();
		});
	}

	function listUniverseSlots() {
		return idbRequest("readonly", (s) => s.getAll()).then((all) => {
			const out = [];
			for (let i = 1; i <= UNIVERSE_SLOTS; i++) {
				const r = (all || []).filter((x) => x && x.slot === "slot" + i)[0];
				out.push(r ? { slot: r.slot, name: r.name, savedAt: r.savedAt, seasons: r.seasons }
					: { slot: "slot" + i, empty: true });
			}
			return out;
		});
	}

	function saveUniverseSlot(slot, name) {
		if (!/^slot[1-9]$/.test(slot) || Number(slot.slice(4)) > UNIVERSE_SLOTS) {
			return Promise.resolve(false);
		}
		if (!state.universe.rows.length || state.universe.running) {
			setStatus("Build a timeline first.");
			return Promise.resolve(false);
		}
		let rec;
		try { rec = slotRecord(slot, name); } catch (e) { showError(e); return Promise.resolve(false); }
		return idbRequest("readwrite", (s) => s.put(rec)).then((ok) => {
			setStatus(ok ? "Saved “" + rec.name + "” (" + rec.seasons + " seasons, in full) to " + slot + "."
				: "Could not save: IndexedDB is not available in this browser.", !ok);
			return !!ok;
		});
	}

	function loadUniverseSlot(slot) {
		if (state.universe.running) return Promise.resolve(false);
		return idbRequest("readonly", (s) => s.get(slot)).then((rec) => {
			if (!rec || !rec.universe || !Array.isArray(rec.universe.rows)) {
				setStatus("That slot is empty.");
				return false;
			}
			try {
				pushUndo("loaded a saved universe");
				applyUniverseSave(rec.universe);
			} catch (e) { showError(e); return false; }
			state.tab = "universe";
			persist();
			render();
			setStatus("Loaded “" + rec.name + "” (" + rec.seasons + " seasons). Load its " +
				"class files and rebuild to open its seasons on the other tabs.");
			return true;
		});
	}

	function deleteUniverseSlot(slot) {
		return idbRequest("readwrite", (s) => s.delete(slot)).then(() => {
			setStatus("Cleared " + slot + ".");
			return true;
		});
	}

	function universeStorageInfo() {
		return { idb: idbOk, slots: UNIVERSE_SLOTS };
	}

	function universeSlotsDialog() {
		const box = el("div");
		const list = el("div", "note universe-slots");
		box.appendChild(el("p", null, "Saved universes are stored in full in this " +
			"browser's IndexedDB — no season, thread or career cap."));
		box.appendChild(list);
		const bar = el("div", "filters");
		const sel = el("select");
		sel.setAttribute("aria-label", "Slot");
		const nm = el("input");
		nm.type = "text";
		nm.placeholder = "name";
		nm.value = state.universe.name || "";
		bar.appendChild(sel);
		bar.appendChild(nm);
		box.appendChild(bar);
		const paint = () => listUniverseSlots().then((slots) => {
			list.innerHTML = "";
			sel.innerHTML = "";
			if (idbOk === false) {
				list.appendChild(el("div", "hint", "IndexedDB is not available here; the " +
					"universe is kept (bounded) in localStorage only."));
			}
			for (const x of slots) {
				sel.appendChild(new Option(x.slot + (x.empty ? " (empty)" : " — " + x.name), x.slot));
				const row = el("div", "rowflex");
				row.appendChild(el("span", null, x.slot + ": " + (x.empty ? "empty"
					: x.name + " · " + x.seasons + " seasons · " + String(x.savedAt || "").slice(0, 16).replace("T", " "))));
				if (!x.empty) {
					const ld = el("button", "tiny", "Load");
					ld.addEventListener("click", () => { closeModal(); loadUniverseSlot(x.slot); });
					const del = el("button", "tiny warn", "Delete");
					del.addEventListener("click", () => { deleteUniverseSlot(x.slot).then(paint); });
					row.appendChild(ld);
					row.appendChild(del);
				}
				list.appendChild(row);
			}
		});
		paint();
		modal("Universe save slots", box, () => {
			const slot = sel.value;
			const name = nm.value.trim();
			closeModal();
			saveUniverseSlot(slot, name);
		}, "Save current to slot");
	}


	/* What a reload keeps: the caps universeForStorage writes under. */
	const PERSIST_CAPS = { rows: PERSIST_ROWS, threads: PERSIST_THREADS,
		alumni: PERSIST_ALUMNI, registry: PERSIST_REGISTRY };

	/* THE WHOLE UNIVERSE AS ONE PLAYERS FILE.

	   The single change that makes the mode feel like a world rather than a
	   spreadsheet. BBGM's draft-class import deletes `stats` on every uploaded
	   player, so a universe exported as a folder of per-class files loses the
	   thing the mode exists for: a man's life spanning several seasons. Tools
	   -> Import players keeps the rows, and it takes one array — so the whole
	   universe goes in as one file, every class at its own draft year, pids
	   renumbered across the world, awards deduped, second generations linked.
	   See Engine.universePlayersFile. */
	function exportUniversePlayers() {
		if (!state.universe.rows.length) {
			setStatus("Build a timeline first.");
			return;
		}
		if (state.universe.viewOnly) {
			setStatus("This universe is a view — load its class files and import it " +
				"again before exporting its players.", true);
			return;
		}
		try {
			/* The whole point is the seasons, so stats, prior seasons and
			   awards are always on for this route whatever the export menu
			   says — a universe players file without them is a class list. */
			const all = liveResults();
			const out = global.Engine.universePlayersFile(all, Object.assign(
				{}, currentExportOpts(),
				{ stats: true, prior: true, awards: true,
					seed: state.universe.baseSeed }));
			evictUniverseResults([]);
			const blob = new Blob([JSON.stringify(out.file, null, "\t")],
				{ type: "application/json" });
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = global.Universe.exportBaseName(state.universe) + "-players.json";
			markExported();
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 5000);
			setStatus("Exported " + out.file.players.length + " players across " +
				out.seasons.length + " seasons" +
				(out.relatives ? ", " + out.relatives + " father/son links" : "") +
				(out.duplicates ? ", " + out.duplicates + " duplicate men merged" : "") +
				". Load it with Tools → Import players (tick “include stats”).");
		} catch (e) {
			showError(e);
		}
	}

	/* Every result the chain produced, rehydrating the ones eviction dropped.
	   Bounding memory during a run must not mean exporting half a universe. */
	function liveResults() {
		const out = [];
		for (let i = 0; i < state.files.length; i++) {
			if (!state.universe.cfgs || state.universe.cfgs[i] === undefined) continue;
			const res = ensureResult(i);
			if (res) out.push(res);
		}
		return out.length ? out : state.results.filter(Boolean);
	}

	/* UNIVERSE-LEVEL VIEWS, ON DEMAND.

	   Coaches persist across the chain with a tenure, a reputation and an
	   age, and conference membership carries from season to season — every
	   fact a coach's career page or a realignment map needs is already in
	   the results the chain produced. Neither is persisted (364 programs
	   times fifty seasons is not a localStorage payload); both are built
	   here from liveResults(), which rehydrates evicted seasons from the
	   configs the chain recorded, and cached on the universe object until
	   the next run replaces it. */
	function universeCareers() {
		if (state.universe.careers) return state.universe.careers;
		const results = liveResults().slice()
			.sort((a, b) => (a.season || 0) - (b.season || 0));
		const coaches = {};
		const confs = {};
		for (const res of results) {
			const season = res.season;
			for (const t of Object.values(res.teams || {})) {
				if (!t || !t.name) continue;
				if (t.coach && t.coach.name) {
					const c = coaches[t.coach.name] || (coaches[t.coach.name] = {
						name: t.coach.name, seasons: [], wins: 0, losses: 0, titles: 0,
						tourneys: 0, finalFours: 0, schools: [], mentor: t.coach.mentor || null,
					});
					const won = res.tourney && res.tourney.champion &&
						res.tourney.champion.team.name === t.name;
					const ff = /Final Four|Champion|Runner/i.test(String(t.ncaaResult || ""));
					c.seasons.push({
						season, school: t.name, w: t.w || 0, l: t.l || 0,
						conf: t.conf, ncaa: t.ncaaResult || null, title: !!won,
						apRank: t.finalRank || t.apRank || null,
						tenure: t.coach.tenure, age: t.coach.age, rep: t.coach.rep,
						replaced: !!t.coach.replaced,
					});
					c.wins += t.w || 0;
					c.losses += t.l || 0;
					if (won) c.titles++;
					if (t.ncaaResult) c.tourneys++;
					if (ff) c.finalFours++;
					if (c.schools.indexOf(t.name) === -1) c.schools.push(t.name);
					if (!c.mentor && t.coach.mentor) c.mentor = t.coach.mentor;
				}
				if (t.conf) {
					const cf = confs[t.conf] || (confs[t.conf] = { name: t.conf, bySeason: {} });
					(cf.bySeason[season] = cf.bySeason[season] || []).push(t.name);
				}
			}
		}
		const careers = Object.values(coaches)
			.sort((a, b) => b.wins - a.wins || b.titles - a.titles ||
				String(a.name).localeCompare(String(b.name)));
		/* Membership as a story: for each conference, who joined and who
		   left between consecutive played seasons, plus the roll at the end. */
		const seasons = results.map((r) => r.season).filter(Number.isFinite);
		const map = Object.keys(confs).sort((a, b) => a.localeCompare(b)).map((name) => {
			const cf = confs[name];
			const moves = [];
			for (let i = 1; i < seasons.length; i++) {
				const was = new Set(cf.bySeason[seasons[i - 1]] || []);
				const now = new Set(cf.bySeason[seasons[i]] || []);
				const joined = Array.from(now).filter((x) => !was.has(x));
				const left = Array.from(was).filter((x) => !now.has(x));
				if (joined.length || left.length) moves.push({ season: seasons[i], joined, left });
			}
			const last = seasons.length ? (cf.bySeason[seasons[seasons.length - 1]] || []) : [];
			const first = seasons.length ? (cf.bySeason[seasons[0]] || []) : [];
			return { name, first: first.length, last: last.length, members: last.slice().sort(), moves };
		});
		state.universe.careers = { coaches: careers, conferences: map, seasons };
		return state.universe.careers;
	}

	/* Re-import: a universe file carries seeds and file fingerprints, not
	   output. With the same class files loaded, replaying it reproduces the
	   same world exactly — that is what determinism buys — run by run, the
	   way it was built (see Universe.replayPlan). */
	function importUniverse(json) {
		const U = global.Universe;
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
		/* A synthetic season needs no file: it is regenerated from the seed
		   its order entry records. Installed without a run; the replay
		   below is the run. */
		{
			const loadedFps = new Set(state.files.map((f) => f.fingerprint));
			const syn = (Array.isArray(json.order) ? json.order : [])
				.filter((o) => o && o.synth && !loadedFps.has(o.fingerprint))
				.map((o) => U.synthFromOrder(o)).filter(Boolean);
			if (syn.length) {
				installFiles(syn, [], { append: state.files.length > 0, noRun: true });
			}
		}
		const have = new Set(state.files.map((f) => f.fingerprint));
		const seasons = json.seasons || [];
		const played = seasons.filter((s) => s && s.fingerprint);
		const missing = played.filter((s) => !have.has(s.fingerprint));
		/* NONE OF ITS FILES: A VIEW, NOT AN ERROR.

		   A version 3 export carries the timeline, the threads, the records
		   book, the alumni index, the registry and the tail. It used to be
		   refused outright when none of its class files were loaded, which
		   threw all of that away to say "load them first". It is installed as
		   a view-only world now: readable, extendable with a later class
		   (the tail is there), and replayable by importing it again once the
		   classes are loaded. */
		if (!played.length || missing.length >= played.length) {
			if (Array.isArray(json.timeline) && json.timeline.length) {
				pushUndo("imported a universe");
				state.universe = U.viewOnlyUniverse(json);
				state.universeImported = null;
				state.universeExpect = null;
				state.universeBiography = json.biography && typeof json.biography === "object"
					? json.biography : null;
				state.tab = "universe";
				persist();
				render();
				setStatus("Imported " + state.universe.rows.length + " seasons as a view: " +
					"none of this universe's class files are loaded, so nothing was replayed. " +
					"The timeline, threads, records book, alumni and careers are the file's own." +
					(missing.length ? " Load " + missing.slice(0, 6).map((m) => m.fileName)
						.join(", ") + (missing.length > 6 ? "…" : "") +
						" and import it again to replay it." : ""), true);
				return;
			}
			showError(new Error("None of this universe's class files are loaded. " +
				"Load them first: " + missing.map((m) => m.fileName).join(", ")));
			return;
		}
		/* UNDOABLE. Importing a universe replaces every setting on the panel,
		   and it used to be the one settings change Ctrl+Z could not take
		   back. The snapshot is taken before anything below moves. */
		pushUndo("imported a universe");
		let note = "";
		/* A locked setting is one the user has said must not move — the
		   randomizer honours that, and so does this, for every run of the
		   replay. The import is reported as partial so the divergence check
		   later has an explanation ready. */
		let held = [];
		const lockOn = (settings) => {
			if (!settings) return null;
			const incoming = CFG.make(settings);
			for (const k of held) incoming[k] = JSON.parse(JSON.stringify(state.cfg[k]));
			return incoming;
		};
		if (json.settings) {
			const seed = json.settings.seed;
			const probe = CFG.make(json.settings);
			held = Object.keys(state.settingLocks || {})
				.filter((k) => state.settingLocks[k] && k in probe && k in state.cfg);
			const incoming = lockOn(json.settings);
			state.cfg = incoming;
			state.cfg.seed = seed || state.cfg.seed;
			note = " Settings from the file were applied." + (held.length
				? " " + held.length + " locked setting" + (held.length === 1 ? "" : "s") +
					" (" + held.join(", ") + ") kept your value" +
					(held.length === 1 ? "" : "s") + ", so the replay may differ."
				: "");
		} else {
			note = " This export predates settings capture (version " +
				(json.version || 1) + "), so it replays under your current settings.";
		}
		/* THE BIOGRAPHIES ARE READ. Kept off state.cfg because they are a
		   fact about THIS universe, not a setting. */
		state.universeBiography = json.biography && typeof json.biography === "object"
			? json.biography : null;
		if (state.universeBiography) {
			note += " " + Object.keys(state.universeBiography).length +
				" player biographies were applied, so the same men come back.";
		}
		/* HOW IT WAS BUILT. An extended or partly re-run universe is replayed
		   run by run with each run's own settings; see Universe.replayPlan. */
		const plan = U.replayPlan(json, state.files);
		/* WHAT THE FILE SAYS EACH SEASON PRODUCED, keyed per row — file and
		   season and occurrence — not on the season alone: two files claiming
		   the same season used to share one expectation. */
		const expectRows = Array.isArray(json.timeline) && json.timeline.length
			? json.timeline : seasons;
		const keys = U.rowKeys(expectRows);
		state.universeExpect = {
			engineRev: Number.isFinite(json.engineRev) ? json.engineRev : null,
			byKey: {},
			followed: plan.followed,
			segments: plan.segments,
			reason: plan.reason || null,
		};
		expectRows.forEach((sn, i) => {
			if (sn && sn.result && keys[i]) state.universeExpect.byKey[keys[i]] = sn.result;
		});
		/* THE WORLD THE FILE DESCRIBES, KEPT — including its registry, which
		   the restore step read and this object never carried. */
		state.universeImported = json.timeline && json.timeline.length
			? {
				rows: json.timeline,
				threads: json.threads || null,
				records: json.records || null,
				alumni: json.alumni || null,
				tail: json.tail || null,
				registry: json.registry && typeof json.registry === "object"
					? json.registry : null,
			}
			: null;
		state.cfg.universe = true;
		state.cfg.seed = json.baseSeed || state.cfg.seed;
		$("seed").value = state.cfg.seed;
		paintConfig();
		if (plan.steps.length > 1) {
			note += " It was built in " + plan.steps.length + " runs (" +
				plan.steps.map((s) => s.kind).join(", ") + "), and is replayed the same way.";
		} else if (!plan.followed) {
			note += " It was built in " + plan.segments + " runs, which cannot be " +
				"followed without every class file loaded, so it replays as one.";
		}
		if (missing.length) {
			setStatus("Replaying " + (played.length - missing.length) + " of " +
				played.length + " seasons — not loaded: " +
				missing.map((m) => m.fileName).join(", ") + "." + note);
		} else {
			setStatus("Replaying " + played.length + " seasons." + note);
		}
		state.universe.followed = typeof json.followed === "string" ? json.followed : null;
		state.universe.dynasty = json.dynasty && typeof json.dynasty === "object" ? json.dynasty : null;
		const steps = plan.steps;
		const runStep = (i) => {
			const s = steps[i];
			const last = i === steps.length - 1;
			const o = { settings: lockOn(s.settings), replaying: !last,
				identity: { name: json.name, createdAt: json.createdAt } };
			if (s.kind === "extend") { o.extend = true; o.only = s.only; }
			else if (s.kind === "resume") o.resumeFrom = s.from;
			else if (s.only) o.only = s.only;
			runUniverse(last ? null : () => runStep(i + 1), o);
		};
		runStep(0);
	}

	/* Did the replay produce the world the file describes? Called once a
	   chain that came from an import has finished. */
	function checkUniverseDivergence() {
		const want = state.universeExpect;
		if (!want) return null;
		const diverged = [];
		const divergedSeasons = [];
		const keys = global.Universe.rowKeys(state.universe.rows);
		state.universe.rows.forEach((r, i) => {
			const expected = want.byKey ? want.byKey[keys[i]] : null;
			if (!expected || !r || !r.result) return;
			if (expected !== r.result) {
				diverged.push(keys[i]);
				divergedSeasons.push(r.season);
			}
		});
		state.universeExpect = null;
		const kept = restoreImportedWorld(diverged);
		if (!diverged.length) return null;
		/* WHOSE FAULT. A universe built in several runs and replayed as one
		   diverges because of the runs, not because of the class files — and
		   used to be told the files or settings were different. */
		const revNote = want.engineRev !== null && want.engineRev !== global.Universe.ENGINE_REV
			? " This universe was built on engine revision " + want.engineRev +
				" and you are running " + global.Universe.ENGINE_REV + "."
			: !want.followed
			? " It was built in " + want.segments + " runs (extended or partly " +
				"re-run) and could not be replayed run by run" +
				(want.reason ? " (" + want.reason + ")" : "") +
				", so seasons after the first run are expected to differ."
			: " The class files or the settings differ from the ones it was built on.";
		return "Season" + (divergedSeasons.length > 1 ? "s " : " ") +
			divergedSeasons.slice(0, 6).join(", ") +
			(divergedSeasons.length > 6 ? " (+" + (divergedSeasons.length - 6) + " more)" : "") +
			" diverged from the imported universe." + revNote +
			(kept && kept.restored
				? " The timeline, the threads and the records book have been " +
					"restored from the file, so the world you were given is the " +
					"one on the Universe tab; the other tabs show this machine's " +
					"replay of it."
				: " This export predates timeline capture, so there is nothing " +
					"to restore it from.");
	}

	/* Put the imported universe's own rows back where the replay disagreed,
	   or could not play a season at all (its class file is not loaded), and
	   merge — not replace — its alumni index and registry. See
	   Universe.restoreImported. */
	function restoreImportedWorld(diverged) {
		const imported = state.universeImported;
		state.universeImported = null;
		if (!imported) return null;
		const out = global.Universe.restoreImported(state.universe, imported, diverged || []);
		if (out.missing) {
			state.universe.importNote = out.missing + " season" +
				(out.missing === 1 ? "" : "s") + " whose class file is not loaded " +
				(out.missing === 1 ? "was" : "were") +
				" taken from the imported timeline rather than extrapolated.";
		}
		return out;
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

	/* Keep the CURRENT history entry describing where the user is. The first
	   page of a session had no bbgmNav entry at all, so Back from the first
	   team or player page opened left the popstate handler nothing to go back
	   to and did nothing; and a destination changed without a push (an
	   editor opening, the arrow keys on the tab bar) left the entry stale.
	   Only written when it differs — Safari throws after 100 writes in 30s. */
	function syncNav() {
		try {
			const want = navState();
			const cur = history.state;
			if (cur && cur.bbgmNav && cur.tab === want.tab && cur.team === want.team &&
				cur.player === want.player && cur.game === want.game) return;
			history.replaceState(Object.assign({}, cur && typeof cur === "object" ? cur : {},
				{ bbgmNav: true }, want), "");
		} catch (e) { /* file:// in some browsers */ }
	}

	/* A tab is a destination too: clicking one pushes history, so Back
	   returns to the tab you came from. Clicking the tab you are ALREADY on
	   is "take me to this tab's front page" — it clears the player, team or
	   box score open inside it. */
	function showTab(key) {
		if (key === state.tab) {
			/* Still re-rendered: the view can be showing something that is
			   not the tab (a batch result renders into it), and clicking the
			   tab is how the user gets the tab back. */
			if (!state.player && !state.team && !state.game) { render(); return; }
			state.player = null;
			state.team = null;
			state.game = null;
		} else {
			state.tab = key;
		}
		pushNav();
		persist();
		render();
	}
	global.App.showTab = showTab;

	function showPlayer(key) {
		state.player = key || null;
		if (key) state.tab = "board";
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
		// Back/forward returns to where that page was scrolled, not the top.
		navRestore = true;
		render();
	});

	/* Where each destination was scrolled when the user left it, so Back can
	   put it back; see render(). A destination is tab + player + team + game. */
	const destScroll = {};
	let lastDest = null;
	let navRestore = false;
	function destKey() {
		return [state.tab, state.tab === "board" ? state.boardMode || "board" : "",
			state.player || "", state.team || "", state.game || ""].join("|");
	}

	function render() {
		paintExportLabel();
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
			b.addEventListener("click", () => showTab(key));
			b.addEventListener("keydown", (e) => {
				const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
				if (!d) return;
				e.preventDefault();
				// Through showTab, for the history entry, and past Compare
				// when nothing is pinned, as the number keys already were.
				let j = (i + d + TABS.length) % TABS.length;
				if (TABS[j][0] === "compare" && !state.pinned) {
					j = (j + d + TABS.length) % TABS.length;
				}
				showTab(TABS[j][0]);
				const next = tabs.querySelector("button.active");
				if (next) next.focus();
			});
			tabs.appendChild(b);
		});
		/* On a phone the tab strip is one sideways-scrolling row; keep the
		   active tab in it rather than off the right edge. */
		{
			const act = tabs.querySelector("button.active");
			if (act && tabs.scrollWidth > tabs.clientWidth) {
				const r = act.getBoundingClientRect();
				const t = tabs.getBoundingClientRect();
				if (r.left < t.left || r.right > t.right) {
					tabs.scrollLeft += (r.left - t.left) - (t.width - r.width) / 2;
				}
			}
		}
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
		/* A rebuild of the SAME destination keeps its scroll (that is the
		   point above). A NEW destination starts at the top — restoring the
		   old scrollY after opening a player from row 60 of the board put
		   his page 3000px down — unless it is a Back/forward, which restores
		   what that destination had. */
		const dest = destKey();
		const sameDest = dest === lastDest;
		let scrolls = captureScroll(view);
		if (lastDest !== null) destScroll[lastDest] = scrolls;
		if (!sameDest) {
			scrolls = navRestore && destScroll[dest] ? destScroll[dest] : { list: [], page: 0, win: 0, top: true };
		}
		navRestore = false;
		lastDest = dest;
		syncNav();
		// A popover or row menu belongs to the view being thrown away.
		if (V.closeWhy) V.closeWhy();
		if (V.closeRowMenu) V.closeRowMenu();
		const focus = sameDest ? captureFocus(view) : null;
		view.innerHTML = "";
		const res = ensureResult(state.active);
		if (!res) {
			/* Universe mode with the chain still to run this file (see
			   ensureResult): the Universe tab renders its own progress, and
			   every other tab says what it is waiting for rather than
			   drawing a world that is not the universe. */
			if (state.cfg.universe && state.files.length) {
				if (state.tab === "universe") { V.universe(view, null); return; }
				const box = el("div", "empty-state");
				box.appendChild(el("h3", null, state.universe.running
					? "Universe: season " + (state.universe.done || 0) + " of " +
						(state.universe.total || state.files.length) + "…"
					: "Waiting for the universe chain"));
				box.appendChild(el("p", "hint", state.universe.running
					? "This tab shows the universe's world, which is still being played. " +
						"It fills in when the chain reaches this class."
					: "Universe mode is on and this class has not been run as part of " +
						"the chain yet. It runs when the chain does; the Universe tab " +
						"has the button and the per-file diagnostics."));
				view.appendChild(box);
			}
			return;
		}
		// The archetype editor reports what the last run actually produced, so
		// it has to be repainted when there is a new run to report.
		paintArchWeights();
		// An open Play game hides every results tab until it is revealed.
		if (global.Play && global.Play.gated(state, res)) { global.Play.gateView(view); return; }
		(V[state.tab] || V.players)(view, res);
		restoreScroll(view, scrolls);
		restoreFocus(view, focus);
	}

	const SCROLLERS = ".scroll, .tablewrap, .drawer";

	/* Containers are keyed by TAB as well as by index: the third scroller on
	   the Teams tab and the third on the board are different tables, and
	   restoring one's horizontal offset onto the other was the old rule. */
	function captureScroll(view) {
		const out = [];
		view.querySelectorAll(SCROLLERS).forEach((n, i) => {
			if (n.scrollLeft || n.scrollTop) out.push([i, n.scrollLeft, n.scrollTop]);
		});
		return { tab: state.tab, list: out, page: view.scrollTop, win: global.scrollY || 0 };
	}

	function restoreScroll(view, saved) {
		if (!saved) return;
		if (saved.top) {
			// A new destination: the top of it.
			view.scrollTop = 0;
			if (global.scrollY) global.scrollTo(0, 0);
			return;
		}
		if (saved.tab === state.tab) {
			const nodes = view.querySelectorAll(SCROLLERS);
			for (const [i, left, top] of saved.list) {
				const n = nodes[i];
				if (!n) continue;
				n.scrollLeft = left;
				n.scrollTop = top;
			}
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
		// The editor is a drawer beside the prospect table, so opening it
		// means being in the mode that has a table.
		if (state.editing) { state.tab = "board"; state.boardMode = "edit"; }
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
		state.tab = "board";
		state.boardMode = "edit";
		state.player = null;
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
			"Draw this prospect again. Nobody else changes build, school or " +
			"ratings; the season is re-simulated around him, so other players' " +
			"stat lines can shift.");
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
		// A season with no attempts has no percentage (null), not 0%.
		const pctOrDash = (x) => Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "—";
		row("Shot mix", n1(s.fga) + " field goals, " + n1(s.tpa) + " of them threes, " +
			n1(s.fta) + " free throws");
		row("Efficiency", (s.ts * 100).toFixed(1) + "% true shooting on " +
			(s.fgp * 100).toFixed(1) + "% from the floor");
		row("The arithmetic", n1(s.fga - s.tpa) + " twos at " +
			(((s.fgp * s.fga - s.tpa * (s.tpp || 0)) / Math.max(0.01, s.fga - s.tpa)) * 100)
				.toFixed(1) + "%, " +
			n1(s.tpa) + " threes at " + pctOrDash(s.tpp) + ", " +
			n1(s.fta) + " free throws at " + pctOrDash(s.ftp) + " = " +
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
	let modalValidate = null;     // returns false to keep the dialog open

	/* `opts.focusCancel`: a destructive confirmation starts on Cancel, so an
	   Enter pressed out of habit does not throw the work away. */
	function modal(title, body, onOk, okLabel, opts) {
		modalTrigger = document.activeElement;
		$("modalTitle").textContent = title;
		const b = $("modalBody");
		b.innerHTML = "";
		b.appendChild(body);
		$("modalOk").textContent = okLabel || (onOk ? "OK" : "Close");
		modalOk = onOk;
		modalValidate = opts && opts.validate || null;
		/* An information dialog has one way out. Showing "Close" beside a
		   "Cancel" that did the same thing asked a question there was no
		   answer to. */
		$("modalCancel").hidden = !onOk;
		const m = $("modal");
		m.hidden = false;
		// Install focus trap
		if (modalTrapCleanup) modalTrapCleanup();
		modalTrapCleanup = trapFocus(m.querySelector(".modalbox"));
		// Move focus to the first focusable element inside the modal
		requestAnimationFrame(() => {
			if (opts && opts.focusCancel && !$("modalCancel").hidden) {
				$("modalCancel").focus();
				return;
			}
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
		modal(title, box, onOk, okLabel, { focusCancel: true });
	}

	/* The themed stand-in for window.prompt: one text box, a label, an inline
	   error. `check(value)` returns an error sentence or "" — the dialog stays
	   open until it passes. onOk gets the trimmed value. */
	function promptModal(title, label, value, onOk, opts) {
		const o = opts || {};
		const box = el("div");
		const lab = el("label", "promptlabel", label);
		const input = el("input");
		input.type = "text";
		input.id = "modalPrompt";
		input.value = value || "";
		if (o.placeholder) input.placeholder = o.placeholder;
		lab.htmlFor = "modalPrompt";
		const err = el("p", "hint promptError");
		err.setAttribute("role", "alert");
		box.appendChild(lab);
		box.appendChild(input);
		box.appendChild(err);
		const check = () => {
			const msg = o.check ? o.check(input.value.trim()) : "";
			err.textContent = msg || "";
			if (msg) input.focus();
			return !msg;
		};
		modal(title, box, () => onOk(input.value.trim()), o.okLabel || "OK", { validate: check });
		setTimeout(() => { input.focus(); input.select(); }, 0);
	}

	function closeModal() {
		$("modal").hidden = true;
		modalOk = null;
		modalValidate = null;
		if (modalTrapCleanup) { modalTrapCleanup(); modalTrapCleanup = null; }
		// Restore focus to the element that triggered the modal
		if (modalTrigger && typeof modalTrigger.focus === "function") {
			try { modalTrigger.focus(); } catch (e) { /* element may be gone */ }
		}
		modalTrigger = null;
	}

	/* ------------------------------------------------------------- clipboard */

	/* `what` names the thing copied for the toast ("seed", "link"); without
	   it the button's resting label stands in. */
	function copyText(text, button, restore, what) {
		/* The label to put back is the one the button HAS, not one the caller
		   remembered: the header's copy-link button is an icon (🔗) and the
		   call site passed the word "Link", so one copy replaced the icon with
		   a word for the rest of the session — and the wider button reflowed
		   the whole header. The parameter is still honoured where a caller
		   wants a different resting label. */
		/* The RESTING label, kept on the button itself: reading textContent
		   at call time read "Copied ✓" on a second click inside the flash,
		   and that became the label for good. */
		if (button && button.dataset.restLabel === undefined) {
			button.dataset.restLabel = button.textContent;
		}
		const was = button ? button.dataset.restLabel : "";
		const done = () => {
			/* Announce it. The seed pill's copy changed the BUTTON's text and
			   nothing else, so a screen reader user pressing it got no
			   confirmation at all — and the pill itself is not a button, so
			   there was not even that. announce() is the tool's own live
			   region and costs nothing. */
			const name = what || (button && (button.getAttribute("aria-label") ||
				button.dataset.restLabel || "").replace(/^Copy\s*/i, "").trim()) || "text";
			// The toast carries its own live region; no second announcement.
			toast("Copied " + name + " to the clipboard.");
			if (!button) return;
			button.textContent = "Copied ✓";
			clearTimeout(Number(button.dataset.copyTimer) || 0);
			button.dataset.copyTimer = String(setTimeout(() => {
				button.textContent = restore || was;
			}, 1400));
		};
		function fallback() {
			// Put focus back afterwards: the textarea took it, and an async
			// fallback could pull it out of whatever opened in the meantime.
			const had = document.activeElement;
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); done(); } catch (e) { /* nothing to do */ }
			ta.remove();
			if (had && had !== document.body && had.isConnected && had.focus) had.focus();
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, fallback);
		} else fallback();
	}

	/* UNSAVED WORK, conservatively: locks and player edits (state.overrides)
	   or universe seasons that changed since the last file this tab wrote —
	   or since the page loaded, since what storage restored is not new. A
	   fresh sample with no locks and no universe is never "unsaved". */
	let exportedSig = null;
	function workSig() {
		const u = state.universe;
		/* The universe by its LAST season and name, not its row count: a
		   reload replays the stored timeline and rebuilds rows it already
		   had, which is not new work. */
		const last = u && u.rows && u.rows.length ? u.rows[u.rows.length - 1] : null;
		return JSON.stringify(state.overrides || {}) + "|" +
			(last ? last.season : "") + "|" + (u && u.name || "");
	}
	function markExported() { exportedSig = workSig(); }
	function unsavedWork() {
		const u = state.universe;
		const any = Object.keys(state.overrides || {}).length > 0 ||
			!!(u && u.rows && u.rows.length);
		return any && workSig() !== exportedSig;
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
		/* What was written, by name. A browser that saves to a download folder
		   without asking gives no visible sign at all, and the statuses the
		   callers wrote said what had happened ("Season exported.") without
		   ever naming the file — so "which of these four JSONs is the one I
		   just made" was unanswerable from inside the tool. */
		lastDownload = name;
		markExported();
		setStatus("Wrote " + name + ".");
		return name;
	}

	/* The status a caller writes after download(): its own sentence, with the
	   file name download() recorded in front of it. */
	let lastDownload = "";
	function exported(extra) {
		setStatus("Wrote " + lastDownload + (extra ? " — " + extra : "") + ".");
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
		/* The biography columns the table gained beside these. Each is drawn
		   per player and survives a reroll, and until now the only way to get
		   any of them out of the tool was to read sixty notes. The rule this
		   file follows is that the CSV and the screen never disagree — see the
		   derived columns routed through Views.derived below — so a column
		   added to one belongs in the other. */
		"hand", "age", "recRank", "stars", "composite", "caps", "continental",
		"board", "preseason", "move", "gp", "mpg", "ppg", "rpg", "orpg", "drpg",
		"apg", "spg", "bpg", "topg", "pfpg", "cspg", "deflpg", "chgpg", "drtg",
		// The volume behind every percentage, which the table now shows too.
		"fga", "tpa", "fta", "tpar", "ftr", "efg", "astTo", "ortg", "prod",
		/* The lineup and playmaking columns. Every one of these is on the
		   table and none of them was in the file, so a spreadsheet built off
		   "Export CSV" could not answer the questions the columns beside them
		   were added to answer — which is the same disagreement between the
		   file and the screen the derived columns below are routed through
		   Views.derived to avoid. */
		"pm", "onOff", "astd", "trans", "clutchPpg",
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
		/* Strings only: a negative number is data, and "'-3" reads as text. */
		if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
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
		/* IN BOARD ORDER.

		   This walked `res.players`, which is the source file's own row order —
		   so "Export CSV" from a tool whose front page is a draft board handed
		   back a spreadsheet in an order that means nothing, and the first
		   thing anybody did with it was sort by the board column. A prospect
		   with no board rank (a class too small for the board, an export taken
		   before the stock phase) sorts last rather than first, the same rule
		   the table's blank handling follows. */
		const ordered = res.players.slice().sort((a, b) => {
			const x = Number.isFinite(a.boardRank) ? a.boardRank : Infinity;
			const y = Number.isFinite(b.boardRank) ? b.boardRank : Infinity;
			return x - y;
		});
		for (const p of ordered) {
			if (!everyone && !V.matchesFilter(p, res)) { skipped++; continue; }
			const s = p.stats || {};
			const t = res.teams[p.newCollege];
			// Derived columns come from the same place the table reads them, so
			// the file and the screen can never disagree.
			const d = (k) => (p.stats ? V.derived(k, p.stats, p) : undefined);
			lines.push([
				p.key, p.name, p.newPos, p.classYear, p.newOvr, p.newPot, p.archetype,
				p.proClub || p.newCollege, t ? t.conf : p.newCollege,
				t ? t.w + "-" + t.l : "", t ? t.apRank : "", t ? t.ncaaSeed : "",
				p.newHgtInches, p.newWeight,
				p.hand || "", Number.isFinite(p.age) ? p.age : "",
				p.recruiting ? p.recruiting.rank : "",
				p.recruiting ? p.recruiting.stars : "",
				p.recruiting ? p.recruiting.composite : "",
				p.proPath && p.proPath.caps
					? p.proPath.caps.n + " " + p.proPath.caps.country +
						(p.proPath.caps.level === "senior" ? "" : " " + p.proPath.caps.level)
					: "",
				p.continental
					? p.continental.competition + " — " + p.continental.result : "",
				p.boardRank, p.preseasonRank, p.stockMove,
				s.gp, s.mpg, s.ppg, s.rpg, s.orpg, s.drpg, s.apg, s.spg, s.bpg,
				s.topg, s.pfpg, s.cspg, s.deflpg, s.chgpg, s.drtg,
				s.fga, s.tpa, s.fta, d("tpar"), d("ftr"), d("efg"), d("astTo"),
				d("ortg"), d("prod"),
				s.pm, s.onOff, d("astd"), d("trans"), s.clutchPpg,
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
		exported(skipped
			? (res.players.length - skipped) + " of " + res.players.length +
				" prospects (the current filter); use “Prospect table as CSV " +
				"(whole class)” for all of them"
			: "all " + res.players.length + " prospects");
	}

	/* ---- the mock draft, as a picture ----------------------------------

	   THE ONE OUTPUT THAT DOES NOT NEED BBGM.

	   Everything this tool writes is a file for the game or a spreadsheet for
	   the user: a JSON class, a CSV, a season dump. All of them require the
	   reader to own Basketball GM and to import something. The thing people
	   actually want to show each other is the first round — name, school,
	   class year, and the draft-night story beside it — and the tool had no
	   way to hand that over except a screenshot of a scrolling table.

	   Drawn on a canvas rather than assembled as HTML, because the point is a
	   file you can paste into a forum post. The board's own data is the whole
	   input: `draftOrder` is where each man was actually taken (the pre-event
	   ranking is `boardRank`, and they differ, which is what the event column
	   is for). Two columns of fifteen, so it is a shape that fits a screen. */
	const MOCK_ROUND = 30;
	function exportMockImage(res) {
		if (!res || !res.board || !res.board.length) {
			setStatus("No draft board to draw.");
			return;
		}
		const order = (res.draftOrder && res.draftOrder.length ? res.draftOrder : res.board)
			.slice(0, MOCK_ROUND);
		if (!order.length) { setStatus("No draft board to draw."); return; }
		const scale = 2;                      // drawn at 2x for a sharp file
		const W = 1180;
		const rows = Math.ceil(order.length / 2);
		const rowH = 46;
		const headH = 96;
		const footH = 40;
		const H = headH + rows * rowH + footH;
		const cv = document.createElement("canvas");
		cv.width = W * scale;
		cv.height = H * scale;
		const g = cv.getContext("2d");
		if (!g) { setStatus("This browser cannot draw to a canvas."); return; }
		g.scale(scale, scale);
		/* Its own palette, deliberately not the page's. The file outlives the
		   theme it was exported under, and a dark-theme PNG pasted into a
		   light forum post reads as a mistake. */
		const ink = "#14181d";
		const dim = "#5c6773";
		const rule = "#dfe4ea";
		const accent = "#b45309";
		g.fillStyle = "#ffffff";
		g.fillRect(0, 0, W, H);
		g.fillStyle = ink;
		g.font = "600 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
		g.fillText(className(res), 28, 44);
		g.fillStyle = dim;
		g.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
		g.fillText("Mock first round · seed " + res.seed + " · " +
			classFingerprint(res), 28, 68);
		g.strokeStyle = rule;
		g.lineWidth = 1;
		g.beginPath();
		g.moveTo(28, headH - 16);
		g.lineTo(W - 28, headH - 16);
		g.stroke();
		const colW = (W - 56) / 2;
		order.forEach((p, i) => {
			const col = i < rows ? 0 : 1;
			const row = i - col * rows;
			const x = 28 + col * colW;
			const y = headH + row * rowH;
			if (row % 2 === 1) {
				g.fillStyle = "#f7f8fa";
				g.fillRect(x - 6, y - 18, colW - 8, rowH - 4);
			}
			g.fillStyle = accent;
			g.font = "600 15px ui-monospace, SFMono-Regular, Menlo, monospace";
			g.fillText(String(i + 1).padStart(2, " "), x, y);
			g.fillStyle = ink;
			g.font = "600 15px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
			g.fillText(p.name, x + 34, y);
			g.fillStyle = dim;
			g.font = "12.5px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
			const where = p.proClub || p.newCollege || "";
			g.fillText([where, p.classYear, p.newPos].filter(Boolean).join(" · "),
				x + 34, y + 16);
			/* The draft-night story, where there is one. This is the whole
			   reason the picture is of `draftOrder` and not of the ranking:
			   without it the image is a list, and with it it is a draft. */
			const ev = p.draftEvent && p.draftEvent.text;
			if (ev) {
				g.fillStyle = accent;
				g.font = "italic 11.5px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
				const text = ev.length > 44 ? ev.slice(0, 43) + "\u2026" : ev;
				g.fillText(text, x + colW - 20 - g.measureText(text).width, y);
			}
		});
		g.fillStyle = dim;
		g.font = "11.5px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
		g.fillText("Generated with the BBGM Draft Class Workshop · " +
			"the same seed reproduces this class exactly", 28, H - 16);
		const name = "mock_round_1_" + res.seed + ".png";
		cv.toBlob((blob) => {
			if (!blob) { setStatus("Could not encode the image."); return; }
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = name;
			document.body.appendChild(a);
			a.click();
			setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
			lastDownload = name;
			setStatus("Wrote " + name + " — the first round as a picture, " +
				"for somebody who does not have the game.");
		}, "image/png");
	}

	/* The whole simulated season was throwaway except for the note strings. */
	function exportSeasonJson(res) {
		download("season_" + res.seed + ".json",
			JSON.stringify(global.Engine.exportSeason(res), null, 2), "application/json");
		exported();
	}

	function exportLeagueFragment(res) {
		download(state.files[state.active].name.replace(/\.json(\.gz)?$|\.gz$/i, "") + "_league_fragment.json",
			JSON.stringify(global.Engine.exportLeagueFragment(res), null, 2), "application/json");
		exported();
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
		exported();
	}

	function exportNotes(res) {
		const lines = ["name\tnote"];
		for (const p of res.players.slice().sort((a, b) => b.newOvr - a.newOvr)) {
			lines.push(p.name + "\t" + (p.note || "").replace(/\n/g, " · "));
		}
		download("notes.tsv", csvJoin(lines), "text/tab-separated-values");
		exported();
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
		exported();
	}

	/* ---------------------------------------------------------- the almanac */

	/* The whole season as one document. Everything below is assembly and
	   plumbing; what goes IN the document is js/almanac.js, which knows
	   nothing about the DOM so the tests can read what a user downloads. */

	function almanacName(res, ext) {
		return "almanac_" + res.season + "_" + res.seed + "." + ext;
	}

	/* The dialog's choices, remembered between openings the way the export
	   menu's are, and shared by both buttons so the PDF and the .md are the
	   same document. The awards scope is the export menu's own setting: a
	   user who narrowed the honors there meant it here too. */
	function almanacOpts() {
		const chosen = state.almanacSections || null;
		const sections = {};
		for (const s of global.Almanac.SECTIONS) {
			sections[s.id] = chosen ? chosen[s.id] !== false : true;
		}
		return {
			sections,
			newsLimit: Number.isFinite(state.almanacNewsLimit)
				? state.almanacNewsLimit : 0,
			awardsScope: state.exportAwardsScope || "all",
			majorConferences: state.exportMajorConfs || null,
		};
	}

	function exportAlmanacMarkdown(res) {
		download(almanacName(res, "md"),
			global.Almanac.markdown(res, almanacOpts()), "text/markdown");
		exported("the whole season as one document");
	}

	/* "PDF" without a PDF library: the printable document opens in a tab and
	   the browser's own print dialog writes the file. Every browser this tool
	   runs in can save a page as PDF, and a bundled renderer would be the
	   first dependency in a tool that has none. A blocked pop-up falls back to
	   downloading the same HTML, which prints identically from a double-click.  */
	function printAlmanac(res) {
		const html = global.Almanac.html(res, almanacOpts());
		let w = null;
		try { w = window.open("", "_blank"); } catch (err) { w = null; }
		if (!w) {
			download(almanacName(res, "html"), html, "text/html");
			exported("your browser blocked the print tab — open the file and " +
				"print it to PDF from there");
			return;
		}
		w.document.write(html);
		w.document.close();
		/* Print once the document has laid out — a print() on a page still
		   parsing gives a blank first page in Safari — but document.close()
		   can have fired `load` already, and waiting for an event that has
		   been and gone leaves the tab sitting there with no print dialog. */
		const print = () => { try { w.focus(); w.print(); } catch (err) { /* closed */ } };
		if (w.document.readyState === "complete") setTimeout(print, 0);
		else w.addEventListener("load", print);
		setStatus("Opened the printable almanac — use your browser's " +
			"“Save as PDF” in the print dialog.");
	}

	/* ------------------------------------------------------ the season site */

	/* The same season, as a small website instead of a document: one HTML
	   file carrying the season as JSON and the reader for it, so the tables
	   sort, the board filters and a name in a headline opens that prospect's
	   capsule. What goes in it is js/site.js, which knows nothing about the
	   DOM either — the file a user downloads is the file CI reads.

	   It is a download rather than a new tab on purpose: the point of the
	   thing is that it survives being emailed to somebody. */
	function siteName(res, ext) {
		return "season_site_" + res.season + "_" + res.seed + "." + ext;
	}

	function exportSeasonSite(res) {
		download(siteName(res, "html"),
			global.SeasonSite.html(res, almanacOpts()), "text/html");
		exported("open it in any browser \u2014 nothing is fetched, so it works " +
			"from a thumb drive, and its own button hands the reader the JSON back");
	}

	function exportSeasonSiteJson(res) {
		download(siteName(res, "json"),
			JSON.stringify(global.SeasonSite.data(res, almanacOpts()), null, 2),
			"application/json");
		exported("the season the website draws itself from \u2014 the standings, " +
			"the bracket, the board, every capsule and the news feed, as data");
	}

	function almanacDialog() {
		const res = state.results[state.active];
		if (!res) return;
		const box = el("div");
		box.appendChild(el("p", "hint",
			"The season as one document: the poll, every conference's standings, " +
			"the bracket round by round, the honors, the leader boards, the pro " +
			"leagues, the board, a capsule for every prospect and the news feed. " +
			"Download it as Markdown, open it printable and save it as a PDF, or " +
			"write it as an interactive website \u2014 one HTML file with the " +
			"whole season in it as JSON, sortable and searchable, no server."));
		const list = el("div", "checks");
		const boxes = {};
		const remembered = state.almanacSections || null;
		for (const s of global.Almanac.SECTIONS) {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = remembered ? remembered[s.id] !== false : true;
			cb.addEventListener("change", () => { state.almanacSections = read(); });
			boxes[s.id] = cb;
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + s.label));
			list.appendChild(lab);
		}
		const read = () => {
			const out = {};
			for (const id of Object.keys(boxes)) out[id] = boxes[id].checked;
			return out;
		};
		box.appendChild(list);
		/* The news feed is eighty to a hundred and twenty articles and it is
		   the one section that can double the page count on its own. */
		const newsWrap = el("div", "ctl");
		const newsLab = el("label", null, "Most news articles");
		newsLab.htmlFor = "almanacNewsLimit";
		const newsInput = el("input");
		newsInput.id = "almanacNewsLimit";
		newsInput.type = "number";
		newsInput.min = "0";
		newsInput.value = String(state.almanacNewsLimit || 0);
		newsInput.addEventListener("input", () => {
			state.almanacNewsLimit = Math.max(0, Number(newsInput.value) || 0);
		});
		newsWrap.appendChild(newsLab);
		newsWrap.appendChild(newsInput);
		newsWrap.appendChild(el("p", "unit", "0 means every article."));
		box.appendChild(newsWrap);
		const pdf = el("button", "tiny", "Open printable (save as PDF)\u2026");
		pdf.addEventListener("click", () => {
			state.almanacSections = read();
			closeModal();
			printAlmanac(res);
		});
		box.appendChild(pdf);
		const site = el("button", "tiny", "Download the interactive website (HTML + JSON)");
		site.addEventListener("click", () => {
			state.almanacSections = read();
			closeModal();
			exportSeasonSite(res);
		});
		box.appendChild(site);
		const siteJson = el("button", "tiny", "Download the website's JSON on its own");
		siteJson.addEventListener("click", () => {
			state.almanacSections = read();
			closeModal();
			exportSeasonSiteJson(res);
		});
		box.appendChild(siteJson);
		modal("Season almanac", box, () => {
			state.almanacSections = read();
			exportAlmanacMarkdown(res);
		}, "Download Markdown");
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
					? " " + plan.unmatched.length + " row(s) named somebody else." : "") +
				(plan.rejected.length
					? " " + plan.rejected.length + " value(s) were not names the tool knows: " +
						plan.rejected.slice(0, 3).join("; ") + "." : "")));
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
		if (plan.rejected.length) {
			box.appendChild(el("p", "hint",
				"Not applied: " + plan.rejected.slice(0, 12).join("; ") +
				(plan.rejected.length > 12 ? "; …" : "")));
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
		const rejected = [];
		const archetypeNames = new Set(global.RatingsBuilder.ARCHETYPES.map((a) => a.name));
		const schoolNames = new Set(global.Colleges.names
			.concat(Object.keys(global.Colleges.NON_NCAA)));
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
				// An empty cell is no lock, not a lock at 0 (Number("") is 0).
				const t = String(r[c] === undefined ? "" : r[c]).trim();
				const v = Number(t);
				return t !== "" && Number.isFinite(v) ? v : null;
			};
			if (cols.ovr >= 0 && num(cols.ovr) !== null) patch.ovr = num(cols.ovr);
			if (cols.pot >= 0 && num(cols.pot) !== null) patch.pot = num(cols.pot);
			/* A name the tool does not know is refused here, not applied:
			   an unknown archetype fell back to the rolled build while the
			   lock badge said otherwise, and an unknown school was written
			   verbatim into the export with no team behind it. */
			if (cols.archetype >= 0 && String(r[cols.archetype]).trim()) {
				const a = String(r[cols.archetype]).trim();
				if (archetypeNames.has(a)) patch.archetype = a;
				else rejected.push(p.name + ": unknown archetype “" + a + "”");
			}
			if (cols.college >= 0 && String(r[cols.college]).trim()) {
				const c = String(r[cols.college]).trim();
				if (schoolNames.has(c)) patch.college = c;
				else rejected.push(p.name + ": unknown school “" + c + "”");
			}
			if (!Object.keys(patch).length) continue;
			applied.push({ player: p, patch });
		}
		return { applied, unmatched, rejected, total };
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
		exported("from " + state.files[state.active].name +
			(exportOne.warning ? ". " + exportOne.warning : ""));
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
		/* Notes are generated every run whether or not this box is on — see
		   phaseNotes in js/engine.js — so unchecking it costs nothing to
		   recompute. It only decides whether the file written out carries
		   them: a scout who doesn't want the prose in the export (a league
		   file kept clean of spoilers, say) can still see it on the Notes
		   tab and flip this only when exporting. */
		const oIncludeNotes = opt("includeNotes", "Include scouting notes in the export", true);
		optBox.appendChild(el("p", "unit",
			"Off writes the file with no note field at all. The note itself is " +
			"still built and still shown on the Notes tab either way."));
		const oNoteAppend = opt("noteAppend", "Keep any note already in the file");
		optBox.appendChild(el("p", "unit",
			"The generated note replaces whatever the file carried. Tick this to " +
			"add it underneath instead, for a file whose notes you edited in BBGM."));
		list.appendChild(optBox);
		paintScope();
		const exportOpts = () => ({
			stats: oStats(), prior: oPrior(), highs: oHighs(), awards: oAwards(),
			ages: oAges(), noteAppend: oNoteAppend(), includeNotes: oIncludeNotes(),
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
				exported(out.players.length + " players; load it with " +
					"Tools → Import players, select them all and tick “Include stats”");
			} catch (err) {
				setStatus("Could not export: " + (err && err.message ? err.message : err));
			}
		});
		item("Merge into a league file… (keeps the statline AND the awards)", () => {
			state.mergeOpts = exportOpts();
			chooseMergeClasses();
		});
		/* The one export that needs nothing but a browser to read. */
		item("Mock first round as a picture (PNG) — for a forum post", () => exportMockImage(res));
		item("Prospect table as CSV (the current filter)", () => exportCsv(res));
		item("Prospect table as CSV (whole class)", () => exportCsv(res, true));
		item("Season as JSON — records, bracket, awards, board", () => exportSeasonJson(res));
		item("Season as CSV", () => exportSeasonCsv(res));
		item("Season almanac — the whole season as Markdown or a PDF\u2026",
			() => almanacDialog());
		item("Season as an interactive website — one HTML file with the JSON in it\u2026",
			() => almanacDialog());
		item("Season as a BBGM league fragment — teams, records, coaches", () => exportLeagueFragment(res));
		item("Note text only, for a spreadsheet", () => exportNotes(res));
		item("Notes as Markdown, for a forum post", () => exportNotesMarkdown(res));
		item("Locked prospects as CSV — the file Import locks reads back", exportLocksCsv);
		item("Import locks from a CSV…", () => $("csvFile").click());
		item("Settings as JSON — drop it on the page to load them again", exportSettingsJson);
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
	/* The merge itself, once both halves are in hand: the classes to write and
	   the league to write them into. Shared by the file-picker route and the
	   in-memory route (the league the classes were lifted out of). */
	function mergeInto(league, leagueName, picked) {
		const results = [];
		for (const i of picked) {
			const r = ensureResult(i);
			if (r) results.push(r);
		}
		if (!results.length) return;
		let out;
		try {
			out = global.Engine.mergeManyIntoLeague(results, league,
				state.mergeOpts || {});
		} catch (err) {
			setStatus("Could not merge: " + (err && err.message ? err.message : err));
			return;
		}
		/* No BOM here, unlike the CSV exports: this file is read back by
		   BBGM's own league loader, not by a spreadsheet. */
		const base = leagueName.replace(/\.json(\.gz)?$/i, "").replace(/\.gz$/i, "");
		const years = out.seasons.slice().sort((a, b) => a - b).join("_");
		download(base + "_with_" + years + "_class.json",
			JSON.stringify(out.file), "application/json");
		exported("merged " + (out.replaced + out.added) + " players into " +
			leagueName + " (" + out.replaced + " replaced, " + out.added + " added, " +
			out.removed + " generated prospects dropped) for the " +
			out.seasons.slice().sort((a, b) => a - b).join(", ") + " draft" +
			(out.seasons.length === 1 ? "" : "s") + ". Load the new file with " +
			"Create New League \u2192 upload" +
			(out.warnings && out.warnings.length ? ". " + out.warnings.join(" ") : ""));
	}

	/* Where the league file comes from. When the classes were lifted out of a
	   league export this session, it is already in memory and asking the user
	   to find the same file on disk again is a step that exists for no
	   reason — and a step at which they can pick the wrong file. */
	function startMerge(picked) {
		state.mergeIndices = picked;
		const src = state.leagueSource;
		if (!src) { $("leagueMergeFile").click(); return; }
		const box = el("div");
		box.appendChild(el("p", null,
			"These classes came out of " + src.name + ", which is still loaded. " +
			"Merge them straight back into it, or pick a different league file."));
		const other = el("button", "tiny", "Use a different league file\u2026");
		other.addEventListener("click", () => {
			closeModal();
			state.mergeIndices = picked;
			$("leagueMergeFile").click();
		});
		box.appendChild(other);
		modal("Merge into a league file", box, () => {
			state.mergeIndices = null;
			setStatus("Merging into " + src.name + "\u2026", true);
			// A frame, so the status paints before a multi-megabyte merge
			// blocks the main thread.
			requestAnimationFrame(() => mergeInto(src.data, src.name, picked));
		}, "Merge into " + src.name);
	}

	function chooseMergeClasses() {
		if (state.files.length < 2) {
			startMerge([state.active]);
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
			startMerge(picked);
		}, state.leagueSource ? "Next\u2026" : "Choose league file…");
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
			/* For the two-class diff on the Compare tab: the build pool the
			   class drew, its curve by board band, and the top of the board. */
			pool: Array.isArray(res.archetypePool) ? res.archetypePool.slice() : [],
			curve: curveOf(res),
			topTen: (res.board || []).slice(0, 10).map((p) => ({
				key: p.key, name: p.name, ovr: p.newOvr, pot: p.newPot,
				pos: p.newPos, year: p.classYear, archetype: p.archetype,
				college: p.proClub || p.newCollege,
			})),
			champion: res.tourney && res.tourney.champion ? res.tourney.champion.team.name : null,
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

	/* The class curve as a few numbers: the overall at fixed positions down
	   the sorted class, which is how a scout describes one ("the top is
	   fine, it falls off a cliff at fifteen"). */
	const CURVE_POINTS = [1, 3, 5, 10, 15, 20, 30, 45, 60];
	function curveOf(res) {
		const sorted = res.players.map((p) => p.newOvr).sort((a, b) => b - a);
		return CURVE_POINTS.map((n) => ({
			at: n, ovr: sorted.length >= n ? sorted[n - 1] : null,
		}));
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
			promptModal("Hold this batch", "Name this batch", suggested, (name) => {
				const label = name || suggested;
				heldBatches = heldBatches.filter((h) => h.label !== label);
				heldBatches.push({
					label, rows: rows.slice(), seed: batchBaseSeed, cfg: effectiveCfg(),
				});
				setStatus("Batch held as “" + label + "”. Change a setting and run another.");
				renderBatch(rows);
			}, { okLabel: "Hold", check: (v) => v.length > 40 ? "Keep the name under 40 characters." : "" });
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
		runUniverse, cancelUniverse, resumeUniverseDialog, exportUniverse, exportUniversePlayers,
		newSyntheticUniverse, syntheticUniverseDialog, simulateForward, simulateForwardDialog,
		restoreSyntheticUniverse,
		exportUniverseCsv, randomizeUniverseName, PERSIST_CAPS,
		followProgram, dynastyDialog, dynastyStatus, abandonDynasty, seasonDrawer,
		universeSlotsDialog, saveUniverseSlot, loadUniverseSlot, deleteUniverseSlot,
		listUniverseSlots, universeStorageInfo,
		importUniverse, showPlayerInFile, universeCareers, liveResults,
		// Exposed for tools/uismoke.js, which loads files without a file input.
		installFiles, paintConfig,
		copyText, announce, toast, promptModal, undoTo, undoHistoryDialog,
		unsavedWork, markExported, editSeedInline, applySeed, bulkApply, bulkShiftOvr, bulkLockAsIs, bulkClear, refreshBulkBar,
		snapshot, rerollUntilDialog, rerollUntil, dailySeed, CHALLENGES, startChallenge,
		challengeResultText, scoreChallenge, restoreSession, randomizeSettings,
		REROLL_PREDICATES,
		exportCsv, setStatus, showError, indexSnapshot,
		// The replay layer, for tools/uismoke.js.
		replayStore, replayDialog, replayAfterRun, chaosDraft, className,
		// Replayability (js/replay.js), for tools/uismoke.js.
		findChallenge, resultCode, applyCode, importGhost, startDaily, startCampaign,
		startPuzzle,
	});

	/* AN UNCAUGHT ERROR SAYS SO. A throw inside a listener used to leave
	   the page half-updated with nothing on screen, and the only record was
	   a console most users never open. Said once per distinct message, and
	   never re-entered: an error raised while reporting one is dropped
	   rather than looping. */
	let lastUncaught = null;
	let reportingUncaught = false;
	function reportUncaught(err) {
		if (reportingUncaught) return;
		const text = err && err.message ? err.message : String(err || "unknown error");
		// Benign by specification, and fired by the header's observer.
		if (/ResizeObserver loop/.test(text) || text === lastUncaught) return;
		lastUncaught = text;
		reportingUncaught = true;
		try {
			showError(new Error("Something went wrong: " + text +
				". The page may be out of step with the settings — Re-apply, or " +
				"reload if it persists."));
		} catch (e) { /* nothing left to report with */ } finally {
			reportingUncaught = false;
		}
	}
	window.addEventListener("error", (e) => reportUncaught(e.error || e.message));
	window.addEventListener("unhandledrejection", (e) => reportUncaught(e.reason));

	const saved = restore();
	readHash();
	// What came back from storage is not new work; only changes after this do.
	markExported();
	window.addEventListener("beforeunload", (e) => {
		if (!unsavedWork()) return;
		e.preventDefault();
		e.returnValue = "";
	});
	lastWrittenHash = location.hash || "";
	/* A link pasted into a tab that is already open changes only the hash,
	   which reloads nothing — so the page went on showing the old class. The
	   hash writeHash put there itself is not news and is ignored. */
	window.addEventListener("hashchange", () => {
		const h = location.hash || "";
		if (h === lastWrittenHash || !/[#&]c=/.test(h)) return;
		lastWrittenHash = h;
		pushUndo("opened a shared link");
		if (!readHash()) { state.undo.pop(); paintUndo(); return; }
		state.editing = null;
		state.selected = {};
		checkLockFingerprint();
		paintConfig();
		persist();
		run(() => setStatus("Applied the settings in the link."));
	});
	window.addEventListener("resize", syncHeaderHeight);
	/* The header wraps without the window resizing — a long "Undo …" label,
	   the seed history appearing, the file picker after a load — and every
	   one of those left --headerH at its startup value, so the sticky panel
	   sat under the header or floated below it. */
	if (typeof ResizeObserver === "function" && document.querySelector("header")) {
		new ResizeObserver(syncHeaderHeight).observe(document.querySelector("header"));
	}
	syncHeaderHeight();

	bindSettingsSearch();
	retuneSliderRanges();
	wrapSlidersWithNumbers();
	addGroupResets();
	bindSettingTier();
	bindSessions();
	bindConfig();
	bindSliderNumbers();
	bindRandomize();
	bindSurprise();
	bindChallenges();
	bindReplay();
	bindSettingFilter();
	bindFiles();
	applyTheme();
	paintConfig();
	paintHistory();
	paintUndo();
	if (saved) applyOpenGroups(saved.open);
	/* The full autosave first, then a synthetic universe is rebuilt from
	   whatever it restored: it has no files to re-drop, only its seed. */
	const afterAutosave = () => {
		try { restoreSyntheticUniverse(); } catch (e) { showError(e); }
	};
	Promise.resolve().then(loadAutosave).then(afterAutosave, afterAutosave);

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
			// A contenteditable is typing too, whatever its tag says.
			if (e.target && e.target.isContentEditable) return;
			/* AND NOT BEHIND A DIALOG. Every other single-key shortcut
			   returns while a modal is open (see the main keydown handler);
			   this one is bound separately and did not, so pressing s with
			   "Reroll until…" or the column picker open slid the settings
			   panel around underneath it. */
			const modalEl = $("modal");
			if (modalEl && !modalEl.hidden) return;
			toggle();
		});
		window.addEventListener("resize", apply);
		apply();
	})();

	$("btnReroll").addEventListener("click", reroll);
	// The same button cancels a search in flight; see rerollUntil.
	$("btnRerollUntil").addEventListener("click", () => {
		if (untilSearch) untilSearch.cancel();
		else rerollUntilDialog();
	});
	// Not `run` directly: run takes an `after` callback and a listener
	// would pass it the click event.
	$("btnRerun").addEventListener("click", () => run());
	$("btnUndo").addEventListener("click", undo);
	$("btnUndo").addEventListener("contextmenu", (e) => { e.preventDefault(); undoHistoryDialog(); });
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
		if (!picked.length) return;
		setStatus("Reading " + f.name + "…", true);
		readTextFile(f).then((text) => {
			let league;
			try {
				league = JSON.parse(text);
			} catch (err) {
				setStatus("Could not merge: " + (err && err.message ? err.message : err));
				return;
			}
			mergeInto(league, f.name, picked);
		}).catch((err) => {
			setStatus(f.name + " could not be read: " +
				(err && err.message ? err.message : err));
		});
	});
	$("csvFile").addEventListener("change", (e) => {
		const f = e.target.files[0];
		if (!f) return;
		const r = new FileReader();
		/* The same check the drag-and-drop path makes: with no class result
		   planLockImport returned null and the import did nothing, silently. */
		r.onload = () => {
			const text = String(r.result);
			if (!state.files.length) {
				showError(new Error("Load a draft class first — a locks CSV is " +
					"applied to the class on screen."));
			} else if (state.results[state.active]) importLocksCsv(text);
			else run(() => importLocksCsv(text));
		};
		r.readAsText(f);
		e.target.value = "";
	});
	$("btnPin").addEventListener("click", () => {
		const res = state.results[state.active];
		if (!res) return;
		state.pinned = indexSnapshot(snapshot(res));
		state.tab = "compare";
		setStatus("Pinned seed " + res.seed + " as the comparison baseline.");
		// Saved at once: the baseline is the one thing meant to outlive the class.
		pushNav();
		persist();
		render();
	});
	/* The card layout follows the viewport in "auto" mode, so a rotation or a
	   window resize has to re-render — otherwise a phone turned landscape keeps
	   the card stack and a desktop window dragged narrow keeps the forty-column
	   table. Debounced, and it only re-renders when the answer actually
	   changed, so dragging a window edge is not seventy table rebuilds. */
	let resizeTimer = null;
	/* Seeded with the mode at load rather than null, or the first resize
	   always re-rendered even when the answer had not changed. */
	let lastCardMode = V.cardMode();
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
		pushUndo("went back to the seed " + v);
		state.cfg.seed = v;
		$("seed").value = v;
		run();
	});
	$("seedPill").addEventListener("click", (e) => {
		// Shift-click pastes (below); copying as well overwrote the clipboard.
		if (e.shiftKey) return;
		copyText($("seedPill").dataset.seed || "", null, "", "seed " + ($("seedPill").dataset.seed || ""));
		const p = $("seedPill");
		if (p.dataset.flashTimer) clearTimeout(Number(p.dataset.flashTimer));
		p.textContent = "seed copied ✓";
		p.dataset.flashTimer = String(setTimeout(() => {
			// Whatever the pill says NOW, not what it said when this fired.
			p.textContent = p.dataset.label || p.textContent;
			delete p.dataset.flashTimer;
		}, 1200));
	});
	/* You could share a seed and not receive one: taking somebody else's meant
	   opening the settings panel and finding the field by hand. Shift-click (or
	   right-click) the pill and paste. */
	const pasteSeed = (e) => {
		e.preventDefault();
		const take = (text) => applySeed(text, "pasted a seed");
		if (navigator.clipboard && navigator.clipboard.readText) {
			navigator.clipboard.readText().then(take, () => promptSeed(take));
		} else promptSeed(take);
	};
	/* The one path a seed typed or pasted into the header takes. */
	function applySeed(text, label) {
		const seed = String(text || "").trim();
		if (!seed) return false;
		pushUndo(label);
		state.cfg.seed = seed;
		$("seed").value = seed;
		state.presetDirty = true;
		run();
		return true;
	}
	/* Edit the seed in place: double-click (or F2 on) the pill swaps it for a
	   text box. Enter applies through applySeed, Escape or blur cancels. */
	function editSeedInline() {
		const pill = $("seedPill");
		if (pill.hidden || $("seedPillEdit")) return;
		const input = el("input", "pill seedpill");
		input.type = "text";
		input.id = "seedPillEdit";
		input.value = pill.dataset.seed || "";
		input.setAttribute("aria-label", "Seed — Enter applies, Escape cancels");
		input.size = Math.max(8, input.value.length + 2);
		let done = false;
		const finish = (apply) => {
			if (done) return;
			done = true;
			const v = input.value.trim();
			input.remove();
			pill.hidden = false;
			pill.focus();
			if (apply && v && v !== String(pill.dataset.seed || "")) applySeed(v, "typed a seed");
		};
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); finish(true); }
			else if (e.key === "Escape") { e.preventDefault(); finish(false); }
		});
		// Deferred: a copy fallback borrows focus for a moment and gives it back.
		input.addEventListener("blur", () => setTimeout(() => {
			if (document.activeElement !== input) finish(false);
		}, 0));
		pill.hidden = true;
		pill.after(input);
		input.focus();
		input.select();
	}
	$("seedPill").addEventListener("dblclick", (e) => { e.preventDefault(); editSeedInline(); });
	$("seedPill").addEventListener("keydown", (e) => {
		if (e.key === "F2") { e.preventDefault(); editSeedInline(); }
	});
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
	$("btnCopyLink").addEventListener("click", (e) => {
		writeHash(true);
		// Shift-click copies the settings as prose instead of as a URL, for
		// the forums and chat clients that eat links. Advertised in the title.
		if (e.shiftKey) copyText(configAsText(), $("btnCopyLink"), null, "settings as text");
		else copyText(location.href, $("btnCopyLink"), null, "link to these settings");
	});
	$("btnCopyText").addEventListener("click", () => {
		writeHash(true);
		copyText(configAsText(), $("btnCopyText"), null, "settings as text");
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
		if (modalValidate && !modalValidate()) return;
		const fn = modalOk;
		closeModal();
		if (fn) fn();
	});
	$("modalCancel").addEventListener("click", closeModal);
	/* Enter in a dialog's text box submits it — "Use a seed", "Save
	   preset", "Reroll until" — as it would in any form. Only a dialog
	   that has an OK action, and only from a one-line box. */
	$("modalBody").addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
		const t = e.target;
		if (!t || t.tagName !== "INPUT" ||
			!/^(text|number|search|url|email)$/.test(t.type || "text")) return;
		if (!modalOk || $("modal").hidden) return;
		e.preventDefault();
		$("modalOk").click();
	});
	$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape") V.closeRowMenu();
		if (e.key === "Escape" && !$("modal").hidden) closeModal();
		else if (e.key === "Escape" && untilSearch) untilSearch.cancel();
		else if (e.key === "Escape" && state.editing !== null && state.editing !== undefined) {
			// The shortcut sheet promises this closes the editor too.
			state.editing = null;
			render();
		}
		const tag = (e.target.tagName || "").toLowerCase();
		const typing = tag === "input" || tag === "textarea" || tag === "select";
		/* Ctrl+Enter / Cmd+Enter triggers generation (Part 5D). Works even
		   when typing, since Ctrl+Enter is not a standard text input combo. */
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			/* Not behind a dialog: the class the dialog is about would be
			   replaced underneath it. */
			if (!$("modal").hidden) return;
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
		/* 1-9 and then 0, because there are ten tabs and there were nine
		   number keys: the Universe tab — the one furthest along a grouped bar
		   and so the most expensive to reach with a mouse — was the only one
		   without a shortcut, while the shortcut sheet advertised "1 – 9".
		   Indexing this way keeps 1-9 exactly where they were. */
		if (k >= "0" && k <= "9") {
			const t = TABS[(Number(k) + 9) % 10];
			if (t && (t[0] !== "compare" || state.pinned)) {
				e.preventDefault();
				showTab(t[0]);
			}
			return;
		}
		if (k === "/") {
			e.preventDefault();
			/* The search box lives on the prospect table, which is now a mode
			   of the Draft board rather than a tab of its own — so "/" takes
			   you there rather than doing nothing on every other page. */
			const box = $("prospectSearch");
			if (box) { box.focus(); box.select(); return; }
			state.tab = "board";
			state.boardMode = "edit";
			persist();
			render();
			requestAnimationFrame(() => {
				const late = $("prospectSearch");
				if (late) { late.focus(); late.select(); }
			});
			return;
		}
		/* The Draft board's two faces. The toggle is one click on the page and
		   one keystroke here, because switching between "who is good" and
		   "let me change this man" is the loop the whole tool is for. */
		if (k === "b") {
			e.preventDefault();
			state.tab = "board";
			state.boardMode = state.boardMode === "edit" ? "board" : "edit";
			if (state.boardMode !== "edit") state.editing = null;
			persist();
			render();
			return;
		}
		if (k === "r" && !$("btnReroll").disabled) { e.preventDefault(); reroll(); return; }
		if (k === "g") {
			e.preventDefault();
			/* state.randomScope, full stop. #randomScope became a chip row
			   (role="radiogroup") when the scopes stopped being a select, and
			   a div has no .value — so the old expression always fell through
			   to the state anyway, correctly and by accident. The button and
			   the shortcut now read the same one thing. */
			randomizeSettings(state.randomScope);
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
		["1 – 9, 0", "Jump to a tab (0 is the tenth)"],
		["b", "Draft board \u2194 Player Edit"],
		["r", "Reroll the class"],
		["g", "Randomize the settings in the chosen scope"],
		["/", "Focus the prospect search (opens Player Edit)"],
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
		["1. Load a class — or a whole league", "Export a draft class from " +
			"Basketball GM (Tools → Export → Draft class) and drop the .json " +
			"here. A whole league export (.json.gz) works too, and is usually " +
			"what you want: it carries the next two or three draft classes " +
			"inside it, and each one loads as its own editable class. Nothing " +
			"is uploaded; everything runs in your browser. You can load " +
			"several files and switch between them."],
		["2. Read the board, edit in Player Edit", "The tool opens on the " +
			"Draft board: the class in board order, which is the question a " +
			"draft class answers. The Player Edit toggle on it (or b) opens " +
			"the full prospect table — filters, columns, locks and the " +
			"editor — on the same class."],
		["3. Reroll until something catches your eye", "Reroll (r) draws a " +
			"new seed: a new class flavor, a new build pool, a new season. " +
			"The seed pill in the header reproduces the exact class — click " +
			"it to copy, shift-click to paste one in. Re-apply keeps the seed " +
			"and re-runs the current settings over it."],
		["4. Shape the class with the settings panel", "Each fieldset is one " +
			"idea. Quality & depth shapes the overall curve (switch to " +
			"“Rebuild class curve” to unlock it). Builds decides how " +
			"specialized players are, how many archetypes one class draws " +
			"from, and its flavor — pick a flavor in the dropdown to keep " +
			"the seed and change what kind of class it is. Class years, " +
			"destinations, the college season, and awards each own their " +
			"corner. Every slider shows what it means in units underneath, " +
			"and what part of the pipeline it re-runs."],
		["5. Or let the dice do it", "The 🎲 Randomize control (g) draws new " +
			"settings in the chosen scope. “Everything, gently” stays near " +
			"the defaults; “everything, wide open” uses each slider's whole " +
			"range; the other scopes randomize one fieldset. It never touches " +
			"the seed (Reroll owns that), the per-build rarity table, or any " +
			"setting you lock with the padlock next to its name. Ctrl+Z puts " +
			"everything back in one step. With more than one file loaded, " +
			"tick “Draw separately for each loaded class” to give every file " +
			"its own independent draw instead of one shared set of settings."],
		["6. Lock what must survive", "Open a prospect and lock his overall, " +
			"build, school or individual ratings — locks survive rerolls, so " +
			"you can keep the player you like while the class around him " +
			"changes. l locks the focused row as-is. The padlocks in the " +
			"settings panel are different: they guard a SETTING against the " +
			"randomizer."],
		["7. Read the season, not just the board", "The class plays a full " +
			"college season: standings, a bracket, awards, game logs, box " +
			"scores, events. A prospect's stat line, his awards and his draft " +
			"stock all come from games that were actually simulated, so the " +
			"Notes tab can defend every claim it makes."],
		["8. Compare, pin, and keep what you like", "Pin (p) keeps the " +
			"current class as a baseline and the Compare tab holds prospects " +
			"side by side. Save preset… names your slider setup; the Link " +
			"button copies a URL that reproduces the exact class, settings " +
			"and locks."],
		["9. Export back to BBGM", "Export JSON writes a draft class file " +
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
