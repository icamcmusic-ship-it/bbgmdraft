/* UI: file loading, config binding, the result views, per-player edits, and
   export. */
(function () {
	"use strict";

	const CFG = window.Config;
	const C = window.Colleges;
	const RB = window.RatingsBuilder;
	const BB = window.BBGM;
	const $ = (id) => document.getElementById(id);
	const el = (tag, cls, text) => {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	};

	const state = {
		cfg: CFG.make(),
		files: [],       // [{name, data}]
		results: [],     // parallel to files; entries may be null until needed
		active: 0,
		tab: "players",
		sort: { key: "newOvr", dir: -1 },
		filter: { q: "", pos: "", conf: "", changedOnly: false, lockedOnly: false },
		overrides: {},   // pid -> {ovr, pot, archetype, college}
		history: [],     // recent seeds, newest first
		presetName: "default",
		presetDirty: false,
		editing: null,   // pid currently open in the editor
	};

	/* ---------------------------------------------------------------- config */

	const SLIDERS = [
		"classQuality", "classDepth", "eliteCount", "potBias", "potSpread",
		"specialization", "archetypeDiversity", "buildNoise", "freshmanShare",
		"wEuroLeague", "wGLeague", "wNBL", "pDII",
		"pace", "scoringEnv", "statNoise", "upsetFactor", "awardStrictness",
	];

	const FORMAT = {
		pDII: (v) => (v * 100).toFixed(1) + "%",
		specialization: (v) => v.toFixed(2) + "x",
		statNoise: (v) => v.toFixed(2) + "x",
		upsetFactor: (v) => v.toFixed(2) + "x",
		awardStrictness: (v) => v.toFixed(2) + "x",
		archetypeDiversity: (v) => v + "%",
		freshmanShare: (v) => v + "%",
	};

	/* What each slider actually does, in units. "Class quality 2" means nothing
	   on its own; "top prospect ~48 ovr" is a reference point. */
	const SLIDER_HINT = {
		classQuality: (v) => "top prospect ≈ " + Math.round(43 + v * 2.6) +
			" ovr, back of the class ≈ " + Math.round(18 + v * 2.0),
		classDepth: (v) => (v < 0 ? "top-heavy: stars, then a cliff"
			: v > 0 ? "deep: fewer stars, more rotation players" : "an even curve"),
		eliteCount: (v) => v === 0 ? "no genuine stars" : v + " prospect(s) get a star ceiling",
		potBias: (v) => "ovr→pot gap shifted " + (v >= 0 ? "+" : "") + (v * 2.2).toFixed(1) + " points",
		potSpread: (v) => "gap sd " + v + " points (higher = more boom/bust)",
		specialization: (v) => v < 0.4 ? "BBGM's samey builds"
			: v > 1.6 ? "extreme specialists" : "clear roles, real weaknesses",
		archetypeDiversity: (v) => Math.round(100 - v) + "% of the class stays Balanced-ish",
		buildNoise: (v) => "±" + v + " rating points of per-rating jitter",
		freshmanShare: (v) => "≈" + v + "% freshmen; the rest spread over So/Jr/Sr",
		pace: (v) => "≈" + Math.round(v * 1.05) + " team points per game",
		scoringEnv: (v) => (v >= 0 ? "+" : "") + (v * 1.6).toFixed(1) + " possessions per 40",
		statNoise: (v) => v < 0.3 ? "stat lines follow ratings exactly" : "season-to-season luck",
		upsetFactor: (v) => v < 0.6 ? "chalk: seeds mostly hold" : v > 1.4 ? "madness" : "a normal March",
		awardStrictness: (v) => v > 1.2 ? "fewer honours reach this class"
			: v < 0.9 ? "more honours reach this class" : "realistic award volume",
	};

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
		const preset = $("preset");
		if (preset) {
			const opt = preset.querySelector('option[value="' + state.presetName + '"]');
			if (opt) {
				const base = state.presetName === "default" ? "— presets —" : state.presetName;
				opt.textContent = base + (state.presetDirty ? " (modified)" : "");
			}
			preset.value = state.presetName;
		}
		paintNoteLines();
		const aw = $("archWeights");
		if (aw && state.cfg.archetypeWeights) {
			for (const i of aw.querySelectorAll("input")) {
				const v = state.cfg.archetypeWeights[i.dataset.arch];
				if (Number.isFinite(v)) i.value = v;
			}
		}
	}

	function markDirty() {
		state.presetDirty = true;
	}

	function bindConfig() {
		for (const key of SLIDERS) {
			const input = $(key);
			if (!input) continue;
			input.addEventListener("input", () => {
				state.cfg[key] = Number(input.value);
				markDirty();
				paintConfig();
				scheduleRun();
			});
		}
		$("ovrMode").addEventListener("change", () => {
			state.cfg.ovrMode = $("ovrMode").value;
			markDirty();
			paintConfig();
			scheduleRun();
		});
		$("varySize").addEventListener("change", () => {
			state.cfg.varySize = $("varySize").checked;
			markDirty();
			scheduleRun();
		});
		$("seed").addEventListener("change", () => {
			state.cfg.seed = $("seed").value.trim();
			scheduleRun();
		});

		const preset = $("preset");
		for (const name of Object.keys(CFG.PRESETS)) {
			preset.appendChild(new Option(name === "default" ? "— presets —" : name, name));
		}
		preset.addEventListener("change", () => {
			const p = CFG.PRESETS[preset.value];
			if (!p) return;
			const seed = state.cfg.seed;
			state.cfg = CFG.make(p);
			state.cfg.seed = seed;
			state.presetName = preset.value;
			state.presetDirty = false;
			paintConfig();
			run();
		});

		$("btnReset").addEventListener("click", () => {
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
			row.appendChild(el("span", "archname", a.name));
			const inp = el("input");
			inp.type = "number";
			inp.step = "0.05";
			inp.min = "0";
			inp.max = "8";
			inp.dataset.arch = a.name;
			inp.value = a.w === undefined ? 1 : a.w;
			inp.setAttribute("aria-label", "Rarity weight for " + a.name);
			inp.addEventListener("change", () => {
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
			state.cfg.archetypeWeights = null;
			for (const i of aw.querySelectorAll("input")) {
				const a = RB.ARCHETYPES.filter((x) => x.name === i.dataset.arch)[0];
				i.value = a && a.w !== undefined ? a.w : 1;
			}
			markDirty();
			run();
		});

		// Note template: which lines are written into each player's note.
		const box = $("noteLines");
		for (const [key, label] of window.Engine.NOTE_LINES) {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.value = key;
			cb.addEventListener("change", () => {
				const want = Array.from(box.querySelectorAll("input:checked")).map((i) => i.value);
				state.cfg.noteLines = want;
				markDirty();
				scheduleRun();
			});
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + label));
			box.appendChild(lab);
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

	/* The seed alone does not reproduce a class — the twenty settings that
	   shaped it matter just as much. Both go in the URL hash, so one link is a
	   complete recipe. */
	function encodeConfig() {
		const out = {};
		for (const k of Object.keys(CFG.DEFAULTS)) {
			const v = state.cfg[k];
			const d = CFG.DEFAULTS[k];
			if (JSON.stringify(v) !== JSON.stringify(d)) out[k] = v;
		}
		if (Object.keys(state.overrides).length) out.overrides = state.overrides;
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
		if (!m) return;
		try {
			const payload = JSON.parse(decodeURIComponent(m[1]));
			if (payload.overrides) {
				state.overrides = payload.overrides;
				delete payload.overrides;
			}
			state.cfg = CFG.make(payload);
			state.presetDirty = true;
		} catch (e) { showError(new Error("Could not read the settings in this link.")); }
	}

	/* ------------------------------------------------------------ file input */

	function summarise(data) {
		const players = data.players || [];
		const blank = players.filter((p) => !p.college || !String(p.college).trim()).length;
		return players.length + " players, season " + (data.startingSeason || "?") +
			", " + Math.round((100 * blank) / Math.max(1, players.length)) + "% blank colleges";
	}

	function readFiles(fileList) {
		const problems = [];
		const jobs = Array.from(fileList).map(
			(f) =>
				new Promise((resolve) => {
					const r = new FileReader();
					r.onerror = () => {
						problems.push(f.name + ": could not be read from disk");
						resolve(null);
					};
					r.onload = () => {
						try {
							const text = String(r.result).replace(/^﻿/, "");
							const data = JSON.parse(text);
							// Full schema check up front, so a bad file is
							// rejected with a sentence instead of throwing a
							// raw TypeError out of the middle of the sim.
							window.Engine.validateLeagueFile(data);
							resolve({ name: f.name, data });
						} catch (e) {
							problems.push(f.name + ": " + e.message);
							resolve(null);
						}
					};
					r.readAsText(f);
				}),
		);
		Promise.all(jobs).then((loaded) => {
			const ok = loaded.filter(Boolean);
			// The old code used alert(), which is modal and loses every error
			// after the first when several files are dropped at once.
			if (problems.length) showError(new Error(problems.join("\n")));
			else clearError();
			if (!ok.length) return;
			state.files = ok.sort((a, b) =>
				(a.data.startingSeason || 0) - (b.data.startingSeason || 0));
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
			for (const id of ["btnReroll", "btnRerun", "btnExport", "btnExportAll"]) {
				$(id).disabled = false;
			}
			run();
		});
	}

	function bindFiles() {
		$("btnLoad").addEventListener("click", () => $("file").click());
		$("file").addEventListener("change", (e) => readFiles(e.target.files));
		$("fileSelect").addEventListener("change", (e) => {
			state.active = Number(e.target.value);
			ensureResult(state.active);
			render();
		});
		// dragover/dragleave on the body fire for every child element the
		// pointer crosses, so the drop zone flickered on the way in. Count
		// enter/leave pairs instead.
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

	// Engine errors must surface: without this, an exception mid-run leaves
	// the previous render frozen on screen and sliders silently do nothing.
	function showError(err) {
		const b = $("errBanner");
		b.hidden = false;
		b.textContent = (err && err.message ? err.message : String(err)) +
			"\n(Click to dismiss.)";
	}
	function clearError() {
		$("errBanner").hidden = true;
	}

	function effectiveCfg() {
		const cfg = CFG.make(state.cfg);
		cfg.overrides = state.overrides;
		return cfg;
	}

	/* Only the file on screen is simulated eagerly. With five files loaded,
	   dragging a slider used to run the engine five times per frame; the other
	   four are computed when you switch to them or export. */
	function ensureResult(i) {
		if (state.results[i]) return state.results[i];
		const f = state.files[i];
		if (!f) return null;
		const cfg = effectiveCfg();
		// Every file in a batch shares the seed, so they stay one set.
		if (!cfg.seed && state.lastSeed) cfg.seed = state.lastSeed;
		state.results[i] = window.Engine.run(f.data, cfg);
		return state.results[i];
	}

	function run() {
		if (!state.files.length) return;
		let seed;
		try {
			// Only the file on screen is simulated now; the others are cleared
			// and recomputed on demand against the same seed.
			state.results = new Array(state.files.length).fill(null);
			state.results[state.active] =
				window.Engine.run(state.files[state.active].data, effectiveCfg());
			seed = state.results[state.active].seed;
			state.lastSeed = seed;
			clearError();
		} catch (err) {
			showError(err);
			return;
		}
		$("seedPill").hidden = false;
		$("seedPill").textContent = "seed " + seed;
		$("seedPill").dataset.seed = seed;
		if (state.history[0] !== seed) {
			state.history.unshift(seed);
			state.history = state.history.slice(0, 12);
			paintHistory();
		}
		writeHash();
		render();
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
		state.cfg.seed = "";
		$("seed").value = "";
		run();
		// run() returns early on an engine error, so read the seed back from
		// the result that actually exists rather than trusting state.results[0]
		// to have been replaced (it used to write the PREVIOUS run's seed into
		// the box, or throw outright on an empty results array).
		const res = state.results[state.active];
		if (!res) {
			state.cfg.seed = previous || "";
			$("seed").value = state.cfg.seed;
			return;
		}
		state.cfg.seed = res.seed;
		$("seed").value = res.seed;
	}

	/* ---------------------------------------------------------------- views */

	const TABS = [
		["players", "Prospects"],
		["teams", "AP Poll & Teams"],
		["bracket", "March Madness"],
		["awards", "Awards & leaders"],
		["distribution", "Distributions"],
		["notes", "Player notes"],
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
			b.addEventListener("click", () => { state.tab = key; render(); });
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
		({
			players: viewPlayers, teams: viewTeams, bracket: viewBracket,
			awards: viewAwards, distribution: viewDistribution, notes: viewNotes,
		})[state.tab](view, res);
	}

	const n1 = (x) => (x === undefined || x === null ? "" : x.toFixed(1));
	const pc = (x) => (x * 100).toFixed(1);

	function delta(now, before) {
		const d = now - before;
		const s = el("span", d > 0 ? "up" : d < 0 ? "down" : "");
		s.textContent = d === 0 ? "" : (d > 0 ? " +" : " ") + d;
		return s;
	}

	function sortable(table, rows, columns) {
		const thead = el("thead");
		const tr = el("tr");
		for (const col of columns) {
			const th = el("th", (col.num ? "num " : "") + "sortable", col.label);
			th.title = col.title || col.label;
			th.tabIndex = 0;
			const activate = () => {
				if (state.sort.key === col.key) state.sort.dir *= -1;
				else state.sort = { key: col.key, dir: col.num === false ? 1 : -1 };
				render();
			};
			th.addEventListener("click", activate);
			th.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
			});
			if (state.sort.key === col.key) {
				th.textContent = col.label + (state.sort.dir < 0 ? " ▾" : " ▴");
				th.setAttribute("aria-sort", state.sort.dir < 0 ? "descending" : "ascending");
			}
			tr.appendChild(th);
		}
		thead.appendChild(tr);
		table.appendChild(thead);

		const key = state.sort.key;
		const dir = state.sort.dir;
		const sorted = rows.slice().sort((a, b) => {
			const va = a.sortVals[key];
			const vb = b.sortVals[key];
			if (typeof va === "string" || typeof vb === "string") {
				return String(va).localeCompare(String(vb)) * dir;
			}
			return ((va || 0) - (vb || 0)) * dir;
		});
		const tbody = el("tbody");
		for (const r of sorted) tbody.appendChild(r.node);
		table.appendChild(tbody);
	}

	function matchesFilter(p, res) {
		const f = state.filter;
		if (f.q) {
			const hay = (p.name + " " + p.newCollege + " " + p.archetype + " " +
				(p.awards || []).join(" ")).toLowerCase();
			if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
		}
		if (f.pos && p.newPos !== f.pos) return false;
		if (f.conf) {
			const t = res.teams[p.newCollege];
			const conf = t ? t.conf : (p.nonNcaa ? p.newCollege : "");
			if (conf !== f.conf) return false;
		}
		if (f.changedOnly && !p.collegeChanged) return false;
		if (f.lockedOnly && !state.overrides[p.pid]) return false;
		return true;
	}

	function filterBar(res, onChange) {
		const bar = el("div", "filters");
		const q = el("input");
		q.type = "search";
		q.placeholder = "Search name, school, archetype, honour…";
		q.value = state.filter.q;
		q.setAttribute("aria-label", "Search prospects");
		q.addEventListener("input", () => { state.filter.q = q.value; onChange(); });
		bar.appendChild(q);

		const posSel = el("select");
		posSel.setAttribute("aria-label", "Filter by position");
		posSel.appendChild(new Option("all positions", ""));
		for (const p of ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"]) {
			posSel.appendChild(new Option(p, p));
		}
		posSel.value = state.filter.pos;
		posSel.addEventListener("change", () => { state.filter.pos = posSel.value; onChange(); });
		bar.appendChild(posSel);

		const confs = {};
		for (const p of res.players) {
			const t = res.teams[p.newCollege];
			const c = t ? t.conf : (p.nonNcaa ? p.newCollege : null);
			if (c) confs[c] = true;
		}
		const confSel = el("select");
		confSel.setAttribute("aria-label", "Filter by conference");
		confSel.appendChild(new Option("all conferences", ""));
		for (const c of Object.keys(confs).sort()) confSel.appendChild(new Option(c, c));
		confSel.value = state.filter.conf;
		confSel.addEventListener("change", () => { state.filter.conf = confSel.value; onChange(); });
		bar.appendChild(confSel);

		for (const [key, label] of [["changedOnly", "reassigned colleges only"],
			["lockedOnly", "locked players only"]]) {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = state.filter[key];
			cb.addEventListener("change", () => { state.filter[key] = cb.checked; onChange(); });
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + label));
			bar.appendChild(lab);
		}

		const csv = el("button", null, "Export table as CSV");
		csv.addEventListener("click", () => exportCsv(res));
		bar.appendChild(csv);
		return bar;
	}

	function viewPlayers(view, res) {
		const summary = el("div", "rowflex");
		const ncaa = res.players.filter((p) => !p.nonNcaa);
		const conv = res.players.filter((p) => p.collegeChanged);
		const avgOvr = res.players.reduce((a, p) => a + p.newOvr, 0) / res.players.length;
		const avgOld = res.players.reduce((a, p) => a + p.origOvr, 0) / res.players.length;
		for (const t of [
			res.players.length + " prospects",
			"avg ovr " + avgOld.toFixed(1) + " → " + avgOvr.toFixed(1),
			"top ovr " + Math.max.apply(null, res.players.map((p) => p.newOvr)),
			conv.length + " colleges reassigned",
			ncaa.length + " in NCAA D-I",
			Object.keys(state.overrides).length + " locked",
		]) summary.appendChild(el("span", "pill", t));
		view.appendChild(summary);
		view.appendChild(filterBar(res, render));
		view.appendChild(el("p", "legendline",
			"Click a column to sort, or a row to edit and lock that prospect. " +
			"Ovr/Pot show the change from the original file."));

		const columns = [
			{ key: "lock", label: "🔒", num: false, title: "Locked settings survive a reroll" },
			{ key: "name", label: "Player", num: false },
			{ key: "pos", label: "Pos", num: false },
			{ key: "year", label: "Year", num: false },
			{ key: "newOvr", label: "Ovr", num: true },
			{ key: "newPot", label: "Pot", num: true },
			{ key: "archetype", label: "Archetype", num: false },
			{ key: "college", label: "College / League", num: false },
			{ key: "conf", label: "Conf", num: false },
			{ key: "mpg", label: "MPG", num: true },
			{ key: "ppg", label: "PPG", num: true },
			{ key: "rpg", label: "RPG", num: true },
			{ key: "apg", label: "APG", num: true },
			{ key: "spg", label: "SPG", num: true },
			{ key: "bpg", label: "BPG", num: true },
			{ key: "topg", label: "TO", num: true },
			{ key: "pfpg", label: "PF", num: true },
			{ key: "usg", label: "USG%", num: true, title: "Share of team chances used on the floor" },
			{ key: "fgp", label: "FG%", num: true },
			{ key: "tpp", label: "3P%", num: true },
			{ key: "ftp", label: "FT%", num: true },
			{ key: "ts", label: "TS%", num: true },
			{ key: "awards", label: "Honors", num: false },
		];

		const shown = res.players.filter((p) => matchesFilter(p, res));
		const rows = shown.map((p) => {
			const s = p.stats || {};
			const team = res.teams[p.newCollege];
			const tr = el("tr");
			if (state.overrides[p.pid]) tr.className = "locked";
			tr.tabIndex = 0;
			const open = () => openEditor(p, res);
			tr.addEventListener("click", (e) => {
				if (e.target.tagName === "BUTTON") return;
				open();
			});
			tr.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); open(); }
			});
			const add = (txt, cls) => { tr.appendChild(el("td", cls, txt)); };

			add(state.overrides[p.pid] ? "🔒" : "");
			const nameTd = el("td");
			nameTd.appendChild(document.createTextNode(p.name));
			tr.appendChild(nameTd);
			add(p.newPos + (p.newPos !== p.origPos ? " (" + p.origPos + ")" : ""));
			add(p.classYear);

			const ovrTd = el("td", "num");
			ovrTd.appendChild(document.createTextNode(String(p.newOvr)));
			ovrTd.appendChild(delta(p.newOvr, p.origOvr));
			tr.appendChild(ovrTd);
			const potTd = el("td", "num");
			potTd.appendChild(document.createTextNode(String(p.newPot)));
			potTd.appendChild(delta(p.newPot, p.origPot));
			tr.appendChild(potTd);

			const aTd = el("td");
			aTd.appendChild(el("span", "tag arch", p.archetype));
			tr.appendChild(aTd);

			const cTd = el("td");
			if (p.nonNcaa) cTd.appendChild(el("span", "tag pro", p.proClub || p.newCollege));
			else cTd.appendChild(document.createTextNode(p.newCollege || "—"));
			if (p.collegeChanged && !p.nonNcaa) cTd.appendChild(el("span", "tag", "new"));
			tr.appendChild(cTd);

			add(team ? team.conf : p.nonNcaa ? p.newCollege : "");
			for (const k of ["mpg", "ppg", "rpg", "apg", "spg", "bpg", "topg", "pfpg"]) {
				add(n1(s[k]), "num");
			}
			for (const k of ["usg", "fgp", "tpp", "ftp", "ts"]) {
				add(s[k] === undefined ? "" : pc(s[k]), "num");
			}
			const awTd = el("td", "wrap");
			awTd.textContent = (p.awards || []).join("; ");
			tr.appendChild(awTd);

			return {
				node: tr,
				sortVals: {
					lock: state.overrides[p.pid] ? 1 : 0,
					name: p.name, pos: p.newPos, year: p.classYear, newOvr: p.newOvr,
					newPot: p.newPot, archetype: p.archetype, college: p.newCollege,
					conf: team ? team.conf : "", mpg: s.mpg, ppg: s.ppg, rpg: s.rpg,
					apg: s.apg, spg: s.spg, bpg: s.bpg, topg: s.topg, pfpg: s.pfpg,
					usg: s.usg, fgp: s.fgp, tpp: s.tpp, ftp: s.ftp, ts: s.ts,
					awards: (p.awards || []).length,
				},
			};
		});

		view.appendChild(el("p", "legendline",
			shown.length + " of " + res.players.length + " prospects shown"));
		const wrap = el("div", "scroll");
		const table = el("table");
		sortable(table, rows, columns);
		wrap.appendChild(table);
		view.appendChild(wrap);
		if (state.editing !== null) {
			const p = res.players.filter((x) => x.pid === state.editing)[0];
			if (p) view.appendChild(editorPanel(p, res));
		}
	}

	/* ----------------------------------------------------- per-player editor */

	function openEditor(p, res) {
		state.editing = state.editing === p.pid ? null : p.pid;
		render();
	}

	function editorPanel(p, res) {
		const panel = el("div", "editor");
		const head = el("div", "rowflex");
		head.appendChild(el("h3", null, p.name + " — " + p.newPos + " · " + p.newOvr + "/" + p.newPot));
		const close = el("button", null, "Close");
		close.addEventListener("click", () => { state.editing = null; render(); });
		head.appendChild(close);
		panel.appendChild(head);

		const ov = state.overrides[p.pid] || {};
		const grid = el("div", "editgrid");

		const field = (label, node) => {
			const w = el("div", "ctl");
			const l = el("label", null, label);
			w.appendChild(l);
			w.appendChild(node);
			grid.appendChild(w);
			return node;
		};

		const ovrIn = el("input");
		ovrIn.type = "number";
		ovrIn.min = 0;
		ovrIn.max = 100;
		ovrIn.value = Number.isFinite(ov.ovr) ? ov.ovr : p.newOvr;
		field("Lock overall", ovrIn);

		const potIn = el("input");
		potIn.type = "number";
		potIn.min = 0;
		potIn.max = 100;
		potIn.value = Number.isFinite(ov.pot) ? ov.pot : p.newPot;
		field("Lock potential", potIn);

		const archSel = el("select");
		archSel.appendChild(new Option("(roll it)", ""));
		for (const a of RB.ARCHETYPES) {
			if (p.origRatings.hgt < a.min || p.origRatings.hgt > a.max) continue;
			archSel.appendChild(new Option(a.name, a.name));
		}
		archSel.value = ov.archetype || "";
		field("Lock archetype", archSel);

		const colSel = el("select");
		colSel.appendChild(new Option("(roll it)", ""));
		for (const name of C.names.concat(Object.keys(C.NON_NCAA)).sort()) {
			colSel.appendChild(new Option(name, name));
		}
		colSel.value = ov.college || "";
		field("Lock school / league", colSel);
		panel.appendChild(grid);

		const buttons = el("div", "rowflex");
		const apply = el("button", "primary", "Apply lock");
		apply.addEventListener("click", () => {
			const next = { ovr: Number(ovrIn.value), pot: Number(potIn.value) };
			if (archSel.value) next.archetype = archSel.value;
			if (colSel.value) next.college = colSel.value;
			state.overrides[p.pid] = next;
			run();
		});
		buttons.appendChild(apply);
		const clear = el("button", null, "Clear lock");
		clear.addEventListener("click", () => {
			delete state.overrides[p.pid];
			run();
		});
		buttons.appendChild(clear);
		panel.appendChild(buttons);

		// "Explain this player": what fired, what it cost, and the full ratings
		// diff against the original file.
		panel.appendChild(el("h4", null, "Why this player looks like this"));
		const why = el("div", "note");
		const s = p.stats;
		why.textContent = [
			"Archetype: " + p.archetype + (ov.archetype ? " (locked)" : "") +
				" — offsets are made ovr-neutral before the solver runs, so the",
			"  build changed his shape, not his overall.",
			"Overall: " + p.origOvr + " → " + p.newOvr +
				(state.cfg.ovrMode === "curve" ? " (re-dealt along the class curve)" : " (preserved)"),
			"Potential: " + p.origPot + " → " + p.newPot,
			"College: " + (p.origCollege || "(none in file)") + " → " + p.newCollege +
				(p.collegeChanged ? " (reassigned)" : ""),
			"Class year: " + p.classYear,
			s ? "Stat line comes from " + n1(s.mpg) + " MPG at USG " + pc(s.usg) +
				"% on a team rated " + (res.teams[p.newCollege]
					? res.teams[p.newCollege].rating.toFixed(1) : "—") : "",
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
			const td = el("td", "num " + (d > 0 ? "up" : d < 0 ? "down" : ""),
				d === 0 ? "" : (d > 0 ? "+" : "") + d);
			dtr.appendChild(td);
		}
		db.appendChild(dtr);
		dt.appendChild(db);
		dw.appendChild(dt);
		panel.appendChild(dw);
		return panel;
	}

	/* ------------------------------------------------------------ team views */

	function viewTeams(view, res) {
		view.appendChild(el("h3", null, "AP Top 25"));
		view.appendChild(el("p", "legendline",
			"Rankings come from record, strength of schedule and roster quality. " +
			"Program strength starts from each school's BBGM draft frequency, then " +
			"this year's prospects are layered on top."));
		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["#", "Team", "Conf", "Record", "Conf record", "SOS", "Seed", "Result", "Prospects"]) {
			hr.appendChild(el("th", h === "#" || h === "SOS" ? "num" : "", h));
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		res.poll.forEach((t, i) => {
			const tr = el("tr");
			tr.appendChild(el("td", "num", String(i + 1)));
			tr.appendChild(el("td", null, t.name));
			tr.appendChild(el("td", null, t.conf));
			tr.appendChild(el("td", null, t.w + "-" + t.l +
				(t.confRegularChamp ? " ★" : "")));
			tr.appendChild(el("td", null, t.cw + "-" + t.cl));
			tr.appendChild(el("td", "num", t.sosAvg.toFixed(1)));
			tr.appendChild(el("td", null, t.ncaaSeed ? "No. " + t.ncaaSeed : "—"));
			tr.appendChild(el("td", null, t.ncaaResult || (t.bid ? "NCAA field" : "—")));
			const names = t.prospects.map((p) => p.name + " (" + p.newOvr + ")").join(", ");
			tr.appendChild(el("td", "wrap", names));
			tb.appendChild(tr);
		});
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);
		view.appendChild(el("p", "legendline", "★ = regular-season conference champion."));

		view.appendChild(el("h3", null, "Programs with prospects in this class"));
		const cards = el("div", "cards");
		const withP = Object.values(res.teams)
			.filter((t) => t.prospects.length)
			.sort((a, b) => b.resume - a.resume);
		for (const t of withP) {
			const c = el("div", "card");
			c.appendChild(el("h4", null,
				t.name + " — " + t.w + "-" + t.l + (t.apRank ? "  (AP #" + t.apRank + ")" : "")));
			const best = t.log.filter((g) => g.won)
				.sort((a, b) => b.quality - a.quality)[0];
			c.appendChild(el("div", "note",
				t.conf + " " + t.cw + "-" + t.cl +
				(t.confRegularChamp ? " · regular-season champion" : "") +
				(t.confTourneyChamp ? " · conference tournament champion" : "") +
				"\n" + (t.ncaaSeed ? "No. " + t.ncaaSeed + " seed, " + t.ncaaResult : (t.bid ? t.ncaaResult : "Did not make the field")) +
				(best ? "\nBest win: " + best.pf + "-" + best.pa + " over " + best.opp : "") +
				"\n" + t.prospects.map((p) =>
					"  " + p.name + " — " + p.newOvr + "/" + p.newPot + " " + p.newPos +
					", " + n1(p.stats.ppg) + "/" + n1(p.stats.rpg) + "/" + n1(p.stats.apg)).join("\n")));
			cards.appendChild(c);
		}
		view.appendChild(cards);

		// Pro / DII leagues get a table of their own rather than a bare name.
		const leagues = res.proLeagues || {};
		for (const name of Object.keys(leagues)) {
			const lg = leagues[name];
			view.appendChild(el("h3", null, name + " — " +
				(lg.champion ? lg.champion.name + " win the title" : "season table")));
			const lw = el("div", "scroll");
			const lt = el("table");
			const lh = el("thead");
			const lhr = el("tr");
			for (const h of ["#", "Club", "Record", "Prospects"]) {
				lhr.appendChild(el("th", h === "#" ? "num" : "", h));
			}
			lh.appendChild(lhr);
			lt.appendChild(lh);
			const lb = el("tbody");
			lg.table.forEach((c, i) => {
				const tr = el("tr");
				tr.appendChild(el("td", "num", String(i + 1)));
				tr.appendChild(el("td", null, c.name + (c.leagueChamp ? " 🏆" : "")));
				tr.appendChild(el("td", null, c.w + "-" + c.l));
				tr.appendChild(el("td", "wrap", c.prospects.map((p) =>
					p.name + " (" + n1(p.stats.ppg) + " ppg)").join(", ")));
				lb.appendChild(tr);
			});
			lt.appendChild(lb);
			lw.appendChild(lt);
			view.appendChild(lw);
		}
	}

	function gameNode(a, b, winner, seedA, seedB, score) {
		const g = el("div", "game" + (winner === b && seedB > seedA + 2 ? " upset" : ""));
		const line = (t, seed, won) => {
			const d = el("div", won ? "w" : "l");
			d.appendChild(el("span", "sd", seed === undefined ? "" : String(seed)));
			d.appendChild(el("span", "gn", t.name));
			return d;
		};
		g.appendChild(line(a, seedA, winner === a));
		g.appendChild(line(b, seedB, winner === b));
		if (score) g.appendChild(el("div", "score", score));
		return g;
	}

	function viewBracket(view, res) {
		const t = res.tourney;
		const head = el("div", "rowflex");
		head.appendChild(el("span", "pill",
			"Champion: " + t.champion.team.name + " (No. " + t.champion.seed + ")"));
		head.appendChild(el("span", "pill", "Runner-up: " + t.runnerUp.team.name));
		head.appendChild(el("span", "pill",
			"Final Four: " + t.finalFour.map((x) => x.team.name).join(", ")));
		const upsets = [];
		for (const r of window.Tournament.REGIONS) {
			for (const round of t.regions[r].rounds) {
				for (const g of round) if (g.upset) upsets.push(g);
			}
		}
		head.appendChild(el("span", "pill", upsets.length + " upsets"));
		view.appendChild(head);

		// Cinderella: the best run by a double-digit seed.
		const cinderella = [];
		for (const r of window.Tournament.REGIONS) {
			for (const x of t.regions[r].seeds) {
				if (x.seed >= 10 && (x.team.ncaaWins || 0) >= 1) cinderella.push(x);
			}
		}
		cinderella.sort((a, b) => (b.team.ncaaWins || 0) - (a.team.ncaaWins || 0));
		if (cinderella.length) {
			const c = cinderella[0];
			view.appendChild(el("p", "legendline",
				"Cinderella: No. " + c.seed + " " + c.team.name + " won " +
				c.team.ncaaWins + " game(s) — " + c.team.ncaaResult + "."));
		}

		const path = el("div", "ctl");
		const sel = el("select");
		sel.appendChild(new Option("follow a team's path…", ""));
		const inField = [];
		for (const r of window.Tournament.REGIONS) {
			for (const x of t.regions[r].seeds) inField.push(x);
		}
		inField.sort((a, b) => a.team.name.localeCompare(b.team.name));
		for (const x of inField) sel.appendChild(new Option(x.team.name, x.team.name));
		const out = el("div", "note");
		sel.addEventListener("change", () => {
			out.textContent = "";
			if (!sel.value) return;
			const lines = [];
			for (const r of window.Tournament.REGIONS) {
				for (const round of t.regions[r].rounds) {
					for (const g of round) {
						if (g.a.team.name !== sel.value && g.b.team.name !== sel.value) continue;
						const me = g.a.team.name === sel.value ? g.a : g.b;
						const them = g.a.team.name === sel.value ? g.b : g.a;
						lines.push((g.winner === me ? "W over " : "L to ") +
							"No. " + them.seed + " " + them.team.name +
							(g.score ? "  " + g.score : ""));
					}
				}
			}
			for (const g of t.semis.concat([t.final])) {
				if (!g.a || !g.b) continue;
				if (g.a.team.name !== sel.value && g.b.team.name !== sel.value) continue;
				const me = g.a.team.name === sel.value ? g.a : g.b;
				const them = g.a.team.name === sel.value ? g.b : g.a;
				lines.push((g.winner === me ? "W over " : "L to ") + them.team.name +
					(g.score ? "  " + g.score : ""));
			}
			out.textContent = lines.join("\n") || "Did not play in the main draw.";
		});
		path.appendChild(sel);
		path.appendChild(out);
		view.appendChild(path);

		view.appendChild(el("h3", null, "First Four"));
		const ff = el("div", "bracket");
		const ffr = el("div", "round");
		for (const g of t.firstFour) {
			ffr.appendChild(gameNode(g.a, g.b, g.winner, g.seed, g.seed, g.score));
		}
		ff.appendChild(ffr);
		view.appendChild(ff);

		const ROUNDS = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"];
		// Mirrored layout: two regions feed in from the left, two from the
		// right, with the Final Four in the middle — so the whole draw reads as
		// one bracket instead of four separate scrolling strips.
		const REG = window.Tournament.REGIONS;
		const mirror = el("div", "bracketwrap");
		const leftCol = el("div", "half");
		const rightCol = el("div", "half right");
		REG.forEach((region, i) => {
			const r = t.regions[region];
			const box = el("div", "regionbox");
			box.appendChild(el("h4", null, region + " — " + r.champ.team.name + " advances"));
			const br = el("div", "bracket");
			r.rounds.forEach((games, gi) => {
				const col = el("div", "round");
				col.appendChild(el("h5", null, ROUNDS[gi] || "Round " + (gi + 1)));
				for (const g of games) {
					col.appendChild(gameNode(g.a.team, g.b.team, g.winner.team,
						g.a.seed, g.b.seed, g.score));
				}
				br.appendChild(col);
			});
			box.appendChild(br);
			(i < 2 ? leftCol : rightCol).appendChild(box);
		});
		const centre = el("div", "centrecol");
		centre.appendChild(el("h4", null, "Final Four"));
		for (const g of t.semis) {
			centre.appendChild(gameNode(g.a.team, g.b.team, g.winner.team,
				g.a.seed, g.b.seed, g.score));
		}
		centre.appendChild(el("h4", null, "National championship"));
		centre.appendChild(gameNode(t.final.a.team, t.final.b.team, t.final.winner.team,
			t.final.a.seed, t.final.b.seed, t.final.score));
		mirror.appendChild(leftCol);
		mirror.appendChild(centre);
		mirror.appendChild(rightCol);
		view.appendChild(mirror);

		view.appendChild(el("h3", null, "Last four in / first four out"));
		const bub = el("div", "note");
		bub.textContent =
			"Last in:  " + t.selection.atLarge.slice(-4).map((x) => x.name + " (" + x.w + "-" + x.l + ")").join(", ") +
			"\nFirst out: " + t.selection.bubble.slice(0, 4).map((x) => x.name + " (" + x.w + "-" + x.l + ")").join(", ");
		view.appendChild(bub);
	}

	/* --------------------------------------------------------------- awards */

	function leaderTable(res, title, key, fmt) {
		const list = res.players.filter((p) => p.stats && p.stats.mpg >= 15)
			.sort((a, b) => b.stats[key] - a.stats[key])
			.slice(0, 10);
		const box = el("div", "card");
		box.appendChild(el("h4", null, title));
		const lines = list.map((p, i) =>
			(i + 1) + ". " + (fmt ? fmt(p.stats[key]) : n1(p.stats[key])) + "  " +
			p.name + " (" + (p.proClub || p.newCollege) + ")");
		box.appendChild(el("div", "note", lines.join("\n")));
		return box;
	}

	function viewAwards(view, res) {
		view.appendChild(el("h3", null, "Statistical leaders"));
		view.appendChild(el("p", "legendline",
			"The first thing to check when sanity-testing a class."));
		const leaders = el("div", "cards");
		leaders.appendChild(leaderTable(res, "Points", "ppg"));
		leaders.appendChild(leaderTable(res, "Rebounds", "rpg"));
		leaders.appendChild(leaderTable(res, "Assists", "apg"));
		leaders.appendChild(leaderTable(res, "Blocks", "bpg"));
		leaders.appendChild(leaderTable(res, "Steals", "spg"));
		leaders.appendChild(leaderTable(res, "True shooting", "ts", (v) => pc(v) + "%"));
		view.appendChild(leaders);

		const teamRows = Object.values(res.teams).filter((t) => t.prospects.length)
			.sort((a, b) => b.pct - a.pct).slice(0, 15);
		const trBox = el("div", "card");
		trBox.appendChild(el("h4", null, "Best records among programs with prospects"));
		trBox.appendChild(el("div", "note", teamRows.map((t) =>
			t.w + "-" + t.l + "  " + t.name + " (" + t.conf + ")").join("\n")));
		view.appendChild(trBox);

		view.appendChild(el("h3", null, "Honours"));
		const honored = res.players.filter((p) => p.awards && p.awards.length)
			.sort((a, b) => (b.scoreTotal || 0) - (a.scoreTotal || 0));
		if (!honored.length) {
			view.appendChild(el("p", "legendline",
				"Nobody in this class cleared the field. Lower “Award strictness” to hand out more."));
		}
		view.appendChild(el("p", "legendline",
			"Prospects are ranked against every returning player in Division I, not " +
			"only against each other, so an All-America slot has to be earned."));
		const cards = el("div", "cards");
		for (const p of honored) {
			const c = el("div", "card");
			c.appendChild(el("h4", null, p.name + " — " + (p.proClub || p.newCollege)));
			const s = p.stats;
			c.appendChild(el("div", "note",
				p.newPos + " · " + p.newOvr + "/" + p.newPot + " · " + p.archetype + "\n" +
				n1(s.ppg) + " PPG / " + n1(s.rpg) + " RPG / " + n1(s.apg) + " APG · " +
				pc(s.fgp) + "% FG, " + pc(s.tpp) + "% 3P\n" +
				p.awards.join("\n")));
			cards.appendChild(c);
		}
		view.appendChild(cards);
	}

	/* --------------------------------------------------------- distributions */

	function histogram(title, values, buckets, fmt) {
		const box = el("div", "card");
		box.appendChild(el("h4", null, title));
		if (!values.length) return box;
		const lo = Math.min.apply(null, values);
		const hi = Math.max.apply(null, values);
		const n = buckets || 12;
		const width = (hi - lo) / n || 1;
		const counts = new Array(n).fill(0);
		for (const v of values) {
			counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
		}
		const max = Math.max.apply(null, counts);
		const chart = el("div", "hist");
		counts.forEach((c, i) => {
			const row = el("div", "histrow");
			row.appendChild(el("span", "histlabel",
				(fmt ? fmt(lo + i * width) : (lo + i * width).toFixed(1))));
			const bar = el("span", "histbar");
			bar.style.width = (max ? (100 * c) / max : 0) + "%";
			bar.title = c + " prospects";
			row.appendChild(bar);
			row.appendChild(el("span", "histcount", String(c)));
			chart.appendChild(row);
		});
		box.appendChild(chart);
		const sorted = values.slice().sort((a, b) => a - b);
		const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
		box.appendChild(el("div", "note",
			"median " + q(0.5).toFixed(1) + " · p90 " + q(0.9).toFixed(1) +
			" · max " + hi.toFixed(1)));
		return box;
	}

	function viewDistribution(view, res) {
		view.appendChild(el("p", "legendline",
			"Eyeball the shape of a class in one second instead of reading 70 rows."));
		const cards = el("div", "cards");
		const withStats = res.players.filter((p) => p.stats);
		cards.appendChild(histogram("Overall rating", res.players.map((p) => p.newOvr), 12));
		cards.appendChild(histogram("Potential", res.players.map((p) => p.newPot), 12));
		cards.appendChild(histogram("Points per game", withStats.map((p) => p.stats.ppg), 12));
		cards.appendChild(histogram("Minutes per game", withStats.map((p) => p.stats.mpg), 12));
		cards.appendChild(histogram("Usage rate", withStats.map((p) => p.stats.usg * 100), 12));
		cards.appendChild(histogram("True shooting", withStats.map((p) => p.stats.ts * 100), 12));

		const counts = {};
		for (const p of res.players) counts[p.archetype] = (counts[p.archetype] || 0) + 1;
		const archBox = el("div", "card");
		archBox.appendChild(el("h4", null, "Archetypes in this class"));
		archBox.appendChild(el("div", "note", Object.keys(counts)
			.sort((a, b) => counts[b] - counts[a])
			.map((k) => String(counts[k]).padStart(3) + "  " + k).join("\n")));
		cards.appendChild(archBox);

		const years = {};
		for (const p of res.players) years[p.classYear] = (years[p.classYear] || 0) + 1;
		const yBox = el("div", "card");
		yBox.appendChild(el("h4", null, "Class years"));
		yBox.appendChild(el("div", "note", ["Freshman", "Sophomore", "Junior", "Senior"]
			.map((k) => String(years[k] || 0).padStart(3) + "  " + k).join("\n")));
		cards.appendChild(yBox);
		view.appendChild(cards);
	}

	/* ---------------------------------------------------------------- notes */

	function viewNotes(view, res) {
		view.appendChild(el("p", "legendline",
			"This is exactly what gets written into each player's note field in the " +
			"exported file. Choose which lines appear under “Note template” in the sidebar."));
		const bar = el("div", "filters");
		const q = el("input");
		q.type = "search";
		q.placeholder = "Search notes…";
		q.value = state.filter.q;
		q.setAttribute("aria-label", "Search notes");
		q.addEventListener("input", () => { state.filter.q = q.value; render(); });
		bar.appendChild(q);
		const copy = el("button", null, "Copy all notes");
		copy.addEventListener("click", () => {
			const text = res.players.slice().sort((a, b) => b.newOvr - a.newOvr)
				.map((p) => p.name + "\n" + p.note).join("\n\n");
			copyText(text, copy, "Copy all notes");
		});
		bar.appendChild(copy);
		view.appendChild(bar);

		const cards = el("div", "cards");
		for (const p of res.players.slice().sort((a, b) => b.newOvr - a.newOvr)) {
			if (!matchesFilter(p, res)) continue;
			const c = el("div", "card");
			c.appendChild(el("h4", null, p.name));
			c.appendChild(el("div", "note", p.note));
			cards.appendChild(c);
		}
		view.appendChild(cards);
	}

	function copyText(text, button, restore) {
		const done = () => {
			if (!button) return;
			button.textContent = "Copied ✓";
			setTimeout(() => { button.textContent = restore; }, 1400);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(done, () => fallback());
		} else fallback();
		function fallback() {
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); done(); } catch (e) { /* nothing to do */ }
			ta.remove();
		}
	}

	/* --------------------------------------------------------------- export */

	function setStatus(text, sticky) {
		const s = $("status");
		s.textContent = text;
		s.hidden = !text;
		if (!sticky) setTimeout(() => { if (s.textContent === text) s.hidden = true; }, 3500);
	}

	function download(name, text) {
		// BBGM writes its exports with a BOM; match it.
		const blob = new Blob(["﻿" + text], { type: "application/json" });
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
			const out = window.Engine.exportFile(res);
			const base = state.files[i].name.replace(/\.json$/i, "");
			// A very large class can blow the string limit; say so instead of
			// failing silently on an empty download.
			const text = JSON.stringify(out, null, 2);
			download(base + "_customized.json", text);
			return true;
		} catch (err) {
			showError(new Error("Could not export " + state.files[i].name + ": " + err.message));
			return false;
		}
	}

	function exportCsv(res) {
		const cols = ["name", "pos", "year", "ovr", "pot", "archetype", "college", "conf",
			"gp", "mpg", "ppg", "rpg", "orpg", "drpg", "apg", "spg", "bpg", "topg", "pfpg",
			"usg", "fgp", "tpp", "ftp", "ts", "awards"];
		const esc = (v) => {
			const s = v === undefined || v === null ? "" : String(v);
			return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
		};
		const lines = [cols.join(",")];
		for (const p of res.players) {
			if (!matchesFilter(p, res)) continue;
			const s = p.stats || {};
			const t = res.teams[p.newCollege];
			lines.push([
				p.name, p.newPos, p.classYear, p.newOvr, p.newPot, p.archetype,
				p.proClub || p.newCollege, t ? t.conf : p.newCollege,
				s.gp, s.mpg, s.ppg, s.rpg, s.orpg, s.drpg, s.apg, s.spg, s.bpg,
				s.topg, s.pfpg, s.usg, s.fgp, s.tpp, s.ftp, s.ts,
				(p.awards || []).join("; "),
			].map((v) => esc(typeof v === "number" ? Number(v.toFixed(3)) : v)).join(","));
		}
		const blob = new Blob([lines.join("\n")], { type: "text/csv" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "prospects.csv";
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
		setStatus("CSV exported.");
	}

	/* Browsers throttle or silently drop multiple programmatic downloads that
	   are not tied to a user gesture, so exporting N files is done one click at
	   a time with an explicit prompt rather than a fire-and-forget stagger. */
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

	/* ------------------------------------------------------------ batch mode */

	function runBatch(n) {
		const file = state.files[state.active];
		if (!file) return;
		setStatus("Generating " + n + " classes…", true);
		setTimeout(() => {
			const rows = [];
			const agg = { ppg: [], mpg: [], ovr: [], awards: [], top: [] };
			for (let i = 0; i < n; i++) {
				const cfg = effectiveCfg();
				cfg.seed = "";
				let res;
				try { res = window.Engine.run(file.data, cfg); } catch (err) {
					showError(err);
					return;
				}
				const withStats = res.players.filter((p) => p.stats);
				const mean = (v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
				agg.ppg.push(mean(withStats.map((p) => p.stats.ppg)));
				agg.mpg.push(mean(withStats.map((p) => p.stats.mpg)));
				agg.ovr.push(mean(res.players.map((p) => p.newOvr)));
				agg.awards.push(res.players.reduce((a, p) => a + (p.awards || []).length, 0));
				agg.top.push(Math.max.apply(null, withStats.map((p) => p.stats.ppg)));
				rows.push(res.seed);
			}
			const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
			const view = $("view");
			view.innerHTML = "";
			view.appendChild(el("h3", null, n + " classes with these settings"));
			view.appendChild(el("div", "note",
				"mean ovr        " + mean(agg.ovr).toFixed(2) + "\n" +
				"mean PPG        " + mean(agg.ppg).toFixed(2) + "\n" +
				"mean MPG        " + mean(agg.mpg).toFixed(2) + "\n" +
				"scoring leader  " + mean(agg.top).toFixed(2) + " (avg per class)\n" +
				"awards/class    " + mean(agg.awards).toFixed(1) + "\n\n" +
				"seeds: " + rows.join(", ")));
			const cards = el("div", "cards");
			cards.appendChild(histogram("Scoring leader per class", agg.top, 10));
			cards.appendChild(histogram("Awards per class", agg.awards, 10));
			view.appendChild(cards);
			setStatus("");
		}, 20);
	}

	/* ----------------------------------------------------------------- init */

	/* The sticky sidebar's offset was a hardcoded 53px, but the header is
	   flex-wrap: wrap and grows to two lines on a narrow window. Measure it. */
	function syncHeaderHeight() {
		const h = document.querySelector("header");
		if (h) {
			document.documentElement.style.setProperty("--headerH", h.offsetHeight + "px");
		}
	}
	window.addEventListener("resize", syncHeaderHeight);
	syncHeaderHeight();

	readHash();
	bindConfig();
	bindFiles();
	paintConfig();
	paintHistory();

	$("errBanner").addEventListener("click", clearError);
	$("btnReroll").addEventListener("click", reroll);
	$("btnRerun").addEventListener("click", run);
	$("btnExport").addEventListener("click", () => {
		if (exportOne(state.active)) setStatus("Exported " + state.files[state.active].name + ".");
	});
	$("btnExportAll").addEventListener("click", exportAll);
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
		copyText(location.href, $("btnCopyLink"), "Copy shareable link");
	});
	$("btnBatch").addEventListener("click", () => {
		if (!state.files.length) return;
		runBatch(Number($("batchN").value) || 10);
	});
})();
