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
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
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
	ok("batch mode produces an aggregate",
		/mean ovr/.test(await page.locator("#view").innerText()));

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
