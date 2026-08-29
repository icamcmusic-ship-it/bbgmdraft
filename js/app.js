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
		filter: { q: "", pos: "", conf: "", changedOnly: false, lockedOnly: false },
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
	function persist() {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify({
				cfg: state.cfg,
				overrides: state.overrides,
				overrideFingerprint: state.overrideFingerprint,
				history: state.history.slice(0, 12),
				presetName: state.presetName,
				presetDirty: state.presetDirty,
				customPresets: state.customPresets,
				hiddenColumns: state.hiddenColumns,
				statMode: state.statMode,
				density: state.density,
				compactBracket: state.compactBracket,
				theme: state.theme,
				sort: state.sort,
				tab: state.tab,
				// Small (a name and six numbers per prospect) and the whole
				// point of pinning is that it outlives the class you pinned.
				pinned: state.pinned,
				open: openGroups(),
			}));
		} catch (e) { /* private browsing, quota, or no storage at all */ }
	}

	function restore() {
		let saved = null;
		try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { saved = null; }
		if (!saved) return null;
		if (saved.cfg) state.cfg = CFG.make(saved.cfg);
		if (saved.overrides) state.overrides = saved.overrides;
		if (saved.overrideFingerprint) state.overrideFingerprint = saved.overrideFingerprint;
		if (Array.isArray(saved.history)) state.history = saved.history;
		if (saved.presetName) state.presetName = saved.presetName;
		state.presetDirty = !!saved.presetDirty;
		if (saved.customPresets) state.customPresets = saved.customPresets;
		if (saved.hiddenColumns) state.hiddenColumns = saved.hiddenColumns;
		if (saved.statMode) state.statMode = saved.statMode;
		if (saved.density) state.density = saved.density;
		state.compactBracket = !!saved.compactBracket;
		if (saved.theme) state.theme = saved.theme;
		if (Array.isArray(saved.sort) && saved.sort.length) state.sort = saved.sort;
		if (saved.pinned) state.pinned = saved.pinned;
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
	function pushUndo(label) {
		state.undo.push({
			label,
			cfg: JSON.parse(JSON.stringify(state.cfg)),
			overrides: JSON.parse(JSON.stringify(state.overrides)),
		});
		if (state.undo.length > 40) state.undo.shift();
		paintUndo();
	}

	function undo() {
		const prev = state.undo.pop();
		if (!prev) return;
		state.cfg = CFG.make(prev.cfg);
		state.overrides = prev.overrides;
		paintUndo();
		paintConfig();
		setStatus("Undid: " + prev.label);
		run();
	}

	function paintUndo() {
		const b = $("btnUndo");
		b.disabled = !state.undo.length;
		b.title = state.undo.length
			? "Undo: " + state.undo[state.undo.length - 1].label + " (Ctrl+Z)"
			: "Nothing to undo";
	}

	/* ---------------------------------------------------------------- config */

	const SLIDERS = [
		"classQuality", "classDepth", "eliteCount", "potBias", "potSpread",
		"specialization", "archetypeDiversity", "classFlavor", "buildNoise",
		"freshmanShare", "transferShare", "redshirtShare", "reclassShare", "pDII",
		"pace", "scoringEnv", "statNoise", "upsetFactor",
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
	};

	/* What each slider actually does, in units. "Class quality 2" means nothing
	   on its own; "top prospect ~48 ovr" is a reference point. */
	const SLIDER_HINT = {
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
		// Measured, not asserted: the whole simulated field runs ORtg ~102.5,
		// so points per game land near pace x 1.025, not pace x 1.05.
		pace: (v) => "≈" + Math.round(v * 1.025) + " team points per game (Division I only)",
		scoringEnv: (v) => (v >= 0 ? "+" : "") + (v * 1.6).toFixed(1) + " possessions per 40",
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
		paintPresets();
		paintNoteLines();
		paintArchWeights();
		paintLeagueWeights();
		document.body.className = "density-" + state.density;
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
		const custom = state.cfg.archetypeWeights;
		for (const i of aw.querySelectorAll("input")) {
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

		// Archetype rarity weights, editable per build.
		const aw = $("archWeights");
		for (const a of RB.ARCHETYPES) {
			const row = el("div", "archrow");
			const name = el("span", "archname", a.name);
			name.title = archetypeTooltip(a);
			row.appendChild(name);
			const inp = el("input");
			inp.type = "number";
			inp.step = "0.05";
			inp.min = "0";
			inp.max = "8";
			inp.dataset.arch = a.name;
			inp.value = a.w === undefined ? 1 : a.w;
			inp.title = archetypeTooltip(a);
			inp.setAttribute("aria-label", "Rarity weight for " + a.name);
			inp.addEventListener("change", () => {
				pushUndo("changed archetype weights");
				const w = {};
				for (const i of aw.querySelectorAll("input")) w[i.dataset.arch] = Number(i.value);
				state.cfg.archetypeWeights = w;
				markDirty();
				scheduleRun();
			});
			row.appendChild(inp);
			aw.appendChild(row);
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

	function writeHash() {
		try {
			const payload = encodeConfig();
			const s = Object.keys(payload).length
				? "#c=" + encodeURIComponent(JSON.stringify(payload))
				: "#";
			history.replaceState(null, "", s);
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

	function showError(err) {
		const b = $("errBanner");
		b.hidden = false;
		b.textContent = (err && err.message ? err.message : String(err)) +
			"\n(Click to dismiss.)";
	}
	function clearError() { $("errBanner").hidden = true; }
	function showWarning(text) {
		const b = $("warnBanner");
		b.hidden = false;
		b.textContent = text + "\n(Click to dismiss.)";
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
	   353 programs, 11,000 games and every stat line in the country — about
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
		$("seedPill").textContent = "seed " + res.seed;
		$("seedPill").dataset.seed = res.seed;
		$("seedPill").title = "Click to copy · " + Math.round(ms) + "ms (" +
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
		view.innerHTML = "";
		const res = ensureResult(state.active);
		if (!res) return;
		(V[state.tab] || V.players)(view, res);
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
		} else if (p.ovrRange) {
			panel.appendChild(el("p", "hint",
				"This build can be solved to any overall from " + p.ovrRange.min +
				" to " + p.ovrRange.max + "."));
		}

		const grid = el("div", "editgrid");
		const controls = {};
		/* Every lock is opt-in. "Apply lock" used to write BOTH ovr and pot
		   unconditionally, so there was no way to lock only the archetype or
		   only the school without also freezing two numbers you did not mean
		   to touch. */
		const field = (key, label, node, current) => {
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
			w.appendChild(row);
			w.appendChild(node);
			grid.appendChild(w);
			node.addEventListener("input", () => { cb.checked = true; });
			node.addEventListener("change", () => { cb.checked = true; });
			controls[key] = { cb, node, current };
			return node;
		};

		const ovrIn = el("input");
		ovrIn.type = "number";
		ovrIn.min = 0;
		ovrIn.max = 100;
		ovrIn.value = Number.isFinite(ov.ovr) ? ov.ovr : p.newOvr;
		field("ovr", "Overall", ovrIn);

		const potIn = el("input");
		potIn.type = "number";
		potIn.min = 0;
		potIn.max = 100;
		potIn.value = Number.isFinite(ov.pot) ? ov.pot : p.newPot;
		field("pot", "Potential", potIn);

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
		field("archetype", "Archetype", archSel);

		const colSel = el("select");
		colSel.appendChild(new Option("(roll it)", ""));
		for (const name of C.names.concat(Object.keys(C.NON_NCAA)).sort()) {
			colSel.appendChild(new Option(name, name));
		}
		colSel.value = ov.college || "";
		field("college", "School / league", colSel);

		const nameIn = el("input");
		nameIn.type = "text";
		nameIn.value = ov.name || p.name;
		field("name", "Name", nameIn);

		const hgtIn = el("input");
		hgtIn.type = "number";
		hgtIn.min = 58;
		hgtIn.max = 96;
		hgtIn.value = Number.isFinite(ov.hgtInches) ? ov.hgtInches : p.newHgtInches;
		field("hgtInches", "Listed height (inches)", hgtIn);
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
			if (!Object.keys(next).length) delete state.overrides[p.key];
			else state.overrides[p.key] = next;
			state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
			run();
		});
		buttons.appendChild(apply);
		const clear = el("button", null, "Clear lock");
		clear.addEventListener("click", () => {
			pushUndo("cleared the lock on " + p.name);
			delete state.overrides[p.key];
			run();
		});
		buttons.appendChild(clear);
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
		return panel;
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

	function setStatus(text, sticky) {
		const s = $("status");
		s.textContent = text;
		s.hidden = !text;
		if (!sticky) setTimeout(() => { if (s.textContent === text) s.hidden = true; }, 3500);
	}

	function download(name, text, type) {
		const blob = new Blob([text], { type: type || "text/plain" });
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
		"conf", "board", "preseason", "move", "gp", "mpg", "ppg", "rpg", "orpg", "drpg",
		"apg", "spg", "bpg", "topg", "pfpg", "cspg", "deflpg", "chgpg", "drtg",
		"usg", "fgp", "tpp", "ftp", "ts", "awards"];

	function esc(v) {
		const s = v === undefined || v === null ? "" : String(v);
		return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	}

	function exportCsv(res) {
		const lines = [CSV_COLS.join(",")];
		for (const p of res.players) {
			if (!V.matchesFilter(p, res)) continue;
			const s = p.stats || {};
			const t = res.teams[p.newCollege];
			lines.push([
				p.key, p.name, p.newPos, p.classYear, p.newOvr, p.newPot, p.archetype,
				p.proClub || p.newCollege, t ? t.conf : p.newCollege,
				p.boardRank, p.preseasonRank, p.stockMove,
				s.gp, s.mpg, s.ppg, s.rpg, s.orpg, s.drpg, s.apg, s.spg, s.bpg,
				s.topg, s.pfpg, s.cspg, s.deflpg, s.chgpg, s.drtg,
				s.usg, s.fgp, s.tpp, s.ftp, s.ts,
				(p.awards || []).join("; "),
			].map((v) => esc(typeof v === "number" ? Number(v.toFixed(3)) : v)).join(","));
		}
		download("prospects.csv", lines.join("\n"), "text/csv");
		setStatus("CSV exported.");
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
		download("season_" + res.seed + ".csv", lines.join("\n"), "text/csv");
		setStatus("Season CSV exported.");
	}

	function exportNotes(res) {
		const lines = ["name\tnote"];
		for (const p of res.players.slice().sort((a, b) => b.newOvr - a.newOvr)) {
			lines.push(p.name + "\t" + (p.note || "").replace(/\n/g, " · "));
		}
		download("notes.tsv", lines.join("\n"), "text/tab-separated-values");
		setStatus("Notes exported.");
	}

	/* Re-apply locks in bulk from a CSV. The natural workflow — export the
	   table, edit ovr/archetype/college in a spreadsheet, bring it back — had
	   no return path at all. */
	function importLocksCsv(text) {
		const rows = parseCsv(text);
		if (!rows.length) { showError(new Error("That CSV has no rows.")); return; }
		const head = rows[0].map((h) => h.trim().toLowerCase());
		const idx = (name) => head.indexOf(name);
		const res = state.results[state.active];
		if (!res) return;
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
			return;
		}
		let applied = 0;
		const unmatched = [];
		pushUndo("imported locks from a CSV");
		for (let i = 1; i < rows.length; i++) {
			const r = rows[i];
			if (!r.length || r.every((c) => !c.trim())) continue;
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
			state.overrides[p.key] = Object.assign({}, state.overrides[p.key] || {}, patch);
			applied++;
		}
		state.overrideFingerprint = (activeFile() || {}).fingerprint || null;
		run();
		setStatus("Applied " + applied + " lock" + (applied === 1 ? "" : "s") +
			(unmatched.length ? "; " + unmatched.length + " row(s) matched nobody." : "."));
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
		item("Prospect table as CSV (respects the current filter)", () => exportCsv(res));
		item("Season as JSON — records, bracket, awards, board", () => exportSeasonJson(res));
		item("Season as CSV", () => exportSeasonCsv(res));
		item("Note text only, for a spreadsheet", () => exportNotes(res));
		item("Import locks from a CSV…", () => $("csvFile").click());
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
				ppg: p.stats ? p.stats.ppg : 0, board: p.boardRank || 0,
			})),
		};
	}

	/* ----------------------------------------------------------- batch mode */

	let batchCancel = false;
	let batchWorker = null;

	function batchProgress(done, total) {
		$("batchProgress").hidden = false;
		$("batchBar").style.width = Math.round((100 * done) / total) + "%";
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

	function renderBatch(rows) {
		const B = global.BatchStats;
		const view = $("view");
		view.innerHTML = "";
		view.appendChild(el("h3", null, rows.length + " classes with these settings"));
		const col = (k) => rows.map((r) => r[k]);
		const line = (label, k, digits) =>
			label.padEnd(18) + B.mean(col(k)).toFixed(digits === undefined ? 2 : digits);
		view.appendChild(el("div", "note", [
			line("mean ovr", "ovr"),
			line("mean pot", "pot"),
			line("mean MPG", "mpg"),
			line("mean PPG", "ppg"),
			line("mean APG", "apg"),
			line("mean USG%", "usg"),
			line("mean TS%", "ts"),
			line("team PPG", "teamPpg"),
			line("team AST", "teamAst"),
			line("scoring leader", "topPpg"),
			line("assist leader", "topApg"),
			line("block leader", "topBpg"),
			line("awards/class", "awards", 1),
			line("honoured players", "honoured", 1),
			line("distinct archetypes", "archetypes", 1),
			"",
			"seeds: " + rows.map((r) => r.seed).join(", "),
		].join("\n")));
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
			batchWorker.postMessage({ type: "batch", leagueFile: file.data, cfg, n });
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
			c.seed = "";
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
		copyText, bulkApply, bulkShiftOvr, bulkClear, refreshBulkBar, snapshot,
		exportCsv, setStatus, showError,
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

	$("errBanner").addEventListener("click", clearError);
	$("warnBanner").addEventListener("click", () => { $("warnBanner").hidden = true; });
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
		state.pinned = snapshot(res);
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
	$("btnCopyLink").addEventListener("click", () => {
		writeHash();
		copyText(location.href, $("btnCopyLink"), "Link");
	});
	$("btnBatch").addEventListener("click", () => {
		if (!state.files.length) return;
		runBatch(Math.max(2, Math.min(200, Number($("batchN").value) || 10)));
	});
	$("btnBatchCancel").addEventListener("click", cancelBatch);
	$("modalOk").addEventListener("click", () => {
		const fn = modalOk;
		closeModal();
		if (fn) fn();
	});
	$("modalCancel").addEventListener("click", closeModal);
	$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !$("modal").hidden) closeModal();
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
			const tag = (e.target.tagName || "").toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select") return;
			e.preventDefault();
			undo();
		}
	});
})(window);
