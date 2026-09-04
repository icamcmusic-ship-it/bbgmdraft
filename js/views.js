/* The tab views. Split out of app.js, which had grown to the point where the
   table, the bracket, the editor and the file loader were one 1,500-line unit.

   Everything here reads shared state and helpers off window.App, which is
   defined by the time any of it runs. */
(function (global) {
	"use strict";

	const C = global.Colleges;
	const { clamp } = global.BBGMRng;
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
		{ key: "face", label: "Face", num: false, off: true, title: "facesjs portrait — the face BBGM itself renders" },
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
		/* The playmaking and lineup side of a modern box score, none of
		   which the line carried: an assisted rate, a transition share, a
		   plus/minus, a close-game scoring average. */
		{ key: "pm", label: "+/-", num: true, stat: true, off: true, title: "Plus/minus per game while on the floor" },
		{ key: "onOff", label: "On/Off", num: true, off: true, title: "Estimated per-40 plus/minus less the team's margin without him" },
		{ key: "astd", label: "AST'd", num: true, off: true, derived: true, title: "Share of his made field goals that were assisted, as a ratio (.640 = 64%)" },
		{ key: "trans", label: "TRN", num: true, off: true, derived: true, title: "Share of his points scored in transition, as a ratio" },
		{ key: "clutchPpg", label: "CLU", num: true, off: true, title: "Points per game in games decided by five or fewer, or in overtime" },
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
		astd: (s) => (Number.isFinite(s.astdRate) ? s.astdRate : undefined),
		trans: (s) => (Number.isFinite(s.transShare) ? s.transShare : undefined),
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
	   stacks forty labeled lines per prospect is not an improvement on a
	   scroll; it is the same information in a taller shape. So the card layout
	   also has its own column set — the twelve fields a scout reads first —
	   independent of whichever columns the user has ticked for the desktop
	   table, with a control to show everything for the cases where that is what
	   they want.

	   `auto` follows the viewport, which is what a phone user wants and a
	   desktop user never notices; `on` and `off` are there because a tablet in
	   landscape is a genuine judgment call and because a narrow window on a
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
		// the columns around it, which is the only behavior that makes a
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
		/* The stack is rebuilt on every render, so it cannot itself be the
		   live region — a screen reader watching a node that is replaced hears
		   nothing. It reports through the app's own region instead, and only
		   when the stack has actually changed, or every unrelated re-render
		   would announce the sort again. */
		const summary = st.sort.length
			? "Sorted by " + st.sort.map((k, i) => {
				const c = COLUMNS.filter((x) => x.key === k.key)[0];
				return ((c && c.label) || k.key) +
					(k.dir < 0 ? " descending" : " ascending") +
					(i < st.sort.length - 1 ? ", then" : "");
			}).join(" ")
			: "Sort cleared";
		if (st.__lastSortSummary !== undefined && st.__lastSortSummary !== summary) {
			A().announce(summary);
		}
		st.__lastSortSummary = summary;
		if (!st.sort.length) return bar;
		bar.setAttribute("aria-label", summary);
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
				"the defenses he faced, and how much of the offense he carried.";
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
			"Search name, school, archetype, honor…", "Search prospects",
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
		preset("Defense", ["pos", "college", "mpg", "drpg", "spg", "bpg", "cspg",
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
		// A prospect's own page rides inside this tab the way a team page
		// rides inside the Teams tab.
		if (st.player) {
			view.appendChild(playerPage(view, res, st.player));
			return;
		}
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
		/* The season's storylines, beside the class's flavor. The two are
		   different statements — a flavor is about the players and a narrative
		   about the season they played — and showing them together is the only
		   way a reader can tell which one produced what they are looking at.
		   See NARRATIVES in js/engine.js. */
		for (const n of res.narrative || []) pills.push(n.name);
		/* What makes THIS class this one. The class is drawn from a pool of
		   builds and given two to four forced anomalies, and both were
		   invisible: a user rerolling had no way to see that the year was a
		   stretch-big year, only to feel that it was not. */
		if (res.archetypePool && res.archetypePool.length) {
			pills.push(res.archetypePool.length + " builds in this class");
		}
		for (const t of pills) summary.appendChild(el("span", "pill", t));
		view.appendChild(summary);
		if ((res.narrative || []).length) {
			view.appendChild(el("p", "legendline",
				"The season: " + res.narrative.map((n) => n.blurb).join("; ") + "."));
		}
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
		/* Realignment, the season's events and draft day used to be three more
		   ·-joined walls here. They are proper dated articles on the News tab
		   now, with every player and team mention a link. */
		view.appendChild(filterBar(res));
		view.appendChild(rangeBar(res));
		view.appendChild(bulkBar(res));

		/* On a phone the card layout picks its own columns (see CARD_COLUMNS):
		   the desktop selection is a choice about a wide table and applying it
		   to a stack of labeled lines produces a forty-line card. `cardAll`
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
			/* The one-line scouting sentence on hover.

			   A forty-column table tells you every number about a player and
			   nothing about who he is, and the sentence that says so was one
			   click away on his page — seventy clicks to read a class. The
			   note's first line IS that sentence (see noteSummary), so the
			   row carries it and the second line under it. */
			if (p.note) {
				const lines = String(p.note).split("\n");
				tr.title = lines.slice(0, 2).join("\n");
			}
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
				case "face": {
					td = el("td");
					const fb = el("div", "facebox small");
					if (global.Faces) global.Faces.render(fb, p);
					td.appendChild(fb);
					sortVals.face = 0;
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
						// A professional club and an academy or DII program are
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
	let openMenuOutsideClick = null;
	function closeRowMenu() {
		if (openMenuOutsideClick) {
			document.removeEventListener("click", openMenuOutsideClick);
			document.removeEventListener("contextmenu", openMenuOutsideClick);
			openMenuOutsideClick = null;
		}
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
		/* Dismiss on a genuine click elsewhere. The listener used to fire on
		   ANY document click, including a right button's own — and some
		   Chromium builds bubble a synthetic `click` to document immediately
		   after the `contextmenu` event that opened this menu (Playwright's
		   CI runner hit this; the Chromium cached for local dev did not), so
		   the menu closed itself before the next deliberate click could land
		   on it, which read as the menu having no items at all. A real
		   "click away to dismiss" is always the primary button; anything
		   else is that echo, not a user closing the menu. */
		/* Not { once: true }: that removes the listener the moment it FIRES,
		   whether or not the handler below actually closed the menu, so the
		   one real left-click still to come would arrive with nothing left
		   to catch it. closeRowMenu() (called from a menu item, Escape, or
		   this handler itself) is what removes it, so a menu dismissed any
		   other way never leaves a stale listener on document. */
		/* A right-click elsewhere dismisses too — but not one on another
		   row, whose own handler has just opened the next menu: a
		   document-level contextmenu listener that closed unconditionally
		   ran right after it and left every right-click past the first
		   opening and closing in the same instant. */
		const outsideClick = (e) => {
			if (e.type === "contextmenu") {
				if (e.target && e.target.closest && e.target.closest("tr[data-pkey]")) return;
				closeRowMenu();
				return;
			}
			if (e.button !== undefined && e.button !== 0) return;
			closeRowMenu();
		};
		openMenuOutsideClick = outsideClick;
		setTimeout(() => {
			document.addEventListener("click", outsideClick);
			document.addEventListener("contextmenu", outsideClick);
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
		/* A team page. You could follow a program through the bracket and
		   never see its roster, its style, its coach, its four prospects and
		   its schedule in one place. */
		/* A single game's box score is a page under the Teams tab, because it
		   is reached from a team's schedule and belongs beside it. */
		if (A().state.game) {
			view.appendChild(gamePage(view, res, A().state.game));
			return;
		}
		if (A().state.team) {
			view.appendChild(teamPage(view, res, A().state.team));
			return;
		}
		view.appendChild(el("h3", null, "AP Top 25"));
		view.appendChild(el("p", "legendline",
			"Voted weekly by a persistent 60-member electorate over the results " +
			"as they happened — first-place votes split, teams rise and fall, " +
			"and the preseason ballot runs on reputation the way the real one " +
			"does. Click a team for its page."));
		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["#", "±", "Team", "Conf", "Record", "Conf record", "NET",
			"Quads", "SOS", "ORtg", "DRtg", "Seed", "Result", "Prospects"]) {
			const th = el("th", ["#", "±", "NET", "SOS", "ORtg", "DRtg"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		res.poll.forEach((t, i) => {
			const tr = el("tr");
			const fpv = i === 0 && t.apFirstPlace ? " (" + t.apFirstPlace + ")" : "";
			tr.appendChild(el("td", "num", (i + 1) + fpv));
			// Movement against the preseason ballot.
			const move = t.apPreseason ? t.apPreseason - (i + 1) : null;
			const mv = el("td", "num");
			mv.appendChild(el("span",
				move === null ? "" : move > 0 ? "up" : move < 0 ? "down" : "",
				move === null ? "NEW" : move === 0 ? "—"
					: (move > 0 ? "▲" : "▼") + Math.abs(move)));
			mv.title = t.apPreseason
				? "Preseason: No. " + t.apPreseason : "Unranked in the preseason poll";
			tr.appendChild(mv);
			tr.appendChild(el("td", null, "")).appendChild(teamLink(t.name));
			tr.appendChild(el("td", null, t.conf));
			tr.appendChild(el("td", null, t.w + "-" + t.l + (t.confRegularChamp ? " ★" : "")));
			tr.appendChild(el("td", null, t.cw + "-" + t.cl));
			tr.appendChild(el("td", "num", t.netRank ? String(t.netRank) : "—"));
			tr.appendChild(el("td", null, t.quads
				? "Q1 " + t.quads.q1w + "-" + t.quads.q1l + " · Q2 " +
					t.quads.q2w + "-" + t.quads.q2l
				: "—"));
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
			"postseason. The number beside No. 1 is its first-place votes " +
			"(of " + (global.Rankings ? global.Rankings.VOTERS : 60) + "); " +
			"± is movement against the preseason ballot."));

		// The poll as a season: every team that was ever ranked, by week.
		if (res.pollHistory && res.pollHistory.length) {
			const hist = res.pollHistory;
			/* Cells are read from the poll history itself, never from
			   t.apHistory: a team missing from res.teams (or one the ranker
			   never wrote apHistory onto) used to produce a one-cell row
			   that collapsed the whole table. Every row now emits exactly
			   one cell per week by construction. */
			const weekRank = hist.map((wk) => {
				const m = {};
				wk.ranks.forEach((r) => { m[r.team] = r; });
				return m;
			});
			const last = weekRank[hist.length - 1];
			const ever = {};
			hist.forEach((wk) => wk.ranks.forEach((r) => {
				if (!ever[r.team] || r.rank < ever[r.team]) ever[r.team] = r.rank;
			}));
			const rows = Object.keys(ever).sort((a, b) => {
				const fa = last[a] ? last[a].rank : 99 + ever[a];
				const fb = last[b] ? last[b].rank : 99 + ever[b];
				return fa - fb;
			});
			view.appendChild(el("h3", null, "The poll, week by week"));
			view.appendChild(el("p", "legendline",
				"Every team that appeared in any weekly ballot — the No. 3 in " +
				"December that was unranked by March is the most interesting " +
				"row here. Green rose or entered; red fell or dropped out. " +
				"Hover a cell for points and first-place votes."));
			const pw = el("div", "scroll");
			const pt = el("table");
			const ph = el("tr");
			ph.appendChild(el("th", null, "Team"));
			hist.forEach((wk) => {
				ph.appendChild(el("th", "num", wk.week === 0 ? "Pre" : String(wk.week)));
			});
			const pth = el("thead");
			pth.appendChild(ph);
			pt.appendChild(pth);
			const ptb = el("tbody");
			for (const name of rows) {
				const tr = el("tr");
				const td = el("td", "sticky");
				td.appendChild(teamLink(name));
				tr.appendChild(td);
				weekRank.forEach((m, w) => {
					const row = m[name];
					const prev = w > 0 ? weekRank[w - 1][name] : null;
					let cls = "num";
					if (row && (!prev || prev.rank > row.rank)) cls += " pollup";
					else if ((!row && prev) || (row && prev && prev.rank < row.rank)) cls += " polldown";
					const cell = el("td", cls, row ? String(row.rank) : "·");
					if (row) {
						cell.title = row.points + " pts" +
							(row.firstPlace ? ", " + row.firstPlace + " first-place" : "") +
							(row.record ? ", " + row.record : "");
					}
					tr.appendChild(cell);
				});
				ptb.appendChild(tr);
			}
			pt.appendChild(ptb);
			pw.appendChild(pt);
			view.appendChild(pw);

			// Scrub to any week: the full 25-deep ballot with points, firsts
			// and records — the data was always there, only the final week
			// was ever shown.
			const wkSel = el("select");
			hist.forEach((wk, i) => {
				const o = el("option", null,
					wk.label || (wk.week === 0 ? "Preseason" : "Week " + wk.week));
				o.value = String(i);
				wkSel.appendChild(o);
			});
			wkSel.value = String(hist.length - 1);
			const wkHead = el("h3", null, "One week's full ballot ");
			wkHead.appendChild(wkSel);
			view.appendChild(wkHead);
			const wkBox = el("div");
			view.appendChild(wkBox);
			const renderWeek = () => {
				wkBox.textContent = "";
				const wk = hist[Number(wkSel.value)];
				if (!wk) return;
				const prevWk = weekRank[Number(wkSel.value) - 1] || null;
				const tw = el("div", "scroll");
				const tb = el("table");
				const hr = el("tr");
				for (const h of ["#", "Team", "Record", "Points", "1st", "±"]) {
					hr.appendChild(el("th", h === "Team" ? null : "num", h));
				}
				const thd = el("thead");
				thd.appendChild(hr);
				tb.appendChild(thd);
				const bod = el("tbody");
				for (const r of wk.ranks) {
					const tr = el("tr");
					tr.appendChild(el("td", "num", String(r.rank)));
					const td = el("td");
					td.appendChild(teamLink(r.team));
					tr.appendChild(td);
					tr.appendChild(el("td", "num", r.record || ""));
					tr.appendChild(el("td", "num", String(r.points)));
					tr.appendChild(el("td", "num", r.firstPlace ? String(r.firstPlace) : ""));
					const was = prevWk && prevWk[r.team] ? prevWk[r.team].rank : null;
					const delta = was === null
						? (prevWk ? "NR" : "")
						: was === r.rank ? "—"
						: was > r.rank ? "▲" + (was - r.rank) : "▼" + (r.rank - was);
					tr.appendChild(el("td",
						"num" + (delta.charAt(0) === "▲" || delta === "NR" ? " pollup"
							: delta.charAt(0) === "▼" ? " polldown" : ""), delta));
					bod.appendChild(tr);
				}
				tb.appendChild(bod);
				tw.appendChild(tb);
				wkBox.appendChild(tw);
				if (wk.othersReceivingVotes && wk.othersReceivingVotes.length) {
					const line = el("p", "legendline");
					line.appendChild(document.createTextNode("Others receiving votes: "));
					wk.othersReceivingVotes.forEach((o, i) => {
						if (i) line.appendChild(document.createTextNode(", "));
						line.appendChild(teamLink(o.team));
						line.appendChild(document.createTextNode(" " + o.points));
					});
					wkBox.appendChild(line);
				}
			};
			wkSel.addEventListener("change", renderWeek);
			renderWeek();
		}

		// Recruiting class rankings: the aggregate the per-player stars and
		// ranks always implied but never produced.
		if (res.recruitingClasses && res.recruitingClasses.length) {
			view.appendChild(el("h3", null, "Recruiting class rankings"));
			view.appendChild(el("p", "legendline",
				"All 368 programs, scored 247-style: per-signee points decay " +
				"steeply with national rank, with diminishing returns after the " +
				"top handful. Prospects in this class keep their real national " +
				"ranks; the rest of every class is synthesized from program " +
				"prestige. Top 25 shown."));
			const rw = el("div", "scroll");
			const rt = el("table");
			const rh = el("tr");
			for (const h of ["#", "Program", "Conf", "Score", "Signees", "5★", "4★", "Avg rank", "Headliner"]) {
				rh.appendChild(el("th", h === "Program" || h === "Headliner" ? null : "num", h));
			}
			const rthead = el("thead");
			rthead.appendChild(rh);
			rt.appendChild(rthead);
			const rtb = el("tbody");
			for (const rc of res.recruitingClasses.slice(0, 25)) {
				const tr = el("tr");
				tr.appendChild(el("td", "num", String(rc.natRank)));
				const td = el("td");
				td.appendChild(teamLink(rc.name));
				tr.appendChild(td);
				tr.appendChild(el("td", null, rc.conf));
				tr.appendChild(el("td", "num", rc.score.toFixed(1)));
				tr.appendChild(el("td", "num", String(rc.signees)));
				tr.appendChild(el("td", "num", rc.fiveStars ? String(rc.fiveStars) : ""));
				tr.appendChild(el("td", "num", rc.fourStars ? String(rc.fourStars) : ""));
				tr.appendChild(el("td", "num", rc.avgRank.toFixed(0)));
				const hd = el("td");
				if (rc.headliner && rc.headliner.real) {
					hd.appendChild(playerLink(rc.headliner.name, rc.headliner.key));
					hd.appendChild(document.createTextNode(" (No. " + rc.headliner.rank + ")"));
				}
				tr.appendChild(hd);
				rtb.appendChild(tr);
			}
			rt.appendChild(rtb);
			rw.appendChild(rt);
			view.appendChild(rw);
		}

		// Selection Sunday: the committee's work, in the committee's terms.
		const sel = res.tourney && res.tourney.selection;
		if (sel) {
			view.appendChild(el("h3", null, "Selection"));
			view.appendChild(el("p", "legendline",
				"Selection and seeding run on observables only: NET rank " +
				"(margin-capped adjusted efficiency + results-based team value), " +
				"quadrant records, road record, stretch form. The committee " +
				"cannot see a team's true rating."));
			if (sel.bubble && sel.bubble.length) {
				const line = el("p", "legendline");
				line.appendChild(document.createTextNode("First four out: "));
				sel.bubble.slice(0, 4).forEach((t, i) => {
					if (i) line.appendChild(document.createTextNode(" · "));
					line.appendChild(teamLink(t.name));
					line.appendChild(document.createTextNode(
						" (NET " + (t.netRank || "—") +
						(t.quads ? ", Q1 " + t.quads.q1w + "-" + t.quads.q1l : "") + ")"));
				});
				view.appendChild(line);
			}
			if (sel.bidCheck && sel.bidCheck.length) {
				view.appendChild(el("p", "legendline",
					"Against the historical norm: " + sel.bidCheck.map((b) =>
						"the " + b.conf + " got " + b.got + " bids (typical " +
						b.expected + ")").join(" · ")));
			}
		}

		view.appendChild(el("h3", null, "Programs with prospects in this class"));
		const cards = el("div", "cards");
		const withP = Object.values(res.teams)
			.filter((t) => t.prospects.length)
			.sort((a, b) => b.resume - a.resume);
		for (const t of withP) {
			const c = el("div", "card");
			const h4 = el("h4");
			h4.appendChild(teamLink(t.name));
			h4.appendChild(document.createTextNode(" — " + t.w + "-" + t.l +
				(t.apRank ? "  (AP #" + t.apRank + ")" : "")));
			c.appendChild(h4);
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

	/* ---------------------------------------------------------------- news */

	/* The season as dated articles (see js/news.js), replacing the four
	   ·-joined strips that used to sit above the prospect table. */
	function viewNews(view, res) {
		const articles = global.News ? global.News.build(res) : [];
		view.appendChild(el("h3", null, "The season, as it happened"));
		view.appendChild(el("p", "legendline",
			"Every article is read off results the sim actually produced — " +
			"nothing here can contradict a box score. Names are links."));
		if (!articles.length) {
			view.appendChild(el("p", "hint", "A quiet year. Turn up season " +
				"events, anomalies or draft-day events in the settings."));
			return;
		}
		/* A hundred kinds and eighty-odd articles a season is a feed you scroll
		   past rather than read, so it filters. Three controls, because they
		   are the three questions people actually ask of it: what kind of
		   story, whose story, and "did anything happen to MY prospects". */
		const st = A().state;
		st.newsFilter = st.newsFilter || { kind: "", text: "", mine: false };
		const f = st.newsFilter;
		const bar = el("div", "filters");
		const kindSel = el("select");
		kindSel.appendChild(new Option("every kind", ""));
		const groups = {};
		for (const a of articles) {
			groups[a.group || "the season"] = groups[a.group || "the season"] || {};
			groups[a.group || "the season"][a.kind] = 1;
		}
		for (const g of Object.keys(groups).sort()) {
			const og = document.createElement("optgroup");
			og.label = g;
			for (const k of Object.keys(groups[g]).sort()) og.appendChild(new Option(k, k));
			kindSel.appendChild(og);
		}
		kindSel.value = f.kind;
		kindSel.addEventListener("change", () => { f.kind = kindSel.value; A().render(); });
		bar.appendChild(kindSel);
		const box = el("input");
		box.type = "search";
		box.placeholder = "team or player…";
		box.value = f.text;
		box.addEventListener("input", () => { f.text = box.value; A().render(); });
		bar.appendChild(box);
		const mineLab = el("label", "check");
		const mine = el("input");
		mine.type = "checkbox";
		mine.checked = !!f.mine;
		mine.addEventListener("change", () => { f.mine = mine.checked; A().render(); });
		mineLab.appendChild(mine);
		mineLab.appendChild(document.createTextNode(" only my prospects"));
		bar.appendChild(mineLab);
		view.appendChild(bar);

		/* "My prospects" means the rows the prospect table is currently
		   showing, so a filtered board and a filtered feed agree. */
		const mineKeys = new Set();
		if (f.mine) {
			for (const p of res.players || []) {
				if (matchesFilter(p, res)) mineKeys.add(p.key);
			}
		}
		const needle = f.text.trim().toLowerCase();
		const shown = articles.filter((a) => {
			if (f.kind && a.kind !== f.kind) return false;
			if (f.mine) {
				const hit = [].concat(a.headline, a.body, ...(a.paras || []))
					.some((seg) => seg && seg.t === "player" && mineKeys.has(seg.key));
				if (!hit) return false;
			}
			if (needle) {
				const hay = [].concat(a.headline, a.body, ...(a.paras || []))
					.map((seg) => seg && seg.v).join(" ").toLowerCase();
				if (hay.indexOf(needle) === -1) return false;
			}
			return true;
		});
		view.appendChild(el("p", "legendline",
			shown.length === articles.length
				? articles.length + " articles"
				: shown.length + " of " + articles.length + " articles"));
		if (!shown.length) {
			view.appendChild(el("p", "hint", "Nothing in the feed matches that."));
			return;
		}
		let lastDate = null;
		const wrap = el("div", "news");
		for (const a of shown) {
			if (a.dateline !== lastDate) {
				wrap.appendChild(el("h4", "newsdate", a.dateline));
				lastDate = a.dateline;
			}
			const art = el("article", "newsitem");
			const h = el("h5");
			renderSegs(h, a.headline, res);
			art.appendChild(h);
			const body = el("p");
			renderSegs(body, a.body, res);
			art.appendChild(body);
			/* Extra paragraphs — a stat block, a context note, a quote — drawn
			   per article by the voice system. See decorate() in js/news.js. */
			for (const para of a.paras || []) {
				const pEl = el("p", "newspara");
				renderSegs(pEl, para, res);
				art.appendChild(pEl);
			}
			art.appendChild(el("p", "newskind",
				a.kind + (a.byline ? " · " + a.byline : "")));
			wrap.appendChild(art);
		}
		view.appendChild(wrap);
	}

	/* ------------------------------------------------------------ universe */

	function viewUniverse(view, res) {
		const st = A().state;
		const u = st.universe || { rows: [] };
		view.appendChild(el("h3", null, "Universe"));
		view.appendChild(el("p", "legendline",
			"Load several class files (oldest season first) and run them as one " +
			"continuous world: conference realignment keeps its memory, " +
			"program strength drifts season to season instead of being " +
			"redrawn, a fired coach is replaced by a named first-year hire, and " +
			"the build-pool memory spans the whole timeline. A universe re-runs " +
			"from its seeds — the export stores seeds, not simulated output."));

		const bar = el("div", "filters");
		/* Universe mode is a setting now (see the "The world" group in the
		   settings panel), so this is a REFRESH rather than the only way in:
		   with the setting on, the chain re-runs whenever anything invalidates
		   it and every tab reads the result. With the setting off the button
		   still builds a one-off timeline, which is what it always did — it
		   just no longer leaves the other tabs disagreeing with it. */
		const on = !!A().state.cfg.universe;
		const run = el("button", u.running ? "warn" : on ? null : "primary",
			u.running ? "Running… " + (u.done || 0) + "/" + (u.total || "?")
				: on ? "Rebuild the timeline" : "Build a timeline (one-off)");
		run.disabled = !!u.running;
		run.title = on
			? "Universe mode is on: every tab already shows this world."
			: "Universe mode is off, so this builds a timeline without changing " +
				"what the other tabs show. Turn on Universe mode under “The " +
				"world” in the settings panel to make it the world.";
		run.addEventListener("click", () => { A().runUniverse(); });
		bar.appendChild(run);
		const exp = el("button", null, "Export universe JSON");
		exp.disabled = !u.rows.length || !!u.running;
		exp.title = "Seeds, settings and player biographies. Small, and it " +
			"replays exactly — as long as whoever opens it has the same class " +
			"files.";
		exp.addEventListener("click", () => { A().exportUniverse(false); });
		bar.appendChild(exp);
		const expAll = el("button", null, "Export with class files");
		expAll.disabled = !u.rows.length || !!u.running;
		expAll.title = "The same file with the class exports inlined, so the " +
			"whole universe is one file to hand somebody. Larger.";
		expAll.addEventListener("click", () => { A().exportUniverse(true); });
		bar.appendChild(expAll);
		const impBtn = el("button", null, "Import universe…");
		impBtn.disabled = !!u.running;
		const impInput = el("input");
		impInput.type = "file";
		impInput.accept = ".json";
		impInput.hidden = true;
		impInput.addEventListener("change", () => {
			const f = impInput.files && impInput.files[0];
			if (!f) return;
			f.text().then((txt) => {
				try { A().importUniverse(JSON.parse(txt)); }
				catch (e) { A().showError(e); }
			});
			impInput.value = "";
		});
		impBtn.addEventListener("click", () => impInput.click());
		bar.appendChild(impBtn);
		bar.appendChild(impInput);
		view.appendChild(bar);

		// Per-file diagnostics: which files will run, in what order, and why
		// a file will not.
		const diags = u.diags ||
			(A().state.files.length && global.Universe
				? global.Universe.validate(A().state.files) : []);
		if (diags.length) {
			view.appendChild(el("h4", null, "Files"));
			const dl = el("div", "note");
			diags.slice().sort((a, b) => (a.season || 0) - (b.season || 0))
				.forEach((d, i) => {
					if (i) dl.appendChild(document.createTextNode("\n"));
					dl.appendChild(document.createTextNode(
						(d.ok ? "✓ " : "✗ ") + d.name +
						(d.season ? " — season " + d.season : "") +
						(d.players ? ", " + d.players + " players" : "") +
						(d.errors && d.errors.length ? "  REJECTED: " + d.errors.join("; ") : "") +
						(d.warnings && d.warnings.length ? "  (" + d.warnings.join("; ") + ")" : "")));
				});
			view.appendChild(dl);
		} else {
			view.appendChild(el("p", "hint",
				"No files loaded yet. Load draft classes with the button in the " +
				"header — multiple files at once is fine."));
		}

		if (!u.rows.length) return;

		view.appendChild(el("h4", null, "Timeline"));
		if (!A().state.cfg.universe) {
			view.appendChild(el("p", "hint",
				"Universe mode is off, so this timeline is a report about a " +
				"world the other tabs are not showing. Turn it on under “The " +
				"world” in the settings panel and every tab — and the export — " +
				"will show this world instead."));
		}
		const wrap = el("div", "scroll");
		const table = el("table");
		const hr = el("tr");
		for (const h of ["Season", "Flavor", "AP No. 1", "Champion", "Player of the Year",
			"No. 1 pick", "Realignment", "Sideline changes", "Later-class players"]) {
			hr.appendChild(el("th", null, h));
		}
		const thead = el("thead");
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		for (const r of u.rows) {
			const tr = el("tr");
			tr.appendChild(el("td", null, String(r.season || "?")));
			if (r.error) {
				const td = el("td", null, "failed: " + r.error);
				td.colSpan = 7;
				tr.appendChild(td);
				tb.appendChild(tr);
				continue;
			}
			tr.appendChild(el("td", null, r.flavor || "—"));
			tr.appendChild(el("td", null, r.apOne || "—"));
			tr.appendChild(el("td", null, (r.champion || "—") +
				(r.champSeed ? " (No. " + r.champSeed + ")" : "")));
			tr.appendChild(el("td", null, r.poy
				? r.poy.name + " (" + r.poy.school + ")" : "—"));
			tr.appendChild(el("td", null, r.no1
				? r.no1.name + " (" + r.no1.school + ")" : "—"));
			tr.appendChild(el("td", null, r.realignment && r.realignment.length
				? r.realignment.join("; ") : "—"));
			/* Fired / retired / hired away, rather than one number that used
			   to be the count of "coaching change" news items and so was
			   almost always 1. See coachingCarousel in js/teams.js. */
			tr.appendChild(el("td", "num", r.coachChanges
				? r.coachChanges + " (" + [
					r.coachFired ? r.coachFired + " out" : null,
					r.coachRetired ? r.coachRetired + " retired" : null,
					r.coachHiredAway ? r.coachHiredAway + " hired away" : null,
				].filter(Boolean).join(", ") + ")"
				: "0"));
			tr.appendChild(el("td", "num", r.futureOnRosters
				? r.futureOnRosters + (r.futureHonors ? " (" + r.futureHonors + " honors)" : "")
				: "0"));
			tb.appendChild(tr);
		}
		table.appendChild(tb);
		wrap.appendChild(table);
		view.appendChild(wrap);
		view.appendChild(el("p", "legendline",
			"Later-class players: prospects from a later loaded class who were " +
			"on this season's rosters as underclassmen — a 2027 junior playing " +
			"his 2025 freshman year here. They take minutes, shots and honors " +
			"from this season, and their own pages show the season they played."));

		if (u.threads && u.threads.length) {
			view.appendChild(el("h4", null, "Threads"));
			view.appendChild(el("div", "note", u.threads.join("\n")));
		}
		if (u.alumni && u.alumni.length) {
			view.appendChild(el("h4", null, "Alumni index"));
			view.appendChild(el("p", "legendline",
				"The names this world remembers, season by season — what a later " +
				"class's news can refer back to."));
			view.appendChild(el("div", "note", u.alumni.map((a) =>
				a.season + "  " + a.name + " (" + a.school +
				(a.club ? ", then " + a.club : "") + ") — " + a.why).join("\n")));
		}
	}

	/* ------------------------------------------------------------- bracket */

	function gameNode(a, b, winner, seedA, seedB, score) {
		/* An upset is styled by its magnitude, not a binary: a 15-over-2 is
		   not the same event as a 10-over-7, so the seed differential picks
		   the intensity class. */
		const loSeed = winner === b ? seedA : seedB;
		const wSeed = winner === b ? seedB : seedA;
		const diff = wSeed !== undefined && loSeed !== undefined ? wSeed - loSeed : 0;
		const upsetCls = diff > 8 ? " upset upset3" : diff > 5 ? " upset upset2"
			: diff > 2 ? " upset upset1" : "";
		const g = el("div", "game" + upsetCls);
		const line = (t, seed, won) => {
			const d = el("div", won ? "w" : "l");
			d.appendChild(el("span",
				"sd" + (seed <= 3 ? " sdtop" : seed >= 13 ? " sdlow" : ""),
				seed === undefined ? "" : String(seed)));
			/* The bracket is the most team-dense view in the app — 67 games —
			   and it was the one place team names rendered as plain text. */
			const link = teamLink(t.name);
			link.classList.add("gn");
			link.setAttribute("data-bteam", t.name);
			d.appendChild(link);
			/* Hovering a team lights its entire path through the rounds. */
			link.addEventListener("mouseenter", () => {
				document.querySelectorAll('[data-bteam="' + CSS.escape(t.name) + '"]')
					.forEach((n) => n.classList.add("pathlit"));
			});
			link.addEventListener("mouseleave", () => {
				document.querySelectorAll(".pathlit")
					.forEach((n) => n.classList.remove("pathlit"));
			});
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
		const champPill = el("span", "pill");
		champPill.appendChild(document.createTextNode("Champion: "));
		champPill.appendChild(teamLink(t.champion.team.name));
		champPill.appendChild(document.createTextNode(" (No. " + t.champion.seed + ")"));
		head.appendChild(champPill);
		if (t.runnerUp) {
			const ruPill = el("span", "pill");
			ruPill.appendChild(document.createTextNode("Runner-up: "));
			ruPill.appendChild(teamLink(t.runnerUp.team.name));
			head.appendChild(ruPill);
		}
		const ffPill = el("span", "pill");
		ffPill.appendChild(document.createTextNode("Final Four: "));
		t.finalFour.forEach((x, i) => {
			if (i) ffPill.appendChild(document.createTextNode(", "));
			ffPill.appendChild(teamLink(x.team.name));
		});
		head.appendChild(ffPill);
		const upsets = [];
		/* Iterate the regions the bracket actually HAS, not the static list:
		   the engine populates only regions with teams on a degraded field,
		   and t.regions[r] on an empty one is a TypeError that takes the whole
		   tab down. Same in the cinderella scan and the follow-a-team paths. */
		const liveRegions = Object.keys(t.regions);
		for (const r of liveRegions) {
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
		for (const r of liveRegions) {
			for (const x of t.regions[r].seeds) {
				if (x.seed >= 10 && (x.team.ncaaWins || 0) >= 1) cinderella.push(x);
			}
		}
		cinderella.sort((a, b) => (b.team.ncaaWins || 0) - (a.team.ncaaWins || 0));
		if (cinderella.length) {
			const c = cinderella[0];
			const line = el("p", "legendline");
			line.appendChild(document.createTextNode("Cinderella: No. " + c.seed + " "));
			line.appendChild(teamLink(c.team.name));
			line.appendChild(document.createTextNode(" won " +
				c.team.ncaaWins + " game(s) — " + c.team.ncaaResult + "."));
			view.appendChild(line);
		}

		const path = el("div", "ctl");
		const sel = el("select");
		sel.setAttribute("aria-label", "Follow a team's path through the bracket");
		sel.appendChild(new Option("follow a team's path…", ""));
		const inField = [];
		for (const r of liveRegions) {
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
			for (const r of liveRegions) {
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
				if (!g || !g.a || !g.b) continue;
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
		const REG = global.Tournament.REGIONS.filter((r) => t.regions[r]);
		const mirror = el("div", "bracketwrap");
		const leftCol = el("div", "half");
		const rightCol = el("div", "half right");
		REG.forEach((region, i) => {
			const r = t.regions[region];
			const box = el("div", "regionbox");
			const rh = el("h4", null, region + " — ");
			rh.appendChild(teamLink(r.champ.team.name));
			rh.appendChild(document.createTextNode(" advances"));
			box.appendChild(rh);
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
		const center = el("div", "centercol");
		center.appendChild(el("h4", null, "Final Four"));
		for (const g of t.semis) {
			center.appendChild(gameNode(g.a.team, g.b.team, g.winner.team,
				g.a.seed, g.b.seed, g.score));
		}
		center.appendChild(el("h4", null, "National championship"));
		if (t.final && t.final.b) {
			center.appendChild(gameNode(t.final.a.team, t.final.b.team, t.final.winner.team,
				t.final.a.seed, t.final.b.seed, t.final.score));
		}
		mirror.appendChild(leftCol);
		mirror.appendChild(center);
		mirror.appendChild(rightCol);
		view.appendChild(mirror);

		view.appendChild(el("h3", null, "Last four in / first four out"));
		const bub = el("div", "note");
		bub.textContent =
			"Last in:  " + t.selection.atLarge.slice(-4).map((x) => x.name + " (" + x.regW + "-" + x.regL + ")").join(", ") +
			"\nFirst out: " + t.selection.bubble.slice(0, 4).map((x) => x.name + " (" + x.regW + "-" + x.regL + ")").join(", ");
		view.appendChild(bub);

		if (t.nit && t.nit.champion) {
			const nitH = el("h3", null, "NIT — ");
		nitH.appendChild(teamLink(t.nit.champion.name));
		nitH.appendChild(document.createTextNode(" win it"));
		view.appendChild(nitH);
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

	/* Counting stats are ranked PER 40 MINUTES OF GAME, because the class
	   spans leagues with incompatible game lengths: a G League prospect plays
	   48-minute games at 103 possessions against the NCAA's 40 at ~68, so his
	   raw per-game totals structurally dominate any mixed board. Rates (TS%,
	   percentages) are already length-free and rank as-is. The DISPLAYED
	   number stays the real per-game figure; only the ordering normalizes. */
	const RATE_KEYS = { ts: true, fgp: true, tpp: true, ftp: true, usg: true, drtg: true };
	function leaderValue(p, key) {
		const v = p.stats[key];
		if (RATE_KEYS[key]) return v;
		const gm = p.nonNcaa
			? (global.StatsSim.leagueEnv(p.newCollege).gameMinutes || 40) : 40;
		return v * (40 / gm);
	}
	function leaderTable(res, title, key, fmt, low) {
		const list = res.players.filter((p) => p.stats && p.stats.mpg >= 15)
			.sort((a, b) => (low
				? leaderValue(a, key) - leaderValue(b, key)
				: leaderValue(b, key) - leaderValue(a, key)))
			.slice(0, 10);
		const box = el("div", "card");
		box.appendChild(el("h4", null, title));
		const noteBox = el("div", "note");
		list.forEach((p, i) => {
			/* Where he finished against the WHOLE of Division I, not only
			   against the other sixty-nine men in this class. A class leader
			   board answers "who is the best of these"; the rank answers "was
			   that any good", and only the second one is a scouting fact. */
			const r = p.statRanks && p.statRanks[key];
			const nat = r && r.national ? "  (" + ordinalish(r.national) + " nationally)"
				: r && r.conf ? "  (" + ordinalish(r.conf) + " in the " + r.confName + ")"
				: "";
			if (i) noteBox.appendChild(document.createTextNode("\n"));
			noteBox.appendChild(document.createTextNode(
				(i + 1) + ". " + (fmt ? fmt(p.stats[key]) : n1(p.stats[key])) + "  "));
			noteBox.appendChild(playerLink(p));
			noteBox.appendChild(document.createTextNode(
				" (" + (p.proClub || p.newCollege) + ")" + nat));
		});
		box.appendChild(noteBox);
		return box;
	}

	function ordinalish(n) {
		const v = n % 100;
		if (v >= 11 && v <= 13) return n + "th";
		return n + (["th", "st", "nd", "rd"][n % 10] || "th");
	}

	/* THE PLAYER-OF-THE-YEAR BALLOTS.

	   Six trophies with six electorates is the mechanism that makes
	   "consensus" mean something, and it was invisible: the model computed a
	   full ordered ballot for each and kept only the name at the top, so in a
	   split year — the interesting year, and the whole reason the six exist —
	   a reader could see two men win three trophies each and had no way to see
	   how close any of the six was.

	   Reported as a MARGIN from the winner rather than as a score, because the
	   scores are on an arbitrary internal scale and a margin is a fact a
	   reader can use. `resume lean` is how much this electorate weighted what
	   the player's team did, which is usually the whole of the disagreement. */
	function ballotCards(res) {
		const rows = res.poyBallots || [];
		if (!rows.length) return null;
		const wrap = el("div");
		wrap.appendChild(el("h3", null, "Player of the year, ballot by ballot"));
		const winners = new Set(rows.map((b) => b.top[0] && b.top[0].name));
		wrap.appendChild(el("p", "legendline", winners.size === 1
			? "All six electorates agreed: a sweep, which is what a consensus " +
				"national player of the year is."
			: winners.size + " different winners across the six trophies. Each " +
				"electorate weighs what a player's team did differently — that " +
				"weight is the “résumé lean” under each name."));
		const cards = el("div", "cards");
		for (const b of rows) {
			const card = el("div", "card");
			card.appendChild(el("h4", null, b.award));
			card.appendChild(el("p", "unit", "résumé lean " + b.resumeLean.toFixed(2)));
			const list = el("ol", "ballot");
			for (const r of b.top) {
				const li = el("li");
				if (r.inClass && r.key) li.appendChild(playerLink(r.name, r.key));
				else li.appendChild(document.createTextNode(r.name));
				li.appendChild(document.createTextNode(" — "));
				li.appendChild(teamLink(r.school));
				li.appendChild(el("span", "unit",
					r.rank === 1 ? "  winner" : "  −" + r.behind.toFixed(2)));
				if (!r.inClass) li.appendChild(el("span", "unit", "  not in the class"));
				list.appendChild(li);
			}
			card.appendChild(list);
			cards.appendChild(card);
		}
		wrap.appendChild(cards);
		return wrap;
	}

	function viewAwards(view, res) {
		const ballots = ballotCards(res);
		if (ballots) view.appendChild(ballots);
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
		   ordering, so the number the honor was decided on was the one number
		   the user could not see — and a prospect's 2.7 deflections a game had
		   nothing beside it to say whether that was remarkable.

		   Every leader here carries its national or conference rank against the
		   whole of Division I (see rankAgainstField in js/awards.js), which is
		   the same field the trophies are decided against. */
		view.appendChild(el("h3", null, "Defensive leaders"));
		view.appendChild(el("p", "legendline",
			"Ranks are against every returning rotation player in Division I, " +
			"simulated through the same model — the field the defensive honors " +
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
		// The single number the defensive honors are actually ranked on.
		const defBox = el("div", "card");
		defBox.appendChild(el("h4", null, "Defensive score"));
		const defList = res.players
			.filter((p) => p.stats && p.stats.mpg >= 15 && Number.isFinite(p.scoreDef))
			.sort((a, b) => b.scoreDef - a.scoreDef).slice(0, 10);
		const defNote = el("div", "note");
		if (!defList.length) defNote.textContent = "No defensive scores in this class.";
		defList.forEach((p, i) => {
			if (i) defNote.appendChild(document.createTextNode("\n"));
			defNote.appendChild(document.createTextNode(
				(i + 1) + ". " + p.scoreDef.toFixed(1) + "  "));
			defNote.appendChild(playerLink(p));
			defNote.appendChild(document.createTextNode(
				" (" + (p.proClub || p.newCollege) + ")"));
		});
		defBox.appendChild(defNote);
		dLeaders.appendChild(defBox);
		view.appendChild(dLeaders);

		const teamRows = Object.values(res.teams).filter((t) => t.prospects.length)
			.sort((a, b) => b.pct - a.pct).slice(0, 15);
		const trBox = el("div", "card");
		trBox.appendChild(el("h4", null, "Best records among programs with prospects"));
		const trNote = el("div", "note");
		teamRows.forEach((t, i) => {
			if (i) trNote.appendChild(document.createTextNode("\n"));
			trNote.appendChild(document.createTextNode(t.w + "-" + t.l + "  "));
			trNote.appendChild(teamLink(t.name));
			trNote.appendChild(document.createTextNode(" (" + t.conf + ")"));
		});
		trBox.appendChild(trNote);
		view.appendChild(trBox);

		// The trophies the class LOST — to named returning players.
		const fh = res.fieldHonors || [];
		if (fh.length) {
			const box = el("div", "card");
			box.appendChild(el("h4", null, fh.some((h) => h.futureClass)
				? "Honors won by returning players and later classes' underclassmen"
				: "Honors won by returning players"));
			const noteBox = el("div", "note");
			fh.forEach((h, i) => {
				if (i) noteBox.appendChild(document.createTextNode("\n"));
				noteBox.appendChild(document.createTextNode(h.award + " — "));
				if (h.key) noteBox.appendChild(playerLink(h.name, h.key));
				else noteBox.appendChild(document.createTextNode(h.name));
				noteBox.appendChild(document.createTextNode(
					(h.classYear ? ", " + h.classYear.toLowerCase() : "") + " ("));
				if (h.school && res.teams[h.school]) noteBox.appendChild(teamLink(h.school));
				else noteBox.appendChild(document.createTextNode(h.school || "unknown"));
				noteBox.appendChild(document.createTextNode(")" +
					(h.starReturner ? " — " + h.starReturner : "") +
					(h.futureClass ? " — in the " + h.futureClass + " draft class" : "")));
			});
			box.appendChild(noteBox);
			view.appendChild(box);
			view.appendChild(el("p", "legendline",
				"A returning player who out-produces the class takes the trophy " +
				"with him — these are the races the class lost."));
		}

		/* The sideline's trophies. */
		const ch = res.coachHonors || [];
		if (ch.length) {
			const box = el("div", "card");
			box.appendChild(el("h4", null, "Coach of the Year"));
			const noteBox = el("div", "note");
			const national = ch.filter((h) => !/ Coach of the Year$/.test(h.award) ||
				/^(Naismith|AP) /.test(h.award));
			const confs = ch.filter((h) => national.indexOf(h) === -1);
			national.concat(confs).forEach((h, i) => {
				if (i) noteBox.appendChild(document.createTextNode("\n"));
				noteBox.appendChild(document.createTextNode(h.award + " — " + h.coach + " ("));
				if (h.school && res.teams[h.school]) noteBox.appendChild(teamLink(h.school));
				else noteBox.appendChild(document.createTextNode(h.school || "unknown"));
				noteBox.appendChild(document.createTextNode(", " + h.record +
					(h.situation ? ", " + h.situation : "") + ")"));
			});
			box.appendChild(noteBox);
			view.appendChild(box);
		}

		view.appendChild(el("h3", null, "Honors"));
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
			const h4 = el("h4");
			h4.appendChild(playerLink(p));
			h4.appendChild(document.createTextNode(" — "));
			if (!p.nonNcaa && res.teams[p.newCollege]) h4.appendChild(teamLink(p.newCollege));
			else h4.appendChild(document.createTextNode(p.proClub || p.newCollege));
			c.appendChild(h4);
			const s = p.stats;
			c.appendChild(el("div", "note",
				p.newPos + " · " + p.newOvr + "/" + p.newPot + " · " + p.archetype + "\n" +
				n1(s.ppg) + " PPG / " + n1(s.rpg) + " RPG / " + n1(s.apg) + " APG · " +
				pc(s.fgp) + "% FG, " + pc(s.tpp) + "% 3P\n" +
				p.awards.join("\n") +
				(p.priorAwards && p.priorAwards.length
					? "\nEarlier: " + p.priorAwards.slice().sort((a, b) => b.season - a.season)
						.map((a) => a.season + " " + a.award).join("; ")
					: "")));
			cards.appendChild(c);
		}
		view.appendChild(cards);
	}

	/* ----------------------------------------------------------- draft board */

	/* THE DRAFT BOARD, and the prospect table behind a toggle on it.

	   The tool opened on a forty-column editable spreadsheet, which is the
	   power tool and not the thing anyone comes to look at: the question a
	   draft class answers is "who is good and in what order", and that is the
	   board. Prospects is not a separate destination any more — it is the
	   same class in edit mode, one button away, and the button says so. */
	function viewDraft(view, res) {
		const st = A().state;
		// A prospect's own page rides inside this tab, whichever mode it is in.
		if (st.player) {
			view.appendChild(playerPage(view, res, st.player));
			return;
		}
		const bar = el("div", "modebar");
		const seg = el("div", "segmented");
		seg.setAttribute("role", "tablist");
		seg.setAttribute("aria-label", "Draft board mode");
		[["board", "Draft board", "The class in board order, for reading"],
			["edit", "Player Edit", "The full prospect table: filters, columns, locks and the editor"],
		].forEach(([mode, label, title]) => {
			const on = (st.boardMode || "board") === mode;
			const b = el("button", on ? "on" : "", label);
			b.type = "button";
			b.title = title;
			b.setAttribute("role", "tab");
			b.setAttribute("aria-selected", on ? "true" : "false");
			b.dataset.boardMode = mode;
			b.addEventListener("click", () => {
				st.boardMode = mode;
				// Leaving edit mode closes the editor with it: a drawer open
				// on a view that is not showing the table is a drawer with
				// nothing to point at.
				if (mode !== "edit") st.editing = null;
				A().persist();
				A().render();
			});
			seg.appendChild(b);
		});
		bar.appendChild(seg);
		/* The class's own two facts, on the board only: the prospect table
		   below carries its own summary row and repeating them there is the
		   clutter this reorganization exists to remove. */
		if ((st.boardMode || "board") !== "edit") {
			bar.appendChild(el("span", "pill", res.players.length + " prospects"));
			if (res.flavor && res.flavor.label) {
				bar.appendChild(el("span", "pill", res.flavor.label));
			}
		}
		view.appendChild(bar);
		if ((st.boardMode || "board") === "edit") {
			viewPlayers(view, res);
			return;
		}
		viewBoard(view, res);
	}

	function viewBoard(view, res) {
		view.appendChild(el("p", "legendline",
			"The file already carries draft.round and draft.pick and the tool " +
			"used them as nothing but a class-order proxy. This is the board the " +
			"simulated season implies: a preseason ranking from ratings alone, " +
			"then what the year actually showed. Click a name for his page."));
		const cards = el("div", "cards");
		const mk = (title, list, sign) => {
			const box = el("div", "card");
			box.appendChild(el("h4", null, title));
			const noteBox = el("div", "note");
			if (!list.length) {
				noteBox.textContent = "nobody moved";
			} else {
				list.forEach((p, i) => {
					if (i) noteBox.appendChild(document.createTextNode("\n"));
					noteBox.appendChild(document.createTextNode(
						(sign && p.stockMove > 0 ? "+" : "") + p.stockMove +
						"  No. " + p.boardRank + "  "));
					noteBox.appendChild(playerLink(p));
					noteBox.appendChild(document.createTextNode(
						" (" + (p.proClub || p.newCollege) + ")"));
				});
			}
			box.appendChild(noteBox);
			return box;
		};
		cards.appendChild(mk("Risers", res.risers || [], true));
		cards.appendChild(mk("Fallers", res.fallers || [], true));
		view.appendChild(cards);

		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		const BOARD_HEADS = ["Board", "Rd", "Pick", "Player", "Pos", "Year", "Ovr", "Pot",
			"School / club", "Preseason", "±", "PPG", "Honors"];
		for (const h of BOARD_HEADS) {
			const th = el("th", ["Board", "Rd", "Pick", "Ovr", "Pot", "Preseason", "±", "PPG"].indexOf(h) >= 0 ? "num" : "", h);
			th.scope = "col";
			hr.appendChild(th);
		}
		thead.appendChild(hr);
		table.appendChild(thead);
		const tb = el("tbody");
		/* Round dividers. A draft board is read in rounds — the lottery, the
		   rest of the first, the second, and the men who do not get picked —
		   and a flat sixty-row list makes the reader count to fourteen to
		   find out where the lottery ended. The board already carries a mock
		   round and pick for every prospect; this is that information as a
		   shape rather than as two numeric columns. */
		let lastBand = null;
		const bandOf = (p) => (!p.mockRound ? "Undrafted"
			: p.mockRound === 1 && p.mockPick <= 14 ? "Lottery"
			: p.mockRound === 1 ? "First round"
			: p.mockRound === 2 ? "Second round" : "Round " + p.mockRound);
		for (const p of res.board || []) {
			const band = bandOf(p);
			if (band !== lastBand) {
				lastBand = band;
				const sep = el("tr", "bandrow");
				const cell = el("td", null, band);
				cell.colSpan = BOARD_HEADS.length;
				sep.appendChild(cell);
				tb.appendChild(sep);
			}
			const tr = el("tr");
			tr.tabIndex = 0;
			// The board is for LOOKING, not editing — clicking a row (or the
			// name link inside it) opens the player's own page. The inline
			// editor is one keystroke away from there ("Edit this prospect…").
			tr.addEventListener("click", (e) => {
				// A click on the name or the school/club link does its own
				// navigation (player vs team); the row click is the fallback
				// for everywhere else in it.
				if (e.target.closest(".linky")) return;
				A().showPlayer(p.key);
			});
			tr.addEventListener("keydown", (e) => {
				if (e.key !== "Enter" && e.key !== " ") return;
				e.preventDefault();
				A().showPlayer(p.key);
			});
			tr.appendChild(el("td", "num", String(p.boardRank)));
			tr.appendChild(el("td", "num", p.mockRound ? String(p.mockRound) : "—"));
			tr.appendChild(el("td", "num", p.mockPick ? String(p.mockPick) : "—"));
			const nameTd = el("td", "sticky");
			nameTd.appendChild(playerLink(p));
			tr.appendChild(nameTd);
			tr.appendChild(el("td", null, p.newPos));
			tr.appendChild(el("td", null, p.classYear));
			tr.appendChild(el("td", "num", String(p.newOvr)));
			tr.appendChild(el("td", "num", String(p.newPot)));
			const schoolTd = el("td");
			if (!p.nonNcaa && res.teams[p.newCollege]) schoolTd.appendChild(teamLink(p.newCollege));
			else schoolTd.appendChild(document.createTextNode(p.proClub || p.newCollege));
			tr.appendChild(schoolTd);
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

	/* How chalky this March was, in the numbers a maintainer would otherwise
	   only see from an audit script: the champion's seed, the Final Four's
	   composition, the first-round upsets, the seed-line results, and the
	   strength margin between the top of the field and the bottom of it.
	   tools/validate.js bands the same quantities over many seeds; this is
	   the one-class reading. */
	function tournamentCard(res) {
		const box = el("div", "card");
		box.appendChild(el("h4", null, "Tournament realism"));
		const t = res.tourney;
		if (!t || !t.regions || !t.champion) {
			box.appendChild(el("p", "hint", "No tournament in this run."));
			return box;
		}
		const TS = global.TeamsSim;
		const lines = [];
		lines.push("Champion: No. " + t.champion.seed + " " + t.champion.team.name +
			(t.runnerUp ? " over No. " + t.runnerUp.seed + " " + t.runnerUp.team.name : ""));
		lines.push("Final Four seeds: " + (t.finalFour || []).map((x) => x.seed).join(", "));
		const r64 = [];
		for (const r of Object.keys(t.regions)) for (const g of t.regions[r].rounds[0] || []) r64.push(g);
		const byLine = {};
		for (const g of r64) {
			const hi = Math.min(g.a.seed, g.b.seed);
			const lo = Math.max(g.a.seed, g.b.seed);
			const k = hi + " v " + lo;
			byLine[k] = byLine[k] || [0, 0];
			if (g.winner.seed === hi) byLine[k][0]++; else byLine[k][1]++;
		}
		lines.push("Round of 64 by line: " + Object.keys(byLine)
			.sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
			.map((k) => k + " " + byLine[k][0] + "-" + byLine[k][1]).join(" · "));
		lines.push("First-round upsets (seed gap of five or more): " +
			r64.filter((g) => g.winner.seed - (g.winner === g.a ? g.b : g.a).seed >= 5).length);
		const strengthOf = (x) => (TS && TS.gameStrength ? TS.gameStrength(x.team.rating) : x.team.rating);
		const lineMean = (seed) => {
			const v = [];
			for (const r of Object.keys(t.regions)) for (const x of t.regions[r].seeds) if (x.seed === seed) v.push(strengthOf(x));
			return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
		};
		const s1 = lineMean(1);
		const s8 = lineMean(8);
		const s16 = lineMean(16);
		if (Number.isFinite(s1) && Number.isFinite(s16)) {
			lines.push("Top-seed strength margin: 1 seeds sit " + (s1 - s16).toFixed(1) +
				" strength points above 16 seeds and " + (s1 - s8).toFixed(1) +
				" above 8 seeds (about " + (0.72 * (s1 - s16)).toFixed(0) + " and " +
				(0.72 * (s1 - s8)).toFixed(0) + " points of expected margin)");
		}
		box.appendChild(el("div", "note", lines.join("\n")));
		box.appendChild(el("p", "hint", "Real March: 1 seeds win about 99% of first-round games, " +
			"take roughly 40% of Final Four places and win 55-65% of titles. Batch mode " +
			"shows the same figures as a distribution."));
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
		cards.appendChild(tournamentCard(res));

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
				A().revealPlayer(current);
			});
			bar.appendChild(back);
			const edit = el("button", "tiny", "Edit " + current.name);
			edit.addEventListener("click", () => {
				A().state.editing = null;
				A().revealPlayer(current);
			});
			bar.appendChild(edit);
		}
		view.appendChild(bar);

		const p = current;
		if (!p || !p.gameLog) return;
		/* Which season. An upperclassman's earlier seasons carry a log of
		   their own now (see priorSchedule in js/engine.js), so the tab can
		   show his sophomore year night by night rather than only the draft
		   year. The draft year is the default and the only choice for a
		   freshman. */
		const earlier = (p.priorSeasons || []).filter((r) => r.gameLog && r.gameLog.games);
		let showRow = null;
		if (earlier.length) {
			const seasons = el("div", "rowflex");
			const want = st.logSeason && earlier.some((r) => r.season === st.logSeason)
				? st.logSeason : null;
			showRow = want ? earlier.filter((r) => r.season === want)[0] : null;
			for (const r of earlier) {
				const b = el("button", "tiny" + (showRow === r ? " primary" : ""),
					r.season + " (" + r.classYear + (r.universe ? ", played in this universe" : "") + ")");
				b.addEventListener("click", () => { st.logSeason = r.season; A().render(); });
				seasons.appendChild(b);
			}
			const now = el("button", "tiny" + (!showRow ? " primary" : ""),
				res.season + " (" + p.classYear + ", draft year)");
			now.addEventListener("click", () => { st.logSeason = null; A().render(); });
			seasons.appendChild(now);
			view.appendChild(seasons);
		}
		const gl = showRow ? showRow.gameLog : p.gameLog;
		const line = showRow ? showRow.line || showRow : p.stats;
		if (showRow) {
			view.appendChild(el("p", "legendline", showRow.universe
				? "The season this universe's " + showRow.season + " actually played, on " +
					showRow.team + "'s roster against that year's field."
				: "A season simulated for him alone, at the ratings he had in " +
					showRow.season + ", on a drawn schedule — nights that are plausible, " +
					"not a replay of a season somebody watched."));
		}
		const head = el("div", "rowflex");
		for (const t of [
			p.name + " · " + p.newPos + " · " + (showRow ? showRow.team : (p.proClub || p.newCollege)),
			"season " + n1(line.ppg) + "/" + n1(line.rpg) + "/" + n1(line.apg),
			"highs " + gl.highs.pts + "p " + gl.highs.reb + "r " + gl.highs.ast + "a",
			gl.twentyPointGames + " 20-point games",
			gl.doubleDoubles + " double-doubles",
			gl.foulOuts + (gl.foulOuts === 1 ? " foul-out" : " foul-outs"),
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

		view.appendChild(gameLogTable(gl));
	}

	/* The game-log table itself, shared by the Game log tab and the page
	   of a returning player who has no row in the prospect table. */
	function gameLogTable(gl) {
		const wrap = el("div", "scroll");
		const table = el("table");
		const thead = el("thead");
		const hr = el("tr");
		for (const h of ["#", "Opponent", "Stage", "Result", "MIN", "PTS", "FG", "3P", "FT", "REB", "AST", "STL", "BLK", "TO", "PF"]) {
			const th = el("th", ["Opponent", "Stage", "Result"].indexOf(h) === -1 ? "num" : "", h);
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
			tr.appendChild(el("td", "num", Number.isFinite(g.min) ? String(g.min) : ""));
			const ptsTd = el("td", "num", String(g.pts));
			if (g.pts === gl.highs.pts) ptsTd.className = "num up";
			tr.appendChild(ptsTd);
			// The shooting behind the points, so a 30 reads as 11-of-15 or
			// as a 28-shot night rather than as a number.
			for (const [m, a] of [["fgm", "fga"], ["tpm", "tpa"], ["ftm", "fta"]]) {
				tr.appendChild(el("td", "num",
					Number.isFinite(g[m]) ? g[m] + "-" + g[a] : ""));
			}
			for (const k of ["reb", "ast", "stl", "blk", "tov", "fouls"]) {
				const td = el("td", "num", String(g[k]));
				if (k === "fouls" && g.fouls >= 5) td.className = "num down";
				tr.appendChild(td);
			}
			tb.appendChild(tr);
		});
		table.appendChild(tb);
		wrap.appendChild(table);
		return wrap;
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
			"Pinned: seed " + pinned.seed + " · " + (pinned.flavor || "no flavor") +
			"    vs    current: seed " + now.seed + " · " + (now.flavor || "no flavor")));

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
		num("Honors handed out", pinned.awards, now.awards, 0);
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
		b.addEventListener("click", () => { A().showTeam(name); });
		return b;
	}

	/* The player-page equivalent of teamLink. Every player name in the season
	   views used to be a string in a text node; there was no page to send it
	   to. Takes a player object or (name, key). */
	function playerLink(p, key) {
		const name = typeof p === "string" ? p : p.name;
		const k = typeof p === "string" ? key : p.key;
		const b = el("button", "linky", name);
		b.addEventListener("click", () => { A().showPlayer(k); });
		return b;
	}

	/* Render a News-style segment list ({t:"text"|"team"|"player"}) with the
	   entities as live links. */
	function renderSegs(container, segs, res) {
		for (const seg of segs) {
			if (seg.t === "team" && res.teams[seg.v]) {
				container.appendChild(teamLink(seg.v));
			} else if (seg.t === "player" && seg.key !== undefined) {
				container.appendChild(playerLink(seg.v, seg.key));
			} else {
				container.appendChild(document.createTextNode(seg.v));
			}
		}
	}

	/* ---------------------------------------------------------- player page */

	function playerPage(view, res, key) {
		const p = res.players.filter((x) => x.key === key)[0];
		const box = el("div");
		const back = el("button", "tiny", "← All prospects");
		back.addEventListener("click", () => { A().showPlayer(null); });
		box.appendChild(back);
		if (!p && /^field:/.test(String(key))) return fieldPlayerPage(box, res, key);
		if (!p && /^future:/.test(String(key))) return futurePlayerPage(box, res, key);
		if (!p) {
			box.appendChild(el("p", "hint", "No such prospect in this class."));
			return box;
		}
		const head = el("div", "rowflex playerhead");
		const face = el("div", "facebox");
		face.dataset.playerKey = p.key;
		head.appendChild(face);
		const idbox = el("div");
		idbox.appendChild(el("h3", null, p.name));
		const line = el("p", "legendline");
		line.appendChild(teamLink(p.newCollege));
		line.appendChild(document.createTextNode(
			" · " + p.classYear + " · " + p.newPos + " · " + feet(p.newHgtInches) +
			", " + p.weight + " lb · " + p.archetype));
		idbox.appendChild(line);
		const pills = el("div", "rowflex");
		pills.appendChild(el("span", "pill", "ovr " + p.newOvr + " · pot " + p.newPot));
		if (p.newSkills && p.newSkills.length) {
			pills.appendChild(el("span", "pill", p.newSkills.join(" ")));
		}
		if (p.boardRank) pills.appendChild(el("span", "pill", "Board: No. " + p.boardRank));
		if (p.surprise) pills.appendChild(el("span", "pill", p.surprise.label));
		idbox.appendChild(pills);
		head.appendChild(idbox);
		box.appendChild(head);

		const dl = el("dl", "shortcuts");
		const row = (k, v) => {
			if (!v) return;
			dl.appendChild(el("dt", null, k));
			const dd = el("dd");
			if (typeof v === "string") dd.textContent = v;
			else dd.appendChild(v);
			dl.appendChild(dd);
		};
		/* THE SCOUTING TRAITS, before the numbers.

		   A scout's report opens with what the player IS and the numbers come
		   after, so the traits sit above the stat rows. Grouped, because a
		   flat list of five traits reads as a shuffle and the group is what
		   says which question each one answers. See js/traits.js. */
		if (p.traits && p.traits.length) {
			const wrap = el("div", "traitlist");
			for (const t of p.traits) {
				const tag = el("span", "tag trait", t.name);
				tag.title = t.group + " — " + t.note +
					(t.mood ? " (BBGM mood: " + t.mood + ")" : "");
				tag.setAttribute("aria-label", t.group + ": " + t.name);
				wrap.appendChild(tag);
			}
			row("Scouting", wrap);
			const eff = [];
			if (Number.isFinite(p.volatility) && Math.abs(p.volatility - 1) > 0.06) {
				eff.push(p.volatility > 1
					? "night to night, more volatile than his average implies (x" +
						p.volatility.toFixed(2) + ")"
					: "unusually consistent night to night (x" + p.volatility.toFixed(2) + ")");
			}
			if (Number.isFinite(p.orbBias) && Math.abs(p.orbBias) > 0.02) {
				eff.push(p.orbBias > 0
					? "lives on the offensive glass"
					: "a defensive-glass rebounder");
			}
			if (Number.isFinite(p.traitInjuryMult) && Math.abs(p.traitInjuryMult - 1) > 0.1) {
				eff.push(p.traitInjuryMult > 1
					? "a medical file that raises the injury risk"
					: "a clean medical file");
			}
			if (p.moodTraits && p.moodTraits.length) {
				eff.push("exports with BBGM mood traits " + p.moodTraits.join(", "));
			}
			if (eff.length) row("What that changes", eff.join(" · "));
		}
		const s = p.stats;
		if (s) {
			row("This season", s.gp + " GP · " + n1(s.mpg) + " MPG · " +
				n1(s.ppg) + " / " + n1(s.rpg) + " / " + n1(s.apg) +
				" · " + n1(s.spg) + " stl, " + n1(s.bpg) + " blk");
			row("Shooting", "FG " + pc(s.fgp) + "% · 3P " + pc(s.tpp) + "% · FT " +
				pc(s.ftp) + "% · TS " + pc(s.ts) + "%");
			row("Usage", pc(s.usg) + "% of possessions · " + n1(s.topg) + " TO · " +
				n1(s.pfpg) + " PF");
			const gl = p.gameLog;
			row("Playmaking", (Number.isFinite(s.astdRate) ? "assisted on " + pc(s.astdRate) + "% of his makes · " : "") +
				(Number.isFinite(s.transShare) ? pc(s.transShare) + "% of points in transition · " : "") +
				(Number.isFinite(s.pm) ? (s.pm >= 0 ? "+" : "") + n1(s.pm) + " per game" +
					(Number.isFinite(s.onOff) ? " (on/off " + (s.onOff >= 0 ? "+" : "") + n1(s.onOff) + ", est.)" : "") : ""));
			if (gl && gl.clutch) {
				row("Close games", gl.clutch.w + "-" + gl.clutch.l + " in games decided by five or fewer · " +
					n1(gl.clutch.ppg) + " PPG (" + (gl.clutch.delta >= 0 ? "+" : "") +
					n1(gl.clutch.delta) + " on his average)");
			}
			if (p.hand === "left") row("Hand", "Left-handed");
		}
		if (p.recruiting) {
			/* The whole recruitment, not the box score of one. Rank and stars
			   were all the page could say; who else was in on him, what he cut
			   it to, when he signed and whether he played in April are the
			   things a scout's file actually opens with. */
			const rec = p.recruiting;
			row("Recruiting", rec.stars + "-star, No. " + rec.rank + " nationally" +
				(rec.posRank ? " · No. " + rec.posRank + " " + rec.posLabel : "") +
				(Number.isFinite(rec.composite) ? " · " + rec.composite.toFixed(4) : "") +
				(rec.headliner ? " — headline signing" : ""));
			if (rec.offerCount) {
				row("Recruitment", rec.offerCount + " offers" +
					(rec.finalists && rec.finalists.length > 1
						? ", cut to " + rec.finalists.join(", ") : "") +
					(rec.signed ? " · signed " + (rec.signed === "early"
						? "in the early period" : rec.signed === "late"
							? "in the late period" : "in the spring") : "") +
					(rec.decommits ? " · " + rec.decommits + " decommitments" : ""));
			}
			if (rec.allStar && rec.allStar.length) {
				row("All-star games", rec.allStar.join(" · "));
			}
		}
		if (p.transfer) row("Path", p.transfer.kind +
			(p.transfer.from ? " — from " + p.transfer.from : ""));
		if (p.backstory) row("Story", p.backstory);
		if (p.betterEarlier) {
			row("Trajectory", "Was better as a " +
				String(p.betterEarlier.classYear || "").toLowerCase() + " (" +
				n1(p.betterEarlier.ppg) + " PPG in " + p.betterEarlier.season + ")");
		}
		if (p.awards && p.awards.length) row("Honors", p.awards.join("; "));
		if (p.priorAwards && p.priorAwards.length) {
			row("Earlier honors", p.priorAwards.slice()
				.sort((a, b) => b.season - a.season)
				.map((a) => a.season + " " + a.award).join("; "));
		}
		box.appendChild(dl);

		// Earlier seasons, when they were simulated.
		if (p.priorSeasons && p.priorSeasons.length) {
			box.appendChild(el("h4", null, "Career"));
			const wrap = el("div", "scroll");
			const table = el("table");
			const hr = el("tr");
			const HEAD = ["Season", "Team", "Year", "Record", "GP", "MPG", "PPG", "RPG", "APG", "TS%",
				"Highs", "Honors"];
			for (const h of HEAD) {
				hr.appendChild(el("th", ["Season", "Team", "Year", "Record", "Highs", "Honors"].indexOf(h) === -1 ? "num" : "", h));
			}
			const thead = el("thead");
			thead.appendChild(hr);
			table.appendChild(thead);
			const tb = el("tbody");
			const rows = p.priorSeasons.slice();
			const highsText = (h) => (h ? h.pts + "p / " + h.reb + "r / " + h.ast + "a" : "—");
			for (const r of rows) {
				const tr = el("tr", r.universe ? "now" : "");
				const seasonTd = el("td", null, String(r.season || ""));
				if (r.universe) {
					seasonTd.textContent = "";
					const go = el("button", "linky", String(r.season) + " ★");
					go.title = "Played in this universe's " + r.season + " season — open it";
					go.addEventListener("click", () => {
						A().showPlayerInFile(r.universeFileIndex, r.universeKey);
					});
					seasonTd.appendChild(go);
				}
				tr.appendChild(seasonTd);
				tr.appendChild(el("td", null, r.team || ""));
				tr.appendChild(el("td", null, r.redshirt ? "Redshirt" : (r.classYear || "")));
				if (r.redshirt) {
					const td = el("td", null, r.reason || "did not play");
					td.colSpan = HEAD.length - 3;
					tr.appendChild(td);
				} else {
					tr.appendChild(el("td", null, r.record ? r.record.w + "-" + r.record.l : "—"));
					tr.appendChild(el("td", "num", String(r.gp || "")));
					tr.appendChild(el("td", "num", n1(r.mpg)));
					tr.appendChild(el("td", "num", n1(r.ppg)));
					tr.appendChild(el("td", "num", n1(r.rpg)));
					tr.appendChild(el("td", "num", n1(r.apg)));
					tr.appendChild(el("td", "num", r.ts ? pc(r.ts) : ""));
					const hi = el("td", null, highsText(r.highs));
					if (r.best && r.best.opp) {
						hi.title = "Best game: " + r.best.pts + " points against " + r.best.opp +
							(r.twentyPointGames ? " · " + r.twentyPointGames + " 20-point games" : "");
					}
					tr.appendChild(hi);
					tr.appendChild(el("td", null, (r.awards || []).join("; ")));
				}
				tb.appendChild(tr);
			}
			if (s) {
				const team = res.teams[p.newCollege];
				const tr = el("tr");
				tr.appendChild(el("td", null, String(res.leagueFile.startingSeason || "")));
				tr.appendChild(el("td", null, p.proClub || p.newCollege));
				tr.appendChild(el("td", null, p.classYear));
				tr.appendChild(el("td", null, team && Number.isFinite(team.w) ? team.w + "-" + team.l : "—"));
				tr.appendChild(el("td", "num", String(s.gp)));
				tr.appendChild(el("td", "num", n1(s.mpg)));
				tr.appendChild(el("td", "num", n1(s.ppg)));
				tr.appendChild(el("td", "num", n1(s.rpg)));
				tr.appendChild(el("td", "num", n1(s.apg)));
				tr.appendChild(el("td", "num", pc(s.ts)));
				tr.appendChild(el("td", null, highsText(p.gameLog && p.gameLog.highs)));
				tr.appendChild(el("td", null, (p.awards || []).slice(0, 3).join("; ") +
					((p.awards || []).length > 3 ? " (+" + (p.awards.length - 3) + ")" : "")));
				tb.appendChild(tr);
			}
			table.appendChild(tb);
			wrap.appendChild(table);
			box.appendChild(wrap);
			if (rows.some((r) => r.universe)) {
				box.appendChild(el("p", "legendline",
					"★ a season this universe actually played, on that year's " +
					"roster, against that year's field — not a season simulated " +
					"for him alone. Click it to open it."));
			}
		}

		if (p.note) {
			box.appendChild(el("h4", null, "Scouting note"));
			box.appendChild(el("div", "note", p.note));
		}

		const actions = el("div", "rowflex");
		const edit = el("button", null, "Edit this prospect…");
		edit.addEventListener("click", () => { A().openEditor(p); });
		actions.appendChild(edit);
		if (p.gameLog && p.gameLog.games && p.gameLog.games.length) {
			const gl = el("button", null, "Game log");
			gl.addEventListener("click", () => {
				A().state.logPlayer = p.key;
				A().state.tab = "gamelog";
				A().persist();
				A().render();
			});
			actions.appendChild(gl);
		}
		box.appendChild(actions);
		if (global.Faces) global.Faces.render(face, p);
		return box;
	}

	/* A LATER CLASS'S UNDERCLASSMAN, in the season he played here.

	   In a universe the 2027 file's junior was a freshman on a 2025 roster,
	   and this is his 2025: the line, the nights, the honors, and a link to
	   the man he became — his own page, in his own file. */
	function futurePlayerPage(box, res, key) {
		const fp = (res.futurePlayers || []).filter((f) => f.key === key)[0];
		if (!fp) {
			box.appendChild(el("p", "hint", "No such player in this season."));
			return box;
		}
		const team = res.teams[fp.newCollege];
		const head = el("div", "rowflex playerhead");
		const idbox = el("div");
		idbox.appendChild(el("h3", null, fp.name));
		const line = el("p", "legendline");
		line.appendChild(teamLink(fp.newCollege));
		line.appendChild(document.createTextNode(
			" · " + fp.classYear + " · " + fp.newPos + " · " + fp.archetype +
			" · ovr " + fp.newOvr + " that year"));
		idbox.appendChild(line);
		const pills = el("div", "rowflex");
		pills.appendChild(el("span", "pill", "In the " + fp.classSeason + " draft class, not this one"));
		const own = el("button", "linky", "His own page, in the " + fp.classSeason + " class →");
		own.addEventListener("click", () => { A().showPlayerInFile(fp.fileIndex, fp.homeKey); });
		pills.appendChild(own);
		idbox.appendChild(pills);
		head.appendChild(idbox);
		box.appendChild(head);
		const dl = el("dl", "shortcuts");
		const row = (k, v) => {
			if (!v) return;
			dl.appendChild(el("dt", null, k));
			dl.appendChild(el("dd", null, v));
		};
		const s = fp.stats;
		if (s) {
			row("This season", s.gp + " GP · " + n1(s.mpg) + " MPG · " +
				n1(s.ppg) + " / " + n1(s.rpg) + " / " + n1(s.apg) +
				" · " + n1(s.spg) + " stl, " + n1(s.bpg) + " blk");
			row("Shooting", "FG " + pc(s.fgp) + "% · 3P " + pc(s.tpp) + "% · FT " +
				pc(s.ftp) + "% · TS " + pc(s.ts) + "%");
			row("Usage", pc(s.usg) + "% of possessions · " + n1(s.topg) + " TO · " +
				n1(s.pfpg) + " PF");
		}
		if (team) row("Team", team.w + "-" + team.l + (team.ncaaSeed
			? " · No. " + team.ncaaSeed + " seed, " + team.ncaaResult : ""));
		if (fp.awards && fp.awards.length) row("Honors", fp.awards.join("; "));
		box.appendChild(dl);
		const gl = fp.gameLog;
		if (gl && gl.games && gl.games.length) {
			box.appendChild(el("h4", null, "Game log"));
			const pillsRow = el("div", "rowflex");
			pillsRow.appendChild(el("span", "pill", "highs " + gl.highs.pts + "p " +
				gl.highs.reb + "r " + gl.highs.ast + "a"));
			pillsRow.appendChild(el("span", "pill", gl.twentyPointGames + " 20-point games"));
			pillsRow.appendChild(el("span", "pill", gl.doubleDoubles + " double-doubles"));
			box.appendChild(pillsRow);
			box.appendChild(gameLogTable(gl));
		}
		return box;
	}

	/* A returning player's page. Star returners have names, take trophies
	   under them and appear in News, and used to be text nobody could click:
	   they are rotation entries on a program, not draft prospects, so they
	   have a stat line and a season but no ratings and no export row. The
	   page says so and shows what there is — the line, the honors he took
	   off the class, and a game log drawn from his season on demand. */
	function fieldPlayerPage(box, res, key) {
		const m = /^field:(.*):(\d+)$/.exec(String(key));
		const team = m && res.teams[m[1]];
		const fp = team && (team.fieldPlayers || []).filter((f) => f.key === key)[0];
		if (!fp) {
			box.appendChild(el("p", "hint", "No such player in this season."));
			return box;
		}
		const head = el("div", "rowflex playerhead");
		const idbox = el("div");
		idbox.appendChild(el("h3", null, fp.name));
		const line = el("p", "legendline");
		line.appendChild(teamLink(team.name));
		line.appendChild(document.createTextNode(
			" · " + (fp.classYear || "returning player") +
			(fp.starReturner ? " · " + fp.starReturner : "")));
		idbox.appendChild(line);
		const pills = el("div", "rowflex");
		pills.appendChild(el("span", "pill", "Not in the draft class — no ratings, no export row"));
		pills.appendChild(el("span", "pill", "Rotation No. " + (fp.rotationIndex + 1)));
		idbox.appendChild(pills);
		head.appendChild(idbox);
		box.appendChild(head);

		const dl = el("dl", "shortcuts");
		const row = (k, v) => {
			if (!v) return;
			dl.appendChild(el("dt", null, k));
			dl.appendChild(el("dd", null, v));
		};
		const s = fp.line;
		if (s) {
			row("This season", s.gp + " GP · " + n1(s.mpg) + " MPG · " +
				n1(s.ppg) + " / " + n1(s.rpg) + " / " + n1(s.apg) +
				" · " + n1(s.spg) + " stl, " + n1(s.bpg) + " blk");
			row("Shooting", "FG " + pc(s.fgp) + "% · 3P " + pc(s.tpp) + "% · FT " +
				pc(s.ftp) + "% · TS " + pc(s.ts) + "%");
			row("Usage", pc(s.usg) + "% of possessions · " + n1(s.topg) + " TO · " +
				n1(s.pfpg) + " PF");
		}
		const honors = (res.fieldHonors || []).filter((h) => h.key === key || (!h.key && h.name === fp.name && h.school === team.name));
		if (honors.length) row("Honors", honors.map((h) => h.award).join("; "));
		box.appendChild(dl);

		if (s && global.StatsSim && global.BBGMRng) {
			const gl = global.StatsSim.gameLog({ stats: s, availability: null }, team,
				new global.BBGMRng.Rng("fieldlog|" + key));
			if (gl && gl.games && gl.games.length) {
				box.appendChild(el("h4", null, "Game log"));
				const pillsRow = el("div", "rowflex");
				pillsRow.appendChild(el("span", "pill", "highs " + gl.highs.pts + "p " +
					gl.highs.reb + "r " + gl.highs.ast + "a"));
				pillsRow.appendChild(el("span", "pill", gl.twentyPointGames + " 20-point games"));
				pillsRow.appendChild(el("span", "pill", gl.doubleDoubles + " double-doubles"));
				box.appendChild(pillsRow);
				box.appendChild(gameLogTable(gl));
			}
		}
		return box;
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

	/* One program: who coaches it, how it plays, who is on it, and every game
	   it played. */
	/* A QUADRANT RECORD, AS A BAR.

	   "Q1 2-5 · Q2 4-3 · Q3/Q4 losses 1" is the single most-read line on a
	   team's résumé and it was a string of numbers, which is the one format a
	   reader cannot compare two teams in at a glance. The committee reads it
	   as a shape: how much of the season was played against good teams, and
	   how much of that was won. So it is a shape. */
	function quadBar(quads) {
		if (!quads) return null;
		const rows = [
			["Q1", quads.q1w, quads.q1l], ["Q2", quads.q2w, quads.q2l],
			["Q3", quads.q3w, quads.q3l], ["Q4", quads.q4w, quads.q4l],
		];
		const total = rows.reduce((a, r) => a + r[1] + r[2], 0);
		if (!total) return null;
		const wrap = el("div", "quadbar");
		for (const [label, w, l] of rows) {
			if (!(w + l)) continue;
			const seg = el("div", "quadseg q" + label[1]);
			seg.style.flexGrow = String(w + l);
			seg.title = label + ": " + w + "-" + l;
			const won = el("div", "quadwon");
			won.style.width = ((w / (w + l)) * 100).toFixed(1) + "%";
			seg.appendChild(won);
			seg.appendChild(el("span", "quadlabel", label + " " + w + "-" + l));
			wrap.appendChild(seg);
		}
		return wrap;
	}

	/* THE POLL, AS A LINE.

	   `[· · 18 15 11 9 12 ...]` is a sparkline written in numbers, and the
	   thing a reader wants from it — did they climb all year or fall off a
	   cliff in February — is exactly what a sparkline shows and a list of
	   numbers does not. Inline SVG, no library, and the numbers stay in the
	   title so nothing is lost. */
	function pollSpark(history) {
		const weeks = (history || []).map((r) => (r ? Number(r) : null));
		if (weeks.filter((x) => x).length < 3) return null;
		const W = 160;
		const H = 26;
		const n = weeks.length;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 " + W + " " + H);
		svg.setAttribute("class", "spark");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", "AP ranking by week: " +
			weeks.map((r) => (r ? "No. " + r : "unranked")).join(", "));
		// Rank 1 at the top, 25 at the bottom, unranked off the bottom edge.
		const x = (i) => (n < 2 ? 0 : (i / (n - 1)) * (W - 2) + 1);
		const y = (r) => 2 + ((clamp(r, 1, 26) - 1) / 25) * (H - 4);
		let d = "";
		let open = false;
		weeks.forEach((r, i) => {
			if (!r) { open = false; return; }
			d += (open ? "L" : "M") + x(i).toFixed(1) + " " + y(r).toFixed(1) + " ";
			open = true;
		});
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d.trim());
		path.setAttribute("fill", "none");
		path.setAttribute("stroke", "currentColor");
		path.setAttribute("stroke-width", "1.5");
		svg.appendChild(path);
		// The weeks they were unranked, as ticks along the bottom.
		weeks.forEach((r, i) => {
			if (r) return;
			const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			c.setAttribute("cx", x(i).toFixed(1));
			c.setAttribute("cy", String(H - 1.5));
			c.setAttribute("r", "1");
			c.setAttribute("fill", "currentColor");
			c.setAttribute("opacity", "0.35");
			svg.appendChild(c);
		});
		return svg;
	}

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
			box.appendChild(el("p", "hint", "No such program in this class."));
			return box;
		}
		box.appendChild(el("h3", null, t.name + " — " + t.w + "-" + t.l +
			(t.apRank ? "  (AP #" + t.apRank + ")" : "")));
		const dl = el("dl", "shortcuts");
		const row = (k, v) => {
			dl.appendChild(el("dt", null, k));
			const dd = el("dd");
			if (typeof v === "string") dd.textContent = v;
			else if (v) dd.appendChild(v);
			dl.appendChild(dd);
		};
		row("Conference", t.conf + " " + t.cw + "-" + t.cl +
			(t.confRegularChamp ? " · regular-season champion" : "") +
			(t.confTourneyChamp ? " · tournament champion" : ""));
		// Guard on t.style, which is the object actually read: it comes from
		// the coach today, but the guard was on the wrong object.
		if (t.coach && t.style) {
			row("Coach", t.coach.name + ", year " + t.coach.tenure +
				" — plays " + t.style.name);
		}
		row("Program level", Math.round(t.level) + " (rating " +
			t.rating.toFixed(1) + ")");
		if (t.recruitClass) {
			row("Recruiting class", "No. " + t.recruitClass.natRank + " nationally · No. " +
				t.recruitClass.confRank + " in the " + t.recruitClass.conf + " · " +
				t.recruitClass.signees + " signees" +
				(t.recruitClass.fiveStars ? " · " + t.recruitClass.fiveStars + " five-star" : "") +
				(t.recruitClass.headliner && t.recruitClass.headliner.real
					? " · headlined by " + t.recruitClass.headliner.name : ""));
		}
		if (Number.isFinite(t.pace)) row("Tempo", t.pace.toFixed(1) + " possessions a game");
		if (t.offRtg) {
			row("Efficiency", "ORtg " + t.offRtg.toFixed(1) +
				" · DRtg " + t.defRtg.toFixed(1) + " · SOS " + t.sosAvg.toFixed(1));
		}
		if (t.netRank) {
			row("NET", "No. " + t.netRank +
				(Number.isFinite(t.roadW) ? " · road " + t.roadW + "-" + t.roadL : ""));
			const bar = quadBar(t.quads);
			if (bar) {
				const cell = el("div");
				cell.appendChild(bar);
				cell.appendChild(el("p", "unit",
					"Width is how many games; the filled part is how many were won."));
				row("Quadrant record", cell);
			}
		}
		if (t.apHistory && t.apHistory.some((r) => r)) {
			const spark = pollSpark(t.apHistory);
			const cell = el("div");
			cell.appendChild(document.createTextNode("Peak No. " + t.apPeak +
				(t.apPreseason ? " · preseason No. " + t.apPreseason
					: " · unranked in the preseason") +
				(t.apRank ? " · final No. " + t.apRank : " · unranked at the end")));
			if (spark) {
				cell.appendChild(spark);
				cell.title = t.apHistory.map((r) => (r ? r : "·")).join(" ");
			} else {
				cell.appendChild(document.createTextNode(
					"  [" + t.apHistory.map((r) => (r ? r : "·")).join(" ") + "]"));
			}
			row("AP poll", cell);
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
			const h = el("h4", "rowflex");
			const fb = el("div", "facebox small");
			if (global.Faces) global.Faces.render(fb, p);
			h.appendChild(fb);
			h.appendChild(playerLink(p));
			c.appendChild(h);
			c.appendChild(el("div", "note",
				p.newPos + " " + p.newOvr + "/" + p.newPot + " · " + p.archetype +
				(p.stats ? "\n" + n1(p.stats.mpg) + " mpg, " + n1(p.stats.ppg) + "/" +
					n1(p.stats.rpg) + "/" + n1(p.stats.apg) : "\nNo season")));
			plist.appendChild(c);
		}
		box.appendChild(plist);

		/* The later classes' underclassmen who were on this roster this
		   year (universe mode). Each links to the season he played here and,
		   from there, to his own class. */
		const future = (t.futureMembers || []).slice()
			.sort((a, b) => ((b.stats && b.stats.mpg) || 0) - ((a.stats && a.stats.mpg) || 0));
		if (future.length) {
			box.appendChild(el("h4", null, "From later draft classes"));
			box.appendChild(el("p", "legendline",
				"Prospects in a later loaded class who were on this roster this " +
				"season, at the class year and rating they had then."));
			const wrap = el("div", "scroll");
			const table = el("table");
			const hr = el("tr");
			for (const h of ["Player", "Class", "Year", "Ovr", "MPG", "PPG", "RPG", "APG", "TS%", "Honors"]) {
				hr.appendChild(el("th", ["Player", "Class", "Year", "Honors"].indexOf(h) === -1 ? "num" : "", h));
			}
			const thead = el("thead");
			thead.appendChild(hr);
			table.appendChild(thead);
			const tb = el("tbody");
			for (const fp of future) {
				const l = fp.stats || {};
				const tr = el("tr");
				const td = el("td", "sticky");
				td.appendChild(playerLink(fp.name, fp.key));
				tr.appendChild(td);
				const cls = el("td");
				const go = el("button", "linky", String(fp.classSeason) + " class");
				go.title = "His page in the " + fp.classSeason + " draft class";
				go.addEventListener("click", () => { A().showPlayerInFile(fp.fileIndex, fp.homeKey); });
				cls.appendChild(go);
				tr.appendChild(cls);
				tr.appendChild(el("td", null, fp.classYear || ""));
				tr.appendChild(el("td", "num", String(fp.newOvr)));
				tr.appendChild(el("td", "num", n1(l.mpg || 0)));
				tr.appendChild(el("td", "num", n1(l.ppg || 0)));
				tr.appendChild(el("td", "num", n1(l.rpg || 0)));
				tr.appendChild(el("td", "num", n1(l.apg || 0)));
				tr.appendChild(el("td", "num", Number.isFinite(l.ts) ? pc(l.ts) : ""));
				tr.appendChild(el("td", null, (fp.awards || []).slice(0, 3).join("; ")));
				tb.appendChild(tr);
			}
			table.appendChild(tb);
			wrap.appendChild(table);
			box.appendChild(wrap);
		}

		/* The rest of the rotation. Returning players carry names, stat
		   lines and, when one of them beat the class to a trophy, honors —
		   and nothing on the team page showed them. Each one links to a
		   page of his own. */
		const returners = (t.fieldPlayers || []).slice()
			.sort((a, b) => b.mpg - a.mpg);
		if (returners.length) {
			box.appendChild(el("h4", null, "Returning rotation"));
			const wrap = el("div", "scroll");
			const table = el("table");
			const hr = el("tr");
			for (const h of ["Player", "Year", "MPG", "PPG", "RPG", "APG", "TS%", "Note"]) {
				hr.appendChild(el("th", ["Player", "Year", "Note"].indexOf(h) === -1 ? "num" : "", h));
			}
			const thead = el("thead");
			thead.appendChild(hr);
			table.appendChild(thead);
			const tb = el("tbody");
			for (const fp of returners) {
				const l = fp.line || {};
				const tr = el("tr");
				const td = el("td", "sticky");
				if (fp.key) td.appendChild(playerLink(fp.name, fp.key));
				else td.textContent = fp.name || "";
				tr.appendChild(td);
				tr.appendChild(el("td", null, fp.classYear || ""));
				tr.appendChild(el("td", "num", n1(fp.mpg || 0)));
				tr.appendChild(el("td", "num", n1(l.ppg || 0)));
				tr.appendChild(el("td", "num", n1(l.rpg || 0)));
				tr.appendChild(el("td", "num", n1(l.apg || 0)));
				tr.appendChild(el("td", "num", Number.isFinite(l.ts) ? pc(l.ts) : ""));
				tr.appendChild(el("td", null, fp.starReturner || ""));
				tb.appendChild(tr);
			}
			table.appendChild(tb);
			wrap.appendChild(table);
			box.appendChild(wrap);
		}
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
			/* A dedicated class, not the shared .down: that class also carries
			   a ::before "▼ " pseudo-element meant for a small inline stat
			   delta, and a browser renders that inserted text as an extra cell
			   at the start of the row — which is why a loss visibly pushed the
			   whole schedule row one column to the right. */
			const tr = el("tr", g.won ? "" : "loss");
			const num = el("td", "num");
			/* The game number is the way into the box score: the opponent cell
			   already links to the opponent's page and a cell cannot mean two
			   things. */
			const open = el("button", "linky", String(i + 1));
			open.title = "Box score";
			open.addEventListener("click", function () {
				A().showGame(gameKeyFor(t.name, i));
			});
			num.appendChild(open);
			tr.appendChild(num);
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

	/* ONE GAME, BOTH TEAMS.

	   The game log was per player: to see what happened in a game you opened
	   one prospect's log, read his line, and then went and found the other
	   prospect's log to read his. A box score is a page, and the model already
	   has every number on it — the score and the result from the team's
	   schedule, and every prospect's own line from his game log, which is
	   reconciled to his season totals and therefore cannot disagree with
	   anything else in the tool.

	   What it deliberately does NOT do is invent per-game lines for the
	   returning players. Their season averages exist; their nights do not, and
	   a box score whose bench rows were season averages divided by games would
	   be a fabrication sitting inside the one view in this tool whose whole
	   claim is that it is a record. The page says so rather than filling the
	   space. */
	function gameKeyFor(team, index) { return team + "|" + index; }

	function gamePage(view, res, ref) {
		const box = el("div");
		const cut = String(ref || "").lastIndexOf("|");
		const home = res.teams[String(ref || "").slice(0, cut)];
		const idx = Number(String(ref || "").slice(cut + 1));
		const back = el("button", "tiny", "← Back to the schedule");
		back.addEventListener("click", () => { A().showGame(null); });
		box.appendChild(back);
		if (!home || !home.log || !home.log[idx]) {
			box.appendChild(el("p", "hint", "No such game in this season."));
			return box;
		}
		const g = home.log[idx];
		const away = res.teams[g.opp];
		/* The same game from the other side, matched on the date rather than
		   on the index: the two schedules are sorted independently. */
		let awayIdx = -1;
		if (away && away.log) {
			awayIdx = away.log.findIndex(function (x) {
				return x.opp === home.name &&
					Math.abs((x.when || 0) - (g.when || 0)) < 1e-9;
			});
		}

		const title = el("h3");
		title.appendChild(teamLink(g.opp));
		title.appendChild(document.createTextNode(" " + g.pa + " at "));
		title.appendChild(teamLink(home.name));
		title.appendChild(document.createTextNode(" " + g.pf +
			(g.ot ? " (" + (g.ot > 1 ? g.ot + "OT" : "OT") + ")" : "")));
		box.appendChild(title);
		const when = global.News ? global.News.dateline(g.when || 0) : "";
		box.appendChild(el("p", "legendline",
			when + " · " + (g.home > 0 ? "at " + home.name
				: g.home < 0 ? "at " + g.opp : "neutral floor") +
			" · " + (g.round || (g.conference ? "conference game" : g.stage)) +
			(away ? " · " + g.opp + " " + away.w + "-" + away.l +
				" · " + home.name + " " + home.w + "-" + home.l : "")));

		const side = function (team, gameIndex, score) {
			if (!team) return;
			box.appendChild(el("h4", null, team.name + " — " + score));
			const rows = [];
			for (const p of team.prospects || []) {
				const gl = p.gameLog && p.gameLog.games;
				if (!gl) continue;
				const line = gl.filter(function (x) { return x.i === gameIndex; })[0];
				if (line) rows.push({ p: p, line: line });
			}
			if (!rows.length) {
				box.appendChild(el("p", "hint", team.prospects && team.prospects.length
					? "Every prospect on this roster missed this game."
					: "No draft prospects on this roster — the returning " +
						"rotation carries season averages, not per-game lines."));
				return;
			}
			rows.sort(function (a, b) { return b.line.min - a.line.min; });
			const wrap = el("div", "scroll");
			const table = el("table");
			const hr = el("tr");
			for (const h of ["Player", "MIN", "PTS", "REB", "AST", "STL", "BLK",
				"TO", "PF", "FG", "3P", "FT", "+/-"]) {
				const th = el("th", h === "Player" ? "" : "num", h);
				th.scope = "col";
				hr.appendChild(th);
			}
			const thead = el("thead");
			thead.appendChild(hr);
			table.appendChild(thead);
			const tb = el("tbody");
			let pts = 0;
			let reb = 0;
			let ast = 0;
			for (const r of rows) {
				const line = r.line;
				const tr = el("tr");
				const td = el("td", "sticky");
				td.appendChild(playerLink(r.p));
				tr.appendChild(td);
				for (const v of [line.min, line.pts, line.reb, line.ast, line.stl,
					line.blk, line.tov, line.fouls]) {
					tr.appendChild(el("td", "num", String(Math.round(v))));
				}
				tr.appendChild(el("td", "num", line.fgm + "-" + line.fga));
				tr.appendChild(el("td", "num", line.tpm + "-" + line.tpa));
				tr.appendChild(el("td", "num", line.ftm + "-" + line.fta));
				tr.appendChild(el("td", "num",
					(line.pm >= 0 ? "+" : "") + Math.round(line.pm)));
				tb.appendChild(tr);
				pts += line.pts; reb += line.reb; ast += line.ast;
			}
			table.appendChild(tb);
			wrap.appendChild(table);
			box.appendChild(wrap);
			box.appendChild(el("p", "unit",
				"Prospects accounted for " + Math.round(pts) + " of " + score +
				" points, " + Math.round(reb) + " rebounds and " + Math.round(ast) +
				" assists. The rest belongs to the returning rotation, which " +
				"carries season averages rather than per-game lines."));
		};
		side(home, idx, g.pf);
		side(away, awayIdx, g.pa);
		return box;
	}

	/* THE RATING VECTOR, AS A SHAPE.

	   The compare tab is a table of thirty numbers, which is the right format
	   for "is he better" and the wrong one for "what kind of player is he".
	   The scouting graphic for that question is a radar over the rating
	   vector, and everything it needs is already on the player: BBGM's fifteen
	   ratings are all on the same 0-100 scale, which is what makes a radar
	   legible rather than a lie.

	   Inline SVG, no library: fifteen axes and four polygons is a hundred
	   lines of trigonometry, and a dependency for that is a dependency.

	   Colour is by SLOT, not by value, and the slots match the compare table's
	   column order, so the reader is never asked to remember which shape is
	   which — the legend is the same names in the same order above it. */
	const RADAR_AXES = [
		["hgt", "Size"], ["stre", "Str"], ["spd", "Spd"], ["jmp", "Jump"],
		["endu", "Endu"], ["ins", "Ins"], ["dnk", "Dunk"], ["ft", "FT"],
		["fg", "Mid"], ["tp", "3PT"], ["oiq", "oIQ"], ["diq", "dIQ"],
		["drb", "Hand"], ["pss", "Pass"], ["reb", "Reb"],
	];
	const RADAR_COLORS = ["#3b82f6", "#ef4444", "#16a34a", "#a855f7"];

	function ratingRadar(players) {
		const SIZE = 260;
		const c = SIZE / 2;
		const R = c - 30;
		const n = RADAR_AXES.length;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 " + SIZE + " " + SIZE);
		svg.setAttribute("class", "radar");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", "Rating profiles: " +
			players.map(function (p) {
				return p.name + " — " + RADAR_AXES.map(function (a) {
					return a[1] + " " + (p.newRatings[a[0]] || 0);
				}).join(", ");
			}).join("; "));
		const mk = function (tag, attrs) {
			const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
			for (const k of Object.keys(attrs)) node.setAttribute(k, String(attrs[k]));
			return node;
		};
		const pt = function (i, v) {
			// Straight up for the first axis, clockwise from there.
			const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
			const r = (clamp(v, 0, 100) / 100) * R;
			return [c + r * Math.cos(ang), c + r * Math.sin(ang)];
		};
		// The rings, at 25/50/75/100, so a reader can read a value off it.
		for (const ring of [25, 50, 75, 100]) {
			const d = RADAR_AXES.map(function (a, i) {
				const q = pt(i, ring);
				void a;
				return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1);
			}).join(" ") + " Z";
			svg.appendChild(mk("path", {
				d: d, fill: "none", stroke: "currentColor",
				"stroke-width": ring === 100 ? 1 : 0.5,
				opacity: ring === 100 ? 0.35 : 0.15,
			}));
		}
		// The axis labels.
		RADAR_AXES.forEach(function (a, i) {
			const q = pt(i, 118);
			const t = mk("text", {
				x: q[0].toFixed(1), y: q[1].toFixed(1),
				"text-anchor": "middle", "dominant-baseline": "middle",
				"font-size": "8", fill: "currentColor", opacity: "0.7",
			});
			t.textContent = a[1];
			svg.appendChild(t);
		});
		// The players.
		players.forEach(function (p, slot) {
			const r = p.newRatings || {};
			const d = RADAR_AXES.map(function (a, i) {
				const q = pt(i, Number(r[a[0]]) || 0);
				return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1);
			}).join(" ") + " Z";
			svg.appendChild(mk("path", {
				d: d, fill: RADAR_COLORS[slot % RADAR_COLORS.length],
				"fill-opacity": players.length > 2 ? 0.10 : 0.16,
				stroke: RADAR_COLORS[slot % RADAR_COLORS.length],
				"stroke-width": 1.6,
			}));
		});
		return svg;
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
		["pm", "Plus/minus", 1], ["astd", "Assisted rate", 2],
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
		/* The shapes first, the numbers under them. A radar answers "what kind
		   of player is he" in one look and the table answers "is he better",
		   and putting the table first means the second question is asked
		   before the first one has been. */
		const radarBox = el("div", "radarbox");
		radarBox.appendChild(ratingRadar(picked));
		const legend = el("div", "radarlegend");
		picked.forEach(function (p, i) {
			const item = el("span", "radaritem");
			const swatch = el("span", "radarswatch");
			swatch.style.background = RADAR_COLORS[i % RADAR_COLORS.length];
			item.appendChild(swatch);
			item.appendChild(document.createTextNode(p.name));
			legend.appendChild(item);
		});
		radarBox.appendChild(legend);
		radarBox.appendChild(el("p", "unit",
			"BBGM's fifteen ratings, all on the same 0-100 scale. The rings are " +
			"25, 50, 75 and 100."));
		box.appendChild(radarBox);

		const table = el("table", "mini compare");
		const head = el("tr");
		head.appendChild(el("th", null, ""));
		for (const p of picked) {
			const th = el("th", "num");
			const fb = el("div", "facebox small");
			if (global.Faces) global.Faces.render(fb, p);
			th.appendChild(fb);
			th.appendChild(playerLink(p));
			head.appendChild(th);
		}
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
		awards: viewAwards, board: viewDraft, distribution: viewDistribution, tournamentCard,
		notes: viewNotes, gamelog: viewGameLog, compare: viewCompare,
		news: viewNews, universe: viewUniverse, playerLink, teamLink, playerPage,
		gamePage, gameKeyFor, quadBar, pollSpark, ballotCards,
		COLUMNS, STAT_MODES, PCT_KEYS, DERIVED, derived, cellValue, statValue,
		CARD_COLUMNS, CARD_BREAKPOINT, cardMode, orderedColumns, moveColumn,
		dropColumn, setColumnOrder,
		matchesFilter, numericColumns, histogram, feet, closeRowMenu,
		el, n1, pc, wrapCell, COMPARE_MAX, ratingRadar, RADAR_AXES,
	};
})(window);
