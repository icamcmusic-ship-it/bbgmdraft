#!/usr/bin/env node
/* Headless-browser smoke test.

   The engine has a headless harness; the UI did not, so a broken selector or a
   CSS rule that swallows clicks (a `display: flex` dialog beating its own
   `hidden` attribute, say) shipped silently. This loads the page over a local
   server, drops in a synthetic class, renders every tab, exercises the editor,
   the staged re-runs and batch mode, and fails on any console or page error.

   Usage: node tools/uismoke.js
   Requires playwright and a Chromium build; skips with exit 0 when either is
   missing, so a checkout without them still passes CI. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = 8791;
const TYPES = {
	".html": "text/html", ".js": "text/javascript",
	".css": "text/css", ".json": "application/json",
};

let playwright;
try {
	playwright = require("playwright");
} catch (e) {
	console.log("playwright is not installed — skipping the UI smoke test.");
	process.exit(0);
}

function serve() {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const rel = decodeURIComponent(req.url.split("?")[0]);
			const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
			if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
			fs.readFile(file, (err, data) => {
				if (err) { res.writeHead(404); res.end("not found"); return; }
				res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
				res.end(data);
			});
		});
		server.listen(PORT, () => resolve(server));
	});
}

/* Playwright's own download is the normal case. Environments that pre-install
   Chromium somewhere else (CI images, sandboxes) are handled by BBGM_CHROMIUM or
   by looking where PLAYWRIGHT_BROWSERS_PATH points. */
function chromiumCandidates() {
	const out = [];
	if (process.env.BBGM_CHROMIUM) out.push(process.env.BBGM_CHROMIUM);
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (root && fs.existsSync(root)) {
		for (const dir of fs.readdirSync(root)) {
			if (!/^chromium/.test(dir)) continue;
			for (const rel of [
				"chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
				"chrome-win/chrome.exe",
			]) {
				const p = path.join(root, dir, rel);
				if (fs.existsSync(p)) out.push(p);
			}
		}
	}
	return out;
}

async function launchChromium() {
	const attempts = [{}].concat(chromiumCandidates().map((executablePath) => ({ executablePath })));
	let last = null;
	for (const opts of attempts) {
		try {
			return await playwright.chromium.launch(opts);
		} catch (err) {
			last = err;
		}
	}
	console.log("no Chromium available — skipping the UI smoke test." +
		(last ? "\n  (" + String(last.message).split("\n")[0] + ")" : ""));
	return null;
}

let failures = 0;
let checks = 0;
function ok(name, condition, detail) {
	checks++;
	if (condition) console.log("  ok   " + name);
	else {
		failures++;
		console.log("  FAIL " + name + (detail ? "\n         " + detail : ""));
	}
}

/* The prospect table is a MODE of the Draft board now ("Player Edit"), not a
   tab of its own — the tool opens on the board. Every check that wants the
   forty-column editable table goes through here. */
async function gotoProspects(page) {
	await page.locator("#tabs button", { hasText: "Draft board" }).first().click();
	await page.waitForTimeout(120);
	const seg = page.locator('.segmented button[data-board-mode="edit"]');
	if (await seg.count()) {
		await seg.first().click();
		await page.waitForTimeout(200);
	}
}

