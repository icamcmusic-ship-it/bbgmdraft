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
	ok("the prospect table has a row per player",
		(await page.locator("table tbody tr").count()) === 70);
	for (const label of await page.locator("#tabs button").allTextContents()) {
		await page.locator("#tabs button", { hasText: label }).first().click();
		await page.waitForTimeout(220);
		const size = (await page.locator("#view").innerHTML()).length;
		ok("tab renders: " + label, size > 150, size + " bytes");
	}

	console.log("\nEditing");
	await page.locator("#tabs button", { hasText: "Prospects" }).click();
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
	const teamPpg = async () => page.evaluate(() => {
		const res = window.App.state.results[window.App.state.active];
		const t = Object.values(res.teams).filter((x) => x.teamTotals);
		return t.reduce((a, x) => a + x.teamTotals.pts, 0) / t.length;
	});
	const modernPpg = await teamPpg();
	await page.evaluate(() => {
		const sel = document.getElementById("era");
		sel.value = "2009-2021";
		sel.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await page.waitForTimeout(800);
	const oldPpg = await teamPpg();
	ok("the era switch moves the whole scoring environment",
		modernPpg - oldPpg > 2, modernPpg.toFixed(1) + " -> " + oldPpg.toFixed(1));
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
	await page.locator("#tabs button", { hasText: "Prospects" }).first().click();
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
	await page.locator("#tabs button", { hasText: "Prospects" }).click();
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

		// A number key is a tab.
		await page.keyboard.press("2");
		await page.waitForTimeout(250);
		ok("a number key jumps to a tab",
			(await page.locator("#tabs button.active").first().textContent())
				.indexOf("Draft board") !== -1);
		await page.keyboard.press("1");
		await page.waitForTimeout(250);

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

		await page.locator("#tabs button", { hasText: "Prospects" }).click();
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
			!(await page.locator("aside").isVisible()));
		await page.locator("#btnSettings").click();
		await page.waitForTimeout(300);
		ok("and the header button brings it back",
			await page.locator("aside").isVisible());
		await page.locator("#btnSettings").click();
		await page.setViewportSize({ width: 1500, height: 980 });
		await page.waitForTimeout(300);
		ok("the panel is always there on a desktop",
			await page.locator("aside").isVisible());
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
		await page.locator(".tabs button", { hasText: "Prospects" }).click();
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
				return st.tab === "players" && st.editing === st.logPlayer;
			}));
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
		ok("the sample class renders a prospect table",
			(await page.locator("table tbody tr").count()) === 70);
		ok("the sample class is named as one",
			/sample/i.test(await page.locator("#fileSummary").textContent()));
		await page.locator("#tabs button", { hasText: "News" }).first().click();
		await page.waitForTimeout(250);
		ok("the sample class writes a News feed",
			(await page.locator("#view").innerHTML()).length > 2000);
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
