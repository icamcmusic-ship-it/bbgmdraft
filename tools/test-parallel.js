#!/usr/bin/env node
/* The regression suite, spread across every core.

   tools/test.js is one process: its inline sections and then the twenty-odd
   area files in tools/tests/, in sequence, which is about twenty minutes on a
   four-core machine and is why it does not get run before every change. The
   area files are independent of each other and of the inline part, so this
   runs the inline part (`test.js --skip-areas`) and each area
   (`run-area.js <name>`) as separate processes, as many at a time as there are
   cores, longest first.

   Usage: node tools/test-parallel.js [--fast] [--jobs N] [--only a,b] [--list]
     --fast        skip the areas that take over a minute (the "full" tier runs them)
     --only a,b    run just those areas (and not the inline part unless "inline" is named)
     --jobs N      processes at once (default: the number of cores)
     --list        print the jobs and exit

   Exit code is non-zero if any job fails. The checks and their order inside a
   job are the same as in tools/test.js; only the interleaving differs. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : null;
};

/* Measured on a four-core machine, in seconds, most expensive first. Anything
   at about a minute or more is in the "full" tier only. Unlisted areas (new ones) run in
   both and are scheduled last until somebody adds them here. */
const WEIGHT = {
	anomalies: 208, inline: 167, "warm-reruns": 141, "audit-regressions": 139,
	ratings: 125, archetypes: 83, paper: 66, "archetype-audit": 57, universesynth: 40,
	audit: 42, "seed-neighborhood": 45, "staying-fresh": 45, universehist: 25,
	replaychallenge: 27, board: 26, replay: 24, replaymeta: 18, export: 18, sim: 17,
	awards: 11, notes: 12, fixes: 11,
};
/* The inline part stays in the fast tier whatever it costs: it holds the golden
   hashes, the determinism and round-trip checks, which are the ones that must
   run before every change. */
const SLOW = new Set(Object.keys(WEIGHT).filter((k) => k !== "inline" && WEIGHT[k] >= 55));

const areas = fs.readdirSync(path.join(__dirname, "tests"))
	.filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")).sort();
let jobs = ["inline"].concat(areas);
if (flag("--fast")) jobs = jobs.filter((j) => !SLOW.has(j));
if (value("--only")) {
	const want = new Set(value("--only").split(",").map((x) => x.trim()).filter(Boolean));
	jobs = jobs.filter((j) => want.has(j));
}
jobs.sort((a, b) => (WEIGHT[b] || 5) - (WEIGHT[a] || 5) || (a < b ? -1 : 1));

if (flag("--list")) {
	console.log(jobs.join("\n"));
	process.exit(0);
}
if (!jobs.length) {
	console.error("no jobs selected");
	process.exit(2);
}

const width = Math.max(1, Number(value("--jobs")) || os.cpus().length);
const started = Date.now();
const results = [];
let next = 0;
let running = 0;

function command(job) {
	return job === "inline"
		? [process.execPath, [path.join(__dirname, "test.js"), "--skip-areas"]]
		: [process.execPath, [path.join(__dirname, "run-area.js"), job]];
}

function launch() {
	while (running < width && next < jobs.length) {
		const job = jobs[next++];
		const [bin, argv] = command(job);
		const t0 = Date.now();
		let out = "";
		const child = spawn(bin, argv, { cwd: path.join(__dirname, ".."), env: process.env });
		running++;
		child.stdout.on("data", (d) => { out += d; });
		child.stderr.on("data", (d) => { out += d; });
		child.on("close", (code) => {
			running--;
			const secs = (Date.now() - t0) / 1000;
			const tally = /all (\d+) checks passed/.exec(out) ||
				/(\d+) of (\d+) checks failed/.exec(out);
			const checks = tally ? Number(tally[2] || tally[1]) : 0;
			results.push({ job, code, secs, out, checks });
			console.log((code === 0 ? "  ok   " : "  FAIL ") + job.padEnd(18) +
				String(checks).padStart(5) + " checks  " + secs.toFixed(0).padStart(4) + "s");
			if (next >= jobs.length && running === 0) finish();
			else launch();
		});
	}
}

function finish() {
	const bad = results.filter((r) => r.code !== 0);
	for (const r of bad) {
		console.log("\n===== " + r.job + " =====");
		console.log(r.out.split("\n").filter((l) => /FAIL|^\s{9}|Error|at /.test(l)).join("\n") ||
			r.out.slice(-2000));
	}
	const total = results.reduce((a, r) => a + r.checks, 0);
	console.log("\n" + (bad.length ? bad.length + " of " + results.length + " jobs failed"
		: "all " + total + " checks passed in " + results.length + " jobs") +
		" · " + ((Date.now() - started) / 1000).toFixed(0) + "s on " + width + " process" +
		(width === 1 ? "" : "es"));
	process.exit(bad.length ? 1 : 0);
}

console.log(jobs.length + " jobs, " + width + " at a time" + (flag("--fast") ? " (fast tier)" : ""));
launch();
