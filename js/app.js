/* UI: file loading, config binding, the five result views, and export. */
(function () {
	"use strict";

	const CFG = window.Config;
	const C = window.Colleges;
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
		results: [],     // parallel to files
		active: 0,
		tab: "players",
		sort: { key: "newOvr", dir: -1 },
	};

	/* ---------------------------------------------------------------- config */

	const SLIDERS = [
		"classQuality", "classDepth", "eliteCount", "potBias", "potSpread",
		"specialization", "archetypeDiversity", "buildNoise",
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
	};

	function paintConfig() {
		for (const key of SLIDERS) {
			const input = $(key);
			if (!input) continue;
			input.value = state.cfg[key];
			const b = input.closest(".ctl").querySelector("label b");
			if (b) b.textContent = (FORMAT[key] || ((v) => String(v)))(Number(input.value));
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
	}

	function bindConfig() {
		for (const key of SLIDERS) {
			const input = $(key);
			if (!input) continue;
			input.addEventListener("input", () => {
				state.cfg[key] = Number(input.value);
				paintConfig();
				scheduleRun();
			});
		}
		$("ovrMode").addEventListener("change", () => {
			state.cfg.ovrMode = $("ovrMode").value;
			paintConfig();
			scheduleRun();
		});
		$("varySize").addEventListener("change", () => {
			state.cfg.varySize = $("varySize").checked;
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
			paintConfig();
			run();
		});

		$("btnReset").addEventListener("click", () => {
			state.cfg = CFG.make();
			paintConfig();
			run();
		});
	}

	let timer = null;
	function scheduleRun() {
		clearTimeout(timer);
		timer = setTimeout(run, 140);
	}

	/* ------------------------------------------------------------ file input */

	function readFiles(fileList) {
		const jobs = Array.from(fileList).map(
			(f) =>
				new Promise((resolve) => {
					const r = new FileReader();
					r.onload = () => {
						try {
							const text = String(r.result).replace(/^﻿/, "");
							const data = JSON.parse(text);
							if (!Array.isArray(data.players)) throw new Error("no players array");
							resolve({ name: f.name, data });
						} catch (e) {
							alert("Could not read " + f.name + ": " + e.message);
							resolve(null);
						}
					};
					r.readAsText(f);
				}),
		);
		Promise.all(jobs).then((loaded) => {
			const ok = loaded.filter(Boolean);
			if (!ok.length) return;
			state.files = ok.sort((a, b) =>
				(a.data.startingSeason || 0) - (b.data.startingSeason || 0));
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
			render();
		});
		const drop = document.body;
		drop.addEventListener("dragover", (e) => {
			e.preventDefault();
			$("empty").classList.add("over");
		});
		drop.addEventListener("dragleave", () => $("empty").classList.remove("over"));
		drop.addEventListener("drop", (e) => {
			e.preventDefault();
			$("empty").classList.remove("over");
			if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
		});
	}

	/* ----------------------------------------------------------------- run */

	function run() {
		if (!state.files.length) return;
		state.results = state.files.map((f) => window.Engine.run(f.data, state.cfg));
		$("seedPill").hidden = false;
		$("seedPill").textContent = "seed " + state.results[0].seed;
		render();
	}

	function reroll() {
		state.cfg.seed = "";
		$("seed").value = "";
		run();
		// Lock the freshly rolled seed in so "Re-apply" is reproducible.
		state.cfg.seed = state.results[0].seed;
		$("seed").value = state.results[0].seed;
	}

	/* ---------------------------------------------------------------- views */

	const TABS = [
		["players", "Prospects"],
		["teams", "AP Poll & Teams"],
		["bracket", "March Madness"],
		["awards", "Awards"],
		["notes", "Player notes"],
	];

	function render() {
		const tabs = $("tabs");
		tabs.innerHTML = "";
		for (const [key, label] of TABS) {
			const b = el("button", key === state.tab ? "active" : "", label);
			b.addEventListener("click", () => { state.tab = key; render(); });
			tabs.appendChild(b);
		}
		const view = $("view");
		view.innerHTML = "";
		const res = state.results[state.active];
		if (!res) return;
		({
			players: viewPlayers, teams: viewTeams, bracket: viewBracket,
			awards: viewAwards, notes: viewNotes,
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
			const th = el("th", col.num ? "num" : "", col.label);
			th.title = col.title || col.label;
			th.addEventListener("click", () => {
				if (state.sort.key === col.key) state.sort.dir *= -1;
				else state.sort = { key: col.key, dir: col.num === false ? 1 : -1 };
				render();
			});
			if (state.sort.key === col.key) {
				th.textContent = col.label + (state.sort.dir < 0 ? " ▾" : " ▴");
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
		]) summary.appendChild(el("span", "pill", t));
		view.appendChild(summary);
		view.appendChild(el("p", "legendline",
			"Click any column to sort. Ovr/Pot show the change from the original file."));

		const columns = [
			{ key: "name", label: "Player", num: false },
			{ key: "pos", label: "Pos", num: false },
			{ key: "age", label: "Age", num: true },
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
			{ key: "fgp", label: "FG%", num: true },
			{ key: "tpp", label: "3P%", num: true },
			{ key: "ftp", label: "FT%", num: true },
			{ key: "awards", label: "Honors", num: false },
		];

		const rows = res.players.map((p) => {
			const s = p.stats || {};
			const team = res.teams[p.newCollege];
			const tr = el("tr");
			const add = (txt, cls) => { tr.appendChild(el("td", cls, txt)); };

			const nameTd = el("td");
			nameTd.appendChild(document.createTextNode(p.name));
			tr.appendChild(nameTd);
			add(p.newPos + (p.newPos !== p.origPos ? " (" + p.origPos + ")" : ""));
			add(String(p.age), "num");

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
			if (p.nonNcaa) cTd.appendChild(el("span", "tag pro", p.newCollege));
			else cTd.appendChild(document.createTextNode(p.newCollege || "—"));
			if (p.collegeChanged && !p.nonNcaa) cTd.appendChild(el("span", "tag", "new"));
			tr.appendChild(cTd);

			add(team ? team.conf : p.nonNcaa ? "—" : "");
			for (const k of ["mpg", "ppg", "rpg", "apg", "spg", "bpg"]) add(n1(s[k]), "num");
			for (const k of ["fgp", "tpp", "ftp"]) add(s[k] === undefined ? "" : pc(s[k]), "num");
			const awTd = el("td", "wrap");
			awTd.textContent = (p.awards || []).join("; ");
			tr.appendChild(awTd);

			return {
				node: tr,
				sortVals: {
					name: p.name, pos: p.newPos, age: p.age, newOvr: p.newOvr,
					newPot: p.newPot, archetype: p.archetype, college: p.newCollege,
					conf: team ? team.conf : "", mpg: s.mpg, ppg: s.ppg, rpg: s.rpg,
					apg: s.apg, spg: s.spg, bpg: s.bpg, fgp: s.fgp, tpp: s.tpp,
					ftp: s.ftp, awards: (p.awards || []).length,
				},
			};
		});

		const wrap = el("div", "scroll");
		const table = el("table");
		sortable(table, rows, columns);
		wrap.appendChild(table);
		view.appendChild(wrap);
	}

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
			tr.appendChild(el("td", null, t.w + "-" + t.l));
			tr.appendChild(el("td", null, t.cw + "-" + t.cl));
			tr.appendChild(el("td", "num", t.sosAvg.toFixed(1)));
			tr.appendChild(el("td", null, t.ncaaSeed ? "No. " + t.ncaaSeed : "—"));
			tr.appendChild(el("td", null, t.ncaaResult || (t.bid ? "NCAA field" : "—")));
			const names = t.prospects.map((p) => p.name + " (" + p.newOvr + ")").join(", ");
			const td = el("td", "wrap", names);
			tr.appendChild(td);
			tb.appendChild(tr);
		});
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);

		view.appendChild(el("h3", null, "Programs with prospects in this class"));
		const cards = el("div", "cards");
		const withP = Object.values(res.teams)
			.filter((t) => t.prospects.length)
			.sort((a, b) => b.resume - a.resume);
		for (const t of withP) {
			const c = el("div", "card");
			c.appendChild(el("h4", null,
				t.name + " — " + t.w + "-" + t.l + (t.apRank ? "  (AP #" + t.apRank + ")" : "")));
			c.appendChild(el("div", "note",
				t.conf + " " + t.cw + "-" + t.cl +
				(t.confTourneyChamp ? " · conference tournament champion" : "") +
				"\n" + (t.ncaaSeed ? "No. " + t.ncaaSeed + " seed, " + t.ncaaResult : (t.bid ? t.ncaaResult : "Did not make the field")) +
				"\n" + t.prospects.map((p) =>
					"  " + p.name + " — " + p.newOvr + "/" + p.newPot + " " + p.newPos +
					", " + n1(p.stats.ppg) + "/" + n1(p.stats.rpg) + "/" + n1(p.stats.apg)).join("\n")));
			cards.appendChild(c);
		}
		view.appendChild(cards);
	}

	function gameNode(a, b, winner, seedA, seedB) {
		const g = el("div", "game" + (winner === b && seedB > seedA + 2 ? " upset" : ""));
		const line = (t, seed, won) => {
			const d = el("div", won ? "w" : "l");
			d.appendChild(el("span", "sd", seed === undefined ? "" : String(seed)));
			d.appendChild(el("span", null, t.name));
			return d;
		};
		g.appendChild(line(a, seedA, winner === a));
		g.appendChild(line(b, seedB, winner === b));
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
		view.appendChild(head);

		view.appendChild(el("h3", null, "First Four"));
		const ff = el("div", "bracket");
		const ffr = el("div", "round");
		for (const g of t.firstFour) {
			ffr.appendChild(gameNode(g.a, g.b, g.winner, g.seed, g.seed));
		}
		ff.appendChild(ffr);
		view.appendChild(ff);

		const ROUNDS = ["Round of 64", "Round of 32", "Sweet 16", "Elite Eight"];
		for (const region of window.Tournament.REGIONS) {
			const r = t.regions[region];
			view.appendChild(el("h3", null, region + " Region — " + r.champ.team.name + " advances"));
			const br = el("div", "bracket");
			r.rounds.forEach((games, i) => {
				const col = el("div", "round");
				col.appendChild(el("h5", null, ROUNDS[i] || "Round " + (i + 1)));
				for (const g of games) {
					col.appendChild(gameNode(g.a.team, g.b.team, g.winner.team, g.a.seed, g.b.seed));
				}
				br.appendChild(col);
			});
			view.appendChild(br);
		}

		view.appendChild(el("h3", null, "Final Four"));
		const fin = el("div", "bracket");
		const semis = el("div", "round");
		semis.appendChild(el("h5", null, "National semifinals"));
		for (const g of t.semis) {
			semis.appendChild(gameNode(g.a.team, g.b.team, g.winner.team, g.a.seed, g.b.seed));
		}
		fin.appendChild(semis);
		const final = el("div", "round");
		final.appendChild(el("h5", null, "National championship"));
		final.appendChild(gameNode(
			t.final.a.team, t.final.b.team, t.final.winner.team,
			t.final.a.seed, t.final.b.seed));
		fin.appendChild(final);
		view.appendChild(fin);

		view.appendChild(el("h3", null, "Last four in / first four out"));
		const bub = el("div", "note");
		bub.textContent =
			"Last in:  " + t.selection.atLarge.slice(-4).map((x) => x.name + " (" + x.w + "-" + x.l + ")").join(", ") +
			"\nFirst out: " + t.selection.bubble.slice(0, 4).map((x) => x.name + " (" + x.w + "-" + x.l + ")").join(", ");
		view.appendChild(bub);
	}

	function viewAwards(view, res) {
		const honored = res.players.filter((p) => p.awards && p.awards.length)
			.sort((a, b) => b.scoreTotal - a.scoreTotal);
		if (!honored.length) {
			view.appendChild(el("p", "legendline",
				"Nobody cleared the award bar this year. Lower “Award strictness” to hand out more."));
		}
		view.appendChild(el("p", "legendline",
			"Awards are earned from the simulated stat line, team results and the " +
			"strength of the league the player did it in. They are written into each " +
			"player's note as well."));
		const cards = el("div", "cards");
		for (const p of honored) {
			const c = el("div", "card");
			c.appendChild(el("h4", null, p.name + " — " + p.newCollege));
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

	function viewNotes(view, res) {
		view.appendChild(el("p", "legendline",
			"This is exactly what gets written into each player's note field in the exported file."));
		const cards = el("div", "cards");
		for (const p of res.players.slice().sort((a, b) => b.newOvr - a.newOvr)) {
			const c = el("div", "card");
			c.appendChild(el("h4", null, p.name));
			c.appendChild(el("div", "note", p.note));
			cards.appendChild(c);
		}
		view.appendChild(cards);
	}

	/* --------------------------------------------------------------- export */

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
		const res = state.results[i];
		const out = window.Engine.exportFile(res);
		const base = state.files[i].name.replace(/\.json$/i, "");
		download(base + "_customized.json", JSON.stringify(out, null, 2));
	}

	/* ----------------------------------------------------------------- init */

	bindConfig();
	bindFiles();
	paintConfig();
	$("btnReroll").addEventListener("click", reroll);
	$("btnRerun").addEventListener("click", run);
	$("btnExport").addEventListener("click", () => exportOne(state.active));
	$("btnExportAll").addEventListener("click", () => {
		state.results.forEach((_, i) => setTimeout(() => exportOne(i), i * 400));
	});
})();