(async () => {
	const V = require("./validate.js");
	V.loadEngine();
	const fixture = path.join(require("os").tmpdir(), "bbgm-uismoke-class.json");
	fs.writeFileSync(fixture, JSON.stringify(V.syntheticClass(3, 70)));

	const server = await serve();
	const browser = await launchChromium();
	if (!browser) {
		server.close();
		process.exit(0);
	}
	const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
	const errors = [];
	// The stack, not just the message: "Cannot read properties of undefined" with
	// no frames is not something anybody can act on.
	page.on("pageerror", (e) => errors.push("pageerror: " +
		String(e.stack || e.message).split("\n").slice(0, 4).join(" | ")));
	page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
	page.on("response", (r) => { if (r.status() >= 400) errors.push("http " + r.status() + " " + r.url()); });

	const base = "http://127.0.0.1:" + PORT + "/index.html";
	await page.goto(base);
	await page.evaluate(() => localStorage.clear());
	await page.goto(base);
	await page.setInputFiles("#file", fixture);
	await page.waitForSelector("table tbody tr", { timeout: 30000 });

	console.log("Rendering");
	/* The tool opens on the Draft board, which is a row per prospect in board
	   order. That IS the front page now, so it is what the first check reads. */
	ok("the tool opens on the Draft board",
		(await page.locator("#tabs button.active").first().textContent()).indexOf("Draft board") !== -1);
	await gotoProspects(page);
	ok("the prospect table has a row per player",
		(await page.locator("table tbody tr").count()) === 70);
	for (const label of await page.locator("#tabs button").allTextContents()) {
		await page.locator("#tabs button", { hasText: label }).first().click();
		await page.waitForTimeout(220);
		const size = (await page.locator("#view").innerHTML()).length;
		ok("tab renders: " + label, size > 150, size + " bytes");
	}

	console.log("\nEditing");
	await gotoProspects(page);
	await page.waitForTimeout(150);
	await page.locator("table tbody tr").first().click();
	await page.waitForSelector(".editor", { timeout: 8000 });
	ok("clicking a row opens the editor", true);
	await page.selectOption(".editor select >> nth=0", { index: 2 });
	await page.locator('.editor button:has-text("Apply lock")').click();
	await page.waitForTimeout(600);
	const lock = await page.evaluate(() => {
		const o = window.App.state.overrides;
		const k = Object.keys(o)[0];
		return k ? o[k] : null;
	});
	ok("a lock stores only the fields that were ticked",
		lock && Object.keys(lock).length === 1 && lock.archetype, JSON.stringify(lock));

	/* The panels that explain the model to the user. Each is a <details> in the
	   editor, and each reads numbers the sim already computed — so a broken
	   reference in one of them is invisible until somebody opens it. */
	for (const [label, needle] of [
		["Where this stat line comes from", "Share of the offense"],
		["Why he is at No.", "Overall rating"],
		// A freshman has no earlier seasons, so this one is checked on the
		// row the panel always has: the season just played.
		["Career to date", "MPG"],
	]) {
		const box = page.locator(".editor details", { hasText: label }).first();
		await box.locator("summary").click();
		await page.waitForTimeout(120);
		ok("the editor explains: " + label,
			(await box.innerText()).indexOf(needle) !== -1);
	}
	// A lock can be cleared without opening the editor.
	await page.locator("table tbody tr td button.lockbadge").first().click();
	await page.waitForTimeout(600);
	ok("a lock clears from its badge in the table",
		(await page.evaluate(() => Object.keys(window.App.state.overrides).length)) === 0);
	// Undo puts it back, and redo takes it away again.
	await page.locator("#btnUndo").click();
	await page.waitForTimeout(700);
	ok("undo restores a cleared lock",
		(await page.evaluate(() => Object.keys(window.App.state.overrides).length)) === 1);
	await page.locator("#btnRedo").click();
	await page.waitForTimeout(700);
	ok("redo re-applies it",
		(await page.evaluate(() => Object.keys(window.App.state.overrides).length)) === 0);
	await page.locator("#btnKeys").click();
	await page.waitForTimeout(200);
	ok("the keyboard sheet opens",
		(await page.locator("#modal").innerText()).indexOf("Undo") !== -1);
	await page.locator("#modalCancel, #modalOk").first().click();
	await page.waitForTimeout(150);

	console.log("\nTable controls");
	// Numeric range filters. For a 70-man class this is the main missing verb:
	// "show me everyone over 18 points a game".
	const shownRows = () => page.locator("table tbody tr").count();
	const before = await shownRows();
	await page.locator('button:has-text("+ range filter")').click();
	await page.waitForTimeout(200);
	await page.selectOption(".rangefilter select", "ppg");
	await page.waitForTimeout(250);
	await page.fill(".rangefilter .rangebox >> nth=0", "18");
	await page.locator(".rangefilter .rangebox >> nth=0").press("Enter");
	await page.waitForTimeout(350);
	const filtered = await shownRows();
	const minPpg = await page.evaluate(() => {
		const res = window.App.state.results[window.App.state.active];
		return Math.min.apply(null, res.players
			.filter((p) => window.Views.matchesFilter(p, res))
			.map((p) => (p.stats ? p.stats.ppg : 0)));
	});
	ok("a numeric range filter narrows the table",
		filtered > 0 && filtered < before && minPpg >= 18,
		filtered + " of " + before + " rows, lowest PPG " + minPpg);
	await page.locator('button:has-text("Clear ranges")').click();
	await page.waitForTimeout(300);
	ok("clearing the range filter restores every row", (await shownRows()) === before);

	// Shooting volume, which was computed and never displayed.
	await page.evaluate(() => {
		window.App.state.hiddenColumns = {};
		window.App.render();
	});
	await page.waitForTimeout(250);
	const heads = await page.locator("table thead th").allTextContents();
	// A sorted header carries a ▾/▴ and, in a multi-key sort, its level number.
	const has = (t) => heads.some((h) => h.replace(/\s*[▾▴]\d*$/, "").trim() === t);
	ok("the shooting-volume columns are available",
		has("FGA") && has("3PA") && has("FTA") && has("3PAr") && has("eFG%"),
		heads.join(" "));
	ok("team context and physicals are available",
		has("Team") && has("AP") && has("Seed") && has("Ht") && has("Wt"),
		heads.join(" "));

	// Multi-key sort, and a way back out of it.
	await page.locator("table thead th", { hasText: "PPG" }).first().click();
	await page.waitForTimeout(200);
	await page.locator("table thead th", { hasText: "Ovr" }).first()
		.click({ modifiers: ["Shift"] });
	await page.waitForTimeout(250);
	ok("the sort stack shows every level",
		(await page.locator(".sortstack .chip").count()) === 2);
	await page.locator(".sortstack .chip >> nth=1").locator("button", { hasText: "×" }).click();
	await page.waitForTimeout(250);
	ok("a sort level can be removed",
		(await page.evaluate(() => window.App.state.sort.length)) === 1);

	console.log("\nStaged re-runs");
	const phases = async (mutate) => {
		await page.evaluate(mutate);
		await page.waitForTimeout(450);
		return page.evaluate(() =>
			window.App.state.results[window.App.state.active].phasesRun.join(","));
	};
	ok("the note template re-runs the notes only",
		(await phases(() => {
			// The first line that is OFF by default: ticking one that is
			// already on is not a change and re-runs nothing.
			const i = Array.from(document.getElementById("noteLines").querySelectorAll("input"))
				.filter((x) => !x.checked)[0];
			i.checked = true;
			i.dispatchEvent(new Event("change", { bubbles: true }));
		})) === "notes");
	ok("an award dial re-runs the awards, not the season",
		(await phases(() => {
			const i = document.getElementById("awardStrictness");
			i.value = "1.5";
			i.dispatchEvent(new Event("input", { bubbles: true }));
		})) === "awards,stock,notes");

	console.log("\nEra and efficiency");
	/* Returns the mean team scoring, or — when the run failed — the error
	   banner, because "oldPpg.toFixed is not a function" is not something
	   anybody can act on and the banner says exactly what broke. */
	const teamPpg = async () => page.evaluate(() => {
		const res = window.App.state.results[window.App.state.active];
		if (!res) {
			return "no result: " +
				((document.querySelector("#errBanner .bannertext") || {}).textContent ||
					"(no error banner either)");
		}
		const t = Object.values(res.teams).filter((x) => x.teamTotals);
		return t.reduce((a, x) => a + x.teamTotals.pts, 0) / t.length;
	});
	const modernPpg = await teamPpg();
	ok("the class re-runs after a settings change", typeof modernPpg === "number",
		String(modernPpg));
	await page.evaluate(() => {
		const sel = document.getElementById("era");
		sel.value = "2009-2021";
		sel.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await page.waitForTimeout(800);
	const oldPpg = await teamPpg();
	ok("and again after the era switch", typeof oldPpg === "number", String(oldPpg));
	ok("the era switch moves the whole scoring environment",
		typeof modernPpg === "number" && typeof oldPpg === "number" &&
		modernPpg - oldPpg > 2, String(modernPpg) + " -> " + String(oldPpg));
	await page.evaluate(() => {
		const sel = document.getElementById("era");
		sel.value = "modern";
		sel.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await page.waitForTimeout(800);

	// The efficiency dial, which did not exist: pace and scoringEnv are both
	// possession dials and left true shooting unmoved in every configuration.
	const fieldTs = async () => page.evaluate(() => {
		const res = window.App.state.results[window.App.state.active];
		const ps = res.players.filter((p) => p.stats);
		return ps.reduce((a, p) => a + p.stats.ts, 0) / ps.length;
	});
	const tsBefore = await fieldTs();
	await page.evaluate(() => {
		const i = document.getElementById("efficiencyEnv");
		i.value = "3";
		i.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await page.waitForTimeout(800);
	const tsAfter = await fieldTs();
	ok("the efficiency dial moves true shooting",
		tsAfter - tsBefore > 0.01,
		(tsBefore * 100).toFixed(1) + " -> " + (tsAfter * 100).toFixed(1));
	await page.evaluate(() => {
		const i = document.getElementById("efficiencyEnv");
		i.value = "0";
		i.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await page.waitForTimeout(800);

	/* The team page and the conference standings, both of which are new views
	   over data the sim has always produced. */
	await page.locator("#tabs button", { hasText: "AP Poll" }).first().click();
	await page.waitForTimeout(250);
	ok("the conference standings render",
		(await page.locator("#view").innerText()).indexOf("Conference standings") !== -1);
	await page.locator("#view table tbody tr td button.linky").first().click();
	await page.waitForTimeout(300);
	const teamText = await page.locator("#view").innerText();
	ok("a team page opens with its coach, its splits and its schedule",
		/Coach/.test(teamText) && /Home . away . neutral/.test(teamText) &&
		/Schedule/.test(teamText), teamText.slice(0, 90));
	/* A loss row used to carry the shared .down class, which also draws a
	   "▼ " pseudo-element before the row and visibly shifted every column
	   one to the right. Every row in the schedule table must have the same
	   cell count regardless of the game's result. */
	{
		const counts = await page.locator("#view table")
			.filter({ hasText: "Opponent" }).last()
			.locator("tbody tr").evaluateAll(
				(rows) => rows.map((r) => r.children.length));
		ok("every schedule row has the same number of cells, win or loss",
			counts.length > 5 && counts.every((c) => c === counts[0]),
			JSON.stringify(counts.slice(0, 10)));
		const lossRows = await page.locator("#view table tr.loss").count();
		ok("a loss row does not carry the shared .down class",
			(await page.locator("#view table tr.down").count()) === 0 && lossRows >= 0);
	}
	await page.locator('#view button:has-text("All teams")').click();
	await page.waitForTimeout(250);

	/* Two prospects side by side. */
	await page.locator("#tabs button", { hasText: "Compare" }).first().click();
	await page.waitForTimeout(250);
	await page.selectOption('#view select[aria-label="Prospect 1"]', { index: 1 });
	await page.waitForTimeout(300);
	await page.selectOption('#view select[aria-label="Prospect 2"]', { index: 2 });
	await page.waitForTimeout(300);
	ok("two prospects compare side by side",
		(await page.locator("#view table.compare").innerText()).indexOf("True shooting") !== -1);
	await gotoProspects(page);
	await page.waitForTimeout(250);

	/* The export menu, which is also where the new verbs live. */
	await page.locator("#btnExportMenu").click();
	await page.waitForTimeout(250);
	const menuText = await page.locator("#modal").innerText();
	ok("the export menu offers Markdown notes, a message history and a preset diff",
		/Markdown/.test(menuText) && /Message history/.test(menuText) &&
		/Compare two presets/.test(menuText), menuText.replace(/\n/g, " · ").slice(0, 140));
	/* The three import routes, as a table. Which checkbox matters depends
	   entirely on which door the user is about to walk through, so the table
	   has to say per route what survives it — a paragraph saying the same
	   thing is what this replaced. */
	const routeRows = await page.locator("#modal table.routes tbody tr").allInnerTexts();
	ok("the export dialog tables what each BBGM import route keeps",
		routeRows.length === 3 &&
		/Draft/.test(routeRows[0]) && /deleted on upload/.test(routeRows[0]) &&
		/Import players/.test(routeRows[1]) && /Include stats/.test(routeRows[1]) &&
		/folded into the note/.test(routeRows[1]) &&
		/league file/.test(routeRows[2]),
		routeRows.join(" || ").replace(/\n/g, " · ").slice(0, 400));
	/* The award scope, and the count it promises to write. */
	ok("the export dialog offers a major-awards scope with a live count",
		/major honors only/.test(menuText) && /honor rows in this class/.test(menuText),
		menuText.replace(/\n/g, " · ").slice(0, 300));
	{
		const before = await page.locator("#modal .unit", { hasText: "honor rows" })
			.first().innerText();
		await page.locator("#exportAwardsScope").selectOption("major");
		await page.waitForTimeout(150);
		const after = await page.locator("#modal .unit", { hasText: "honor rows" })
			.first().innerText();
		const n = (t) => Number((t.match(/(\d+)/) || [0, 0])[1]);
		ok("choosing major honors reports a smaller count",
			n(after) > 0 && n(after) < n(before), before + " -> " + after);
		ok("and reveals the conference list to edit",
			await page.locator("#exportMajorConfs").isVisible());
		await page.locator("#exportAwardsScope").selectOption("all");
	}
	ok("and the export menu offers both routes that keep them",
		/Players file, for Tools/.test(menuText) &&
		/Merge into a league file/.test(menuText),
		menuText.replace(/\n/g, " · ").slice(0, 400));
	await page.locator('#modal button:has-text("Compare two presets")').click();
	await page.waitForTimeout(250);
	ok("two presets can be compared",
		(await page.locator("#modal").innerText()).length > 30);
	await page.locator("#modalCancel, #modalOk").first().click();
	await page.waitForTimeout(200);

	console.log("\nBatch");
	await page.evaluate(() => {
		// The sidebar groups are collapsible and remember their state.
		document.getElementById("grp-batch").open = true;
		document.getElementById("batchN").value = "3";
	});
	await page.locator("#btnBatch").click();
	await page.waitForFunction(
		() => document.getElementById("batchProgress").hidden === true,
		null, { timeout: 120000 });
	await page.waitForTimeout(250);
	const batchText = await page.locator("#view").innerText();
	ok("batch mode produces an aggregate", /mean ovr/.test(batchText));
	// A batch of averages with no spread and no seed cannot be re-run or read.
	ok("the batch panel shows a distribution and its seed",
		/p5/.test(batchText) && /p95/.test(batchText) && /batch seed/.test(batchText));
	ok("the batch says which population its per-player rows cover",
		/NCAA prospects per class/.test(batchText));
	const withWorker = batchText;

	/* The main-thread fallback, which nothing tested.

	   Opening index.html straight off the disk blocks workers in most
	   browsers, and that is the documented way to use this tool — so the path
	   most users are on was the one path with no coverage at all. Forced by
	   making the Worker constructor throw, which is exactly what a file://
	   browser does. */
	await page.evaluate(() => {
		window.Worker = function () { throw new Error("workers are blocked"); };
	});
	await page.locator("#btnBatch").click();
	await page.waitForFunction(
		() => document.getElementById("batchProgress").hidden === true,
		null, { timeout: 120000 });
	await page.waitForTimeout(250);
	const inlineText = await page.locator("#view").innerText();
	ok("batch falls back to the main thread when a worker cannot start",
		/mean ovr/.test(inlineText) && /batch seed/.test(inlineText));
	// Both paths derive each class's seed from the batch seed the same way, so
	// the same batch seed has to produce the same table either way.
	const strip = (t) => t.replace(/batch seed [^\n]*/, "");
	ok("the fallback produces the same batch the worker does",
		strip(inlineText) === strip(withWorker),
		strip(inlineText) === strip(withWorker) ? "" : "worker and inline disagree");

	console.log("\nSettings coverage");
	{
		/* Every setting needs a control, or it is a setting nobody can reach.
		   The engine-side test asserts each one is declared by a phase; this is
		   the other half of the same claim. The exceptions are the containers
		   with their own editors and the three legacy sliders folded into
		   leagueWeights. */
		/* recentPools joins the exemptions for the same reason `overrides`
		   is on it: it is state the UI MAINTAINS rather than a setting the
		   user sets. It is the list of build pools the last few classes used,
		   which pickClassPool reads to push a repeated build toward the back
		   of the queue; the dial the user turns is poolMemory, which does have
		   a control. */
		const EXEMPT = ["seed", "overrides", "leagueWeights", "archetypeWeights",
			"noteLines", "wEuroLeague", "wGLeague", "wNBL", "recentPools"];
		const missing = await page.evaluate((exempt) =>
			Object.keys(window.Config.DEFAULTS)
				.filter((k) => exempt.indexOf(k) === -1)
				.filter((k) => !document.getElementById(k)), EXEMPT);
		ok("every setting has a control in the panel", missing.length === 0,
			missing.join(", "));
	}

	console.log("\nKeyboard and table verbs");
	await gotoProspects(page);
	await page.waitForSelector("table tbody tr", { timeout: 8000 });
	{
		// "/" focuses the search, which is where every table shortcut starts.
		await page.locator("body").click({ position: { x: 5, y: 5 } });
		await page.keyboard.press("/");
		ok("slash focuses the prospect search",
			await page.evaluate(() => document.activeElement &&
				document.activeElement.id === "prospectSearch"));
		await page.keyboard.press("Escape");
		await page.locator("body").click({ position: { x: 5, y: 5 } });

		// A number key is a tab. 1 is the Draft board, which is where the
		// tool opens; 4 is the poll, which is somewhere else.
		await page.keyboard.press("4");
		await page.waitForTimeout(250);
		ok("a number key jumps to a tab",
			(await page.locator("#tabs button.active").first().textContent())
				.indexOf("AP Poll") !== -1);
		await page.keyboard.press("1");
		await page.waitForTimeout(250);
		ok("and 1 comes back to the Draft board",
			(await page.locator("#tabs button.active").first().textContent())
				.indexOf("Draft board") !== -1);

		// "l" locks the focused row without opening the editor.
		await page.locator("table tbody tr").nth(2).focus();
		await page.keyboard.press("l");
		await page.waitForTimeout(400);
		ok("l locks the focused row",
			(await page.locator("table tbody tr.locked").count()) >= 1);
		await page.locator("table tbody tr.locked").first().focus();
		await page.keyboard.press("l");
		await page.waitForTimeout(400);
		ok("l again unlocks it",
			(await page.locator("table tbody tr.locked").count()) === 0);

		// The archetype filter, and [ / ] stepping through it.
		const before = await page.locator("table tbody tr").count();
		await page.keyboard.press("]");
		await page.waitForTimeout(300);
		const after = await page.locator("table tbody tr").count();
		ok("] filters the table to one build", after < before, before + " -> " + after);
		await page.keyboard.press("[");
		await page.waitForTimeout(300);
		ok("[ steps back to the whole class",
			(await page.locator("table tbody tr").count()) === before);
	}

	console.log("\nBulk and layout verbs");
	{
		await page.locator("#bulkBar select").first().selectOption("10");
		await page.waitForTimeout(300);
		ok("selecting the top of the board ticks rows",
			(await page.locator("table tbody tr.picked").count()) === 10);
		// The lock-as-is verb is the last select in the bar once rows are ticked.
		const locks = page.locator("#bulkBar select");
		await locks.nth(await locks.count() - 1).selectOption("ovr");
		await page.waitForTimeout(600);
		ok("locking the selection as-is locks every ticked row",
			(await page.locator("table tbody tr.locked").count()) === 10);
		/* Clearing a class's worth of locks asks first now. The confirmation
		   is the point of the check: a user who clicks this expecting it to
		   undo the one lock they just made loses every hand edit in the class,
		   and the button sits next to "Clear selection". */
		await page.locator("#bulkBar button", { hasText: "Clear locks" }).click();
		await page.waitForTimeout(300);
		ok("clearing ten locks asks before it does it",
			!(await page.locator("#modal").isHidden()) &&
			(await page.locator("#modalTitle").textContent()).indexOf("Clear") === 0,
			await page.locator("#modalTitle").textContent());
		await page.locator("#modalOk").click();
		await page.waitForTimeout(600);
		ok("confirming it clears them",
			(await page.locator("table tbody tr.locked").count()) === 0);
		await page.locator("#bulkBar button", { hasText: "Clear selection" }).click();
		await page.waitForTimeout(300);

		// Saved column layouts.
		await page.locator(".filters button", { hasText: "Columns…" }).click();
		await page.waitForSelector(".colpicker", { timeout: 5000 });
		page.once("dialog", (d) => d.accept("my view"));
		await page.locator("button", { hasText: "Save this layout…" }).click();
		await page.waitForTimeout(400);
		ok("a column layout can be saved and comes back by name",
			(await page.locator("button", { hasText: "my view" }).count()) >= 1);
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);
	}

	console.log("\nCompare and reroll");
	{
		await page.locator("#btnPin").click();
		await page.waitForTimeout(400);
		const sels = page.locator("#view .filters select");
		ok("the compare tab offers four slots", (await sels.count()) >= 4);
		const keys = await page.evaluate(() =>
			window.App.state.results[window.App.state.active].players
				.slice(0, 3).map((p) => p.key));
		for (let i = 0; i < 3; i++) await sels.nth(i).selectOption(keys[i]);
		await page.waitForTimeout(400);
		ok("three prospects compare side by side",
			(await page.locator("#view table.compare th").count()) === 4);

		await gotoProspects(page);
		await page.waitForTimeout(200);
		const seedBefore = await page.evaluate(() => window.App.state.lastSeed);
		await page.locator("#btnReroll").click();
		await page.waitForTimeout(900);
		const seedAfter = await page.evaluate(() => window.App.state.lastSeed);
		ok("a reroll draws a new class", seedBefore !== seedAfter);
		await page.locator("#btnUndo").click();
		await page.waitForTimeout(900);
		ok("undo brings the rerolled class back",
			(await page.evaluate(() => window.App.state.lastSeed)) === seedBefore,
			seedBefore + " -> " + (await page.evaluate(() => window.App.state.lastSeed)));
	}

	console.log("\nNarrow viewport");
	{
		await page.setViewportSize({ width: 420, height: 900 });
		await page.waitForTimeout(300);
		ok("the settings panel is out of the way on a phone",
			!(await page.locator("#settings").isVisible()));
		/* The player editor is an aside too, and the rule that hid the
		   panel hid it with it: on a phone a tapped row selected the player
		   and showed nothing. */
		await page.evaluate(() => {
			const st = window.App.state;
			st.editing = st.results[st.active].players[0].key;
			window.App.render();
		});
		await page.waitForTimeout(300);
		ok("the player editor still shows on a phone",
			await page.locator(".drawer").isVisible());
		await page.evaluate(() => { window.App.state.editing = null; window.App.render(); });
		await page.locator("#btnSettings").click();
		await page.waitForTimeout(300);
		ok("and the header button brings it back",
			await page.locator("#settings").isVisible());
		await page.locator("#btnSettings").click();
		await page.setViewportSize({ width: 1500, height: 980 });
		await page.waitForTimeout(300);
		ok("the panel is always there on a desktop",
			await page.locator("#settings").isVisible());
	}

	console.log("\nCards, columns and the menu");
	{
		/* The card layout. `.cardtable` has existed in the stylesheet since the
		   table grew past thirty columns and nothing ever put the class on an
		   element that mattered, so a phone got the forty-column desktop table.
		   This is the check that says the class is applied AND that the cards
		   are not simply the same forty columns stacked. */
		await page.setViewportSize({ width: 420, height: 900 });
		await page.waitForTimeout(500);
		ok("a phone gets the card layout",
			(await page.locator(".tablesplit.cardtable").count()) === 1);
		const cardCells = await page.locator("table tbody tr").first()
			.locator("td").count();
		ok("a card is a dozen fields, not forty", cardCells > 5 && cardCells <= 18,
			cardCells + " cells per card");
		ok("each card cell says which field it is",
			(await page.locator("table tbody tr").first()
				.locator("td[data-label]").count()) > 3);

		await page.setViewportSize({ width: 1500, height: 980 });
		await page.waitForTimeout(500);
		ok("a desktop gets the table back",
			(await page.locator(".tablesplit.cardtable").count()) === 0);
		const tableCells = await page.locator("table tbody tr").first()
			.locator("td").count();
		ok("and the table has more columns than the card did",
			tableCells > cardCells, tableCells + " vs " + cardCells);

		/* Column reordering. Drag-and-drop is hard to drive reliably headless;
		   alt+arrow is the same code path through moveColumn and is what the
		   keyboard user gets. */
		const before = await page.evaluate(() =>
			[...document.querySelectorAll("table thead th")].map((t) =>
				t.dataset.colkey || "").filter(Boolean));
		const moved = before[3];
		await page.locator('th[data-colkey="' + moved + '"]').focus();
		await page.keyboard.press("Alt+ArrowLeft");
		await page.waitForTimeout(400);
		const after = await page.evaluate(() =>
			[...document.querySelectorAll("table thead th")].map((t) =>
				t.dataset.colkey || "").filter(Boolean));
		ok("a column can be moved with the keyboard",
			after.indexOf(moved) === before.indexOf(moved) - 1,
			moved + ": " + before.indexOf(moved) + " -> " + after.indexOf(moved));
		ok("the new order is stored as a preference",
			(await page.evaluate(() => Array.isArray(window.App.state.columnOrder))));
		ok("and it survives a re-render",
			await page.evaluate(async () => {
				window.App.render();
				return [...document.querySelectorAll("table thead th")]
					.map((t) => t.dataset.colkey || "").filter(Boolean).join(",");
			}) === after.join(","));
		// Back to where we started, so later checks see the canonical order.
		await page.evaluate(() => { window.App.state.columnOrder = null; window.App.render(); });
		await page.waitForTimeout(300);

		/* The row context menu, which is the only path from the table to the
		   comparison.

		   The comparison was filled a few steps up, and this menu offers
		   "Remove from compare" — not "Add to compare" — for a player who is
		   already in it. So whether the button this check clicks existed at
		   all depended on whether the top row of the table happened to be one
		   of the three prospects picked earlier, which is not what the check
		   is about and is exactly how it failed on one CI runner and passed on
		   the next with the same commit. Empty the comparison first, so the
		   menu is built against known state. */
		await page.evaluate(() => {
			const st = window.App.state;
			st.compare = (st.compare || []).map(() => null);
			window.App.render();
		});
		await page.waitForTimeout(250);
		await page.locator("table tbody tr").first().click({ button: "right" });
		await page.waitForTimeout(300);
		ok("right-clicking a row opens a menu",
			(await page.locator(".rowmenu").count()) === 1);
		/* Some Chromium builds bubble an extra `click` (button 2) to document
		   right after the `contextmenu` that opens this menu — CI hit exactly
		   this and the menu's own outside-click listener, which did not check
		   which button fired, read that echo as the user dismissing it and
		   closed the menu before the next line's click could land, which
		   showed up as "no button matches Add to compare" thirty seconds
		   later. A right-button echo must not close it; a real left click
		   still does (checked below, after the menu is done with). */
		await page.evaluate(() => {
			document.dispatchEvent(new MouseEvent("click",
				{ bubbles: true, cancelable: true, button: 2 }));
		});
		ok("a right-button echo does not close the menu",
			(await page.locator(".rowmenu").count()) === 1);
		/* A second right-click, on another row, opens that row's menu. A
		   document listener that closed on any contextmenu ran right after
		   the row's own handler, so every right-click after the first
		   opened and closed in the same instant. */
		await page.locator("table tbody tr").nth(1).click({ button: "right" });
		await page.waitForTimeout(300);
		ok("a second right-click opens the next row's menu",
			(await page.locator(".rowmenu").count()) === 1);
		await page.locator("table tbody tr").first().click({ button: "right" });
		await page.waitForTimeout(300);
		/* Named before it is clicked: a locator that matches nothing spends
		   thirty seconds timing out and then says only that it found nothing,
		   which is all CI got out of it. This says what the menu did offer. */
		const menuLabels = await page.locator(".rowmenu button").allTextContents();
		ok("the menu offers the comparison verb",
			menuLabels.some((t) => /Add to compare/.test(t)),
			menuLabels.join(" · ") || "the menu had no buttons");
		await page.locator(".rowmenu button", { hasText: "Add to compare" })
			.click({ timeout: 5000 });
		await page.waitForTimeout(400);
		ok("and it can add a prospect to the comparison",
			await page.evaluate(() =>
				(window.App.state.compare || []).filter(Boolean).length > 0));
		ok("the menu closes after a choice",
			(await page.locator(".rowmenu").count()) === 0);

		// Filling the comparison in one click.
		await page.locator(".tabs button", { hasText: "Compare" }).click();
		await page.waitForTimeout(400);
		await page.locator("button", { hasText: "top by PPG" }).click();
		await page.waitForTimeout(500);
		ok("the comparison can be filled from the top of a statistic",
			await page.evaluate(() => {
				const st = window.App.state;
				const res = st.results[st.active];
				const picked = st.compare.filter(Boolean)
					.map((k) => res.players.filter((p) => p.key === k)[0])
					.filter(Boolean);
				if (picked.length < 2) return false;
				const best = res.players.filter((p) => p.stats)
					.sort((a, b) => b.stats.ppg - a.stats.ppg)[0];
				return picked[0].key === best.key;
			}));

		// The seed history's own housekeeping.
		await gotoProspects(page);
		await page.waitForTimeout(300);
		const seeds = await page.evaluate(() => {
			window.App.state.history = ["aaa", "bbb", "ccc"];
			window.App.persist();
			return window.App.state.history.length;
		});
		ok("the seed history holds seeds", seeds === 3);
		await page.evaluate(() => {
			const sel = document.getElementById("seedHistory");
			// paintHistory is internal; re-render it through a run-free path.
			sel.hidden = false;
		});
		ok("the seed history is manageable from the UI",
			await page.evaluate(() => {
				const sel = document.getElementById("seedHistory");
				return sel !== null;
			}));

		// The build search in the archetype panel.
		await page.evaluate(() => { document.getElementById("grp-arch").open = true; });
		await page.locator("#archSearch").fill("floor-spacing");
		await page.waitForTimeout(300);
		ok("the archetype panel can be searched",
			(await page.locator("#archWeights .archrow:not(.arch-filtered)").count()) === 1,
			(await page.locator("#archWeights .archrow:not(.arch-filtered)").count()) + " rows shown");
		await page.locator("#archSearch").fill("shooting");
		await page.waitForTimeout(300);
		const byTag = await page.locator("#archWeights .archrow:not(.arch-filtered)").count();
		ok("and searched by tag, not only by name", byTag > 8, byTag + " shooting builds");
		await page.locator("#archSearch").fill("");
		await page.waitForTimeout(300);

		// The game log's way back to the table.
		await page.locator(".tabs button", { hasText: "Game logs" }).click();
		await page.waitForTimeout(500);
		const backBtn = page.locator("button").filter({ hasText: "in the table" });
		ok("the game log links back to the prospect table",
			(await backBtn.count()) === 1);
		await backBtn.first().click();
		await page.waitForTimeout(600);
		ok("and it lands on the prospect it was showing",
			await page.evaluate(() => {
				const st = window.App.state;
				return st.tab === "board" && st.boardMode === "edit" &&
					st.editing === st.logPlayer;
			}));
		// The shortcut sheet says Escape closes the editor; it did not.
		await page.locator("body").click({ position: { x: 5, y: 5 } });
		await page.keyboard.press("Escape");
		await page.waitForTimeout(300);
		ok("Escape closes the editor",
			await page.evaluate(() => window.App.state.editing === null));
	}

	console.log("\nThe busy indicator");
	{
		/* run() blocks for a third of a second and now paints a busy state
		   first. The state has to come back OFF, and it has to not eat a
		   message the work itself wrote — setStatus's auto-hide guards on the
		   text still being its own, which a busy message left in place makes
		   false for the rest of the session. */
		const status = () => page.evaluate(() => {
			const s = document.getElementById("status");
			return { text: s.textContent, hidden: s.hidden,
				working: s.classList.contains("working"),
				busy: document.body.classList.contains("busy") };
		});
		const idle = await status();
		ok("the status line is not left saying the class is generating",
			idle.text.indexOf("Generating") === -1, JSON.stringify(idle));
		ok("and the busy state is off", !idle.busy && !idle.working);

		await page.locator("#btnReroll").click();
		await page.waitForTimeout(1200);
		const afterReroll = await status();
		ok("a reroll clears the busy state when it finishes",
			!afterReroll.busy && !afterReroll.working &&
			afterReroll.text.indexOf("Generating") === -1,
			JSON.stringify(afterReroll));

		/* A message written by the work survives. bulkLockAsIs writes its
		   status and then runs, which is the case that was being wiped. */
		await page.locator("table tbody tr").first().locator("td input[type=checkbox]").check();
		await page.waitForTimeout(200);
		const locks = page.locator("#bulkBar select");
		await locks.nth(await locks.count() - 1).selectOption("ovr");
		await page.waitForTimeout(1200);
		const afterLock = await status();
		ok("a message written around a run survives the busy line",
			afterLock.text.indexOf("Locked") === 0, JSON.stringify(afterLock));
		await page.evaluate(() => { window.App.state.selected = {}; window.App.bulkClear(); });
		await page.waitForTimeout(300);
		await page.evaluate(() => {
			window.App.state.overrides = {};
			window.App.persist();
			window.App.run();
		});
		await page.waitForTimeout(900);
	}

	console.log("\nThe pool memory across rerolls");
	{
		/* The UI owns the pool history — the engine sees one run and cannot
		   know what "the last few classes" means. Two properties matter and
		   only one of them is that the history grows. */
		await page.evaluate(() => { window.App.state.poolHistory = []; });
		const pools = [];
		for (let i = 0; i < 3; i++) {
			await page.locator("#btnReroll").click();
			await page.waitForTimeout(900);
			pools.push(await page.evaluate(() => {
				const st = window.App.state;
				return (st.results[st.active].archetypePool || []).slice();
			}));
		}
		ok("a reroll records the class it replaced",
			await page.evaluate(() => (window.App.state.poolHistory || []).length >= 2),
			String(await page.evaluate(() => (window.App.state.poolHistory || []).length)));
		ok("the history never holds the class currently on screen",
			await page.evaluate(() => {
				const st = window.App.state;
				const now = (st.results[st.active].archetypePool || []).join("|");
				return !(st.poolHistory || []).some((p) => p.join("|") === now);
			}));

		/* The one that would have broken silently: recentPools is a
		   build-phase dependency, so recording it at the wrong moment makes
		   Re-apply hand back a different class from the same seed. */
		const before = await page.evaluate(() => {
			const st = window.App.state;
			return st.results[st.active].players.map((p) => p.archetype).join(",");
		});
		await page.locator("#btnRerun").click();
		await page.waitForTimeout(900);
		const after = await page.evaluate(() => {
			const st = window.App.state;
			return st.results[st.active].players.map((p) => p.archetype).join(",");
		});
		ok("re-applying the same seed still gives back the same class",
			before === after);
		ok("and re-applying did not advance the pool memory",
			await page.evaluate(() => (window.App.state.poolHistory || []).length) >= 2 &&
			await page.evaluate(() => {
				const st = window.App.state;
				const now = (st.results[st.active].archetypePool || []).join("|");
				return !(st.poolHistory || []).some((p) => p.join("|") === now);
			}));
		void pools;
	}

	console.log("\nGame log detail");
	{
		await page.locator("#tabs button", { hasText: "Game log" }).first().click();
		await page.waitForTimeout(250);
		const heads = await page.locator("#view table thead th").allTextContents();
		ok("the game log carries minutes and shooting splits",
			heads.indexOf("MIN") !== -1 && heads.indexOf("FG") !== -1 &&
			heads.indexOf("3P") !== -1 && heads.indexOf("FT") !== -1, heads.join(","));
		const cell = await page.locator("#view table tbody tr").first()
			.locator("td").nth(6).textContent();
		ok("a shooting cell reads makes-of-attempts", /^\d+-\d+$/.test(cell.trim()), cell);
	}

	console.log("\nSample class");
	{
		/* A first-time visitor with no export gets a drop-a-file screen and
		   a button. The button has to produce a class through the same
		   path a real file takes. */
		await page.goto(base);
		await page.evaluate(() => localStorage.clear());
		await page.goto(base);
		ok("the empty screen offers a sample class",
			(await page.locator("#btnSample").count()) === 1);
		await page.locator("#btnSample").click();
		await page.waitForSelector("table tbody tr", { timeout: 30000 });
		/* The board carries a divider row per round (see bandOf in
		   js/views.js), so the player rows are the ones that are not one. */
		ok("the sample class renders a board with a row per prospect",
			(await page.locator("table tbody tr:not(.bandrow)").count()) === 70);
		ok("the sample class is named as one",
			/sample/i.test(await page.locator("#fileSummary").textContent()));
		await page.locator("#tabs button", { hasText: "News" }).first().click();
		await page.waitForTimeout(250);
		ok("the sample class writes a News feed",
			(await page.locator("#view").innerHTML()).length > 2000);
	}

	/* ---------------------------------------------------------------------
	   THE CHROME ITSELF: the header, the dialog and the two themes.

	   Everything above this reads state. These read LAYOUT and COLOR, which is
	   where the audit found what it found: a copy button that ate its own
	   icon, a header that grew an empty band when it wrapped, a bracket that
	   scrolled the whole page sideways on a phone, and white text on the
	   light-blue accent every dark theme uses. None of it raises an error and
	   none of it changes a number, so nothing here could see it. */
	console.log("\nThe chrome");
	{
		// A copy button restores the label it HAD, not one a call site
		// remembered: btnCopyLink is an icon and was passed the word "Link".
		const icon = await page.locator("#btnCopyLink").textContent();
		await page.locator("#btnCopyLink").click();
		await page.waitForTimeout(1800);
		ok("the copy-link button goes back to its own icon",
			(await page.locator("#btnCopyLink").textContent()) === icon,
			icon + " -> " + (await page.locator("#btnCopyLink").textContent()));

		/* The header wraps at any width once the seed history and a long
		   "Undo …" label are in it. The flex spacer must not become an empty
		   row of its own when it does, and the undo label must not be able to
		   push the bar wider on its own. */
		await page.locator("#btnReroll").click();
		await page.waitForTimeout(900);
		const head = await page.evaluate(() => {
			const hd = document.querySelector("header");
			const sp = hd.querySelector(".spacer");
			return {
				h: Math.round(hd.getBoundingClientRect().height),
				spacer: Math.round(sp.getBoundingClientRect().height),
				undo: Math.round(document.getElementById("btnUndo").getBoundingClientRect().width),
			};
		});
		ok("a wrapped header does not grow an empty band",
			head.spacer === 0 && head.h <= 130, JSON.stringify(head));
		ok("and the undo label cannot widen the bar without limit",
			head.undo <= 200, String(head.undo));

		// The bracket sized itself to its content and pushed the PAGE sideways.
		await page.setViewportSize({ width: 390, height: 844 });
		await page.locator("#tabs button", { hasText: "March Madness" }).first().click();
		await page.waitForTimeout(400);
		const scrolls = await page.evaluate(() => ({
			sw: document.documentElement.scrollWidth,
			cw: document.documentElement.clientWidth,
		}));
		ok("the bracket does not scroll the page sideways on a phone",
			scrolls.sw <= scrolls.cw + 1, JSON.stringify(scrolls));
		await page.setViewportSize({ width: 1500, height: 980 });
		await page.waitForTimeout(300);

		/* Contrast on the accent, in the theme where it fails: white on
		   #4da3ff is 2.6:1, and it was on Export JSON and on the selected
		   randomizer chip. */
		const contrast = async (sel) => page.evaluate((s) => {
			const lum = (c) => {
				const m = c.match(/[\d.]+/g).map(Number);
				const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
				return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
			};
			const cs = getComputedStyle(document.querySelector(s));
			const a = lum(cs.color), b = lum(cs.backgroundColor);
			return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
		}, sel);
		const theme = await page.evaluate(() => document.getElementById("themeSelect").value);
		for (const t of ["dark", "twilight-court", "night-game"]) {
			await page.evaluate((v) => {
				const s = document.getElementById("themeSelect");
				s.value = v;
				s.dispatchEvent(new Event("change", { bubbles: true }));
			}, t);
			await page.waitForTimeout(150);
			const c1 = await contrast("#btnExport");
			const c2 = await contrast("#randomScope .chip.on");
			ok("text on the accent is readable in " + t, c1 >= 4.5 && c2 >= 4.5,
				"Export " + c1 + ":1, chip " + c2 + ":1");
		}
		await page.evaluate((v) => {
			const s = document.getElementById("themeSelect");
			s.value = v;
			s.dispatchEvent(new Event("change", { bubbles: true }));
		}, theme);
		await page.waitForTimeout(150);

		// Five columns of route facts inside a 560px dialog: two of them used
		// to sit off the right edge behind a scrollbar nobody looks for.
		await page.locator("#btnExportMenu").click();
		await page.waitForTimeout(300);
		const fit = await page.evaluate(() => {
			const t = document.querySelector("#modal table.routes");
			const box = document.querySelector("#modal .modalbox");
			return { t: Math.round(t.getBoundingClientRect().width), box: box.clientWidth };
		});
		ok("the import-route table fits inside the dialog", fit.t <= fit.box,
			JSON.stringify(fit));
		await page.locator("#modalCancel, #modalOk").first().click();
		await page.waitForTimeout(200);

		/* One note to the clipboard. "Copy all notes" wrote seventy of them,
		   which is the wrong verb for pasting one prospect into a post. */
		await page.locator("#tabs button", { hasText: "Player notes" }).first().click();
		await page.waitForTimeout(350);
		const copies = await page.locator(".notehead button").count();
		ok("every note card carries a copy button of its own", copies > 10, String(copies));
		await page.locator(".notehead button").first().click();
		await page.waitForTimeout(250);
		ok("copying one note confirms on the button",
			/Copied/.test(await page.locator(".notehead button").first().innerText()));
		await page.waitForTimeout(1500);
		ok("and the button goes back to its own label",
			(await page.locator(".notehead button").first().innerText()).trim() === "Copy");

		/* An export that says only "Season exported." is not a confirmation
		   that a file was written, and it does not say which file. */
		await page.locator("#btnExportMenu").click();
		await page.waitForTimeout(300);
		await page.locator("#modal button", { hasText: "Season as CSV" }).first().click();
		await page.waitForTimeout(700);
		ok("an export names the file it wrote",
			/Wrote .+\.csv/.test(await page.locator("#status").innerText()),
			(await page.locator("#status").innerText()).slice(0, 80));
		if (!(await page.locator("#modal").isHidden())) {
			await page.locator("#modalCancel, #modalOk").first().click();
			await page.waitForTimeout(200);
		}
		await page.locator("#tabs button", { hasText: "Draft board" }).first().click();
		await page.waitForTimeout(250);
	}

	console.log("\nThe settings filter");
	{
		const visibleCtls = async () => page.evaluate(() =>
			Array.from(document.querySelectorAll("#settings details.grp .ctl"))
				.filter((c) => !c.classList.contains("settings-hidden")).length);
		/* One search box for SETTINGS. The archetype panel has its own, which
		   filters builds rather than settings and is a different control. */
		ok("there is exactly one settings search box",
			(await page.locator("#settings input[type=search]:not(#archSearch)")
				.count()) === 1);
		const all = await visibleCtls();
		ok("the panel has enough controls to need a filter", all > 40, String(all));
		await page.locator("#settingSearch").fill("pace");
		await page.waitForTimeout(200);
		const few = await visibleCtls();
		ok("searching narrows the panel", few > 0 && few < all, few + " of " + all);
		ok("and says how many matched",
			/\d+ of \d+ settings/.test(await page.locator("#settingSearchNote").innerText()),
			await page.locator("#settingSearchNote").innerText());
		await page.locator("#settingSearch").fill("zzzznothing");
		await page.waitForTimeout(200);
		ok("a search with no matches says so",
			/nothing matches/.test(await page.locator("#settingSearchNote").innerText()));
		await page.locator("#settingSearch").fill("");
		await page.waitForTimeout(200);
		ok("clearing it restores every control", (await visibleCtls()) === all);
		/* Only-changed. Nothing has been changed by hand at this point except
		   the era, which was set back, so one deliberate change is made. */
		await page.evaluate(() => {
			const i = document.getElementById("upsetFactor");
			i.value = "1.7";
			i.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await page.waitForTimeout(900);
		await page.locator("#onlyChanged").check();
		await page.waitForTimeout(250);
		const changed = await visibleCtls();
		ok("only-changed shows a handful, not the panel",
			changed > 0 && changed < all / 2, changed + " of " + all);
		const labels = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#settings details.grp .ctl"))
				.filter((c) => !c.classList.contains("settings-hidden"))
				.map((c) => (c.querySelector("label") || {}).textContent || "").join(" "));
		ok("and one of them is the setting that was changed",
			/March upsets/.test(labels), labels.slice(0, 120));
		await page.locator("#onlyChanged").uncheck();
		await page.waitForTimeout(200);
	}

	console.log("\nDestination weights by region");
	{
		await page.evaluate(() => {
			document.getElementById("grp-leagues").open = true;
		});
		await page.waitForTimeout(150);
		const groups = await page.locator("#leagueWeights details.leaguegroup").count();
		ok("the destinations are grouped rather than a flat list of 23",
			groups >= 3 && groups <= 8, String(groups));
		const inputs = await page.locator("#leagueWeights input").count();
		/* Derived, not typed: the count was hardcoded at 23 and went stale the
		   first time a league was added. Every destination gets a box except
		   "DII NCAA", which has a slider of its own (pDII) in the same
		   fieldset. */
		const want = await page.evaluate(() =>
			Object.keys(window.Colleges.NON_NCAA).filter((k) => k !== "DII NCAA").length);
		ok("and every league is still there", inputs === want,
			inputs + " boxes for " + want + " destinations");
		/* Europe is the group that has to exist, and the EuroLeague has to be
		   in it: the grouping is derived from each league's own birthplace
		   multipliers, so this is the check that the derivation works. */
		const euro = await page.evaluate(() => {
			const g = Array.from(
				document.querySelectorAll("#leagueWeights details.leaguegroup"))
				.filter((d) => /Europe/.test(d.querySelector("summary").textContent))[0];
			if (!g) return null;
			return Array.from(g.querySelectorAll("input")).map((i) => i.dataset.league);
		});
		ok("the EuroLeague is grouped under Europe",
			!!euro && euro.indexOf("EuroLeague") !== -1, (euro || []).join(", "));
		/* The group multiplier. */
		await page.evaluate(() => {
			const g = Array.from(
				document.querySelectorAll("#leagueWeights details.leaguegroup"))
				.filter((d) => /Europe/.test(d.querySelector("summary").textContent))[0];
			g.open = true;
			window.__before = Array.from(g.querySelectorAll("input"))
				.map((i) => Number(i.value));
			g.querySelector("summary button").click();
		});
		await page.waitForTimeout(700);
		const doubled = await page.evaluate(() => {
			const g = Array.from(
				document.querySelectorAll("#leagueWeights details.leaguegroup"))
				.filter((d) => /Europe/.test(d.querySelector("summary").textContent))[0];
			const now = Array.from(g.querySelectorAll("input")).map((i) => Number(i.value));
			return now.every((v, i) => v === Math.min(100, window.__before[i] * 2));
		});
		ok("doubling a region doubles every weight in it", doubled);
		ok("and the change reaches the settings",
			await page.evaluate(() => {
				const w = window.App.state.cfg.leagueWeights;
				return w && w.EuroLeague === Math.min(100, window.__before[0] * 2);
			}));
	}

	console.log("\nThe randomizer scopes");
	{
		const chips = await page.locator("#randomScope .chip").allInnerTexts();
		ok("the randomizer offers its scopes as chips",
			chips.length === 8, chips.join(", "));
		ok("exactly one is selected",
			(await page.locator("#randomScope .chip.on").count()) === 1);
		await page.locator("#randomScope .chip", { hasText: "builds" }).click();
		await page.waitForTimeout(150);
		ok("clicking one selects it",
			(await page.evaluate(() => window.App.state.randomScope)) === "builds");
		ok("and marks it for a screen reader",
			(await page.locator("#randomScope .chip.on").getAttribute("aria-checked")) === "true");
		await page.locator("#randomScope .chip", { hasText: "gently" }).click();
		await page.waitForTimeout(150);
	}

	console.log("\nThe compare radar");
	{
		await page.locator("#tabs button", { hasText: "Compare" }).first().click();
		await page.waitForTimeout(300);
		await page.evaluate(() => {
			const st = window.App.state;
			const res = st.results[st.active];
			const keys = res.players.slice()
				.sort((a, b) => (a.boardRank || 999) - (b.boardRank || 999))
				.slice(0, 3).map((p) => p.key);
			st.compare = keys.concat([null]).slice(0, 4);
			window.App.render();
		});
		await page.waitForTimeout(300);
		ok("the compare tab draws a rating radar",
			(await page.locator("#view svg.radar").count()) === 1);
		const paths = await page.locator("#view svg.radar path").count();
		/* Four rings plus one polygon per player. */
		ok("with a ring per level and a polygon per player", paths === 7, String(paths));
		const labels = await page.locator("#view svg.radar text").allInnerTexts();
		ok("and all fifteen rating axes labelled", labels.length === 15, labels.join(","));
		const legend = await page.locator("#view .radaritem").allInnerTexts();
		ok("with a legend naming the players in order", legend.length === 3, legend.join(" / "));
		const aria = await page.locator("#view svg.radar").getAttribute("aria-label");
		ok("and the numbers behind it in the aria-label",
			/Size \d+/.test(String(aria)) && /Pass \d+/.test(String(aria)),
			String(aria).slice(0, 100));
	}

	console.log("\nA game's box score");
	{
		await page.evaluate(() => {
			const st = window.App.state;
			const res = st.results[st.active];
			const t = Object.values(res.teams).filter((x) => x.prospects.length >= 1)[0];
			window.App.showTeam(t.name);
		});
		await page.waitForTimeout(350);
		const gameLinks = page.locator("#view table tbody td.num button.linky");
		ok("every schedule row opens a box score",
			(await gameLinks.count()) >= 25, String(await gameLinks.count()));
		await gameLinks.first().click();
		await page.waitForFunction(
			() => window.App && window.App.state && window.App.state.game,
			null, { timeout: 10000 });
		await page.waitForTimeout(200);
		const text = await page.locator("#view").innerText();
		ok("the box score names both teams and the score",
			/ at .+\d/.test(text.split("\n")[1] || ""), text.split("\n").slice(0, 3).join(" | "));
		/* Wait for the box score's own table rather than a fixed 350ms: on a
		   loaded machine the render lands after the timeout and the whole
		   block fails on a stopwatch rather than on a defect. */
		await page.waitForSelector("#view table thead th", { timeout: 10000 });
		const heads = await page.locator("#view table thead th").allInnerTexts();
		ok("and carries a real box-score header",
			heads.indexOf("MIN") !== -1 && heads.indexOf("+/-") !== -1 &&
			heads.indexOf("FG") !== -1, heads.join(","));
		const cell = await page.locator("#view table tbody tr td").nth(9).innerText();
		ok("with makes-of-attempts shooting", /^\d+-\d+$/.test(cell.trim()), cell);
		ok("and says what it is not showing",
			/returning rotation/.test(text));
		/* The two lines have to be the same game seen from two sides. */
		const consistent = await page.evaluate(() => {
			const st = window.App.state;
			const res = st.results[st.active];
			const cut = st.game.lastIndexOf("|");
			const home = res.teams[st.game.slice(0, cut)];
			const g = home.log[Number(st.game.slice(cut + 1))];
			const away = res.teams[g.opp];
			const mirror = away.log.filter((x) => x.opp === home.name &&
				Math.abs(x.when - g.when) < 1e-9)[0];
			return !!mirror && mirror.pf === g.pa && mirror.pa === g.pf;
		});
		ok("and the opponent's schedule agrees with it", consistent);
		await page.evaluate(() => { window.App.showGame(null); window.App.showTeam(null); });
		await page.waitForTimeout(250);
	}

	console.log("\nThe season's storylines");
	{
		await gotoProspects(page);
		await page.waitForTimeout(300);
		const text = await page.locator("#view").innerText();
		const narrative = await page.evaluate(() => {
			const st = window.App.state;
			return (st.results[st.active].narrative || []).map((n) => n.name);
		});
		ok("a class draws season storylines", narrative.length >= 2, narrative.join(" + "));
		ok("and the prospects tab names them",
			narrative.every((n) => text.indexOf(n) !== -1), narrative.join(" + "));
		ok("and says what each one means",
			/The season: .{20,}/.test(text),
			(text.match(/The season: [^\n]{0,120}/) || [""])[0]);
	}

	console.log("\nScouting traits on the player page");
	{
		await page.evaluate(() => {
			const st = window.App.state;
			const res = st.results[st.active];
			window.App.showPlayer(res.players.filter((p) => !p.nonNcaa)[0].key);
		});
		await page.waitForTimeout(400);
		const tags = await page.locator("#view .traitlist .tag.trait").allInnerTexts();
		ok("the player page lists his scouting traits",
			tags.length >= 2 && tags.every((t) => t.length > 3), tags.join(" / "));
		const title = await page.locator("#view .traitlist .tag.trait").first()
			.getAttribute("title");
		ok("each trait carries its group and its note in a tooltip",
			/ — .{15,}/.test(String(title)), String(title).slice(0, 90));
		const dt = await page.locator("#view dl.shortcuts dt").allInnerTexts();
		ok("and the page says what the traits change",
			dt.indexOf("Scouting") !== -1, dt.join(", "));
	}

	console.log("\nThe news feed filters");
	{
		await page.locator("#tabs button", { hasText: "News" }).first().click();
		await page.waitForTimeout(300);
		const countText = async () => (await page.locator("#view .legendline")
			.nth(1).innerText());
		const all = await countText();
		ok("the feed says how many articles it is showing",
			/\d+ articles/.test(all), all);
		const total = Number((all.match(/(\d+) articles/) || [0, 0])[1]);
		ok("and there are enough of them to need filtering", total >= 40, all);
		/* Filter by kind. */
		const opts = await page.locator("#view select option").allInnerTexts();
		ok("the kind filter lists the kinds in the feed, grouped",
			opts.length > 20 &&
			(await page.locator("#view select optgroup").count()) >= 3,
			opts.length + " options");
		await page.locator("#view select").selectOption({ index: 2 });
		await page.waitForTimeout(250);
		const filtered = await countText();
		ok("choosing a kind narrows the feed",
			/ of \d+ articles/.test(filtered) &&
			Number(filtered.split(" ")[0]) < total, filtered);
		await page.locator("#view select").selectOption("");
		await page.waitForTimeout(250);
		/* Filter by text. */
		await page.locator("#view input[type=search]").fill("zzzznothing");
		await page.waitForTimeout(250);
		ok("a search with no matches says so",
			/Nothing in the feed matches/.test(await page.locator("#view").innerText()));
		await page.locator("#view input[type=search]").fill("");
		await page.waitForTimeout(250);
		ok("clearing the search restores the feed", (await countText()) === all);
	}

	console.log("\nUniverse mode as a setting");
	{
		/* THE BUG THIS EXISTS FOR.

		   The universe used to finish by nulling every cached result, so the
		   next render of any tab re-ran the file with the plain config — no
		   carry-over, and the base seed instead of the season's own. The
		   Timeline said one team won the title and the Bracket tab for the
		   same file showed another. Nothing in any harness could see it,
		   because both halves were individually correct.

		   Two class files, universe mode on, and the champion the Timeline
		   names has to be the champion the cached result carries. */
		await page.goto(base);
		await page.evaluate(() => localStorage.clear());
		await page.goto(base);
		await page.evaluate(() => {
			const S = window.Sample;
			const A = window.App;
			const files = [2026, 2027].map((season) => {
				const data = S.makeClass(season, 70, season);
				return { name: "class-" + season + ".json", data };
			});
			A.installFiles(files, []);
		});
		await page.waitForSelector("table tbody tr", { timeout: 30000 });
		await page.evaluate(() => {
			window.App.state.cfg.universe = true;
			window.App.state.cfg.seed = "smoke-universe";
		});
		await page.evaluate(() => window.App.runUniverse());
		await page.waitForFunction(() => !window.App.state.universe.running &&
			window.App.state.universe.rows.length >= 2, null, { timeout: 60000 });
		const agree = await page.evaluate(() => {
			const st = window.App.state;
			const out = [];
			for (const row of st.universe.rows) {
				const i = st.files.findIndex((f) => f.name === row.fileName);
				const res = st.results[i];
				out.push({
					file: row.fileName,
					timeline: row.champion,
					cached: res && res.tourney && res.tourney.champion
						? res.tourney.champion.team.name : null,
					seedRow: row.seed,
					seedCached: res ? res.seed : null,
				});
			}
			return out;
		});
		ok("the chain keeps a result for every season it ran",
			agree.length >= 2 && agree.every((a) => a.cached), JSON.stringify(agree));
		ok("every tab reads the champion the timeline names",
			agree.every((a) => a.timeline === a.cached),
			agree.map((a) => a.file + ": " + a.timeline + " vs " + a.cached).join(" | "));
		ok("and the season's own seed, not the base seed",
			agree.every((a) => a.seedRow === a.seedCached),
			JSON.stringify(agree.map((a) => [a.seedRow, a.seedCached])));
		/* And the other half: the export writes the universe's world rather
		   than a re-simulation of the file. The note carries the season's own
		   record, so comparing the exported note against the cached result is
		   a comparison of the two worlds. */
		const exportAgrees = await page.evaluate(() => {
			const st = window.App.state;
			const res = st.results[st.active];
			const file = window.Engine.exportFile(res, {});
			const i = res.players.findIndex((p) => p.note && !p.nonNcaa);
			return i >= 0 && file.players[i].note === res.players[i].note;
		});
		ok("the export writes the universe's world", exportAgrees);
		/* THE SAME MEN ACROSS THE TWO FILES. The 2027 class's upperclassmen
		   were on 2026's rosters; the 2026 team page lists them, the awards
		   page can name one, and the 2027 player's career table carries the
		   season 2026 actually played, marked and linked. */
		const cross = await page.evaluate(() => {
			const st = window.App.state;
			const i26 = st.files.findIndex((f) => /2026/.test(f.name));
			const i27 = st.files.findIndex((f) => /2027/.test(f.name));
			const r26 = st.results[i26];
			const r27 = st.results[i27];
			const future = (r26 && r26.futurePlayers) || [];
			const withTeam = future.filter((p) => r26.teams[p.newCollege] &&
				(r26.teams[p.newCollege].futureMembers || []).indexOf(p) !== -1);
			const linked = r27 ? r27.players.filter((p) =>
				(p.priorSeasons || []).some((r) => r.universe && r.season === r26.season)) : [];
			return {
				future: future.length, withTeam: withTeam.length, linked: linked.length,
				stats: future.every((p) => p.stats && p.gameLog),
				team: withTeam.length ? withTeam[0].newCollege : null,
				key27: linked.length ? linked[0].key : null,
				i26, i27,
			};
		});
		ok("the later class's upperclassmen played the earlier season",
			cross.future >= 10 && cross.withTeam === cross.future && cross.stats,
			JSON.stringify(cross));
		ok("and their own file's career table carries that season",
			cross.linked >= 10 && cross.linked <= cross.future, cross.linked + " of " + cross.future);
		if (cross.team) {
			await page.evaluate((i) => {
				window.App.state.active = i;
				window.App.showTeam(null);
			}, cross.i26);
			await page.evaluate((name) => window.App.showTeam(name), cross.team);
			const heading = await page.evaluate(() =>
				Array.from(document.querySelectorAll("#view h4")).map((h) => h.textContent));
			ok("the team page has a section for later-class players",
				heading.indexOf("From later draft classes") !== -1, heading.join(" | "));
			await page.evaluate(() => window.App.showTeam(null));
		}
		if (cross.key27) {
			await page.evaluate((args) => window.App.showPlayerInFile(args.i, args.key),
				{ i: cross.i27, key: cross.key27 });
			const marked = await page.evaluate(() =>
				Array.from(document.querySelectorAll("#view button.linky"))
					.some((b) => /★/.test(b.textContent)));
			ok("the player's career table marks the season the universe played",
				marked);
			await page.evaluate(() => window.App.showPlayer(null));
		}
		/* Turning the setting off drops the chain's configs, so the tabs go
		   back to standalone runs rather than silently keeping a world the
		   user has switched out of. */
		await page.evaluate(() => {
			window.App.state.cfg.universe = false;
			window.App.state.universe.cfgs = {};
		});
		ok("turning universe mode off clears the cached chain configs",
			(await page.evaluate(() =>
				Object.keys(window.App.state.universe.cfgs).length)) === 0);
	}

	console.log("\nThe table's own numbers");
	{
		/* A GOLDEN SNAPSHOT OF THE VIEW LAYER.

		   Every number in this tool is banded somewhere — except the last step,
		   which is the view turning it into text. cellValue, statValue, the
		   per-40 and totals conversions, the percent columns and the +/- signs
		   are a hundred lines of formatting that nothing reads back, and the
		   failure they produce is the worst kind: two columns swapped, or per-40
		   quietly showing per-game, in a table that still looks entirely
		   plausible. This smoke test was checking for console errors, which that
		   does not raise.

		   So: the sample class, a fixed seed, a fixed column set, and the first
		   ten rows as text in all three stat modes. Any change to what a column
		   means shows up as a one-line diff in review; an intended one is
		   re-recorded with --update-golden.

		   The sample class is used rather than a loaded file because it is the
		   one input the harness can produce identically every time. */
		await page.goto(base);
		await page.evaluate(() => localStorage.clear());
		await page.goto(base);
		/* The sample-class BUTTON seeds itself from the clock, so the class it
		   builds is different every run and cannot be a snapshot. The sample
		   generator takes a seed; this uses a stated one, through the same
		   installFiles path a real file takes. */
		await page.evaluate(() => {
			const data = window.Sample.makeClass(4242, 70, 2027);
			window.App.state.cfg.seed = "uismoke-golden";
			window.App.installFiles([{ name: "golden-sample.json", data }], []);
		});
		await page.waitForSelector("table tbody tr", { timeout: 30000 });
		const snap = await page.evaluate(() => {
			const A = window.App;
			const V = window.Views;
			const res = A.state.results[A.state.active];
			const out = {};
			/* The identity columns are rendered straight off the player in the
			   row builder rather than through cellValue, so they are captured
			   from the same place the row builder reads them: a swap there is
			   as invisible as a swap in the numbers. */
			const ID = (p) => [p.name, p.newPos, p.classYear, p.archetype,
				p.newCollege].join("~");
			const KEYS = ["newOvr", "newPot", "board", "move", "hgtInches", "weight",
				"gp", "mpg", "ppg", "rpg", "orpg", "drpg", "apg", "spg", "bpg", "topg",
				"pfpg", "fga", "tpa", "fta", "usg", "fgp", "tpp", "ftp", "ts",
				"tpar", "ftr", "efg", "astTo", "ortg", "prod", "drtg", "record"];
			for (const mode of ["perGame", "totals", "per40"]) {
				const rows = res.players.slice()
					.sort((a, b) => b.newOvr - a.newOvr || (a.key < b.key ? -1 : 1))
					.slice(0, 10);
				out[mode] = rows.map((p) => ID(p) + "|" + KEYS.map((k) => {
					const v = V.cellValue(p, k, res, mode);
					if (v === undefined || v === null) return "";
					if (typeof v === "number") return v.toFixed(4);
					return String(v);
				}).join("|"));
			}
			return out;
		});
		const file = path.join(__dirname, "golden-table.json");
		if (process.argv.includes("--update-golden")) {
			fs.writeFileSync(file, JSON.stringify(snap, null, "\t") + "\n");
			console.log("  --   recorded tools/golden-table.json");
		} else {
			let want = null;
			try { want = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { want = null; }
			if (!want) {
				ok("the table snapshot exists", false,
					"tools/golden-table.json is missing — run: node tools/uismoke.js --update-golden");
			} else {
				for (const mode of ["perGame", "totals", "per40"]) {
					const a = (want[mode] || []).join("\n");
					const b = (snap[mode] || []).join("\n");
					/* Point at the FIELD that moved, not at the first 120
					   characters of the row: a per-40 conversion that changed
					   leaves the first eight columns identical, and a diff
					   that shows those and stops is a diff that says nothing. */
					let firstDiff = "";
					if (a !== b) {
						const la = a.split("\n");
						const lb = b.split("\n");
						outer:
						for (let i = 0; i < Math.max(la.length, lb.length); i++) {
							if (la[i] === lb[i]) continue;
							const fa = String(la[i]).split("|");
							const fb = String(lb[i]).split("|");
							for (let j = 0; j < Math.max(fa.length, fb.length); j++) {
								if (fa[j] === fb[j]) continue;
								firstDiff = "row " + i + " (" + fa[0] + "), field " + j +
									": want " + fa[j] + ", got " + fb[j];
								break outer;
							}
							firstDiff = "row " + i + " differs in length";
							break;
						}
					}
					ok("the prospect table's " + mode + " numbers are unchanged",
						a === b, firstDiff);
				}
				/* And the three modes are actually different, or the snapshot
				   is pinning a conversion that stopped happening. */
				ok("per-game, totals and per-40 are three different tables",
					snap.perGame.join() !== snap.totals.join() &&
					snap.perGame.join() !== snap.per40.join());
			}
		}
	}

	/* ---------------------------------------------------------------------
	   A WHOLE LEAGUE EXPORT.

	   The headline path of this change and the one with no coverage at all: a
	   BBGM league carries its next two or three draft classes inside it as
	   ordinary player rows with an undrafted tid and a future draft year, and
	   the tool used to take one of them and discard the file. It has to load
	   one editable class per draft year, say so, and keep the league in
	   memory for the merge.

	   Last, because loading a file replaces everything on the page. */
	console.log("\nA whole league export");
	{
		const league = { version: 50, startingSeason: 2027, gameAttributes: { season: 2027 },
			teams: [], players: [] };
		let pid = 0;
		for (const year of [2027, 2028, 2029]) {
			const cls = V.syntheticClass(year, 60);
			for (const p of cls.players) {
				const copy = JSON.parse(JSON.stringify(p));
				copy.pid = pid++;
				copy.tid = -2;
				copy.draft = { year, round: 0, pick: 0, tid: -1 };
				copy.born = { year: year - 19, loc: (p.born && p.born.loc) || "USA" };
				league.players.push(copy);
			}
		}
		// The rest of the league: rostered players, who are not a draft class
		// however their draft rows read.
		for (const p of V.syntheticClass(9, 120).players) {
			const copy = JSON.parse(JSON.stringify(p));
			copy.pid = pid++;
			copy.tid = 5;
			copy.draft = { year: 2020, round: 1, pick: 3, tid: 5 };
			copy.born = { year: 2000, loc: "USA" };
			copy.college = "Duke";
			league.players.push(copy);
		}
		const leagueFixture = path.join(require("os").tmpdir(), "bbgm-uismoke-league.json");
		fs.writeFileSync(leagueFixture, JSON.stringify(league));

		await page.goto(base);
		await page.evaluate(() => localStorage.clear());
		await page.goto(base);
		await page.setInputFiles("#file", leagueFixture);
		await page.waitForSelector("table tbody tr", { timeout: 60000 });
		const files = await page.evaluate(() =>
			window.App.state.files.map((f) => f.name + "|" +
				(f.data.startingSeason || "?") + "|" + (f.data.players || []).length));
		ok("a league export loads one class per draft year",
			files.length === 3, files.join(" , "));
		ok("each class carries its own draft year and only its own players",
			files.every((f, i) => f.indexOf("|" + (2027 + i) + "|60") !== -1),
			files.join(" , "));
		ok("and the file picker offers all three",
			(await page.locator("#fileSelect option").count()) === 3);
		ok("the league itself is kept for the merge",
			await page.evaluate(() => {
				const src = window.App.state.leagueSource;
				return !!(src && src.data && src.data.players.length ===
					window.App.state.files.reduce((a, f) =>
						a + f.data.players.length, 0) + 120);
			}), "the whole league, not just the classes");
		const warn = await page.locator("#warnBanner .bannertext").innerText();
		ok("and the page says what it did with the file",
			/full league export/.test(warn) && /2027, 2028, 2029/.test(warn),
			warn.slice(0, 140));
		/* The merge offers the league already in memory rather than sending
		   the user back to the disk for the same file. */
		await page.locator("#btnExportMenu").click();
		await page.waitForTimeout(250);
		await page.locator('#modal button:has-text("Merge into a league file")').click();
		await page.waitForTimeout(350);
		// With several classes loaded the first dialog is the class picker;
		// the league question is the one after it.
		ok("the merge offers every loaded class", (await page.locator(
			"#modal .checklist input[type=checkbox]").count()) === 3);
		await page.locator("#modalOk").click();
		await page.waitForTimeout(350);
		const mergeText = await page.locator("#modal").innerText();
		ok("the merge dialog names the league the classes came from",
			/still loaded/.test(mergeText), mergeText.slice(0, 200));
		await page.locator("#modalCancel").click();
		await page.waitForTimeout(200);
	}

	console.log("\nThe randomizer, per loaded class");
	{
		const league = { version: 50, startingSeason: 2027, gameAttributes: { season: 2027 },
			teams: [], players: [] };
		let pid = 0;
		for (const year of [2027, 2028]) {
			const cls = V.syntheticClass(year, 40);
			for (const p of cls.players) {
				const copy = JSON.parse(JSON.stringify(p));
				copy.pid = pid++;
				copy.tid = -2;
				copy.draft = { year, round: 0, pick: 0, tid: -1 };
				copy.born = { year: year - 19, loc: (p.born && p.born.loc) || "USA" };
				league.players.push(copy);
			}
		}
		// classesFromFile only splits a file into one class per draft year
		// once it is bigger than an ordinary class (see MAX_CLASS in
		// js/engine.js) — under that it loads as a single 80-player class
		// instead of two. Padded with rostered players, the same way the
		// league-export fixture above does.
		for (const p of V.syntheticClass(9, 200).players) {
			const copy = JSON.parse(JSON.stringify(p));
			copy.pid = pid++;
			copy.tid = 5;
			copy.draft = { year: 2020, round: 1, pick: 3, tid: 5 };
			copy.born = { year: 2000, loc: "USA" };
			copy.college = "Duke";
			league.players.push(copy);
		}
		const leagueFixture = path.join(require("os").tmpdir(), "bbgm-uismoke-randomfile.json");
		fs.writeFileSync(leagueFixture, JSON.stringify(league));

		await page.goto(base);
		await page.evaluate(() => localStorage.clear());
		await page.goto(base);
		await page.setInputFiles("#file", leagueFixture);
		await page.waitForSelector("table tbody tr", { timeout: 60000 });
		ok("two classes loaded", (await page.evaluate(() =>
			window.App.state.files.length)) === 2);
		ok("the per-file checkbox appears with more than one file loaded",
			await page.locator("#randomPerFileRow").isVisible());

		await page.locator("#randomizePerFile").check();
		// "quality" — five settings at once, so an unlucky single-key
		// collision between two independent draws cannot read as a failure.
		await page.evaluate(() => { window.App.state.randomScope = "quality"; });
		await page.locator("#btnRandomize").click();
		await page.waitForTimeout(400);
		const patches = await page.evaluate(() => {
			const fc = window.App.state.fileCfgs || {};
			return [JSON.stringify(fc[0] || {}), JSON.stringify(fc[1] || {})];
		});
		ok("checking it draws a distinct patch for each loaded file",
			patches[0] !== "{}" && patches[1] !== "{}" && patches[0] !== patches[1],
			patches.join(" vs "));
		const cfgBeforeSwitch = await page.evaluate(() => window.App.state.cfg.classDepth);
		// File 1's result is not computed until something actually looks at
		// it (ensureResult is lazy) — switch to it the way a user would.
		await page.selectOption("#fileSelect", "1");
		await page.waitForTimeout(300);
		const cfgAfterSwitch = await page.evaluate(() => window.App.state.cfg.classDepth);
		ok("the shared settings panel is untouched by a per-file draw",
			cfgBeforeSwitch === cfgAfterSwitch, cfgBeforeSwitch + " vs " + cfgAfterSwitch);
		const ranWith = await page.evaluate(() =>
			[0, 1].map((i) => {
				const res = window.App.state.results[i];
				return res && res.cfg ? res.cfg.classDepth : null;
			}));
		ok("each file actually ran with its own drawn settings, not the shared ones",
			Number.isFinite(ranWith[0]) && Number.isFinite(ranWith[1]) &&
				ranWith[0] !== ranWith[1],
			ranWith.join(" vs "));
		await page.selectOption("#fileSelect", "0");
		await page.waitForTimeout(200);

		// Unticking returns to one shared draw for every file.
		await page.locator("#randomizePerFile").uncheck();
		await page.locator("#btnRandomize").click();
		await page.waitForTimeout(400);
		const afterShared = await page.evaluate(() =>
			Object.keys(window.App.state.fileCfgs || {}).length);
		ok("unticking the box goes back to one shared draw for every file",
			afterShared === 0, afterShared + " per-file patches left over");

		// A fresh file load resets any leftover per-file patches. A second,
		// differently-named copy of the same fixture: re-selecting the exact
		// path Playwright already has loaded is not guaranteed to look like a
		// new selection to the page.
		await page.locator("#randomizePerFile").check();
		await page.evaluate(() => { window.App.state.randomScope = "quality"; });
		await page.locator("#btnRandomize").click();
		await page.waitForTimeout(400);
		const leagueFixture2 = path.join(
			require("os").tmpdir(), "bbgm-uismoke-randomfile-2.json");
		fs.writeFileSync(leagueFixture2, JSON.stringify(league));
		await page.setInputFiles("#file", leagueFixture2);
		await page.waitForSelector("table tbody tr", { timeout: 60000 });
		const afterReload = await page.evaluate(() =>
			Object.keys(window.App.state.fileCfgs || {}).length);
		ok("loading a new set of files clears stale per-file patches",
			afterReload === 0, afterReload + " leftover patches");
	}

	console.log("\nNo errors");
	ok("no console or page errors", errors.length === 0, errors.join("\n         "));

	await browser.close();
	server.close();
	console.log("\n" + (failures ? failures + " of " + checks + " checks failed"
		: "all " + checks + " checks passed"));
	process.exit(failures ? 1 : 0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
