/* The tab views. Split out of app.js, which had grown to the point where the
   table, the bracket, the editor and the file loader were one 1,500-line unit.

   Everything here reads shared state and helpers off window.App, which is
   defined by the time any of it runs. */
(function (global) {
	"use strict";

	const C = global.Colleges;
	const RB = global.RatingsBuilder;

	const A = () => global.App;
	const el = (tag, cls, text) => {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	};
	/* A cell whose text is allowed to wrap, but only to a couple of lines. The
	   full text is on the title so nothing is lost. */
	function wrapCell(text) {
		const td = el("td", "wrap");
		const inner = el("div", "clamp", text);
		inner.title = text;
		td.appendChild(inner);
		return td;
	}

	const n1 = (x) => (x === undefined || x === null || !Number.isFinite(x) ? "" : x.toFixed(1));
	const pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) : "");

	/* ------------------------------------------------------------- columns */

	/* Every column the prospect table can show. 23 of them on a laptop meant
	   horizontal scrolling for every glance at PPG, so which ones appear is now
	   the user's choice and is remembered. */
	const COLUMNS = [
		{ key: "pick", label: "", num: false, fixed: true, title: "Select for bulk editing" },
		{ key: "lock", label: "🔒", num: false, fixed: true, title: "Locked settings survive a reroll" },
		{ key: "name", label: "Player", num: false, fixed: true, sticky: true },
		{ key: "pos", label: "Pos", num: false },
		{ key: "year", label: "Year", num: false },
		{ key: "board", label: "Brd", num: true, title: "Position on the mock draft board" },
		{ key: "move", label: "±", num: true, title: "Movement from the preseason board" },
		{ key: "newOvr", label: "Ovr", num: true },
		{ key: "newPot", label: "Pot", num: true },
		{ key: "archetype", label: "Archetype", num: false },
		{ key: "college", label: "College / League", num: false },
		{ key: "conf", label: "Conf", num: false },
		{ key: "gp", label: "GP", num: true, stat: true },
		{ key: "mpg", label: "MPG", num: true, stat: true },
		{ key: "ppg", label: "PPG", num: true, stat: true },
		{ key: "rpg", label: "RPG", num: true, stat: true },
		{ key: "orpg", label: "ORB", num: true, stat: true, off: true },
		{ key: "drpg", label: "DRB", num: true, stat: true, off: true },
		{ key: "apg", label: "APG", num: true, stat: true },
		{ key: "spg", label: "SPG", num: true, stat: true },
		{ key: "bpg", label: "BPG", num: true, stat: true },
		{ key: "topg", label: "TO", num: true, stat: true },
		{ key: "pfpg", label: "PF", num: true, stat: true },
		{ key: "cspg", label: "CS", num: true, stat: true, off: true, title: "Contested shots per game" },
		{ key: "deflpg", label: "DEFL", num: true, stat: true, off: true, title: "Deflections per game" },
		{ key: "chgpg", label: "CHG", num: true, stat: true, off: true, title: "Charges drawn per game" },
		{ key: "drtg", label: "DRtg", num: true, off: true, title: "Points allowed per 100 possessions on the floor" },
		{ key: "usg", label: "USG%", num: true, title: "Share of team chances used on the floor" },
		{ key: "fgp", label: "FG%", num: true },
		{ key: "tpp", label: "3P%", num: true },
		{ key: "ftp", label: "FT%", num: true },
		{ key: "ts", label: "TS%", num: true },
		{ key: "awards", label: "Honors", num: false },
	];
	const PCT_KEYS = { usg: 1, fgp: 1, tpp: 1, ftp: 1, ts: 1 };

	/* Per-game, totals or per-40. The table only ever showed per-game, which is
	   the wrong unit half the time you are comparing two prospects who played
	   very different minutes. */
	const STAT_MODES = [
		["perGame", "per game"],
		["totals", "season totals"],
		["per40", "per 40 minutes"],
	];
	function statValue(p, key, mode) {
		const s = p.stats;
		if (!s || s[key] === undefined) return undefined;
		const v = s[key];
		if (!Number.isFinite(v)) return undefined;
		const col = COLUMNS.filter((c) => c.key === key)[0];
		if (!col || !col.stat || key === "gp" || key === "mpg") {
			return key === "mpg" && mode === "totals" ? v * s.gp : v;
		}
		if (mode === "totals") return v * s.gp;
		if (mode === "per40") return s.mpg > 0 ? (v * 40) / s.mpg : 0;
		return v;
	}

	function visibleColumns() {
		const hidden = A().state.hiddenColumns || {};
		return COLUMNS.filter((c) => c.fixed || !hidden[c.key]);
	}

	/* --------------------------------------------------------------- table */

	function delta(now, before) {
		const d = now - before;
		const s = el("span", d > 0 ? "up" : d < 0 ? "down" : "");
		s.textContent = d === 0 ? "" : (d > 0 ? " +" : " ") + d;
		return s;
	}

	/* Multi-column sort. shift-click adds a key rather than replacing it, so
	   "tier, then PPG" is expressible. */
	function sortRows(rows) {
		const keys = A().state.sort;
		return rows.slice().sort((a, b) => {
			for (const { key, dir } of keys) {
				const va = a.sortVals[key];
				const vb = b.sortVals[key];
				let cmp;
				if (typeof va === "string" || typeof vb === "string") {
					cmp = String(va === undefined ? "" : va)
						.localeCompare(String(vb === undefined ? "" : vb));
				} else {
					cmp = (va || 0) - (vb || 0);
				}
				if (cmp) return cmp * dir;
			}
			return 0;
		});
	}

	function buildTable(rows, columns) {
		const table = el("table");
		const thead = el("thead");
		const tr = el("tr");
		const sort = A().state.sort;
		for (const col of columns) {
			const th = el("th",
				(col.num ? "num " : "") + (col.sticky ? "sticky " : "") + "sortable", col.label);
			th.title = (col.title || col.label) + " — click to sort, shift-click to add a level";
			th.tabIndex = 0;
			th.scope = "col";
			const activate = (additive) => {
				const idx = sort.findIndex((s) => s.key === col.key);
				if (!additive) {
					if (idx === 0) sort[0].dir *= -1;
					else A().state.sort = [{ key: col.key, dir: col.num === false ? 1 : -1 }];
				} else if (idx >= 0) {
					sort[idx].dir *= -1;
				} else {
					sort.push({ key: col.key, dir: col.num === false ? 1 : -1 });
				}
				A().persist();
				A().render();
			};
			th.addEventListener("click", (e) => activate(e.shiftKey));
			th.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(e.shiftKey); }
			});
			const si = sort.findIndex((s) => s.key === col.key);
			if (si >= 0) {
				th.textContent = col.label + (sort[si].dir < 0 ? " ▾" : " ▴") +
					(sort.length > 1 ? String(si + 1) : "");
				th.setAttribute("aria-sort", sort[si].dir < 0 ? "descending" : "ascending");
			}
			tr.appendChild(th);
		}
		thead.appendChild(tr);
		table.appendChild(thead);
		const tbody = el("tbody");
		for (const r of sortRows(rows)) tbody.appendChild(r.node);
		table.appendChild(tbody);
		return table;
	}

	function matchesFilter(p, res) {
		const f = A().state.filter;
		if (f.q) {
			const hay = (p.name + " " + p.newCollege + " " + (p.proClub || "") + " " +
				p.archetype + " " + p.classYear + " " +
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
		if (f.lockedOnly && !A().state.overrides[p.key]) return false;
		return true;
	}

	/* The search box used to call render() on every keystroke, which rebuilt
	   every tab, the filter bar (losing the caret position on some browsers), a
	   70-row x 23-column table and the editor panel. */
	function searchInput(placeholder, label, getter, setter) {
		const q = el("input");
		q.type = "search";
		q.placeholder = placeholder;
		q.value = getter();
		q.setAttribute("aria-label", label);
		let t = null;
		q.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => {
				setter(q.value);
				A().render();
				const next = document.querySelector('input[type=search]');
				if (next) {
					next.focus();
					next.setSelectionRange(next.value.length, next.value.length);
				}
			}, 180);
		});
		return q;
	}

	function filterBar(res) {
		const st = A().state;
		const bar = el("div", "filters");
		bar.appendChild(searchInput(
			"Search name, school, archetype, honour…", "Search prospects",
			() => st.filter.q, (v) => { st.filter.q = v; }));

		const posSel = el("select");
		posSel.setAttribute("aria-label", "Filter by position");
		posSel.appendChild(new Option("all positions", ""));
		for (const p of ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"]) {
			posSel.appendChild(new Option(p, p));
		}
		posSel.value = st.filter.pos;
		posSel.addEventListener("change", () => { st.filter.pos = posSel.value; A().render(); });
		bar.appendChild(posSel);

		const confs = {};
		for (const p of res.players) {
			const t = res.teams[p.newCollege];
			const c = t ? t.conf : (p.nonNcaa ? p.newCollege : null);
			if (c) confs[c] = true;
		}
		const confSel = el("select");
		confSel.setAttribute("aria-label", "Filter by conference or league");
		confSel.appendChild(new Option("all conferences", ""));
		for (const c of Object.keys(confs).sort()) confSel.appendChild(new Option(c, c));
		confSel.value = st.filter.conf;
		confSel.addEventListener("change", () => { st.filter.conf = confSel.value; A().render(); });
		bar.appendChild(confSel);

		for (const [key, label] of [["changedOnly", "reassigned colleges only"],
			["lockedOnly", "locked players only"]]) {
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = st.filter[key];
			cb.addEventListener("change", () => { st.filter[key] = cb.checked; A().render(); });
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + label));
			bar.appendChild(lab);
		}

		const modeSel = el("select");
		modeSel.setAttribute("aria-label", "Statistic units");
		for (const [k, l] of STAT_MODES) modeSel.appendChild(new Option(l, k));
		modeSel.value = st.statMode;
		modeSel.addEventListener("change", () => {
			st.statMode = modeSel.value;
			A().persist();
			A().render();
		});
		bar.appendChild(modeSel);

		const dens = el("select");
		dens.setAttribute("aria-label", "Row density");
		for (const [k, l] of [["normal", "normal rows"], ["compact", "compact rows"],
			["comfortable", "roomy rows"]]) dens.appendChild(new Option(l, k));
		dens.value = st.density;
		dens.addEventListener("change", () => {
			st.density = dens.value;
			A().persist();
			A().render();
		});
		bar.appendChild(dens);

		const cols = el("button", null, "Columns…");
		cols.addEventListener("click", () => columnPicker());
		bar.appendChild(cols);
		return bar;
	}

	function columnPicker() {
		const st = A().state;
		const box = el("div");
		box.appendChild(el("p", "hint",
			"Untick a column to hide it. The player name, lock and selection " +
			"columns always stay."));
		const grid = el("div", "colpicker");
		for (const col of COLUMNS) {
			if (col.fixed) continue;
			const lab = el("label", "check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = !st.hiddenColumns[col.key];
			cb.addEventListener("change", () => {
				if (cb.checked) delete st.hiddenColumns[col.key];
				else st.hiddenColumns[col.key] = true;
			});
			lab.appendChild(cb);
			lab.appendChild(document.createTextNode(" " + (col.label || col.key)));
			lab.title = col.title || "";
			grid.appendChild(lab);
		}
		box.appendChild(grid);
		const presets = el("div", "rowflex");
		const preset = (name, keys) => {
			const b = el("button", "tiny", name);
			b.addEventListener("click", () => {
				st.hiddenColumns = {};
				for (const col of COLUMNS) {
					if (col.fixed) continue;
					if (keys.indexOf(col.key) === -1) st.hiddenColumns[col.key] = true;
				}
				A().closeModal();
				A().persist();
				A().render();
			});
			presets.appendChild(b);
		};
		preset("Everything", COLUMNS.map((c) => c.key));
		preset("Scouting", ["pos", "year", "board", "move", "newOvr", "newPot",
			"archetype", "college", "conf", "mpg", "ppg", "rpg", "apg", "ts", "awards"]);
		preset("Box score", ["pos", "college", "gp", "mpg", "ppg", "rpg", "apg",
			"spg", "bpg", "topg", "pfpg", "fgp", "tpp", "ftp", "ts"]);
		preset("Defence", ["pos", "college", "mpg", "drpg", "spg", "bpg", "cspg",
			"deflpg", "chgpg", "drtg", "pfpg", "awards"]);
		box.appendChild(el("h4", null, "Presets"));
		box.appendChild(presets);
		A().modal("Columns", box, () => { A().persist(); A().render(); });
	}

	function viewPlayers(view, res) {
		const st = A().state;
		const summary = el("div", "rowflex");
		const ncaa = res.players.filter((p) => !p.nonNcaa);
		const conv = res.players.filter((p) => p.collegeChanged);
		const avgOvr = res.players.reduce((a, p) => a + p.newOvr, 0) / res.players.length;
		const avgOld = res.players.reduce((a, p) => a + p.origOvr, 0) / res.players.length;
		const pills = [
			res.players.length + " prospects",
			"avg ovr " + avgOld.toFixed(1) + " → " + avgOvr.toFixed(1),
			"top ovr " + Math.max.apply(null, res.players.map((p) => p.newOvr)),
			conv.length + " colleges reassigned",
			ncaa.length + " in NCAA D-I",
			Object.keys(st.overrides).length + " locked",
		];
		if (res.flavor && res.flavor.name !== "balanced") {
			pills.push("this class is " + res.flavor.label);
		}
		for (const t of pills) summary.appendChild(el("span", "pill", t));
		view.appendChild(summary);
		view.appendChild(filterBar(res));
		view.appendChild(bulkBar(res));

		const columns = visibleColumns();
		const shown = res.players.filter((p) => matchesFilter(p, res));
		const mode = st.statMode;
		const rows = shown.map((p) => {
			const s = p.stats || {};
			const team = res.teams[p.newCollege];
			const tr = el("tr");
			const cls = [];
			if (st.overrides[p.key]) cls.push("locked");
			if (st.selected[p.key]) cls.push("picked");
			tr.className = cls.join(" ");
			tr.tabIndex = 0;
			const open = () => A().openEditor(p);
			tr.addEventListener("click", (e) => {
				if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
				open();
			});
			tr.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); open(); }
			});
			const sortVals = {};
			for (const col of columns) {
				let td;
				switch (col.key) {
				case "pick": {
					td = el("td");
					const cb = el("input");
					cb.type = "checkbox";
					cb.checked = !!st.selected[p.key];
					cb.setAttribute("aria-label", "Select " + p.name);
					cb.addEventListener("change", () => {
						if (cb.checked) st.selected[p.key] = true;
						else delete st.selected[p.key];
						tr.classList.toggle("picked", cb.checked);
						A().refreshBulkBar();
					});
					td.appendChild(cb);
					sortVals.pick = st.selected[p.key] ? 1 : 0;
					break;
				}
				case "lock":
					td = el("td", null, st.overrides[p.key] ? "🔒" : "");
					sortVals.lock = st.overrides[p.key] ? 1 : 0;
					break;
				case "name":
					td = el("td", "sticky");
					td.appendChild(document.createTextNode(p.name));
					sortVals.name = p.name;
					break;
				case "pos":
					td = el("td", null, p.newPos + (p.newPos !== p.origPos ? " (" + p.origPos + ")" : ""));
					sortVals.pos = p.newPos;
					break;
				case "year":
					td = el("td", null, p.classYear);
					sortVals.year = p.classYear;
					break;
				case "board":
					td = el("td", "num", p.boardRank === undefined ? "" : String(p.boardRank));
					sortVals.board = p.boardRank;
					break;
				case "move": {
					td = el("td", "num");
					const m = p.stockMove || 0;
					td.appendChild(el("span", m > 0 ? "up" : m < 0 ? "down" : "",
						m === 0 ? "—" : (m > 0 ? "+" : "") + m));
					sortVals.move = m;
					break;
				}
				case "newOvr":
					td = el("td", "num");
					td.appendChild(document.createTextNode(String(p.newOvr)));
					td.appendChild(delta(p.newOvr, p.origOvr));
					sortVals.newOvr = p.newOvr;
					break;
				case "newPot":
					td = el("td", "num");
					td.appendChild(document.createTextNode(String(p.newPot)));
					td.appendChild(delta(p.newPot, p.origPot));
					sortVals.newPot = p.newPot;
					break;
				case "archetype":
					td = el("td");
					td.appendChild(el("span", "tag arch", p.archetype));
					sortVals.archetype = p.archetype;
					break;
				case "college":
					td = el("td");
					if (p.nonNcaa) {
						// A professional club and an academy or DII programme are
						// not the same kind of destination.
						td.appendChild(el("span", p.leaguePro ? "tag pro" : "tag",
							p.proClub || p.newCollege));
					} else td.appendChild(document.createTextNode(p.newCollege || "—"));
					if (p.collegeChanged && !p.nonNcaa) td.appendChild(el("span", "tag", "new"));
					sortVals.college = p.newCollege;
					break;
				case "conf":
					td = el("td", null, team ? team.conf : p.nonNcaa ? p.newCollege : "");
					sortVals.conf = team ? team.conf : "";
					break;
				case "awards":
					td = wrapCell((p.awards || []).join("; "));
					sortVals.awards = (p.awards || []).length;
					break;
				default: {
					const v = PCT_KEYS[col.key] ? s[col.key] : statValue(p, col.key, mode);
					td = el("td", "num", v === undefined ? ""
						: PCT_KEYS[col.key] ? pc(v)
						: col.key === "gp" || (mode === "totals" && col.key !== "drtg")
							? String(Math.round(v)) : n1(v));
					sortVals[col.key] = v;
				}
				}
				tr.appendChild(td);
			}
			return { node: tr, sortVals };
		});

		view.appendChild(el("p", "legendline",
			shown.length + " of " + res.players.length + " prospects shown · " +
			"click a row to edit and lock, click a column to sort " +
			"(shift-click for a second level)"));
		const wrap = el("div", "scroll");
		wrap.appendChild(buildTable(rows, columns));
		view.appendChild(wrap);
		if (st.editing !== null) {
			const p = res.players.filter((x) => x.key === st.editing)[0];
			if (p) view.appendChild(A().editorPanel(p, res));
		}
	}

	/* ------------------------------------------------------------ bulk edit */

	function bulkBar(res) {
		const st = A().state;
		const bar = el("div", "filters");
		bar.id = "bulkBar";
		const count = Object.keys(st.selected).length;
		const label = el("span", "pill", count + " selected");
		bar.appendChild(label);

		const all = el("button", "tiny", "Select all shown");
		all.addEventListener("click", () => {
			for (const p of res.players) if (matchesFilter(p, res)) st.selected[p.key] = true;
			A().render();
		});
		bar.appendChild(all);
		const none = el("button", "tiny", "Clear selection");
		none.addEventListener("click", () => { A().state.selected = {}; A().render(); });
		bar.appendChild(none);

		if (!count) {
			bar.appendChild(el("span", "hint",
				"Tick rows to edit several prospects at once — if you want every " +
				"seven-footer to be a Rim Protector, that is one click, not seven."));
			return bar;
		}

		const archSel = el("select");
		archSel.setAttribute("aria-label", "Set archetype for the selection");
		archSel.appendChild(new Option("set archetype…", ""));
		for (const a of RB.ARCHETYPES) archSel.appendChild(new Option(a.name, a.name));
		archSel.addEventListener("change", () => {
			if (!archSel.value) return;
			A().bulkApply({ archetype: archSel.value },
				"set archetype to " + archSel.value + " for " + count + " prospects");
		});
		bar.appendChild(archSel);

		const colSel = el("select");
		colSel.setAttribute("aria-label", "Set school for the selection");
		colSel.appendChild(new Option("set school / league…", ""));
		for (const name of C.names.concat(Object.keys(C.NON_NCAA)).sort()) {
			colSel.appendChild(new Option(name, name));
		}
		colSel.addEventListener("change", () => {
			if (!colSel.value) return;
			A().bulkApply({ college: colSel.value },
				"set school to " + colSel.value + " for " + count + " prospects");
		});
		bar.appendChild(colSel);

		const shift = el("input");
		shift.type = "number";
		shift.value = "0";
		shift.step = "1";
		shift.style.width = "70px";
		shift.setAttribute("aria-label", "Overall adjustment for the selection");
		bar.appendChild(shift);
		const shiftBtn = el("button", "tiny", "Shift ovr");
		shiftBtn.addEventListener("click", () => {
			const d = Number(shift.value) || 0;
			if (!d) return;
			A().bulkShiftOvr(d);
		});
		bar.appendChild(shiftBtn);

		const unlock = el("button", "tiny", "Clear locks");
		unlock.addEventListener("click", () => A().bulkClear());
		bar.appendChild(unlock);
		return bar;
	}

	/* ---------------------------------------------------------- team views */

	function viewTeams(view, res) {
		view.appendChild(el("h3", null, "AP Top 25"));
		view.appendChild(el("p", "legendline",
			"Rankings come from record, strength of schedule and roster quality. " +
			"Program strength starts from each school's BBGM draft frequency, then " +
			"this year's prospects are layered on top. Every one of the 353 " +
			"programs plays a full season, so the ratings below are real."));
		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["#", "Team", "Conf", "Record", "Conf record", "SOS",
			"ORtg", "DRtg", "Seed", "Result", "Prospects"]) {
			const th = el("th", ["#", "SOS", "ORtg", "DRtg"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		res.poll.forEach((t, i) => {
			const tr = el("tr");
			tr.appendChild(el("td", "num", String(i + 1)));
			tr.appendChild(el("td", null, t.name));
			tr.appendChild(el("td", null, t.conf));
			tr.appendChild(el("td", null, t.w + "-" + t.l + (t.confRegularChamp ? " ★" : "")));
			tr.appendChild(el("td", null, t.cw + "-" + t.cl));
			tr.appendChild(el("td", "num", t.sosAvg.toFixed(1)));
			tr.appendChild(el("td", "num", t.offRtg ? t.offRtg.toFixed(1) : "—"));
			tr.appendChild(el("td", "num", t.defRtg ? t.defRtg.toFixed(1) : "—"));
			tr.appendChild(el("td", null, t.ncaaSeed ? "No. " + t.ncaaSeed : "—"));
			tr.appendChild(el("td", null, t.ncaaResult || t.nitResult ||
				(t.bid ? "NCAA field" : "—")));
			tr.appendChild(wrapCell(
				t.prospects.map((p) => p.name + " (" + p.newOvr + ")").join(", ")));
			tb.appendChild(tr);
		});
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);
		view.appendChild(el("p", "legendline",
			"★ = regular-season conference champion. Records include the " +
			"postseason."));

		view.appendChild(el("h3", null, "Programs with prospects in this class"));
		const cards = el("div", "cards");
		const withP = Object.values(res.teams)
			.filter((t) => t.prospects.length)
			.sort((a, b) => b.resume - a.resume);
		for (const t of withP) {
			const c = el("div", "card");
			c.appendChild(el("h4", null,
				t.name + " — " + t.w + "-" + t.l + (t.apRank ? "  (AP #" + t.apRank + ")" : "")));
			const best = t.log.filter((g) => g.won).sort((a, b) => b.quality - a.quality)[0];
			c.appendChild(el("div", "note",
				t.conf + " " + t.cw + "-" + t.cl +
				(t.style ? " · plays " + t.style.name : "") +
				(t.confRegularChamp ? " · regular-season champion" : "") +
				(t.confTourneyChamp ? " · conference tournament champion" : "") +
				"\n" + (t.ncaaSeed ? "No. " + t.ncaaSeed + " seed, " + t.ncaaResult
					: t.nitResult ? t.nitResult : "Did not make the field") +
				(t.offRtg ? "\nORtg " + t.offRtg.toFixed(1) + " · DRtg " + t.defRtg.toFixed(1) : "") +
				(best ? "\nBest win: " + best.pf + "-" + best.pa + " over " + best.opp : "") +
				"\n" + t.prospects.map((p) =>
					"  " + p.name + " — " + p.newOvr + "/" + p.newPot + " " + p.newPos +
					", " + n1(p.stats.ppg) + "/" + n1(p.stats.rpg) + "/" + n1(p.stats.apg)).join("\n")));
			cards.appendChild(c);
		}
		view.appendChild(cards);

		const leagues = res.proLeagues || {};
		for (const name of Object.keys(leagues)) {
			const lg = leagues[name];
			view.appendChild(el("h3", null, name + " — " +
				(lg.champion ? lg.champion.name + " win the title" : "season table") +
				(lg.cup && lg.cup.champion ? ", " + lg.cup.champion.name + " win the cup" : "")));
			const env = lg.env || {};
			view.appendChild(el("p", "legendline",
				"Own environment: " + env.pace + " possessions over " + env.gameMinutes +
				"-minute games" +
				(env.youthCap ? ", teenagers capped at " + env.youthCap + " minutes" : "") + "."));
			const lw = el("div", "scroll");
			const lt = el("table");
			const lh = el("thead");
			const lhr = el("tr");
			for (const h of ["#", "Club", "Record", "Prospects"]) {
				const th = el("th", h === "#" ? "num" : "", h);
				th.scope = "col";
				lhr.appendChild(th);
			}
			lh.appendChild(lhr);
			lt.appendChild(lh);
			const lb = el("tbody");
			lg.table.forEach((c, i) => {
				const tr = el("tr");
				tr.appendChild(el("td", "num", String(i + 1)));
				tr.appendChild(el("td", null, c.name + (c.leagueChamp ? " 🏆" : "") +
					(c.cupChamp ? " 🥇" : "") + (c.relegated ? " ↓" : "")));
				tr.appendChild(el("td", null, c.w + "-" + c.l));
				tr.appendChild(wrapCell(c.prospects.map((p) =>
					p.name + " (" + n1(p.stats.ppg) + " ppg" +
					(p.proDeal ? ", " + p.proDeal : "") + ")").join(", ")));
				lb.appendChild(tr);
			});
			lt.appendChild(lb);
			lw.appendChild(lt);
			view.appendChild(lw);
			if (lg.relegated && lg.relegated.length) {
				view.appendChild(el("p", "legendline",
					"↓ relegated: " + lg.relegated.map((c) => c.name).join(", ")));
			}
		}
	}

	/* ------------------------------------------------------------- bracket */

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
		// The bracket was pure visual structure with no accessible text at all.
		g.setAttribute("role", "group");
		g.setAttribute("aria-label",
			(winner === a ? a.name : b.name) + " beat " +
			(winner === a ? b.name : a.name) + (score ? ", " + score : ""));
		return g;
	}

	function viewBracket(view, res) {
		const st = A().state;
		const t = res.tourney;
		const head = el("div", "rowflex");
		head.appendChild(el("span", "pill",
			"Champion: " + t.champion.team.name + " (No. " + t.champion.seed + ")"));
		head.appendChild(el("span", "pill", "Runner-up: " + t.runnerUp.team.name));
		head.appendChild(el("span", "pill",
			"Final Four: " + t.finalFour.map((x) => x.team.name).join(", ")));
		const upsets = [];
		for (const r of global.Tournament.REGIONS) {
			for (const round of t.regions[r].rounds) {
				for (const g of round) if (g.upset) upsets.push(g);
			}
		}
		head.appendChild(el("span", "pill", upsets.length + " upsets"));
		const compact = el("label", "check");
		const cb = el("input");
		cb.type = "checkbox";
		cb.checked = st.compactBracket;
		cb.addEventListener("change", () => {
			st.compactBracket = cb.checked;
			A().persist();
			A().render();
		});
		compact.appendChild(cb);
		compact.appendChild(document.createTextNode(" compact (winners only)"));
		head.appendChild(compact);
		view.appendChild(head);

		const cinderella = [];
		for (const r of global.Tournament.REGIONS) {
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
		sel.setAttribute("aria-label", "Follow a team's path through the bracket");
		sel.appendChild(new Option("follow a team's path…", ""));
		const inField = [];
		for (const r of global.Tournament.REGIONS) {
			for (const x of t.regions[r].seeds) inField.push(x);
		}
		inField.sort((a, b) => a.team.name.localeCompare(b.team.name));
		for (const x of inField) sel.appendChild(new Option(x.team.name, x.team.name));
		const out = el("div", "note");
		out.setAttribute("role", "status");
		sel.addEventListener("change", () => {
			out.textContent = "";
			if (!sel.value) return;
			const lines = [];
			for (const r of global.Tournament.REGIONS) {
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
		const REG = global.Tournament.REGIONS;
		const mirror = el("div", "bracketwrap");
		const leftCol = el("div", "half");
		const rightCol = el("div", "half right");
		REG.forEach((region, i) => {
			const r = t.regions[region];
			const box = el("div", "regionbox");
			box.appendChild(el("h4", null, region + " — " + r.champ.team.name + " advances"));
			if (st.compactBracket) {
				/* Four rounds scrolling horizontally inside a box that is
				   itself in a column gave you nested horizontal scroll. Compact
				   mode lists the winners instead. */
				const cr = el("div", "compactregion");
				const ol = el("ol");
				r.rounds.forEach((games, gi) => {
					const li = el("li");
					li.appendChild(el("b", null, (ROUNDS[gi] || "Round " + (gi + 1)) + ": "));
					li.appendChild(document.createTextNode(
						games.map((g) => g.winner.seed + " " + g.winner.team.name +
							(g.upset ? " ⚡" : "")).join(", ")));
					ol.appendChild(li);
				});
				cr.appendChild(ol);
				box.appendChild(cr);
			} else {
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
			}
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
			"Last in:  " + t.selection.atLarge.slice(-4).map((x) => x.name + " (" + x.regW + "-" + x.regL + ")").join(", ") +
			"\nFirst out: " + t.selection.bubble.slice(0, 4).map((x) => x.name + " (" + x.regW + "-" + x.regL + ")").join(", ");
		view.appendChild(bub);

		if (t.nit && t.nit.champion) {
			view.appendChild(el("h3", null, "NIT — " + t.nit.champion.name + " win it"));
			view.appendChild(el("p", "legendline",
				"Thirty-two teams that missed the 68. A fringe prospect's team " +
				"plays somewhere in March."));
			const nit = el("div", "note");
			nit.textContent = t.nit.field
				.filter((x) => (x.nitWins || 0) >= 2)
				.sort((a, b) => (b.nitWins || 0) - (a.nitWins || 0))
				.map((x) => x.nitResult + " — " + x.name + " (" + x.w + "-" + x.l + ")")
				.join("\n");
			view.appendChild(nit);
		}
	}

	/* --------------------------------------------------------------- awards */

	function leaderTable(res, title, key, fmt) {
		const list = res.players.filter((p) => p.stats && p.stats.mpg >= 15)
			.sort((a, b) => b.stats[key] - a.stats[key])
			.slice(0, 10);
		const box = el("div", "card");
		box.appendChild(el("h4", null, title));
		box.appendChild(el("div", "note", list.map((p, i) =>
			(i + 1) + ". " + (fmt ? fmt(p.stats[key]) : n1(p.stats[key])) + "  " +
			p.name + " (" + (p.proClub || p.newCollege) + ")").join("\n")));
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
		leaders.appendChild(leaderTable(res, "Contested shots", "cspg"));
		leaders.appendChild(leaderTable(res, "Deflections", "deflpg"));
		leaders.appendChild(leaderTable(res, "Defensive rating", "drtg",
			(v) => v.toFixed(1)));
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
				"Nobody in this class cleared the field. Lower the award sliders to hand out more."));
		}
		view.appendChild(el("p", "legendline",
			"Prospects are ranked against every returning player in Division I — " +
			"against their actual simulated seasons, not a formula — so an " +
			"All-America slot has to be earned."));
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

	/* ----------------------------------------------------------- draft board */

	function viewBoard(view, res) {
		view.appendChild(el("p", "legendline",
			"The file already carries draft.round and draft.pick and the tool " +
			"used them as nothing but a class-order proxy. This is the board the " +
			"simulated season implies: a preseason ranking from ratings alone, " +
			"then what the year actually showed."));
		const cards = el("div", "cards");
		const mk = (title, list, sign) => {
			const box = el("div", "card");
			box.appendChild(el("h4", null, title));
			box.appendChild(el("div", "note", list.length
				? list.map((p) => (sign && p.stockMove > 0 ? "+" : "") + p.stockMove +
					"  No. " + p.boardRank + "  " + p.name + " (" +
					(p.proClub || p.newCollege) + ")").join("\n")
				: "nobody moved"));
			return box;
		};
		cards.appendChild(mk("Risers", res.risers || [], true));
		cards.appendChild(mk("Fallers", res.fallers || [], true));
		view.appendChild(cards);

		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["Board", "Rd", "Pick", "Player", "Pos", "Year", "Ovr", "Pot",
			"School / club", "Preseason", "±", "PPG", "Honours"]) {
			const th = el("th", ["Board", "Rd", "Pick", "Ovr", "Pot", "Preseason", "±", "PPG"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		for (const p of res.board || []) {
			const tr = el("tr");
			tr.tabIndex = 0;
			tr.addEventListener("click", () => {
				A().state.tab = "players";
				A().openEditor(p);
			});
			tr.appendChild(el("td", "num", String(p.boardRank)));
			tr.appendChild(el("td", "num", p.mockRound ? String(p.mockRound) : "—"));
			tr.appendChild(el("td", "num", p.mockPick ? String(p.mockPick) : "—"));
			tr.appendChild(el("td", "sticky", p.name));
			tr.appendChild(el("td", null, p.newPos));
			tr.appendChild(el("td", null, p.classYear));
			tr.appendChild(el("td", "num", String(p.newOvr)));
			tr.appendChild(el("td", "num", String(p.newPot)));
			tr.appendChild(el("td", null, p.proClub || p.newCollege));
			tr.appendChild(el("td", "num", String(p.preseasonRank)));
			const mv = el("td", "num");
			mv.appendChild(el("span", p.stockMove > 0 ? "up" : p.stockMove < 0 ? "down" : "",
				p.stockMove === 0 ? "—" : (p.stockMove > 0 ? "+" : "") + p.stockMove));
			tr.appendChild(mv);
			tr.appendChild(el("td", "num", p.stats ? n1(p.stats.ppg) : ""));
			tr.appendChild(wrapCell((p.awards || []).slice(0, 3).join("; ")));
			tb.appendChild(tr);
		}
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);
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
		for (const v of values) counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
		const max = Math.max.apply(null, counts);
		const chart = el("div", "hist");
		chart.setAttribute("role", "img");
		const sorted = values.slice().sort((a, b) => a - b);
		const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
		chart.setAttribute("aria-label", title + ": " + values.length + " values from " +
			lo.toFixed(1) + " to " + hi.toFixed(1) + ", median " + q(0.5).toFixed(1));
		counts.forEach((c, i) => {
			const row = el("div", "histrow");
			row.appendChild(el("span", "histlabel",
				(fmt ? fmt(lo + i * width) : (lo + i * width).toFixed(1))));
			const bar = el("span", "histbar");
			bar.style.width = (max ? (100 * c) / max : 0) + "%";
			bar.title = c + " prospects between " + (lo + i * width).toFixed(1) +
				" and " + (lo + (i + 1) * width).toFixed(1);
			row.appendChild(bar);
			row.appendChild(el("span", "histcount", String(c)));
			chart.appendChild(row);
		});
		box.appendChild(chart);
		// Axis ticks: min / median / max under the bars, which cost nothing and
		// were simply absent.
		const axis = el("div", "histaxis");
		axis.appendChild(el("span"));
		const ticks = el("span", "ticks");
		ticks.appendChild(el("span", null, "0"));
		ticks.appendChild(el("span", null, Math.round(max / 2) + " players"));
		ticks.appendChild(el("span", null, String(max)));
		axis.appendChild(ticks);
		axis.appendChild(el("span"));
		box.appendChild(axis);
		box.appendChild(el("div", "note",
			"min " + lo.toFixed(1) + " · median " + q(0.5).toFixed(1) +
			" · p90 " + q(0.9).toFixed(1) + " · max " + hi.toFixed(1)));
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
		cards.appendChild(histogram("Defensive rating", withStats.map((p) => p.stats.drtg), 12));

		const counts = {};
		for (const p of res.players) counts[p.archetype] = (counts[p.archetype] || 0) + 1;
		const archBox = el("div", "card");
		archBox.appendChild(el("h4", null, "Archetypes in this class" +
			(res.flavor && res.flavor.name !== "balanced" ? " (" + res.flavor.label + ")" : "")));
		archBox.appendChild(el("div", "note", Object.keys(counts)
			.sort((a, b) => counts[b] - counts[a])
			.map((k) => String(counts[k]).padStart(3) + "  " + k).join("\n")));
		cards.appendChild(archBox);

		const years = {};
		for (const p of res.players) years[p.classYear] = (years[p.classYear] || 0) + 1;
		const yBox = el("div", "card");
		yBox.appendChild(el("h4", null, "Class years"));
		yBox.appendChild(el("div", "note", Object.keys(years).sort()
			.map((k) => String(years[k]).padStart(3) + "  " + k).join("\n")));
		cards.appendChild(yBox);

		const paths = { transfers: 0, redshirts: 0, reclass: 0, fiveStar: 0, headliners: 0 };
		for (const p of res.players) {
			if (p.transfer) paths.transfers++;
			if (p.redshirt) paths.redshirts++;
			if (p.reclassified) paths.reclass++;
			if (p.recruiting && p.recruiting.stars === 5) paths.fiveStar++;
			if (p.recruiting && p.recruiting.headliner) paths.headliners++;
		}
		const pBox = el("div", "card");
		pBox.appendChild(el("h4", null, "How they got here"));
		pBox.appendChild(el("div", "note",
			String(paths.transfers).padStart(3) + "  transfers\n" +
			String(paths.redshirts).padStart(3) + "  redshirted\n" +
			String(paths.reclass).padStart(3) + "  reclassified\n" +
			String(paths.fiveStar).padStart(3) + "  five-star recruits\n" +
			String(paths.headliners).padStart(3) + "  headline signing of their class"));
		cards.appendChild(pBox);
		view.appendChild(cards);
	}

	/* ---------------------------------------------------------------- notes */

	function viewNotes(view, res) {
		const st = A().state;
		view.appendChild(el("p", "legendline",
			"This is exactly what gets written into each player's note field in the " +
			"exported file. Choose which lines appear under “Note template” in the sidebar."));
		const bar = el("div", "filters");
		/* The Notes search used to share state.filter.q with the Prospects tab,
		   so typing here silently filtered the table over there. */
		bar.appendChild(searchInput("Search notes…", "Search notes",
			() => st.noteQuery, (v) => { st.noteQuery = v; }));
		const copy = el("button", null, "Copy all notes");
		copy.addEventListener("click", () => {
			A().copyText(res.players.slice().sort((a, b) => b.newOvr - a.newOvr)
				.map((p) => p.name + "\n" + p.note).join("\n\n"), copy, "Copy all notes");
		});
		bar.appendChild(copy);
		const tsv = el("button", null, "Copy as spreadsheet rows");
		tsv.addEventListener("click", () => {
			const rows = res.players.slice().sort((a, b) => b.newOvr - a.newOvr)
				.map((p) => [p.name, (p.note || "").replace(/\n/g, " · ")].join("\t"));
			A().copyText(["name\tnote"].concat(rows).join("\n"), tsv,
				"Copy as spreadsheet rows");
		});
		bar.appendChild(tsv);
		view.appendChild(bar);

		const q = (st.noteQuery || "").toLowerCase();
		const cards = el("div", "cards");
		for (const p of res.players.slice().sort((a, b) => b.newOvr - a.newOvr)) {
			if (q && (p.name + "\n" + p.note).toLowerCase().indexOf(q) === -1) continue;
			const c = el("div", "card");
			c.appendChild(el("h4", null, p.name));
			c.appendChild(el("div", "note", p.note));
			cards.appendChild(c);
		}
		view.appendChild(cards);
	}

	/* ------------------------------------------------------------ game logs */

	function viewGameLog(view, res) {
		const st = A().state;
		view.appendChild(el("p", "legendline",
			"Every prospect's season, game by game. The old model drew these " +
			"lines to find one season high and then threw the array away."));
		const bar = el("div", "filters");
		const sel = el("select");
		sel.setAttribute("aria-label", "Choose a prospect");
		const sorted = res.players.slice().sort((a, b) => (a.boardRank || 0) - (b.boardRank || 0));
		for (const p of sorted) {
			if (!p.gameLog) continue;
			sel.appendChild(new Option("No. " + p.boardRank + "  " + p.name + " — " +
				(p.proClub || p.newCollege), p.key));
		}
		if (!sel.options.length) {
			view.appendChild(el("p", "legendline", "No game logs in this class."));
			return;
		}
		if (!st.logPlayer || !sorted.some((p) => p.key === st.logPlayer)) {
			st.logPlayer = sel.options[0].value;
		}
		sel.value = st.logPlayer;
		sel.addEventListener("change", () => { st.logPlayer = sel.value; A().render(); });
		bar.appendChild(sel);
		view.appendChild(bar);

		const p = res.players.filter((x) => x.key === st.logPlayer)[0];
		if (!p || !p.gameLog) return;
		const gl = p.gameLog;
		const head = el("div", "rowflex");
		for (const t of [
			p.name + " · " + p.newPos + " · " + (p.proClub || p.newCollege),
			"season " + n1(p.stats.ppg) + "/" + n1(p.stats.rpg) + "/" + n1(p.stats.apg),
			"highs " + gl.highs.pts + "p " + gl.highs.reb + "r " + gl.highs.ast + "a",
			gl.twentyPointGames + " 20-point games",
			gl.doubleDoubles + " double-doubles",
		]) head.appendChild(el("span", "pill", t));
		if (gl.hotStreak) {
			head.appendChild(el("span", "pill",
				"best run: " + gl.hotStreak.games + " games at " + n1(gl.hotStreak.ppg)));
		}
		if (gl.injury) {
			head.appendChild(el("span", "pill",
				"missed " + gl.injury.games + " with " + gl.injury.kind));
		}
		view.appendChild(head);

		if (gl.splits) {
			const sp = el("div", "note");
			const line = (label, s) => (s
				? label + ": " + s.gp + " GP, " + n1(s.ppg) + " / " + n1(s.rpg) + " / " + n1(s.apg)
				: null);
			sp.textContent = [
				line("Before the turn of the year", gl.splits.early),
				line("Conference season", gl.splits.late),
				gl.postseason ? line("Postseason", gl.postseason) : null,
			].filter(Boolean).join("\n");
			view.appendChild(sp);
		}

		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["#", "Opponent", "Stage", "Result", "PTS", "REB", "AST", "STL", "BLK", "TO"]) {
			const th = el("th", ["#", "PTS", "REB", "AST", "STL", "BLK", "TO"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		gl.games.forEach((g, i) => {
			const tr = el("tr");
			tr.appendChild(el("td", "num", String(i + 1)));
			tr.appendChild(el("td", "sticky", g.opp));
			tr.appendChild(el("td", null, g.round || (g.conference ? "conference" : "non-conference")));
			tr.appendChild(el("td", null, (g.won ? "W " : "L ") + g.pf + "-" + g.pa +
				(g.ot ? (g.ot > 1 ? " " + g.ot + "OT" : " OT") : "")));
			for (const k of ["pts", "reb", "ast", "stl", "blk", "tov"]) {
				const td = el("td", "num", String(g[k]));
				if (k === "pts" && g.pts === gl.highs.pts) td.className = "num up";
				tr.appendChild(td);
			}
			tb.appendChild(tr);
		});
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);
	}

	/* --------------------------------------------------------------- compare */

	function viewCompare(view, res) {
		const pinned = A().state.pinned;
		if (!pinned) {
			view.appendChild(el("p", "legendline",
				"Press Pin to keep this class as a baseline, then change the " +
				"settings or reroll: this tab shows what moved. The seed history " +
				"could take you back to a class but never showed you what changed."));
			return;
		}
		const now = A().snapshot(res);
		view.appendChild(el("p", "legendline",
			"Pinned: seed " + pinned.seed + " · " + (pinned.flavor || "no flavour") +
			"    vs    current: seed " + now.seed + " · " + (now.flavor || "no flavour")));

		const cards = el("div", "cards");
		const num = (label, a, b, digits) => {
			const d = b - a;
			const box = el("div", "card");
			box.appendChild(el("h4", null, label));
			const v = el("div", "note");
			v.textContent = a.toFixed(digits === undefined ? 2 : digits) + "  →  " +
				b.toFixed(digits === undefined ? 2 : digits) +
				"   (" + (d >= 0 ? "+" : "") + d.toFixed(digits === undefined ? 2 : digits) + ")";
			box.appendChild(v);
			cards.appendChild(box);
		};
		num("Average overall", pinned.avgOvr, now.avgOvr);
		num("Average potential", pinned.avgPot, now.avgPot);
		num("Average PPG", pinned.avgPpg, now.avgPpg);
		num("Average MPG", pinned.avgMpg, now.avgMpg);
		num("Scoring leader", pinned.topPpg, now.topPpg);
		num("Honours handed out", pinned.awards, now.awards, 0);
		num("Distinct archetypes", pinned.archetypes, now.archetypes, 0);
		view.appendChild(cards);

		view.appendChild(el("h3", null, "Player by player"));
		const byKey = {};
		for (const p of pinned.players) byKey[p.key] = p;
		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["Player", "Ovr", "Pot", "Archetype", "School", "PPG", "Board"]) {
			const th = el("th", ["Ovr", "Pot", "PPG", "Board"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		for (const p of now.players) {
			const was = byKey[p.key];
			if (!was) continue;
			const tr = el("tr");
			tr.appendChild(el("td", "sticky", p.name));
			const cmpNum = (a, b, digits) => {
				const td = el("td", "num");
				td.appendChild(document.createTextNode(
					digits ? b.toFixed(digits) : String(b)));
				const d = b - a;
				if (Math.abs(d) > (digits ? 0.05 : 0)) {
					td.appendChild(el("span", d > 0 ? "up" : "down",
						" " + (d > 0 ? "+" : "") + (digits ? d.toFixed(digits) : d)));
				}
				tr.appendChild(td);
			};
			cmpNum(was.ovr, p.ovr);
			cmpNum(was.pot, p.pot);
			const arch = el("td", null, p.archetype);
			if (was.archetype !== p.archetype) {
				arch.className = "up";
				arch.title = "was " + was.archetype;
			}
			tr.appendChild(arch);
			const school = el("td", null, p.college);
			if (was.college !== p.college) {
				school.className = "up";
				school.title = "was " + was.college;
			}
			tr.appendChild(school);
			cmpNum(was.ppg, p.ppg, 1);
			cmpNum(was.board, p.board);
			tb.appendChild(tr);
		}
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);
	}

	global.Views = {
		players: viewPlayers, teams: viewTeams, bracket: viewBracket, bulkBar,
		awards: viewAwards, board: viewBoard, distribution: viewDistribution,
		notes: viewNotes, gamelog: viewGameLog, compare: viewCompare,
		COLUMNS, STAT_MODES, PCT_KEYS, statValue, matchesFilter, histogram,
		el, n1, pc, wrapCell,
	};
})(window);
