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
		["Where this stat line comes from", "Share of the offence"],
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
			const i = document.getElementById("noteLines").querySelectorAll("input")[1];
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
