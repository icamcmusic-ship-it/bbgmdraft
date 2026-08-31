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
		/* Team context. All three are on res.teams and none of them was shown,
		   so a 19-point scorer's row said nothing about whether he did it for a
		   one seed or for a team that finished 9-22. */
		{ key: "record", label: "Team", num: false, off: true, title: "His team's record" },
		{ key: "apRank", label: "AP", num: true, off: true, title: "His team's final AP ranking" },
		{ key: "seed", label: "Seed", num: true, off: true, title: "His team's NCAA tournament seed" },
		// Physicals, which varySize can change and which were never displayed.
		{ key: "hgtInches", label: "Ht", num: true, off: true, phys: true, title: "Listed height" },
		{ key: "weight", label: "Wt", num: true, off: true, phys: true, title: "Listed weight in pounds" },
		{ key: "gp", label: "GP", num: true, stat: true },
		{ key: "mpg", label: "MPG", num: true, stat: true },
		{ key: "ppg", label: "PPG", num: true, stat: true },
		/* The shape of a season, which no average can carry: a man who scored
		   14 every night and one who scored 6 until January and 22 after read
		   as the same row. Off by default — it is a picture, not a number, so
		   it does not sort and it costs a column. */
		{ key: "trend", label: "Trend", num: false, off: true, stat: true,
			title: "Points per game across the season, game by game" },
		{ key: "rpg", label: "RPG", num: true, stat: true },
		{ key: "orpg", label: "ORB", num: true, stat: true, off: true },
		{ key: "drpg", label: "DRB", num: true, stat: true, off: true },
		{ key: "apg", label: "APG", num: true, stat: true },
		{ key: "spg", label: "SPG", num: true, stat: true },
		{ key: "bpg", label: "BPG", num: true, stat: true },
		{ key: "topg", label: "TO", num: true, stat: true },
		{ key: "pfpg", label: "PF", num: true, stat: true },
		/* Shooting VOLUME. Every one of these numbers was already on p.stats and
		   none of them was on screen, so the table could tell you a prospect
		   shot 35% from three and not whether that was on two attempts a game
		   or on eight — which for a draft tool is the single most-missed set of
		   columns there is. */
		{ key: "fga", label: "FGA", num: true, stat: true, off: true, title: "Field-goal attempts" },
		{ key: "tpa", label: "3PA", num: true, stat: true, off: true, title: "Three-point attempts" },
		{ key: "fta", label: "FTA", num: true, stat: true, off: true, title: "Free-throw attempts" },
		{ key: "tpar", label: "3PAr", num: true, off: true, derived: true, title: "Share of shots taken from three, as a ratio (.381 = 38.1%)" },
		{ key: "ftr", label: "FTr", num: true, off: true, derived: true, title: "Free-throw attempts per field-goal attempt, as a ratio" },
		{ key: "cspg", label: "CS", num: true, stat: true, off: true, title: "Contested shots per game" },
		{ key: "deflpg", label: "DEFL", num: true, stat: true, off: true, title: "Deflections per game" },
		{ key: "chgpg", label: "CHG", num: true, stat: true, off: true, title: "Charges drawn per game" },
		{ key: "drtg", label: "DRtg", num: true, off: true, title: "Points allowed per 100 possessions on the floor" },
		{ key: "ortg", label: "ORtg", num: true, off: true, derived: true, title: "Points produced per 100 possessions he used" },
		{ key: "usg", label: "USG%", num: true, title: "Share of team chances used on the floor" },
		{ key: "fgp", label: "FG%", num: true },
		{ key: "efg", label: "eFG%", num: true, off: true, derived: true, title: "Field-goal percentage counting a three as one and a half shots" },
		{ key: "tpp", label: "3P%", num: true },
		{ key: "ftp", label: "FT%", num: true },
		{ key: "ts", label: "TS%", num: true },
		{ key: "astTo", label: "A:TO", num: true, off: true, derived: true, title: "Assists per turnover" },
		{ key: "prod", label: "PROD", num: true, off: true, derived: true, title: "Production score — the single number the award model ranks on" },
		{ key: "awards", label: "Honors", num: false },
	];
	const PCT_KEYS = { usg: 1, fgp: 1, tpp: 1, ftp: 1, ts: 1, efg: 1 };

	/* Columns computed from the stat line rather than stored on it. They were
	   all derivable and none of them was derived, which is why a table with
	   thirty-three columns still could not answer "who is efficient on volume".
	   Per-game / totals / per-40 does not apply to a ratio, so these are
	   excluded from statValue's unit conversion. */
	const DERIVED = {
		tpar: (s) => (s.fga > 0 ? s.tpa / s.fga : undefined),
		ftr: (s) => (s.fga > 0 ? s.fta / s.fga : undefined),
		efg: (s) => (s.fga > 0 ? (s.fgp * s.fga + 0.5 * s.tpa * s.tpp) / s.fga : undefined),
		astTo: (s) => (s.topg > 0.02 ? s.apg / s.topg : undefined),
		// Points produced per 100 chances used, the offensive mirror of DRtg.
		ortg: (s) => {
			const used = s.fga + 0.44 * s.fta + s.topg;
			return used > 0 ? (100 * (s.ppg + 1.1 * s.apg)) / used : undefined;
		},
		// awards.js already computes exactly this to rank the whole country;
		// there was no reason for it to be invisible.
		prod: (s) => s.ppg + 1.2 * s.rpg + 1.7 * s.apg + 2.6 * s.spg + 2.6 * s.bpg -
			0.8 * s.topg + 55 * (s.ts - 0.52),
	};

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
		if (!s) return undefined;
		if (DERIVED[key]) {
			const d = DERIVED[key](s);
			return Number.isFinite(d) ? d : undefined;
		}
		if (s[key] === undefined) return undefined;
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

	/* The value a column shows, for anything: a stat, a derived stat, a team
	   context field or a physical. One function so the table, the CSV, the
	   range filters and the sort all agree on what a column means. */
	function cellValue(p, key, res, mode) {
		const s = p.stats;
		const team = res && res.teams ? res.teams[p.newCollege] : null;
		switch (key) {
		case "newOvr": return p.newOvr;
		case "newPot": return p.newPot;
		case "board": return p.boardRank;
		case "move": return p.stockMove || 0;
		case "hgtInches": return p.newHgtInches;
		case "weight": return p.newWeight;
		case "apRank": return team ? team.apRank : undefined;
		case "seed": return team ? team.ncaaSeed : undefined;
		// Sorted and filtered on games above .500, which is what the cell shows.
		case "record": return team ? team.w - team.l : undefined;
		default:
			if (!s) return undefined;
			return PCT_KEYS[key] && !DERIVED[key] ? s[key] : statValue(p, key, mode);
		}
	}

	/* Height as a person reads it. */
	function feet(inches) {
		if (!Number.isFinite(inches)) return "";
		return Math.floor(inches / 12) + "'" + Math.round(inches % 12) + '"';
	}

	/* --- the phone layout ------------------------------------------------

	   css/style.css has carried a `.cardtable` rule since the table grew past
	   thirty columns: below 700px each row becomes a card and each cell prints
	   its own column label. NOTHING EVER ADDED THE CLASS. So the rule was dead
	   and a phone got the desktop table — forty columns behind a horizontal
	   scroll with a sticky name column, which is exactly the "you cannot see
	   more than three columns at once" the audit describes.

	   Two things are needed and only one of them is the class. A card that
	   stacks forty labelled lines per prospect is not an improvement on a
	   scroll; it is the same information in a taller shape. So the card layout
	   also has its own column set — the twelve fields a scout reads first —
	   independent of whichever columns the user has ticked for the desktop
	   table, with a control to show everything for the cases where that is what
	   they want.

	   `auto` follows the viewport, which is what a phone user wants and a
	   desktop user never notices; `on` and `off` are there because a tablet in
	   landscape is a genuine judgement call and because a narrow window on a
	   desktop is not necessarily a phone. */
	const CARD_COLUMNS = ["pick", "lock", "name", "pos", "year", "board",
		"newOvr", "newPot", "archetype", "college", "mpg", "ppg", "rpg", "apg",
		"ts", "awards"];
	const CARD_BREAKPOINT = 700;

	function cardMode() {
		const st = A().state;
		const pref = st.cardView || "auto";
		if (pref === "on") return true;
		if (pref === "off") return false;
		return typeof window !== "undefined" && window.innerWidth <= CARD_BREAKPOINT;
	}

	/* The table's column ORDER, which used to be the order of the COLUMNS
	   array and nothing else.

	   Columns could be shown, hidden and saved as a layout, and their order was
	   fixed by a literal in this file — so a user who wanted PPG next to TS%,
	   which is a completely ordinary thing to want in a table with forty
	   columns and two of them relevant to the question in front of them, could
	   not have it without editing the source. Drag-and-drop reordering is what
	   every data table does.

	   `state.columnOrder` is a list of keys. It is a PREFERENCE, not a schema:
	   any key it does not mention keeps its position from COLUMNS, and any key
	   it mentions that no longer exists is dropped. So a stored order survives
	   a release that adds or removes a column instead of pinning the table to
	   whatever the columns were on the day it was saved. */
	function orderedColumns() {
		const order = A().state.columnOrder;
		if (!Array.isArray(order) || !order.length) return COLUMNS.slice();
		const byKey = {};
		for (const c of COLUMNS) byKey[c.key] = c;
		const out = [];
		const seen = {};
		for (const k of order) {
			if (!byKey[k] || seen[k]) continue;
			seen[k] = true;
			out.push(byKey[k]);
		}
		// Anything the stored order never heard of keeps its place relative to
		// the columns around it, which is the only behaviour that makes a
		// partial order safe.
		COLUMNS.forEach((c, i) => {
			if (seen[c.key]) return;
			// Insert after the last already-placed column that precedes it in
			// the canonical order.
			let at = out.length;
			for (let j = i + 1; j < COLUMNS.length; j++) {
				const idx = out.indexOf(byKey[COLUMNS[j].key]);
				if (idx !== -1) { at = idx; break; }
			}
			out.splice(at, 0, c);
			seen[c.key] = true;
		});
		return out;
	}

	function visibleColumns() {
		const hidden = A().state.hiddenColumns || {};
		return orderedColumns().filter((c) => c.fixed || !hidden[c.key]);
	}

	/* --------------------------------------------------------------- table */

	/* What the pinned baseline recorded for one player and one column, so the
	   main table can show a ± against it. Returns undefined when nothing is
	   pinned or the player is not in the pinned class. */
	const PINNED_COLS = { ppg: 1, rpg: 1, apg: 1, mpg: 1, ts: 1, board: 1 };
	function pinnedValue(key, col) {
		const st = A().state;
		// A ± is only meaningful against the same units. Season totals and
		// per-40 are conversions of a per-game snapshot; don't pretend.
		if (st.statMode !== "perGame" || !PINNED_COLS[col]) return undefined;
		const pin = st.pinned;
		if (!pin || !pin.byKey) return undefined;
		const p = pin.byKey[key];
		return p && Number.isFinite(p[col]) ? p[col] : undefined;
	}

	/* O·P·A·S·H·N — overall, potential, archetype, school, height, name. */
	const LOCK_KEYS = [
		["ovr", "O", "overall"], ["pot", "P", "potential"],
		["archetype", "A", "archetype"], ["college", "S", "school"],
		["hgtInches", "H", "listed height"], ["name", "N", "name"],
	];
	function lockBadge(ov) {
		const on = LOCK_KEYS.filter(([k]) => ov[k] !== undefined && ov[k] !== null)
			.map(([, letter]) => letter);
		if (ov.ratings && Object.keys(ov.ratings).length) on.push("R");
		// A per-player reroll is state, not a lock; it gets its own mark.
		if (Number(ov.reroll)) on.push("↻");
		return on.length ? on.join("·") : "🔒";
	}
	function lockSummary(ov) {
		const bits = LOCK_KEYS.filter(([k]) => ov[k] !== undefined && ov[k] !== null)
			.map(([k, , label]) => label + " = " + ov[k]);
		if (ov.ratings && Object.keys(ov.ratings).length) {
			bits.push("ratings: " + Object.keys(ov.ratings)
				.map((k) => k + " " + ov.ratings[k]).join(", "));
		}
		if (Number(ov.reroll)) bits.push("rerolled on his own " + ov.reroll + " time(s)");
		return bits.length
			? "Locked — survives a reroll:\n  " + bits.join("\n  ")
			: "Nothing locked.";
	}

	function potTooltip(p) {
		const f = p.potFactors;
		if (!f) return "Potential " + p.newPot;
		const label = {
			arch: "archetype", age: "age", ageClass: "age within the class",
			touch: "shooting touch (FT%)", frame: "frame", role: "role vs production",
			bias: "your potential bias slider",
		};
		const bits = Object.keys(label)
			.filter((k) => Number.isFinite(f[k]) && Math.abs(f[k]) >= 0.3)
			.map((k) => "  " + label[k] + " " + (f[k] > 0 ? "+" : "") + f[k].toFixed(1));
		return "Potential " + p.newPot + " — built from ovr " + p.newOvr + " plus:\n" +
			(bits.length ? bits.join("\n") : "  nothing notable");
	}

	function delta(now, before) {
		const d = now - before;
		const s = el("span", d > 0 ? "up" : d < 0 ? "down" : "");
		s.textContent = d === 0 ? "" : (d > 0 ? " +" : " ") + d;
		return s;
	}

	/* Multi-column sort. shift-click adds a key rather than replacing it, so
	   "tier, then PPG" is expressible. */
	/* Multi-key comparison with one rule for missing values: they sort LAST,
	   in whichever direction the column is sorted.

	   `(va || 0) - (vb || 0)` made a player with no stat line indistinguishable
	   from one who genuinely averaged 0.0, so sorting by PPG put the
	   international prospects who never played among the men who played and
	   scored nothing. The string branch fired if EITHER value was a string, so
	   a column with mixed types compared as text or as numbers depending on
	   which pair the sort happened to reach first, which is not a total order
	   and can leave the result in any arrangement at all. Now the type of the
	   comparison is decided by the column, once. */
	function isBlank(v) {
		return v === undefined || v === null || v === "" ||
			(typeof v === "number" && !Number.isFinite(v));
	}

	function sortRows(rows) {
		const keys = A().state.sort;
		const numeric = {};
		for (const { key } of keys) {
			const col = COLUMNS.filter((c) => c.key === key)[0];
			numeric[key] = col ? col.num !== false : true;
		}
		return rows.slice().sort((a, b) => {
			for (const { key, dir } of keys) {
				const va = a.sortVals[key];
				const vb = b.sortVals[key];
				const ba = isBlank(va);
				const bb = isBlank(vb);
				// Missing sorts last either way, so reversing a column never
				// fills the top of the table with players who have no value.
				if (ba || bb) {
					if (ba && bb) continue;
					return (ba ? 1 : -1) * dir;
				}
				const cmp = numeric[key]
					? Number(va) - Number(vb)
					: String(va).localeCompare(String(vb));
				if (cmp) return cmp * dir;
			}
			return 0;
		});
	}

	/* The sort stack, shown and editable. Shift-clicking added a level and
	   there was no way to see the whole stack or to remove one of them, so
	   "tier, then PPG, then oh no what did I click" was a one-way trip. */
	function sortStack() {
		const st = A().state;
		const bar = el("div", "sortstack");
		if (!st.sort.length) return bar;
		bar.appendChild(el("span", "hint", "sorted by "));
		st.sort.forEach((k, i) => {
			const col = COLUMNS.filter((c) => c.key === k.key)[0];
			const chip = el("span", "chip");
			chip.appendChild(document.createTextNode(
				(i + 1) + ". " + ((col && col.label) || k.key) + (k.dir < 0 ? " ▾" : " ▴")));
			const flip = el("button", "tiny", "⇅");
			flip.title = "Reverse this level";
			flip.setAttribute("aria-label", "Reverse the sort on " + ((col && col.label) || k.key));
			flip.addEventListener("click", () => {
				k.dir *= -1;
				A().persist();
				A().render();
			});
			chip.appendChild(flip);
			if (st.sort.length > 1) {
				const rm = el("button", "tiny", "×");
				rm.title = "Remove this sort level";
				rm.setAttribute("aria-label", "Remove the sort on " + ((col && col.label) || k.key));
				rm.addEventListener("click", () => {
					st.sort.splice(i, 1);
					A().persist();
					A().render();
				});
				chip.appendChild(rm);
			}
			bar.appendChild(chip);
		});
		return bar;
	}

	/* The column being dragged, if any. One at a time by construction, and
	   cleared on dragend so an interrupted drag cannot leave the next click
	   reordering something. */
	let dragKey = null;

	/* Write a new column order. Always stores the FULL order rather than a
	   diff, so the stored preference is self-describing; orderedColumns()
	   handles a stored order that is missing keys or names dead ones. */
	function setColumnOrder(keys) {
		A().state.columnOrder = keys;
		A().persist();
		A().render();
	}

	function dropColumn(movedKey, targetKey, after) {
		const keys = orderedColumns().map((c) => c.key);
		const from = keys.indexOf(movedKey);
		if (from === -1) return;
		keys.splice(from, 1);
		let at = keys.indexOf(targetKey);
		if (at === -1) return;
		if (after) at++;
		keys.splice(at, 0, movedKey);
		setColumnOrder(keys);
	}

	/* One step left or right, skipping the fixed columns so a column can never
	   be moved in front of the sticky name column. */
	function moveColumn(key, dir) {
		const cols = orderedColumns();
		const keys = cols.map((c) => c.key);
		const from = keys.indexOf(key);
		if (from === -1) return;
		let to = from + dir;
		while (to >= 0 && to < cols.length && cols[to].fixed) to += dir;
		if (to < 0 || to >= cols.length) return;
		keys.splice(from, 1);
		keys.splice(to, 0, key);
		setColumnOrder(keys);
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
				/* Keyboard reordering. Drag-and-drop is the discoverable path
				   and it is not the only one that has to exist: alt+arrow moves
				   the column, which is reachable without a pointer and is how
				   the reorder is testable at all. */
				if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) {
					e.preventDefault();
					moveColumn(col.key, e.key === "ArrowLeft" ? -1 : 1);
				}
			});
			/* Drag to reorder. The fixed columns (selection, lock, name) do not
			   move: the name is the sticky column the horizontal scroll is
			   anchored on, and the two controls belong beside it. */
			if (!col.fixed) {
				th.draggable = true;
				th.dataset.colkey = col.key;
				th.addEventListener("dragstart", (ev) => {
					dragKey = col.key;
					th.classList.add("dragging");
					if (ev.dataTransfer) {
						ev.dataTransfer.effectAllowed = "move";
						// Firefox will not start a drag without data set.
						try { ev.dataTransfer.setData("text/plain", col.key); } catch (x) { /* ok */ }
					}
				});
				th.addEventListener("dragend", () => {
					dragKey = null;
					th.classList.remove("dragging");
					for (const x of table.querySelectorAll("th.dropbefore, th.dropafter")) {
						x.classList.remove("dropbefore", "dropafter");
					}
				});
				th.addEventListener("dragover", (ev) => {
					if (!dragKey || dragKey === col.key) return;
					ev.preventDefault();
					if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
					const r = th.getBoundingClientRect();
					const after = ev.clientX > r.left + r.width / 2;
					th.classList.toggle("dropbefore", !after);
					th.classList.toggle("dropafter", after);
				});
				th.addEventListener("dragleave", () => {
					th.classList.remove("dropbefore", "dropafter");
				});
				th.addEventListener("drop", (ev) => {
					ev.preventDefault();
					if (!dragKey || dragKey === col.key) return;
					const r = th.getBoundingClientRect();
					dropColumn(dragKey, col.key, ev.clientX > r.left + r.width / 2);
					dragKey = null;
				});
				th.title = (col.title || col.label) +
					" — click to sort, shift-click to add a level, " +
					"drag (or alt+←/→) to reorder";
			}
			const si = sort.findIndex((s) => s.key === col.key);
			if (si >= 0) {
				th.textContent = col.label + (sort[si].dir < 0 ? " ▾" : " ▴") +
					(sort.length > 1 ? String(si + 1) : "");
				th.setAttribute("aria-sort", sort[si].dir < 0 ? "descending" : "ascending");
				th.classList.add("sorted");
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

	/* Move focus (and, when the editor is open, the editor) one row along. */
	function moveRow(from, dir, follow) {
		const rows = Array.prototype.slice.call(
			from.parentNode ? from.parentNode.querySelectorAll("tr") : []);
		const i = rows.indexOf(from);
		const next = rows[i + dir];
		if (!next) return;
		// Roving tabindex: the row with focus is the one row in the tab order.
		from.tabIndex = -1;
		from.removeAttribute("data-focus");
		next.tabIndex = 0;
		next.setAttribute("data-focus", "row");
		if (follow && next.dataset.pkey) {
			A().state.editing = next.dataset.pkey;
			A().render();
			const again = document.querySelector('tr[data-pkey="' +
				next.dataset.pkey.replace(/["\\]/g, "\\$&") + '"]');
			if (again) again.focus();
			return;
		}
		next.focus();
	}

	/* A twelve-pixel scoring trend for one prospect's season.

	   The Game logs tab has the whole thing, but SHAPE is what a scout reads
	   off a season and the table could only show a mean: a man who scored 14 a
	   game every night and one who scored 6 until January and 22 after are the
	   same row. Inline SVG, no library, and it degrades to nothing when there
	   is no log to draw. */
	const SPARK_W = 64;
	const SPARK_H = 16;
	function sparkline(p, key) {
		const games = p.gameLog && p.gameLog.games;
		if (!games || games.length < 4) return null;
		const vals = games.map((g) => g[key] || 0);
		const hi = Math.max.apply(null, vals) || 1;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "spark");
		svg.setAttribute("viewBox", "0 0 " + SPARK_W + " " + SPARK_H);
		svg.setAttribute("width", String(SPARK_W));
		svg.setAttribute("height", String(SPARK_H));
		svg.setAttribute("aria-hidden", "true");
		svg.setAttribute("focusable", "false");
		const step = SPARK_W / Math.max(1, vals.length - 1);
		const y = (v) => SPARK_H - 1.5 - (v / hi) * (SPARK_H - 3);
		/* The season average, as a reference line. Sixty-four pixels of trend
		   with nothing behind it shows only the SHAPE — a man who scored 6 then
		   22 and a man who scored 16 then 18 draw very similar rising lines,
		   because each is scaled to its own maximum. The mean says where the
		   shape sits. Drawn from a theme token rather than an opacity, so it
		   survives a dark background; see .sparkbase in css/style.css. */
		const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
		const base = document.createElementNS("http://www.w3.org/2000/svg", "path");
		base.setAttribute("d", "M0 " + y(mean).toFixed(1) + "L" + SPARK_W + " " +
			y(mean).toFixed(1));
		base.setAttribute("class", "sparkbase");
		svg.appendChild(base);
		let d = "";
		vals.forEach((v, i) => { d += (i ? "L" : "M") + (i * step).toFixed(1) + " " + y(v).toFixed(1); });
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d);
		path.setAttribute("class", "sparkline");
		svg.appendChild(path);
		/* A title, because the picture is the point and its scale is not
		   readable from sixty-four pixels. */
		const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
		t.textContent = vals.length + " games, high " + hi + ", average " +
			mean.toFixed(1) + " (the dotted line)";
		svg.appendChild(t);
		return svg;
	}

	/* One line saying where a number came from, for the table's hover text.
	   Everything here is already on the player or his team; the point is that
	   reading it required opening a panel. */
	function explainCell(p, key, res) {
		const s = p.stats;
		if (!s) return "";
		const team = res.teams[p.newCollege];
		const where = p.proClub || p.newCollege;
		const who = p.name + " — " + p.archetype + ", " + p.classYear + ", " + where;
		const pace = team && Number.isFinite(team.pace)
			? team.pace.toFixed(1) + " possessions" : null;
		switch (key) {
		case "ppg":
			return who + ". " + pc(s.usg) + " of his team's chances over " +
				n1(s.mpg) + " minutes at " + pc(s.ts) + " true shooting" +
				(pace ? ", on " + pace + " a game" : "") + ".";
		case "mpg":
			return who + ". Rotation slot " + ((p.minutesRank || 0) + 1) +
				" on a team rated " + (team ? Math.round(team.level) : "—") + ".";
		case "usg":
			return who + ". Usage is what a coach gives him: build, class year " +
				"and his own role, then his share of what his teammates leave.";
		case "apg":
		case "rpg":
		case "spg":
		case "bpg":
			return who + ". His share of the team pool, by weight and minutes.";
		case "ts":
		case "fgp":
		case "tpp":
		case "ftp":
			return who + ". Shooting composites against a player of his size, " +
				"the defences he faced, and how much of the offence he carried.";
		default:
			return who + ".";
		}
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
		if (f.archetype && p.archetype !== f.archetype) return false;
		if (f.conf) {
			const t = res.teams[p.newCollege];
			const conf = t ? t.conf : (p.nonNcaa ? p.newCollege : "");
			if (conf !== f.conf) return false;
		}
		if (f.changedOnly && !p.collegeChanged) return false;
		if (f.lockedOnly && !A().state.overrides[p.key]) return false;
		/* Numeric range filters. For a 70-man class across forty columns,
		   "show me everyone over 18 points a game" and "overall 45 to 55" are
		   the two verbs the table did not have: you could search text and pick
		   a position, and that was all. */
		for (const r of f.ranges || []) {
			if (!r.key) continue;
			const raw = cellValue(p, r.key, res, A().state.statMode);
			/* A player with no value for the column is EXCLUDED and counted,
			   not silently deleted.

			   apRank and seed only exist for D-I players, so adding a range
			   filter on either made every EuroLeague, G League and DII prospect
			   vanish from the table with nothing on screen to say why — the
			   count line said "41 of 70 shown" and the missing 29 had no
			   attribute in common the user could see. It is the same outcome,
			   but the row count now names it (see rangeBar). */
			if (raw === undefined || !Number.isFinite(raw)) {
				p.rangeNoValue = true;
				return false;
			}
			// Percentages are entered the way they are displayed.
			const v = PCT_KEYS[r.key] ? raw * 100 : raw;
			if (Number.isFinite(r.min) && v < r.min) return false;
			if (Number.isFinite(r.max) && v > r.max) return false;
		}
		return true;
	}

	/* Every column a range filter can be built on. */
	function numericColumns() {
		return COLUMNS.filter((c) => c.num && c.key !== "pick" && c.key !== "lock");
	}

	function rangeBar(res) {
		const st = A().state;
		const bar = el("div", "filters ranges");
		const rows = st.filter.ranges || (st.filter.ranges = []);
		const commit = () => { A().persist(); A().render(); };
		rows.forEach((r, i) => {
			const grp = el("span", "rangefilter");
			const sel = el("select");
			sel.setAttribute("aria-label", "Filter column");
			sel.appendChild(new Option("— column —", ""));
			for (const c of numericColumns()) {
				sel.appendChild(new Option(c.label || c.key, c.key));
			}
			sel.value = r.key || "";
			sel.addEventListener("change", () => { r.key = sel.value; commit(); });
			grp.appendChild(sel);
			const box = (which, ph) => {
				const inp = el("input");
				inp.type = "number";
				inp.step = "any";
				inp.className = "rangebox";
				inp.placeholder = ph;
				inp.setAttribute("aria-label", ph + " for " + (r.key || "the chosen column"));
				inp.value = Number.isFinite(r[which]) ? String(r[which]) : "";
				const apply = () => {
					r[which] = inp.value === "" ? undefined : Number(inp.value);
					commit();
				};
				inp.addEventListener("change", apply);
				grp.appendChild(inp);
			};
			box("min", "min");
			box("max", "max");
			/* The scale a value is entered on. "PPG over 18" and "TS% over 55"
			   are two different scales — PCT_KEYS multiplies by 100 for entry —
			   and nothing on screen said so, so "TS% over 0.55" quietly matched
			   nobody. */
			if (r.key) {
				const unit = PCT_KEYS[r.key] ? "%"
					: (r.key === "tpar" || r.key === "ftr") ? "rate 0-1"
					: r.key === "hgtInches" ? "inches"
					: r.key === "weight" ? "lb"
					: "";
				if (unit) grp.appendChild(el("span", "unit", unit));
			}
			const rm = el("button", "tiny", "×");
			rm.title = "Remove this filter";
			rm.setAttribute("aria-label", "Remove the " + (r.key || "empty") + " filter");
			rm.addEventListener("click", () => { rows.splice(i, 1); commit(); });
			grp.appendChild(rm);
			bar.appendChild(grp);
		});
		const add = el("button", "tiny", "+ range filter");
		add.title = "Filter on a number — “PPG over 18”, “ovr 45 to 55”";
		add.addEventListener("click", () => { rows.push({ key: "", min: undefined, max: undefined }); commit(); });
		bar.appendChild(add);
		if (rows.length) {
			const clear = el("button", "tiny", "Clear ranges");
			clear.addEventListener("click", () => { st.filter.ranges = []; commit(); });
			bar.appendChild(clear);
		}
		return bar;
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
		/* The re-render restores focus and the caret by itself (see
		   App.render), so this no longer reaches for `the first search input in
		   the document` — which grabbed the wrong box on any tab with two of
		   them — and no longer forces the caret to the end of the value 180ms
		   after every keystroke, which made editing the middle of a query
		   impossible: type "pointguard", click between the words to add a
		   space, and the caret snapped back to the end. */
		q.setAttribute("data-focus", "search:" + label);
		let t = null;
		q.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => {
				setter(q.value);
				A().render();
			}, 180);
		});
		return q;
	}

	function filterBar(res) {
		const st = A().state;
		const bar = el("div", "filters");
		const search = searchInput(
			"Search name, school, archetype, honour…", "Search prospects",
			() => st.filter.q, (v) => { st.filter.q = v; });
		// So "/" has something to focus.
		search.id = "prospectSearch";
		bar.appendChild(search);

		/* Step through the class one build at a time. Reading a class by
		   archetype — every Rim Protector, then every Stretch Big — is how you
		   see whether a build is doing what you asked of it, and the only way
		   to do it was to type the name and retype it. */
		const archSel = el("select");
		archSel.id = "archFilter";
		archSel.setAttribute("aria-label", "Filter by archetype");
		archSel.appendChild(new Option("all builds", ""));
		const present = {};
		for (const p of res.players) if (p.archetype) present[p.archetype] = true;
		for (const a of Object.keys(present).sort()) archSel.appendChild(new Option(a, a));
		archSel.value = st.filter.archetype || "";
		archSel.addEventListener("change", () => {
			st.filter.archetype = archSel.value;
			A().render();
		});
		bar.appendChild(archSel);

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

		/* The card/table switch. Only shown where it is a real choice — on a
		   wide desktop the table is obviously right and the control is noise. */
		if (cardMode() || (typeof window !== "undefined" &&
			window.innerWidth <= 1100)) {
			const cv = el("select");
			cv.setAttribute("aria-label", "Table or card layout");
			for (const [k, l] of [["auto", "layout: automatic"],
				["on", "layout: cards"], ["off", "layout: table"]]) {
				cv.appendChild(new Option(l, k));
			}
			cv.value = st.cardView || "auto";
			cv.addEventListener("change", () => {
				st.cardView = cv.value;
				A().persist();
				A().render();
			});
			bar.appendChild(cv);
			if (cardMode()) {
				const all = el("label", "check");
				const cb = el("input");
				cb.type = "checkbox";
				cb.checked = !!st.cardAll;
				cb.addEventListener("change", () => {
					st.cardAll = cb.checked;
					A().persist();
					A().render();
				});
				all.appendChild(cb);
				all.appendChild(document.createTextNode(" all columns"));
				all.title = "Cards show the twelve fields a scout reads first. " +
					"Tick to show every column you have enabled.";
				bar.appendChild(all);
			}
		}

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

		/* Saved layouts. The built-in presets below cover the common views, but
		   with forty-odd columns everyone ends up with one arrangement they
		   actually work in, and it had to be rebuilt from the checkbox grid
		   every time the built-ins were used. These persist with the rest of
		   the settings. */
		const saved = st.columnLayouts || (st.columnLayouts = {});
		const savedRow = el("div", "rowflex");
		savedRow.appendChild(el("span", "hint", "Your layouts:"));
		const names = Object.keys(saved).sort();
		if (!names.length) savedRow.appendChild(el("span", "hint", "none yet"));
		for (const name of names) {
			const b = el("button", "tiny", name);
			b.addEventListener("click", () => {
				st.hiddenColumns = Object.assign({}, saved[name]);
				A().closeModal();
				A().persist();
				A().render();
			});
			savedRow.appendChild(b);
			const x = el("button", "tiny", "×");
			x.title = "Delete the layout “" + name + "”";
			x.setAttribute("aria-label", "Delete the layout " + name);
			x.addEventListener("click", () => {
				delete saved[name];
				A().persist();
				columnPicker();
			});
			savedRow.appendChild(x);
		}
		const saveBtn = el("button", "tiny", "Save this layout…");
		saveBtn.addEventListener("click", () => {
			const name = window.prompt("Name this column layout:", "");
			if (!name || !name.trim()) return;
			saved[name.trim()] = Object.assign({}, st.hiddenColumns);
			A().persist();
			A().setStatus("Saved the column layout “" + name.trim() + "”.");
			columnPicker();
		});
		savedRow.appendChild(saveBtn);
		box.appendChild(savedRow);

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
			"archetype", "college", "conf", "hgtInches", "weight",
			"mpg", "ppg", "rpg", "apg", "ts", "awards"]);
		preset("Box score", ["pos", "college", "gp", "mpg", "ppg", "rpg", "apg",
			"spg", "bpg", "topg", "pfpg", "fgp", "tpp", "ftp", "ts"]);
		// "35% from three" means nothing without "on 7.8 attempts".
		preset("Shooting", ["pos", "college", "mpg", "ppg", "fga", "tpa", "fta",
			"tpar", "ftr", "fgp", "efg", "tpp", "ftp", "ts", "usg"]);
		preset("Efficiency", ["pos", "college", "mpg", "usg", "ts", "efg", "ortg",
			"drtg", "astTo", "prod", "ppg", "apg", "topg"]);
		preset("Defence", ["pos", "college", "mpg", "drpg", "spg", "bpg", "cspg",
			"deflpg", "chgpg", "drtg", "pfpg", "awards"]);
		preset("Team context", ["pos", "college", "conf", "record", "apRank", "seed",
			"newOvr", "mpg", "ppg", "usg", "ts", "awards"]);
		box.appendChild(el("h4", null, "Presets"));
		box.appendChild(presets);

		/* Order. The picker could show and hide columns and had nothing to say
		   about the order they came in, because there was no order to say
		   anything about — it was the order of the COLUMNS literal. This is the
		   way back from a drag that went wrong, and the place the reorder is
		   discoverable from for anyone who never tries dragging a header. */
		box.appendChild(el("h4", null, "Order"));
		const orderRow = el("div", "rowflex");
		orderRow.appendChild(el("span", "hint",
			"Drag a column heading in the table to move it, or focus one and " +
			"press alt+← / alt+→."));
		const resetOrder = el("button", "tiny", "Reset the column order");
		resetOrder.disabled = !Array.isArray(st.columnOrder) || !st.columnOrder.length;
		resetOrder.addEventListener("click", () => {
			st.columnOrder = null;
			A().persist();
			A().closeModal();
			A().render();
		});
		orderRow.appendChild(resetOrder);
		box.appendChild(orderRow);
		A().modal("Columns", box, () => { A().persist(); A().render(); });
	}

	function viewPlayers(view, res) {
		const st = A().state;
		const summary = el("div", "rowflex");
		const ncaa = res.players.filter((p) => !p.nonNcaa);
		const conv = res.players.filter((p) => p.collegeChanged);
		/* Every one of these divided or Math.max'd over a list that validation
		   makes non-empty for a whole class — but the same helpers run over
		   filtered sets and over classes with no D-I players at all, where
		   Math.max.apply(null, []) is -Infinity and a mean is NaN. */
		const n = res.players.length || 1;
		const avgOvr = res.players.reduce((a, p) => a + p.newOvr, 0) / n;
		const avgOld = res.players.reduce((a, p) => a + p.origOvr, 0) / n;
		const pills = [
			res.players.length + " prospects",
			"avg ovr " + avgOld.toFixed(1) + " → " + avgOvr.toFixed(1),
			"top ovr " + (res.players.length
				? Math.max.apply(null, res.players.map((p) => p.newOvr)) : "—"),
			conv.length + " colleges reassigned",
			ncaa.length + " in NCAA D-I",
			Object.keys(st.overrides).length + " locked",
		];
		if (res.flavor && res.flavor.name !== "balanced") {
			pills.push("this class is " + res.flavor.label);
		}
		/* What makes THIS class this one. The class is drawn from a pool of
		   builds and given two to four forced anomalies, and both were
		   invisible: a user rerolling had no way to see that the year was a
		   stretch-big year, only to feel that it was not. */
		if (res.archetypePool && res.archetypePool.length) {
			pills.push(res.archetypePool.length + " builds in this class");
		}
		for (const t of pills) summary.appendChild(el("span", "pill", t));
		view.appendChild(summary);
		if (res.surprises && res.surprises.length) {
			const line = el("p", "legendline");
			line.appendChild(document.createTextNode("Story of the class: "));
			res.surprises.forEach((sp, i) => {
				if (i) line.appendChild(document.createTextNode(" · "));
				const b = el("button", "linky", sp.player + ", " + sp.label);
				b.addEventListener("click", () => {
					const who = res.players.filter((x) => x.key === sp.key)[0];
					if (who) A().openEditor(who);
				});
				line.appendChild(b);
			});
			view.appendChild(line);
		}
		/* Realignment. The map of college basketball changing is a thing a
		   season is remembered for, and it happened silently. */
		if (res.realignment && res.realignment.length) {
			const line = el("p", "legendline");
			line.appendChild(document.createTextNode(
				"Realignment: " + res.realignment
					.map((m) => m.school + " leaves the " + m.from + " for the " + m.to)
					.join(" · ")));
			view.appendChild(line);
		}
		/* What happened during the season, and what happened on draft day. Both
		   are read off results the sim already produced (see midSeasonEvents in
		   js/teams.js and DRAFT_EVENTS in js/engine.js); before this the season
		   was a list of scores and the board was a sorted list, and neither of
		   them could say a single thing about itself. */
		if (res.seasonEvents && res.seasonEvents.length) {
			const line = el("p", "legendline");
			line.appendChild(document.createTextNode("The season: " +
				res.seasonEvents.map((e) => e.text).join(" · ")));
			view.appendChild(line);
		}
		if (res.draftEvents && res.draftEvents.length) {
			const line = el("p", "legendline");
			line.appendChild(document.createTextNode("Draft day: "));
			res.draftEvents.forEach((e, i) => {
				if (i) line.appendChild(document.createTextNode(" · "));
				const b = el("button", "linky", e.player + " " + e.text);
				b.title = e.detail || "";
				b.addEventListener("click", () => {
					const who = res.players.filter((x) => x.key === e.key)[0];
					if (who) A().openEditor(who);
				});
				line.appendChild(b);
			});
			view.appendChild(line);
		}
		view.appendChild(filterBar(res));
		view.appendChild(rangeBar(res));
		view.appendChild(bulkBar(res));

		/* On a phone the card layout picks its own columns (see CARD_COLUMNS):
		   the desktop selection is a choice about a wide table and applying it
		   to a stack of labelled lines produces a forty-line card. `cardAll`
		   opts back in to everything. */
		const cards = cardMode();
		const columns = cards && !st.cardAll
			? orderedColumns().filter((c) => CARD_COLUMNS.indexOf(c.key) !== -1)
			: visibleColumns();
		for (const p of res.players) p.rangeNoValue = false;
		const shown = res.players.filter((p) => matchesFilter(p, res));
		const noValue = res.players.filter((p) => p.rangeNoValue).length;
		const mode = st.statMode;
		const rows = shown.map((p) => {
			const s = p.stats || {};
			const team = res.teams[p.newCollege];
			const tr = el("tr");
			const cls = [];
			if (st.overrides[p.key]) cls.push("locked");
			if (st.selected[p.key]) cls.push("picked");
			tr.className = cls.join(" ");
			/* Roving tabindex. Every row used to be tabIndex 0, so reaching the
			   editor below a 70-man table meant seventy tab stops. One row is
			   in the tab order — the one being edited, or the first — and the
			   arrow keys move between rows from there, which is how a grid is
			   supposed to behave. */
			tr.tabIndex = -1;
			tr.dataset.pkey = p.key;
			if (st.editing === p.key) tr.classList.add("editing");
			const open = () => A().openEditor(p);
			tr.addEventListener("click", (e) => {
				if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
				open();
			});
			/* Right-click a row for the things you want to do TO a prospect as
			   against edit about him. Adding to the comparison in particular
			   had no path from the table at all: you read a row, decided you
			   wanted it beside another one, and then went to a different tab to
			   find it again in a dropdown of seventy names. */
			tr.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				rowMenu(e, p, res);
			});
			/* Row navigation. The editor opened on click and there was no way to
			   walk the class from the keyboard, so reviewing seventy prospects
			   meant seventy round trips to the mouse. j/k and the arrow keys
			   move; if the editor is open it follows you down the table. */
			tr.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); return; }
				const d = (e.key === "j" || e.key === "ArrowDown") ? 1
					: (e.key === "k" || e.key === "ArrowUp") ? -1 : 0;
				if (!d) return;
				e.preventDefault();
				moveRow(tr, d, st.editing !== null);
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
				case "lock": {
					/* WHAT is locked, not merely that something is. A padlock
					   with no detail meant opening the editor to find out
					   whether you had pinned his overall or only his school. */
					const ov = st.overrides[p.key];
					td = el("td", null, "");
					if (ov) {
						/* Clearing a lock meant a round trip into the editor and
						   back for something the badge is already showing you.
						   The badge is a button: click (or long-press) it and
						   the lock is gone, without opening the row. */
						const btn = el("button", "lockbadge", lockBadge(ov));
						btn.title = lockSummary(ov) + " — click to clear";
						btn.setAttribute("aria-label",
							"Clear the locks on " + p.name + ": " + lockSummary(ov));
						btn.addEventListener("click", (e) => {
							e.stopPropagation();
							A().clearLock(p);
						});
						td.appendChild(btn);
					}
					sortVals.lock = ov ? Object.keys(ov).length : 0;
					break;
				}
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
					/* p.potFactors carries the whole reason a player has upside
					   — archetype, age, age within the class, shooting touch,
					   frame, role against production — and only the editor
					   showed it. It belongs on the number it explains. */
					td.title = potTooltip(p);
					sortVals.newPot = p.newPot;
					break;
				case "archetype": {
					td = el("td");
					/* The build's signature ratings, on the row.

					   The offsets were on a `title` attribute only, which is
					   invisible on a touch device and unreliable to a screen
					   reader — so on a phone the archetype was a name and
					   nothing else. The three ratings the build leans on are
					   printed beside it, and the full vector stays on the title
					   and in aria-label for anyone who wants all of it. */
					const tag = el("span", "tag arch", p.archetype);
					const raw = (RB.RAW_OFFSETS || {})[p.archetype] || {};
					const keys = Object.keys(raw)
						.sort((x, y) => Math.abs(raw[y]) - Math.abs(raw[x]));
					const full = keys.length
						? keys.map((k) => k + " " + (raw[k] > 0 ? "+" : "") + raw[k]).join(", ")
						: "no offsets — the build BBGM would have produced";
					tag.title = p.archetype + ": " + full;
					tag.setAttribute("aria-label", p.archetype + ", " + full);
					td.appendChild(tag);
					const top = keys.filter((k) => raw[k] > 0).slice(0, 3);
					if (top.length) {
						td.appendChild(el("span", "offsets",
							" " + top.map((k) => k + "+" + raw[k]).join(" ")));
					}
					sortVals.archetype = p.archetype;
					break;
				}
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
				case "record":
					td = el("td", null, team ? team.w + "-" + team.l : "");
					sortVals.record = team ? team.w - team.l : undefined;
					break;
				case "apRank":
					td = el("td", "num", team && team.apRank ? "#" + team.apRank : "");
					// Unranked sorts below every ranked team, not above them.
					sortVals.apRank = team && team.apRank ? -team.apRank : -999;
					break;
				case "seed":
					td = el("td", "num", team && team.ncaaSeed ? String(team.ncaaSeed) : "");
					sortVals.seed = team && team.ncaaSeed ? -team.ncaaSeed : -99;
					break;
				case "hgtInches":
					td = el("td", "num", feet(p.newHgtInches));
					sortVals.hgtInches = p.newHgtInches;
					break;
				case "weight":
					td = el("td", "num",
						Number.isFinite(p.newWeight) ? String(p.newWeight) : "");
					sortVals.weight = p.newWeight;
					break;
				case "trend": {
					td = el("td", "sparkcell");
					const sp = sparkline(p, "pts");
					if (sp) td.appendChild(sp);
					else td.textContent = "—";
					break;
				}
				default: {
					const v = cellValue(p, col.key, res, mode);
					const base = v === undefined ? ""
						: PCT_KEYS[col.key] ? pc(v)
						// Rate ratios read as .381, the way every box score prints them.
						: (col.key === "tpar" || col.key === "ftr") ? v.toFixed(3)
						: col.key === "gp" ||
							(mode === "totals" && !col.derived && col.key !== "drtg")
							? String(Math.round(v)) : n1(v);
					td = el("td", "num", base);
					/* A small delta against the pinned class, so Pin is useful
					   from the main table and not only from the Compare tab.
					   delta() already existed and was used on two columns. */
					const before = pinnedValue(p.key, col.key);
					if (Number.isFinite(before) && Number.isFinite(v)) {
						const d = v - before;
						const shown = PCT_KEYS[col.key] ? (d * 100).toFixed(1) : d.toFixed(1);
						if (Math.abs(Number(shown)) >= 0.05) {
							td.appendChild(el("span", d > 0 ? "up" : "down",
								" " + (d > 0 ? "+" : "") + shown));
						}
					}
					sortVals[col.key] = v;
				}
				}
				/* The label the card layout prints beside the value on a phone
				   (see the max-width: 700px block in css/style.css). A
				   forty-column horizontal scroll is unusable however it is
				   arranged, so under 700px each row becomes a card — which
				   needs every cell to be able to say what it is. */
				if (col.label && !col.fixed) td.setAttribute("data-label", col.label);
				/* "Explain this number" without opening the editor. The editor
				   has explain panels and you had to open a player to reach one,
				   so scanning a table for a number that looks wrong meant a
				   round trip per number. */
				if (!td.title && col.stat && p.stats) td.title = explainCell(p, col.key, res);
				tr.appendChild(td);
			}
			return { node: tr, sortVals };
		});

		view.appendChild(el("p", "legendline",
			shown.length + " of " + res.players.length + " prospects shown · " +
			(noValue ? noValue + " excluded for having no value in a filtered " +
				"column (AP rank and seed only exist for D-I players) · " : "") +
			"click a row to edit and lock, click a column to sort " +
			"(shift-click for a second level)"));
		view.appendChild(sortStack());
		if (!shown.length) {
			/* An empty table with no explanation is the worst possible answer
			   to a filter that matched nothing: it looks like the tool broke. */
			view.appendChild(emptyState(res));
			return;
		}
		/* The editor used to be appended AFTER the table, so clicking row 4 of
		   70 put the panel you were meant to edit in sixty-six rows below the
		   fold. It is a drawer beside the table now (and above it on a narrow
		   screen), so the row and its editor are visible at the same time. */
		const split = el("div", "tablesplit");
		if (cards) split.classList.add("cardtable");
		const wrap = el("div", "scroll");
		const table = buildTable(rows, columns);
		wrap.appendChild(table);
		// The single row in the tab order: the one being edited if it is shown,
		// otherwise the first.
		const body = table.querySelector("tbody");
		const first = body &&
			(body.querySelector('tr[data-pkey="' + st.editing + '"]') ||
				body.querySelector("tr"));
		if (first) {
			first.tabIndex = 0;
			first.setAttribute("data-focus", "row");
		}
		split.appendChild(wrap);
		if (st.editing !== null) {
			const p = res.players.filter((x) => x.key === st.editing)[0];
			if (p) {
				const drawer = el("aside", "drawer");
				drawer.setAttribute("aria-label", "Editing " + p.name);
				drawer.appendChild(A().editorPanel(p, res));
				split.appendChild(drawer);
				split.classList.add("open");
			}
		}
		view.appendChild(split);
	}

	/* The row context menu. Positioned at the pointer, dismissed by the next
	   click or Escape, and rebuilt each time rather than kept around — it holds
	   a reference to one prospect and one result, and a stale one pointing at a
	   rerolled class is worse than no menu. */
	let openMenu = null;
	function closeRowMenu() {
		if (!openMenu) return;
		if (openMenu.parentNode) openMenu.parentNode.removeChild(openMenu);
		openMenu = null;
	}

	function rowMenu(e, p, res) {
		closeRowMenu();
		const st = A().state;
		const menu = el("div", "rowmenu");
		menu.setAttribute("role", "menu");
		const item = (label, fn, title) => {
			const b = el("button", null, label);
			b.setAttribute("role", "menuitem");
			if (title) b.title = title;
			b.addEventListener("click", () => { closeRowMenu(); fn(); });
			menu.appendChild(b);
		};
		item("Open the editor", () => A().openEditor(p));
		const slot = (st.compare || []).indexOf(p.key);
		if (slot === -1) {
			const free = (st.compare || []).indexOf(null);
			item(free === -1 ? "Add to compare (replaces the first)" : "Add to compare",
				() => {
					const c = (st.compare || []).slice();
					c[free === -1 ? 0 : free] = p.key;
					st.compare = c;
					A().persist();
					A().setStatus(p.name + " added to the comparison.");
					A().render();
				},
				"Hold him beside up to three others on the Compare tab");
		} else {
			item("Remove from compare", () => {
				const c = st.compare.slice();
				c[slot] = null;
				st.compare = c;
				A().persist();
				A().render();
			});
		}
		item("Compare with the rest of his position",
			() => {
				const keys = res.players.filter((x) => x.newPos === p.newPos)
					.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999))
					.slice(0, COMPARE_MAX).map((x) => x.key);
				// Whoever was right-clicked is always in the comparison, even
				// if his board rank leaves him outside the best four.
				if (keys.indexOf(p.key) === -1) keys[keys.length - 1] = p.key;
				st.compare = keys.concat(new Array(COMPARE_MAX).fill(null))
					.slice(0, COMPARE_MAX);
				st.tab = "compare";
				A().persist();
				A().render();
			},
			"The best " + COMPARE_MAX + " " + (p.newPos || "players") +
			" in the class, side by side");
		item("Show his game log", () => {
			st.logPlayer = p.key;
			st.tab = "gamelog";
			A().persist();
			A().render();
		});
		if (p.newCollege) {
			item("Open " + p.newCollege, () => {
				st.team = p.newCollege;
				st.tab = "teams";
				A().persist();
				A().render();
			});
		}
		document.body.appendChild(menu);
		// Kept inside the viewport: a right-click near the bottom right of the
		// window would otherwise put the menu off the edge of it.
		const r = menu.getBoundingClientRect();
		const x = Math.min(e.clientX, window.innerWidth - r.width - 8);
		const y = Math.min(e.clientY, window.innerHeight - r.height - 8);
		menu.style.left = Math.max(4, x) + "px";
		menu.style.top = Math.max(4, y) + "px";
		openMenu = menu;
		setTimeout(() => {
			document.addEventListener("click", closeRowMenu, { once: true });
			document.addEventListener("contextmenu", closeRowMenu, { once: true });
		}, 0);
	}

	/* Nothing matched. Say which filters are on and offer to clear them. */
	function emptyState(res) {
		const st = A().state;
		const f = st.filter;
		const box = el("div", "card empty-state");
		box.appendChild(el("h4", null, "No prospects match"));
		const on = [];
		if (f.q) on.push('search "' + f.q + '"');
		if (f.pos) on.push("position " + f.pos);
		if (f.conf) on.push("conference " + f.conf);
		if (f.changedOnly) on.push("reassigned colleges only");
		if (f.lockedOnly) on.push("locked players only");
		for (const r of f.ranges || []) {
			if (!r.key) continue;
			const col = COLUMNS.filter((c) => c.key === r.key)[0];
			const label = (col && col.label) || r.key;
			on.push(label +
				(Number.isFinite(r.min) ? " ≥ " + r.min : "") +
				(Number.isFinite(r.max) ? " ≤ " + r.max : ""));
		}
		box.appendChild(el("p", "hint", on.length
			? "Active filters: " + on.join(" · ")
			: "Every prospect in this class is hidden."));
		const clear = el("button", "tiny", "Clear all filters");
		clear.addEventListener("click", () => {
			st.filter = { q: "", pos: "", conf: "", changedOnly: false,
				lockedOnly: false, ranges: [] };
			A().persist();
			A().render();
		});
		box.appendChild(clear);
		return box;
	}

	/* ------------------------------------------------------------ bulk edit */

	function bulkBar(res) {
		const st = A().state;
		const bar = el("div", "filters");
		bar.id = "bulkBar";
		const count = Object.keys(st.selected).length;
		const label = el("span", "pill", count + " selected");
		bar.appendChild(label);

		/* Selecting the top of the board. "Everything above the fold" is what a
		   user means and it took a shift-click they did not have. */
		const topN = el("select");
		topN.setAttribute("aria-label", "Select the top of the board");
		topN.appendChild(new Option("select top…", ""));
		for (const n of [5, 10, 14, 15, 20, 30, 60]) {
			topN.appendChild(new Option("top " + n, String(n)));
		}
		topN.addEventListener("click", (e) => e.stopPropagation());
		topN.addEventListener("change", () => {
			const n = Number(topN.value);
			topN.value = "";
			if (!n) return;
			const order = res.players.slice()
				.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
			st.selected = {};
			for (const p of order.slice(0, n)) st.selected[p.key] = true;
			A().render();
		});
		bar.appendChild(topN);

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

		/* Lock verbs. You could set a field for a selection but not FREEZE what
		   the selection already had, so "keep the top fifteen exactly as they
		   are and reroll everything else" — the single most common thing
		   anyone does with this tool — meant opening fifteen editors. */
		const lockWhat = el("select");
		lockWhat.setAttribute("aria-label", "Lock the selection as it is");
		lockWhat.appendChild(new Option("lock as-is…", ""));
		lockWhat.appendChild(new Option("everything", "all"));
		lockWhat.appendChild(new Option("overall only", "ovr"));
		lockWhat.appendChild(new Option("archetype only", "archetype"));
		lockWhat.appendChild(new Option("school only", "college"));
		lockWhat.addEventListener("change", () => {
			if (!lockWhat.value) return;
			A().bulkLockAsIs(lockWhat.value);
			lockWhat.value = "";
		});
		bar.appendChild(lockWhat);

		const unlock = el("button", "tiny", "Clear locks");
		unlock.addEventListener("click", () => A().bulkClear());
		bar.appendChild(unlock);
		return bar;
	}

	/* ---------------------------------------------------------- team views */

	function viewTeams(view, res) {
		/* A team page. You could follow a programme through the bracket and
		   never see its roster, its style, its coach, its four prospects and
		   its schedule in one place. */
		if (A().state.team) {
			view.appendChild(teamPage(view, res, A().state.team));
			return;
		}
		view.appendChild(el("h3", null, "AP Top 25"));
		view.appendChild(el("p", "legendline",
			"Rankings come from record, strength of schedule and roster quality. " +
			"Program strength starts from each school's BBGM draft frequency, then " +
			"this year's prospects are layered on top. Every one of the 368 " +
			"programs plays a full season, so the ratings below are real. " +
			"Click a team for its page."));
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
			tr.appendChild(el("td", null, "")).appendChild(teamLink(t.name));
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

		view.appendChild(conferenceStandings(res));

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

	function leaderTable(res, title, key, fmt, low) {
		const list = res.players.filter((p) => p.stats && p.stats.mpg >= 15)
			.sort((a, b) => (low
				? a.stats[key] - b.stats[key] : b.stats[key] - a.stats[key]))
			.slice(0, 10);
		const box = el("div", "card");
		box.appendChild(el("h4", null, title));
		box.appendChild(el("div", "note", list.map((p, i) => {
			/* Where he finished against the WHOLE of Division I, not only
			   against the other sixty-nine men in this class. A class leader
			   board answers "who is the best of these"; the rank answers "was
			   that any good", and only the second one is a scouting fact. */
			const r = p.statRanks && p.statRanks[key];
			const nat = r && r.national ? "  (" + ordinalish(r.national) + " nationally)"
				: r && r.conf ? "  (" + ordinalish(r.conf) + " in the " + r.confName + ")"
				: "";
			return (i + 1) + ". " + (fmt ? fmt(p.stats[key]) : n1(p.stats[key])) + "  " +
				p.name + " (" + (p.proClub || p.newCollege) + ")" + nat;
		}).join("\n")));
		return box;
	}

	function ordinalish(n) {
		const v = n % 100;
		if (v >= 11 && v <= 13) return n + "th";
		return n + (["th", "st", "nd", "rd"][n % 10] || "th");
	}

	function viewAwards(view, res) {
		view.appendChild(el("h3", null, "Statistical leaders"));
		view.appendChild(el("p", "legendline",
			"The first thing to check when sanity-testing a class."));
		const leaders = el("div", "cards");
		leaders.appendChild(leaderTable(res, "Points", "ppg"));
		leaders.appendChild(leaderTable(res, "Rebounds", "rpg"));
		leaders.appendChild(leaderTable(res, "Assists", "apg"));
		leaders.appendChild(leaderTable(res, "True shooting", "ts", (v) => pc(v) + "%"));
		view.appendChild(leaders);

		/* --- the defensive board -------------------------------------------

		   The defensive box score was generated, displayed and never ranked the
		   way the offensive one is. The award model reads defenseScore() to
		   decide a defensive player of the year and then discarded the
		   ordering, so the number the honour was decided on was the one number
		   the user could not see — and a prospect's 2.7 deflections a game had
		   nothing beside it to say whether that was remarkable.

		   Every leader here carries its national or conference rank against the
		   whole of Division I (see rankAgainstField in js/awards.js), which is
		   the same field the trophies are decided against. */
		view.appendChild(el("h3", null, "Defensive leaders"));
		view.appendChild(el("p", "legendline",
			"Ranks are against every returning rotation player in Division I, " +
			"simulated through the same model — the field the defensive honours " +
			"are decided against."));
		const dLeaders = el("div", "cards");
		dLeaders.appendChild(leaderTable(res, "Blocks", "bpg"));
		dLeaders.appendChild(leaderTable(res, "Steals", "spg"));
		dLeaders.appendChild(leaderTable(res, "Contested shots", "cspg"));
		dLeaders.appendChild(leaderTable(res, "Deflections", "deflpg"));
		dLeaders.appendChild(leaderTable(res, "Charges drawn", "chgpg"));
		dLeaders.appendChild(leaderTable(res, "Defensive rebounds", "drpg"));
		// Lower is better, which is why this one is sorted the other way and
		// why it used to sit at the top of the board showing the worst.
		dLeaders.appendChild(leaderTable(res, "Defensive rating (lowest)", "drtg",
			(v) => v.toFixed(1), true));
		// The single number the defensive honours are actually ranked on.
		const defBox = el("div", "card");
		defBox.appendChild(el("h4", null, "Defensive score"));
		const defList = res.players
			.filter((p) => p.stats && p.stats.mpg >= 15 && Number.isFinite(p.scoreDef))
			.sort((a, b) => b.scoreDef - a.scoreDef).slice(0, 10);
		defBox.appendChild(el("div", "note", defList.length
			? defList.map((p, i) => (i + 1) + ". " + p.scoreDef.toFixed(1) + "  " +
				p.name + " (" + (p.proClub || p.newCollege) + ")").join("\n")
			: "No defensive scores in this class."));
		dLeaders.appendChild(defBox);
		view.appendChild(dLeaders);

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
		const finite = values.filter((v) => Number.isFinite(v));
		if (!finite.length) {
			box.appendChild(el("p", "hint", "No values to plot."));
			return box;
		}
		values = finite;
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

		/* The way back. Reading a game log was a one-way trip: the prospect's
		   name was plain text, so opening his editor meant switching to the
		   Prospects tab, remembering the filter you had left there, finding him
		   again in seventy rows and clicking him. Everywhere else in the tool a
		   player's name is a link to his editor; this was the one place it was
		   not. Both buttons act on the prospect being SHOWN, which is what
		   "back to the table" has to mean here — an unscoped tab switch is what
		   the user could already do. */
		const current = res.players.filter((x) => x.key === st.logPlayer)[0];
		if (current) {
			const back = el("button", "tiny", "◂ " + current.name + " in the table");
			back.title = "Show " + current.name + " in the prospect table, " +
				"scrolled to and with his editor open";
			back.addEventListener("click", () => {
				A().state.tab = "players";
				A().revealPlayer(current);
			});
			bar.appendChild(back);
			const edit = el("button", "tiny", "Edit " + current.name);
			edit.addEventListener("click", () => {
				A().state.tab = "players";
				A().state.editing = null;
				A().revealPlayer(current);
			});
			bar.appendChild(edit);
		}
		view.appendChild(bar);

		const p = current;
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
		/* Two verbs, not one. Pin gives you class-versus-class, which is what
		   this tab did; the obvious missing one is player-versus-player, which
		   is the comparison a draft board is actually made of and which the
		   tool could not do at all. */
		view.appendChild(playerCompare(res));
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

	function teamLink(name) {
		const b = el("button", "linky", name);
		b.addEventListener("click", () => {
			A().state.team = name;
			A().state.tab = "teams";
			A().persist();
			A().render();
		});
		return b;
	}

	/* Conference standings. The data has always been there — cw/cl, conference
	   tournaments, an auto bid — and was never shown as a table, so "how did
	   the Big East go this year" was a question the tool could not answer. */
	function conferenceStandings(res) {
		const box = el("div");
		box.appendChild(el("h3", null, "Conference standings"));
		const byConf = {};
		for (const t of Object.values(res.teams)) {
			(byConf[t.conf] = byConf[t.conf] || []).push(t);
		}
		const st = A().state;
		const bar = el("div", "filters");
		const sel = el("select");
		sel.setAttribute("aria-label", "Conference");
		sel.setAttribute("data-focus", "confpick");
		const names = Object.keys(byConf).sort((a, b) => {
			const sa = (C.CONFERENCES[a] || {}).strength || 0;
			const sb = (C.CONFERENCES[b] || {}).strength || 0;
			return sb - sa || a.localeCompare(b);
		});
		for (const n of names) sel.appendChild(new Option(n, n));
		if (!st.standingsConf || names.indexOf(st.standingsConf) === -1) {
			st.standingsConf = names[0];
		}
		sel.value = st.standingsConf;
		sel.addEventListener("change", () => {
			st.standingsConf = sel.value;
			A().persist();
			A().render();
		});
		bar.appendChild(sel);
		box.appendChild(bar);
		const pool = (byConf[st.standingsConf] || []).slice()
			.sort((a, b) => (b.cw - b.cl) - (a.cw - a.cl) || b.rating - a.rating);
		const meta = C.CONFERENCES[st.standingsConf];
		if (meta) {
			const drift = pool.length && Number.isFinite(pool[0].confStrength)
				? pool[0].confStrength : meta.strength;
			box.appendChild(el("p", "legendline",
				"Strength " + drift.toFixed(0) + " this season, against a baseline of " +
				meta.strength + " — conference strength drifts from year to year."));
		}
		const wrap = el("div", "scroll");
		const table = el("table");
		const hr = el("tr");
		for (const h of ["Team", "Conf", "Overall", "SOS", "ORtg", "DRtg", "Postseason"]) {
			const th = el("th", ["SOS", "ORtg", "DRtg"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		const thead = el("thead");
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		for (const t of pool) {
			const tr = el("tr");
			const td = el("td", "sticky");
			td.appendChild(teamLink(t.name));
			if (t.confRegularChamp) td.appendChild(document.createTextNode(" ★"));
			if (t.confTourneyChamp) td.appendChild(document.createTextNode(" 🏆"));
			tr.appendChild(td);
			tr.appendChild(el("td", null, t.cw + "-" + t.cl));
			tr.appendChild(el("td", null, t.w + "-" + t.l));
			tr.appendChild(el("td", "num", t.sosAvg.toFixed(1)));
			tr.appendChild(el("td", "num", t.offRtg ? t.offRtg.toFixed(1) : "—"));
			tr.appendChild(el("td", "num", t.defRtg ? t.defRtg.toFixed(1) : "—"));
			tr.appendChild(el("td", null, t.ncaaSeed ? "No. " + t.ncaaSeed + " seed, " +
				t.ncaaResult : (t.nitResult || "—")));
			tb.appendChild(tr);
		}
		table.appendChild(tb);
		wrap.appendChild(table);
		box.appendChild(wrap);
		return box;
	}

	/* One programme: who coaches it, how it plays, who is on it, and every game
	   it played. */
	function teamPage(view, res, name) {
		const t = res.teams[name];
		const box = el("div");
		const back = el("button", "tiny", "← All teams");
		back.addEventListener("click", () => {
			A().state.team = null;
			A().persist();
			A().render();
		});
		box.appendChild(back);
		if (!t) {
			box.appendChild(el("p", "hint", "No such programme in this class."));
			return box;
		}
		box.appendChild(el("h3", null, t.name + " — " + t.w + "-" + t.l +
			(t.apRank ? "  (AP #" + t.apRank + ")" : "")));
		const dl = el("dl", "shortcuts");
		const row = (k, v) => {
			dl.appendChild(el("dt", null, k));
			dl.appendChild(el("dd", null, v));
		};
		row("Conference", t.conf + " " + t.cw + "-" + t.cl +
			(t.confRegularChamp ? " · regular-season champion" : "") +
			(t.confTourneyChamp ? " · tournament champion" : ""));
		if (t.coach) {
			row("Coach", t.coach.name + ", year " + t.coach.tenure +
				" — plays " + t.style.name);
		}
		row("Programme level", Math.round(t.level) + " (rating " +
			t.rating.toFixed(1) + ")");
		if (Number.isFinite(t.pace)) row("Tempo", t.pace.toFixed(1) + " possessions a game");
		if (t.offRtg) {
			row("Efficiency", "ORtg " + t.offRtg.toFixed(1) +
				" · DRtg " + t.defRtg.toFixed(1) + " · SOS " + t.sosAvg.toFixed(1));
		}
		row("Postseason", t.ncaaSeed ? "No. " + t.ncaaSeed + " seed, " + t.ncaaResult
			: (t.nitResult || "Did not make the field"));
		// Home and away. The schedule has always carried it and the game log
		// used it for a lift; no split was ever shown.
		const home = t.log.filter((g) => g.home > 0);
		const away = t.log.filter((g) => g.home < 0);
		const neutral = t.log.filter((g) => !g.home);
		const rec = (l) => l.filter((g) => g.won).length + "-" +
			l.filter((g) => !g.won).length;
		row("Home / away / neutral",
			rec(home) + " at home · " + rec(away) + " on the road · " +
			rec(neutral) + " on neutral floors");
		if ((t.outages || []).length) {
			row("Injuries", t.outages.map((o) => {
				const who = t.prospects.filter((p) => p.key === o.who)[0];
				return (who ? who.name : "a starter") + " (" + o.kind + ")";
			}).join(", "));
		}
		box.appendChild(dl);

		box.appendChild(el("h4", null, "Prospects"));
		const plist = el("div", "cards");
		for (const p of t.prospects) {
			const c = el("div", "card");
			const h = el("h4");
			const b = el("button", "linky", p.name);
			b.addEventListener("click", () => {
				A().state.team = null;
				A().state.tab = "players";
				A().openEditor(p);
			});
			h.appendChild(b);
			c.appendChild(h);
			c.appendChild(el("div", "note",
				p.newPos + " " + p.newOvr + "/" + p.newPot + " · " + p.archetype +
				(p.stats ? "\n" + n1(p.stats.mpg) + " mpg, " + n1(p.stats.ppg) + "/" +
					n1(p.stats.rpg) + "/" + n1(p.stats.apg) : "\nNo season")));
			plist.appendChild(c);
		}
		box.appendChild(plist);

		box.appendChild(el("h4", null, "Schedule"));
		const wrap = el("div", "scroll");
		const table = el("table");
		const hr = el("tr");
		for (const h of ["#", "Opponent", "Where", "Result", "Score", "Stage"]) {
			const th = el("th", h === "#" ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		const thead = el("thead");
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		t.log.forEach((g, i) => {
			const tr = el("tr", g.won ? "" : "down");
			tr.appendChild(el("td", "num", String(i + 1)));
			const td = el("td", "sticky");
			td.appendChild(teamLink(g.opp));
			tr.appendChild(td);
			tr.appendChild(el("td", null,
				g.home > 0 ? "home" : g.home < 0 ? "away" : "neutral"));
			tr.appendChild(el("td", null, g.won ? "W" : "L"));
			tr.appendChild(el("td", null, g.pf !== null
				? g.pf + "-" + g.pa + (g.ot ? " (" + g.ot + "OT)" : "") : "—"));
			tr.appendChild(el("td", null,
				g.round || (g.conference ? "conference" : g.stage)));
			tb.appendChild(tr);
		});
		table.appendChild(tb);
		wrap.appendChild(table);
		box.appendChild(wrap);
		return box;
	}

	/* Two prospects side by side, on every row that has a number in it. */
	const COMPARE_ROWS = [
		["newOvr", "Overall", 0], ["newPot", "Potential", 0],
		["hgtInches", "Height", 0], ["weight", "Weight", 0],
		["gp", "Games", 0], ["mpg", "Minutes", 1], ["ppg", "Points", 1],
		["rpg", "Rebounds", 1], ["apg", "Assists", 1], ["spg", "Steals", 1],
		["bpg", "Blocks", 1], ["topg", "Turnovers", 1, true],
		["fga", "Field goals", 1], ["tpa", "Threes", 1], ["fta", "Free throws", 1],
		["usg", "Usage", 1], ["ts", "True shooting", 1], ["tpp", "3P%", 1],
		["ftp", "FT%", 1], ["drtg", "Defensive rating", 1, true],
		["board", "Board position", 0, true],
	];

	/* Four slots, not two. Two players is a head-to-head; TIERING — is this
	   man the third-best wing in the class or the sixth? — is what anybody
	   actually does on a draft board, and it needs three or four columns.
	   Empty slots are simply not rendered, so the two-player case looks
	   exactly as it did. */
	const COMPARE_MAX = 4;

	function playerCompare(res) {
		const st = A().state;
		if (!Array.isArray(st.compare)) st.compare = [];
		while (st.compare.length < COMPARE_MAX) st.compare.push(null);
		st.compare.length = COMPARE_MAX;
		const box = el("div", "card");
		box.appendChild(el("h4", null, "Prospects side by side"));
		const bar = el("div", "filters");
		const sorted = res.players.slice()
			.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999));
		st.compare.forEach((_, slot) => {
			const sel = el("select");
			sel.setAttribute("aria-label", "Prospect " + (slot + 1));
			sel.setAttribute("data-focus", "compare" + slot);
			sel.appendChild(new Option("— pick a prospect —", ""));
			for (const p of sorted) {
				sel.appendChild(new Option(
					(p.boardRank ? p.boardRank + ". " : "") + p.name +
						" (" + p.newPos + " " + p.newOvr + ")", p.key));
			}
			sel.value = st.compare[slot] || "";
			sel.addEventListener("change", () => {
				st.compare[slot] = sel.value || null;
				A().persist();
				A().render();
			});
			bar.appendChild(sel);
		});
		const swap = el("button", "tiny", "Swap first two");
		swap.addEventListener("click", () => {
			const c = st.compare.slice();
			const t = c[0]; c[0] = c[1]; c[1] = t;
			st.compare = c;
			A().persist();
			A().render();
		});
		bar.appendChild(swap);
		const clear = el("button", "tiny", "Clear");
		clear.addEventListener("click", () => {
			st.compare = new Array(COMPARE_MAX).fill(null);
			A().persist();
			A().render();
		});
		bar.appendChild(clear);
		box.appendChild(bar);

		/* --- filling the slots without four dropdowns ------------------------

		   Every comparison had to be assembled one dropdown at a time from a
		   seventy-name list, which makes the obvious comparisons — the top of
		   the board, the wings, the men who scored most — the most tedious
		   ones. These are the four the tool was already in a position to
		   answer, plus one that follows whatever the user has done to the
		   table, which is the general case: filter the table however you like
		   and take the top four of it. */
		const fillBar = el("div", "filters");
		fillBar.appendChild(el("span", "hint", "Fill from:"));
		const fill = (label, title, list) => {
			const b = el("button", "tiny", label);
			b.title = title;
			b.addEventListener("click", () => {
				const keys = list().slice(0, COMPARE_MAX).map((p) => p.key);
				if (!keys.length) { A().setStatus("Nothing matched."); return; }
				st.compare = keys.concat(new Array(COMPARE_MAX).fill(null))
					.slice(0, COMPARE_MAX);
				A().persist();
				A().render();
			});
			fillBar.appendChild(b);
		};
		const withStats = (f) => res.players.filter((p) => p.stats && f(p));
		const byBoard = (a, b) => (a.boardRank || 999) - (b.boardRank || 999);
		fill("top of the board", "The first four prospects on the mock board",
			() => sorted.slice());
		fill("top by PPG", "The four highest scorers in the class",
			() => withStats(() => true).sort((a, b) => b.stats.ppg - a.stats.ppg));
		fill("what the table shows",
			"The first four prospects the prospect table is currently showing, " +
			"in its current sort — filter the table however you like, then use this",
			() => (A().visibleRows() || []).slice());
		/* By position, which is the comparison a draft board is actually made
		   of: you are not choosing between the best four players, you are
		   choosing between the wings. */
		const posSel = el("select");
		posSel.setAttribute("aria-label", "Compare the best at one position");
		posSel.appendChild(new Option("best at position…", ""));
		const positions = [];
		for (const p of res.players) {
			if (p.newPos && positions.indexOf(p.newPos) === -1) positions.push(p.newPos);
		}
		positions.sort();
		for (const pos of positions) {
			const n = res.players.filter((p) => p.newPos === pos).length;
			posSel.appendChild(new Option(pos + " (" + n + ")", pos));
		}
		posSel.addEventListener("change", () => {
			if (!posSel.value) return;
			const keys = res.players.filter((p) => p.newPos === posSel.value)
				.sort(byBoard).slice(0, COMPARE_MAX).map((p) => p.key);
			posSel.value = "";
			if (!keys.length) return;
			st.compare = keys.concat(new Array(COMPARE_MAX).fill(null))
				.slice(0, COMPARE_MAX);
			A().persist();
			A().render();
		});
		fillBar.appendChild(posSel);
		box.appendChild(fillBar);

		const find = (k) => res.players.filter((p) => p.key === k)[0] || null;
		const picked = st.compare.map(find).filter(Boolean);
		if (picked.length < 2) {
			box.appendChild(el("p", "hint",
				"Pick two or more prospects to see every number they differ on. " +
				"Three or four is how you tier a position."));
			return box;
		}
		const valueOf = (p, key) => {
			if (key === "board") return p.boardRank;
			if (key === "hgtInches") return p.newHgtInches;
			if (key === "weight") return p.newWeight;
			if (key === "newOvr" || key === "newPot") return p[key];
			if (!p.stats) return undefined;
			if (key === "usg" || key === "ts" || key === "tpp" || key === "ftp") {
				return p.stats[key] * 100;
			}
			return p.stats[key];
		};
		const table = el("table", "mini compare");
		const head = el("tr");
		head.appendChild(el("th", null, ""));
		for (const p of picked) head.appendChild(el("th", "num", p.name));
		table.appendChild(head);
		const meta = (label, f) => {
			const tr = el("tr");
			tr.appendChild(el("td", null, label));
			for (const p of picked) tr.appendChild(el("td", null, f(p)));
			table.appendChild(tr);
		};
		meta("Position", (p) => p.newPos);
		meta("Archetype", (p) => p.archetype);
		meta("Year", (p) => p.classYear);
		meta("School", (p) => p.proClub || p.newCollege);
		for (const [key, label, digits, lowerBetter] of COMPARE_ROWS) {
			const vals = picked.map((p) => valueOf(p, key));
			if (!vals.some(Number.isFinite)) continue;
			const real = vals.filter(Number.isFinite);
			/* With more than two columns "better than the other one" is not a
			   question, so the mark goes on the BEST of the row — which is the
			   only reading that stays meaningful at three and four. */
			const best = lowerBetter
				? Math.min.apply(null, real) : Math.max.apply(null, real);
			const tie = real.filter((v) => v === best).length === real.length;
			const tr = el("tr");
			tr.appendChild(el("td", null, label));
			for (const v of vals) {
				const td = el("td", "num", Number.isFinite(v) ? v.toFixed(digits) : "—");
				if (!tie && Number.isFinite(v) && v === best) td.classList.add("up");
				tr.appendChild(td);
			}
			table.appendChild(tr);
		}
		box.appendChild(table);
		return box;
	}

	/* Derived columns, for anything outside this file that needs the same
	   arithmetic (the CSV export, so a file and the screen cannot disagree). */
	function derived(key, stats) {
		return DERIVED[key] ? DERIVED[key](stats) : undefined;
	}

	global.Views = {
		players: viewPlayers, teams: viewTeams, bracket: viewBracket, bulkBar,
		awards: viewAwards, board: viewBoard, distribution: viewDistribution,
		notes: viewNotes, gamelog: viewGameLog, compare: viewCompare,
		COLUMNS, STAT_MODES, PCT_KEYS, DERIVED, derived, cellValue, statValue,
		CARD_COLUMNS, CARD_BREAKPOINT, cardMode, orderedColumns, moveColumn,
		dropColumn, setColumnOrder,
		matchesFilter, numericColumns, histogram, feet, closeRowMenu,
		el, n1, pc, wrapCell, COMPARE_MAX,
	};
})(window);
