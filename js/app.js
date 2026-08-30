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
		presetName: "default",
		presetDirty: false,
		customPresets: {},
		editing: null,   // player key currently open in the editor
		hiddenColumns: {},
		statMode: "perGame",
		density: "normal",
		redo: [],
		// The two prospects the Compare tab is holding side by side.
		compare: [null, null, null, null],
		// The programme whose page the Teams tab is showing, if any.
		team: null,
		standingsConf: null,
		compactBracket: false,
		theme: "system",
		logPlayer: null,
		pinned: null,
		undo: [],
		lastSeed: null,
	};
	global.App = { state };

	/* ------------------------------------------------------------ persistence */

	/* Nothing survived a refresh: settings, locks and seed history were all
	   lost unless you happened to have copied the link first. The loaded FILE
	   cannot be stored (it is megabytes and it is the user's data), so it is
	   the one thing that has to be dropped in again. */
	/* Bumped whenever the shape of the persisted payload changes. STORE_KEY was
	   versioned and the payload inside it was not, so a future settings change
	   would read stale keys out of an old blob and silently half-apply them. */
	const STORE_VERSION = 2;
	let quotaWarned = false;

	function persist() {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify({
				v: STORE_VERSION,
				cfg: state.cfg,
				overrides: state.overrides,
				overrideFingerprint: state.overrideFingerprint,
				history: state.history.slice(0, 12),
				presetName: state.presetName,
				presetDirty: state.presetDirty,
				customPresets: state.customPresets,
				hiddenColumns: state.hiddenColumns,
				statMode: state.statMode,
				compare: state.compare,
				columnLayouts: state.columnLayouts,
				standingsConf: state.standingsConf,
				density: state.density,
				compactBracket: state.compactBracket,
				theme: state.theme,
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

	function restore() {
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
		if (!saved) return null;
		/* A payload from a different schema is discarded rather than
		   half-applied. Only `theme` is carried across, because it is a
		   preference about the browser rather than about a draft class and
		   losing it is pure annoyance. */
		if (Number(saved.v || 1) !== STORE_VERSION) {
			if (saved.theme) state.theme = saved.theme;
			return null;
		}
		if (saved.cfg) state.cfg = CFG.make(saved.cfg);
		if (saved.overrides) state.overrides = saved.overrides;
		if (saved.overrideFingerprint) state.overrideFingerprint = saved.overrideFingerprint;
		if (Array.isArray(saved.history)) state.history = saved.history;
		if (saved.presetName) state.presetName = saved.presetName;
		state.presetDirty = !!saved.presetDirty;
		if (saved.customPresets) state.customPresets = saved.customPresets;
		if (saved.hiddenColumns) state.hiddenColumns = saved.hiddenColumns;
		if (saved.statMode) state.statMode = saved.statMode;
		if (Array.isArray(saved.compare)) {
			state.compare = saved.compare.slice(0, V.COMPARE_MAX || 4);
		}
		if (saved.columnLayouts && typeof saved.columnLayouts === "object") {
			state.columnLayouts = saved.columnLayouts;
		}
		if (saved.standingsConf) state.standingsConf = saved.standingsConf;
		if (saved.density) state.density = saved.density;
		state.compactBracket = !!saved.compactBracket;
		if (saved.theme) state.theme = saved.theme;
		if (Array.isArray(saved.sort) && saved.sort.length) state.sort = saved.sort;
		if (saved.pinned) state.pinned = indexSnapshot(saved.pinned);
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
		// A restored class is a different class, so an editor open on somebody
		// who may not be in it any more has to close.
		state.editing = null;
		paintUndo();
		paintConfig();
		setStatus(verb + ": " + snap.label);
		run();
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
		"archetypePool", "surpriseBudget", "injuryRate",
		"awardStrictness", "confAwardStrictness", "proAwardStrictness",
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
		freshmanShare: (v) => v + "%",
		transferShare: (v) => v + "%",
		redshirtShare: (v) => v + "%",
		reclassShare: (v) => v + "%",
		injuryRate: (v) => v.toFixed(2) + "x",
		archetypePool: (v) => (v ? v + " builds" : "off"),
		surpriseBudget: (v) => (v ? "about " + v : "none"),
	};

	/* What each slider actually does, in units. "Class quality 2" means nothing
	   on its own; "top prospect ~48 ovr" is a reference point. */
	const SLIDER_HINT = {
		archetypePool: (v) => (v
			? "this class is drawn from about " + v + " of the 72 builds — " +
				"lower is more distinctive, higher is one of everything"
			: "off: every build is eligible in every class"),
		surpriseBudget: (v) => (v
			? "a five-star bust, an unranked riser, a 24-year-old JUCO, a 7'4\" project…"
			: "no forced anomalies"),
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
		archetypeDiversity: (v) => "exactly " + Math.round(100 - v) + "% of the class stays Balanced",
		classFlavor: (v) => v < 0.15 ? "every class has the same archetype mix"
			: v > 1.5 ? "a class is unmistakably one thing"
			: "each class leans guard-heavy, big-heavy, defensive…",
		buildNoise: (v) => "±" + v + " rating points of per-rating jitter",
		freshmanShare: (v) => "≈" + v + "% freshmen; the rest spread over So/Jr/Sr",
		transferShare: (v) => "≈" + v + "% of upperclassmen arrived from another programme",
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
		awardStrictness: (v) => v > 1.2 ? "fewer national honours reach this class"
			: v < 0.9 ? "more national honours reach this class" : "realistic national award volume",
		confAwardStrictness: (v) => v > 1.2 ? "fewer conference honours"
			: v < 0.9 ? "more conference honours" : "realistic conference award volume",
		proAwardStrictness: (v) => v > 1.2 ? "a higher bar for honours abroad"
			: v < 0.9 ? "a lower bar for honours abroad" : "a realistic bar abroad",
	};

	function awardInteractionHint() {
		const fresh = state.cfg.freshmanShare;
		const parts = [
			"These interact with settings elsewhere. " +
			(fresh < 20
				? "With only " + fresh + "% freshmen, the Freshman of the Year and " +
					"All-Freshman categories mostly dry up."
				: fresh > 70
				? "With " + fresh + "% freshmen, almost every honour in the class is " +
					"also a freshman honour."
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
		}
		$("ovrMode").value = state.cfg.ovrMode;
		$("varySize").checked = !!state.cfg.varySize;
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
		paintEra();
		paintPhaseCosts();
		paintPresets();
		paintNoteLines();
		paintArchWeights();
		paintLeagueWeights();
		/* `cardtable` turns the prospect table into one card per prospect below
		   700px (see css/style.css). It is a body class rather than a media
		   query alone so the card layout only applies to the table that has the
		   data-label attributes for it. */
		document.body.className = "density-" + state.density +
			(state.tab === "players" ? " cardtable" : "");
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
		postseason: "March onward (~60 ms)",
		stats: "stats onward (~40 ms)",
		pot: "potential onward (~3 ms)",
		awards: "awards onward (~2 ms)",
		stock: "the draft board (~1 ms)",
		notes: "notes only (~0.6 ms)",
	};
	function phaseCostFor(key) {
		const phases = global.Engine.PHASES;
		for (const ph of phases) {
			if ((ph.deps || []).indexOf(key) !== -1) return PHASE_COST[ph.name] || ph.name;
		}
		return null;
	}
	function paintPhaseCosts() {
		for (const key of SLIDERS.concat(["era", "ovrMode", "varySize"])) {
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
			tag.textContent = "re-runs: " + cost;
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
	   summarised rather than dumped. */
	function presetDiff() {
		const preset = CFG.PRESETS[state.presetName] || state.customPresets[state.presetName];
		if (!preset) return [];
		return diffConfigs(CFG.make(preset), state.cfg);
	}

	/* The settings two configurations differ on, as "name: was → is".
	   Object-valued settings (the archetype and destination weight tables) are
	   summarised rather than dumped. */
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
	function paintArchWeights() {
		const aw = $("archWeights");
		if (!aw) return;
		// Realised frequency from the last run, beside the weight that asked
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
		$("era").addEventListener("change", () => {
			pushUndo("changed the era");
			state.cfg.era = $("era").value;
			markDirty();
			paintConfig();
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
			pushUndo("reset every setting to the defaults");
			state.cfg = CFG.make();
			state.presetName = "default";
			state.presetDirty = false;
			paintConfig();
			run();
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
		$("btnArchReset").addEventListener("click", () => {
			pushUndo("reset the archetype weights");
			state.cfg.archetypeWeights = null;
			markDirty();
			paintArchWeights();
			run();
		});

		// Destination weights, one row per non-NCAA league.
		const lw = $("leagueWeights");
		for (const name of Object.keys(C.NON_NCAA)) {
			if (name === "DII NCAA") continue;
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
			inp.addEventListener("change", () => {
				pushUndo("changed destination weights");
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
			});
			row.appendChild(inp);
			lw.appendChild(row);
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

	function summarise(data) {
		const players = data.players || [];
		const blank = players.filter((p) => !p.college || !String(p.college).trim()).length;
		return players.length + " players, season " + (data.startingSeason || "?") +
			", " + Math.round((100 * blank) / Math.max(1, players.length)) + "% blank colleges";
	}

	function readFiles(fileList) {
		const problems = [];
		// A five-file drop used to just sit there with nothing on screen.
		$("empty").classList.add("busy");
		setStatus("Reading " + fileList.length + " file" +
			(fileList.length === 1 ? "" : "s") + "…", true);
		const jobs = Array.from(fileList).map(
			(f) => new Promise((resolve) => {
				const r = new FileReader();
				r.onerror = () => {
					problems.push(f.name + ": could not be read from disk");
					resolve(null);
				};
				r.onload = () => {
					try {
						const text = String(r.result).replace(/^\ufeff/, "");
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
						resolve({ name: f.name, data, warnings: check.warnings });
					} catch (e) {
						problems.push(f.name + ": " + e.message);
						resolve(null);
					}
				};
				r.readAsText(f);
			}),
		);
		Promise.all(jobs).then((loaded) => {
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
				(f) => f.name + ": " + summarise(f.data)).join("  ·  ");
			$("fileSummary").hidden = false;
			for (const id of ["btnReroll", "btnRerun", "btnExport", "btnExportMenu",
				"btnExportAll", "btnPin"]) $(id).disabled = false;
			checkLockFingerprint();
			const warns = state.files.flatMap((f) => (f.warnings || [])
				.map((w) => f.name + ": " + w));
			if (warns.length) showWarning(warns.join("\n"));
			setStatus("");
			run();
		});
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
		}
	}

	function bindFiles() {
		$("btnLoad").addEventListener("click", () => $("file").click());
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
		return cfg;
	}

	function ensureResult(i) {
		if (state.results[i]) return state.results[i];
		const runner = state.runners[i];
		if (!runner) return null;
		// Every file in a batch shares the seed, so they stay one set.
		state.results[i] = runner.run(effectiveCfg());
		return state.results[i];
	}

	/* The engine is staged: a runner only redoes the phases whose settings
	   changed. Moving the note template or an award dial used to re-simulate
	   368 programs, 11,000 games and every stat line in the country — about
	   200ms of blocking work every 140ms while a slider was moving. */
	function run() {
		if (!state.files.length) return;
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
		$("seedPill").hidden = false;
		/* A short hash OF THE CLASS, not of the seed. Two people can share a
		   seed and still be looking at different classes — a different source
		   file, a lock one of them set, a version of the tool with a different
		   model in it — and had no way to notice. Matching fingerprints mean
		   the same seventy players. */
		$("seedPill").textContent = "seed " + res.seed + " · " + classFingerprint(res);
		$("seedPill").dataset.seed = res.seed;
		$("seedPill").title = "Seed and class fingerprint — two people with the same " +
			"fingerprint are looking at the same seventy players. " +
			"Click to copy the seed, shift-click or right-click to paste one · " + Math.round(ms) + "ms (" +
			(res.phasesRun.length ? res.phasesRun.join(" → ") : "nothing to redo") + ")";
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

	function paintHistory() {
		const sel = $("seedHistory");
		sel.innerHTML = "";
		sel.appendChild(new Option("recent seeds…", ""));
		for (const s of state.history) sel.appendChild(new Option(s, s));
		sel.hidden = state.history.length < 2;
	}

	function reroll() {
		const previous = state.lastSeed;
		pushUndo("rerolled the class");
		state.cfg.seed = "";
		// Reroll is the only thing that changes a blank seed; everything else
		// keeps the class you are looking at.
		state.lastSeed = null;
		$("seed").value = "";
		// A reroll replaces every player, so an open editor showing the old one
		// is a stale panel over a class that no longer contains him.
		state.editing = null;
		state.selected = {};
		run();
		const res = state.results[state.active];
		if (!res) {
			state.lastSeed = previous || null;
			return;
		}
		// The reroll's seed becomes the pinned one; the box stays blank so the
		// next reroll draws again.
		state.lastSeed = res.seed;
	}

	/* ---------------------------------------------------------------- views */

	const TABS = [
		["players", "Prospects"],
		["board", "Draft board"],
		["teams", "AP Poll & Teams"],
		["bracket", "March Madness"],
		["awards", "Awards & leaders"],
		["gamelog", "Game logs"],
		["distribution", "Distributions"],
		["notes", "Player notes"],
		["compare", "Compare"],
	];

	function render() {
		const tabs = $("tabs");
		tabs.innerHTML = "";
		tabs.setAttribute("role", "tablist");
		TABS.forEach(([key, label], i) => {
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
				? "Class flavour: " + res.flavor.label + " (archetype weights are tilted this year)"
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
				? "Opponents faced: rim defence " + (team.oppDefense.rim >= 0 ? "+" : "") +
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
	   offence, then the pace of the team he plays for, then the defences he
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
		row("Share of the offence", (s.usg * 100).toFixed(1) + "% of his team's " +
			"chances while on the floor (" + (s.usgShare * 100).toFixed(1) +
			"% of all of them)");
		if (t) {
			row("Team tempo", n1(t.pace) + " possessions a game" +
				(t.style ? " — " + t.style.name : ""));
			row("Programme", t.name + ", level " + Math.round(t.level) +
				", " + t.w + "-" + t.l +
				(t.coach ? " under " + t.coach.name + " (year " + t.coach.tenure + ")" : ""));
			if (t.oppDefense) {
				const d = t.oppDefense;
				const say = (v) => (v > 0.01 ? "tougher" : v < -0.01 ? "softer" : "average");
				row("Defences faced", "at the rim " + say(d.rim) +
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

	/* The seasons before this one. Fabricated, and labelled as such — but "he
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
		for (const h of ["Season", "Team", "GP", "MPG", "PPG", "RPG", "APG", "TS%"]) {
			head.appendChild(el("th", null, h));
		}
		table.appendChild(head);
		const line = (season, team, r, now) => {
			const tr = el("tr", now ? "now" : "");
			tr.appendChild(el("td", null, String(season)));
			tr.appendChild(el("td", null, team));
			if (r.redshirt) {
				const td = el("td", null, r.reason || "redshirt");
				td.colSpan = 6;
				tr.appendChild(td);
				return tr;
			}
			tr.appendChild(el("td", "num", String(Math.round(r.gp))));
			for (const k of ["mpg", "ppg", "rpg", "apg"]) {
				tr.appendChild(el("td", "num", r[k].toFixed(1)));
			}
			tr.appendChild(el("td", "num", (r.ts * 100).toFixed(1)));
			return tr;
		};
		for (const r of rows) table.appendChild(line(r.season, r.team, r, false));
		if (p.stats) {
			table.appendChild(line(res.season, p.proClub || p.newCollege, p.stats, true));
		}
		box.appendChild(table);
		if (rows.length) {
			box.appendChild(el("p", "hint",
				"Earlier seasons are reconstructed by the model, not simulated — " +
				"the same way the recruiting ranking and the transfer history are. " +
				"Nothing in the tool ranks on them."));
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
		setStatus("Locked " + (nameOf[what] || what) + " on " + keys.length +
			" prospect" + (keys.length === 1 ? "" : "s") +
			" — a reroll now leaves them alone.");
		run();
	}

	function bulkClear() {
		const keys = bulkTargets();
		if (!keys.length) return;
		pushUndo("cleared locks on " + keys.length + " prospects");
		for (const key of keys) delete state.overrides[key];
		run();
	}

	/* -------------------------------------------------------------- modal */

	let modalOk = null;
	function modal(title, body, onOk, okLabel) {
		$("modalTitle").textContent = title;
		const b = $("modalBody");
		b.innerHTML = "";
		b.appendChild(body);
		$("modalOk").textContent = okLabel || "OK";
		modalOk = onOk;
		$("modal").hidden = false;
	}
	function closeModal() { $("modal").hidden = true; modalOk = null; }

	/* ------------------------------------------------------------- clipboard */

	function copyText(text, button, restore) {
		const done = () => {
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

	function setStatus(text, sticky) {
		const s = $("status");
		s.textContent = text;
		s.hidden = !text;
		if (text) remember(text);
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

	function exportOne(i) {
		const res = ensureResult(i);
		if (!res) return false;
		try {
			const out = global.Engine.exportFile(res);
			const base = state.files[i].name.replace(/\.json$/i, "");
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
	   ship. A leading apostrophe is the standard neutraliser and is invisible
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
				(p.awards || []).join("; "),
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
			lines.push(["award", a.name, a.school, a.awards.join("; "), "", ""].map(esc).join(","));
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
		run();
		setStatus("Applied " + plan.applied.length + " lock" +
			(plan.applied.length === 1 ? "" : "s") +
			(plan.unmatched.length
				? "; " + plan.unmatched.length + " row(s) matched nobody." : "."));
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

	function exportAll() {
		let i = 0;
		const step = () => {
			if (i >= state.files.length) {
				setStatus("All " + state.files.length + " files exported.");
				$("btnExportAll").textContent = "Export all";
				return;
			}
			const ok = exportOne(i);
			i++;
			if (!ok) return;
			if (i < state.files.length) {
				$("btnExportAll").textContent = "Export next (" + i + "/" + state.files.length + ")";
				setStatus("Exported " + i + " of " + state.files.length +
					". Your browser blocks bulk downloads without a click — " +
					"press the button again for the next file.", true);
				$("btnExportAll").onclick = step;
			} else step();
		};
		step();
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
		item("Prospect table as CSV (the current filter)", () => exportCsv(res));
		item("Prospect table as CSV (whole class)", () => exportCsv(res, true));
		item("Season as JSON — records, bracket, awards, board", () => exportSeasonJson(res));
		item("Season as CSV", () => exportSeasonCsv(res));
		item("Note text only, for a spreadsheet", () => exportNotes(res));
		item("Notes as Markdown, for a forum post", () => exportNotesMarkdown(res));
		item("Import locks from a CSV…", () => $("csvFile").click());
		item("Message history", messageHistory);
		item("Compare two presets…", comparePresets);
		box.appendChild(list);
		modal("Export and import", box, null, "Close");
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

	function batchDone(rows) {
		$("batchProgress").hidden = true;
		$("btnBatch").disabled = false;
		$("btnBatchCancel").hidden = true;
		batchWorker = null;
		if (!rows || !rows.length) { setStatus("Batch cancelled."); return; }
		renderBatch(rows);
		setStatus("");
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
		const d = (k) => (k === "awards" || k === "honoured" || k === "archetypes" ? 1 : 2);
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
			line("honoured players", "honoured"),
			line("distinct archetypes", "archetypes"),
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
		const flavours = {};
		for (const r of rows) flavours[r.flavor || "—"] = (flavours[r.flavor || "—"] || 0) + 1;
		const fBox = el("div", "card");
		fBox.appendChild(el("h4", null, "Class flavours drawn"));
		fBox.appendChild(el("div", "note", Object.keys(flavours)
			.sort((a, b) => flavours[b] - flavours[a])
			.map((k) => String(flavours[k]).padStart(3) + "  " + k).join("\n")));
		cards.appendChild(fBox);
		view.appendChild(cards);
	}

	function runBatch(n) {
		const file = activeFile();
		if (!file) return;
		batchCancel = false;
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
		   the UI between each one and can be cancelled the same way. */
		try {
			batchWorker = new Worker("js/worker.js");
			batchWorker.onmessage = (e) => {
				const m = e.data;
				if (m.type === "progress") batchProgress(m.done, m.total);
				else if (m.type === "done") batchDone(m.rows);
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
				rows.push(global.BatchStats.summarise(runner.run(c)));
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
	   only means something next to "because I moved pace and specialisation". */
	const BATCH_ROWS = [
		["mean ovr", "ovr", 2], ["mean pot", "pot", 2], ["mean MPG", "mpg", 2],
		["mean PPG", "ppg", 2], ["mean RPG", "rpg", 2], ["mean APG", "apg", 2],
		["mean USG%", "usg", 2], ["mean TS%", "ts", 2],
		["team PPG", "teamPpg", 2], ["team AST", "teamAst", 2],
		["scoring leader", "topPpg", 2], ["assist leader", "topApg", 2],
		["block leader", "topBpg", 2], ["awards/class", "awards", 1],
		["honoured players", "honoured", 1], ["distinct archetypes", "archetypes", 1],
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
		$("btnTheme").textContent = state.theme === "dark" ? "☾"
			: state.theme === "light" ? "☀" : "◐";
		$("btnTheme").title = "Theme: " + state.theme + " (click to change)";
	}

	/* ----------------------------------------------------------------- init */

	function syncHeaderHeight() {
		const h = document.querySelector("header");
		if (h) {
			document.documentElement.style.setProperty("--headerH", h.offsetHeight + "px");
		}
	}

	Object.assign(global.App, {
		state, render, run, persist, openEditor, editorPanel, modal, closeModal,
		clearLock,
		copyText, bulkApply, bulkShiftOvr, bulkLockAsIs, bulkClear, refreshBulkBar,
		snapshot,
		exportCsv, setStatus, showError, indexSnapshot,
	});

	const saved = restore();
	const fromHash = readHash();
	if (fromHash) state.overrideFingerprint = state.overrideFingerprint || null;
	window.addEventListener("resize", syncHeaderHeight);
	syncHeaderHeight();

	bindConfig();
	bindFiles();
	applyTheme();
	paintConfig();
	paintHistory();
	paintUndo();
	if (saved) applyOpenGroups(saved.open);

	$("errClose").addEventListener("click", clearError);
	$("warnClose").addEventListener("click", () => { $("warnBanner").hidden = true; });
	/* The settings panel is a toggle on a narrow screen. It starts CLOSED
	   there — a phone user's first act is to look at the class, not at the
	   sliders — and the button reflects the real state either way. */
	(function bindSettingsToggle() {
		const btn = $("btnSettings");
		if (!btn) return;
		const narrow = () => window.matchMedia("(max-width: 860px)").matches;
		const paint = () => {
			const open = !narrow() || document.body.classList.contains("settings-open");
			btn.setAttribute("aria-expanded", open ? "true" : "false");
			btn.textContent = open ? "Hide settings" : "Settings";
		};
		btn.addEventListener("click", () => {
			document.body.classList.toggle("settings-open");
			paint();
		});
		window.addEventListener("resize", paint);
		paint();
	})();

	$("btnReroll").addEventListener("click", reroll);
	$("btnRerun").addEventListener("click", run);
	$("btnUndo").addEventListener("click", undo);
	$("btnExport").addEventListener("click", () => {
		if (exportOne(state.active)) setStatus("Exported " + state.files[state.active].name + ".");
	});
	$("btnExportMenu").addEventListener("click", exportMenu);
	$("btnExportAll").addEventListener("click", exportAll);
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
	$("btnTheme").addEventListener("click", () => {
		state.theme = state.theme === "system" ? "dark" : state.theme === "dark" ? "light" : "system";
		applyTheme();
		persist();
	});
	$("seedHistory").addEventListener("change", (e) => {
		if (!e.target.value) return;
		state.cfg.seed = e.target.value;
		$("seed").value = e.target.value;
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
	$("modalOk").addEventListener("click", () => {
		const fn = modalOk;
		closeModal();
		if (fn) fn();
	});
	$("modalCancel").addEventListener("click", closeModal);
	$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !$("modal").hidden) closeModal();
		const tag = (e.target.tagName || "").toLowerCase();
		const typing = tag === "input" || tag === "textarea" || tag === "select";
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
		if (k === "e" && !$("btnExport").disabled) {
			e.preventDefault();
			if (exportOne(state.active)) {
				setStatus("Exported " + state.files[state.active].name + ".");
			}
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
		if (state.overrides[key]) {
			pushUndo("cleared the lock on " + p.name);
			delete state.overrides[key];
			setStatus("Unlocked " + p.name + ".");
		} else {
			pushUndo("locked " + p.name);
			state.overrides[key] = {
				ovr: p.newOvr, archetype: p.archetype, college: p.newCollege,
			};
			setStatus("Locked " + p.name + " at ovr " + p.newOvr + ", " +
				p.archetype + ", " + p.newCollege + ".");
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		run();
	}

	const SHORTCUTS = [
		["?", "Show this list"],
		["1 – 9", "Jump to a tab"],
		["r", "Reroll the class"],
		["/", "Focus the prospect search"],
		["l", "Lock or unlock the focused row"],
		["[ / ]", "Previous / next archetype filter"],
		["p", "Pin this class as the comparison baseline"],
		["e", "Export the active file"],
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
})(window);
