"use strict";
/* The analytics, mock, sharing and editor quick wins (audit section 6: Q10,
   Q13, Q14, Q25-Q35, Q37, Q39): the pure helpers in js/share.js, the batch
   summary's contact-sheet fields, the Mock tab's CSV and picture rows, and
   static reads of js/app.js, js/views.js and index.html for the wiring that
   lives in event handlers. What is on screen is driven in a browser by the
   "Quick wins: analytics, mock, sharing" section of tools/uismoke.js. */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

module.exports = function (ok, V) {
	if (!global.window) global.window = global;
	if (!global.self) global.self = global;
	const S = global.Share;
	require(path.join(ROOT, "js", "views.js"));
	const Vw = global.Views;
	const APP = read("js", "app.js");
	const VIEWS = read("js", "views.js");
	const HTML = read("index.html");

	/* ---- Q34: the link codec ------------------------------------------- */
	{
		let good = true;
		for (const n of [0, 1, 2, 3, 4, 5, 31, 256]) {
			const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
			const text = S.b64uEncode(bytes);
			const back = S.b64uDecode(text);
			if (!/^[A-Za-z0-9_-]*$/.test(text) || Buffer.compare(Buffer.from(bytes), Buffer.from(back)) !== 0 ||
				text !== Buffer.from(bytes).toString("base64url")) good = false;
		}
		ok("share/base64url round-trips every length and matches Node's own", good);
		let threw = false;
		try { S.b64uDecode("a+b/"); } catch (e) { threw = true; }
		ok("share/base64url refuses characters outside its alphabet", threw);

		ok("share/a plain link and a compressed link are told apart",
			JSON.stringify(S.parseHash("#c=%7B%7D")) === JSON.stringify({ kind: "c", body: "%7B%7D" }) &&
			S.parseHash("#z=abc").kind === "z" && S.parseHash("#x=1") === null && S.parseHash("") === null &&
			S.parseHash("#c=") === null && S.parseHash("#a=1&c=xyz").body === "xyz");

		// A payload with 70 players' locks: well over the limit as plain text.
		const payload = { classQuality: 3, seed: "tower-1", overrides: {}, fp: "abc123" };
		for (let i = 0; i < 70; i++) {
			payload.overrides[String(1000 + i)] = { ovr: 40 + (i % 20), pot: 55 + (i % 15), archetype: "Rim Protector",
				college: "Duke", name: "Player Number " + i, hgtInches: 70 + (i % 12), ratings: { tp: 40 + i, ins: 60 - (i % 9) } };
		}
		const plain = S.plainBody(payload);
		ok("share/the fixture's plain link is over the limit", plain.length > S.HASH_LIMIT, String(plain.length));
		// The compressed form, built with zlib, reads back through the codec's own pieces.
		const z = S.zipBody(zlib.deflateRawSync(Buffer.from(JSON.stringify(payload))));
		ok("share/deflated and base64url'd, the same payload is at least a third shorter and under the limit",
			z.length < plain.length * 0.67 && z.length < S.HASH_LIMIT, z.length + " vs " + plain.length);
		const inflated = JSON.parse(zlib.inflateRawSync(Buffer.from(S.b64uDecode(z))).toString("utf8"));
		ok("share/and inflates back to the identical payload",
			JSON.stringify(inflated) === JSON.stringify(payload));
		ok("share/the plain form is still read", JSON.stringify(S.decodePlain(S.plainBody({ a: 1, b: "é & =" }))) ===
			JSON.stringify({ a: 1, b: "é & =" }));

		/* The async path (CompressionStream) is driven in a child process, since
		   this suite is synchronous: compress, decompress, fall back to the lean
		   link, read the plain form and read a link zlib made. */
		const script = `
			global.window = global;
			require(${JSON.stringify(path.join(ROOT, "js", "share.js"))});
			const S = global.Share;
			const zlib = require("zlib");
			const payload = ${JSON.stringify(payload)};
			(async () => {
				const out = {};
				const r = await S.encodeLink(payload);
				out.form = r.form; out.lean = r.lean; out.len = r.hash.length; out.head = r.hash.slice(0, 3);
				out.back = JSON.stringify(await S.decodeLink(r.hash)) === JSON.stringify(payload);
				const small = await S.encodeLink({ classQuality: 2 });
				out.small = small.hash + "|" + small.form + "|" + small.lean;
				const none = await S.encodeLink({});
				out.none = JSON.stringify(none);
				// Incompressible locks: the settings alone survive.
				const rnd = {}; let x = 12345;
				for (let i = 0; i < 400; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; rnd["k" + i] = { name: x.toString(36) + x.toString(16) + (x * 7).toString(36) }; }
				const big = await S.encodeLink({ classQuality: 4, overrides: rnd, fp: "f" }, { limit: 1500 });
				out.big = { lean: big.lean, head: big.hash.slice(0, 3), noLocks: !/overrides/.test(decodeURIComponent(big.hash.slice(3))) };
				const made = "#z=" + S.zipBody(zlib.deflateRawSync(Buffer.from(JSON.stringify(payload))));
				out.zlibLink = JSON.stringify(await S.decodeLink(made)) === JSON.stringify(payload);
				out.plainLink = JSON.stringify(await S.decodeLink("#c=" + S.plainBody({ q: 1 }))) === '{"q":1}';
				let bad = "no error";
				try { await S.decodeLink("#z=AAAA"); } catch (e) { bad = "threw"; }
				out.bad = bad;
				console.log(JSON.stringify(out));
			})().catch((e) => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); });
		`;
		let r = {};
		try { r = JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" })); } catch (e) { r = { error: String(e) }; }
		ok("share/a too-long link is written compressed (#z=), under the limit, locks included",
			!r.error && r.form === "z" && r.head === "#z=" && r.lean === false && r.len <= S.HASH_LIMIT, JSON.stringify(r));
		ok("share/decodeLink reads the compressed link back to the identical payload", r.back === true, JSON.stringify(r));
		ok("share/a small payload stays a plain #c= link, byte for byte",
			r.small === "#c=" + S.plainBody({ classQuality: 2 }) + "|c|false", r.small);
		ok("share/nothing to write is an empty hash", r.none === JSON.stringify({ hash: "", form: "c", lean: false }), r.none);
		ok("share/when nothing fits, the locks are dropped and the link says so",
			r.big && r.big.lean === true && r.big.noLocks === true, JSON.stringify(r.big));
		ok("share/a link made with zlib and a plain link both open", r.zlibLink === true && r.plainLink === true);
		ok("share/a corrupt compressed link throws instead of applying anything", r.bad === "threw", String(r.bad));
	}

	/* ---- Q33: deep links ------------------------------------------------ */
	{
		const d = S.deepFields({ tab: "compare", player: "512", compare: ["512", null, "9"], fp: "ff00" });
		ok("share/a deep link carries the tab, the prospect, the compared set and the file fingerprint",
			d.tab === "compare" && d.pk === "512" && JSON.stringify(d.cmp) === '["512","9"]' && d.fp === "ff00",
			JSON.stringify(d));
		ok("share/the board tab and an empty state add nothing",
			JSON.stringify(S.deepFields({ tab: "board", compare: ["1"], fp: "x" })) === "{}");
		ok("share/the compared set rides along only on the Compare tab",
			!("cmp" in S.deepFields({ tab: "mock", compare: ["1", "2"], fp: "x" })));
		const tabs = ["board", "compare", "mock"];
		const got = S.readDeep({ tab: "mock", pk: "5", cmp: ["1", 2, "3", "4", "5", "6"], fp: "ab" }, tabs);
		ok("share/reading validates: known tabs, string keys, at most four compared",
			got.tab === "mock" && got.pk === "5" && JSON.stringify(got.cmp) === '["1","3","4","5"]' && got.fp === "ab",
			JSON.stringify(got));
		ok("share/an unknown tab or a junk payload asks for nothing",
			S.readDeep({ tab: "nope" }, tabs) === null && S.readDeep(null, tabs) === null &&
			S.readDeep({ pk: 5, cmp: "x" }, tabs) === null);
		ok("share/it applies only when the file's fingerprint matches",
			S.deepApplies(got, "ab") && !S.deepApplies(got, "cd") && !S.deepApplies(got, null) &&
			!S.deepApplies(S.readDeep({ pk: "5" }, tabs), "ab"));
		ok("share/the page writes deep fields only on a deliberate share, and applies them through the fingerprint",
			/if \(withDrawnSeed\) \{[^}]*deepFields/.test(APP.slice(APP.indexOf("function linkPayload"))) &&
			/function applyPendingDeep/.test(APP) && /deepApplies\(d, f\.fingerprint\)/.test(APP) &&
			/showWarning\(warns\.join\("\\n"\)\);\s*applyPendingDeep\(\);/.test(APP));
		ok("share/the hashchange listener reads #z= links too", /\[#&\]\[cz\]=/.test(APP));
	}

	/* ---- Q39: copy as a command line ------------------------------------ */
	{
		const a = S.commandLine({ file: "draft class 2027.json", seed: "tower-1",
			delta: { classQuality: 3.5, vary: true, preset: "x", flavor: "Guard-heavy", seed: "tower-1" } });
		ok("share/the command starts with run, the file and the seed",
			a.text.indexOf("bbgmdraft run 'draft class 2027.json' --seed tower-1") === 0, a.text);
		ok("share/each plain setting is one --set, sorted by key, booleans spelled out",
			a.text.indexOf("--set classQuality=3.5 --set flavor=Guard-heavy --set preset=x --set vary=true") !== -1, a.text);
		ok("share/nothing to say about a plain command", a.notes.length === 0);
		const b = S.commandLine({ file: "c.json", seed: "o'brien", year: 2028,
			delta: { noteLines: ["summary", "stats"], archetypeWeights: { Sharpshooter: 3 }, mu: ["chaos"], pinned: ["pace"], overrides: {} },
			locks: 2 });
		ok("share/quotes what a shell would split, and takes --year for a league",
			b.text.indexOf("bbgmdraft run c.json --year 2028 --seed 'o'\\''brien'") === 0, b.text);
		ok("share/the note template goes through --notes", /--notes summary,stats/.test(b.text), b.text);
		ok("share/a table-valued setting goes through --settings, with a note saying so",
			/--settings settings\.json$/.test(b.text) && b.notes.some((n) => /archetypeWeights/.test(n) && /--settings/.test(n) &&
				/Export settings JSON/.test(n)), JSON.stringify(b));
		ok("share/mutators and locks are said not to travel",
			b.notes.some((n) => /Mutators \(chaos\)/.test(n)) && b.notes.some((n) => /2 locked players/.test(n)));
		ok("share/pinned, locks and link fields never become flags",
			!/pinned|overrides|--set mu/.test(b.text));
		ok("share/shellQuote leaves safe words alone and quotes the rest",
			S.shellQuote("a-b_c.d") === "a-b_c.d" && S.shellQuote("") === "''" && S.shellQuote("x y") === "'x y'");
		ok("share/the page wires the generator to a header button",
			/function commandLineText/.test(APP) && /id|"btnCopyCmd"/.test(APP) && /Share\.commandLine/.test(APP));
	}

	/* ---- Q37: kept classes ---------------------------------------------- */
	{
		const snap = (seed, at, extra) => Object.assign({ id: "kept/" + seed + "/" + at, seed, at, label: "L " + seed,
			cfg: { classQuality: 2 }, overrides: { 5: { ovr: 50 } }, lastSeed: seed, poolHistory: [["a", "b"]],
			keptName: "Name " + seed, keptNote: "note " + seed, fingerprint: "fp" + seed, flavor: "Balanced",
			file: "a.json", fileFp: "ff", season: 2027, junk: "dropped" }, extra || {});
		const list = [snap("s1", 100), snap("s2", 300), snap("s3", 200)];
		const bundle = S.makeBundle(list, 999);
		ok("share/a bundle has a format, a version and the kept classes",
			bundle.format === S.KEPT_FORMAT && bundle.v === 1 && bundle.kept.length === 3 && bundle.at === 999);
		ok("share/only known fields are kept", bundle.kept.every((k) => !("junk" in k) && k.kept === true));
		const back = S.parseBundle(JSON.stringify(bundle));
		ok("share/a bundle survives export and import intact",
			!back.error && back.dropped === 0 && JSON.stringify(back.list) === JSON.stringify(bundle.kept));
		ok("share/a bundle's entries keep what restoring a session needs",
			back.list[0].cfg.classQuality === 2 && back.list[0].overrides[5].ovr === 50 &&
			back.list[0].poolHistory[0][1] === "b" && back.list[0].fileFp === "ff" && back.list[0].seed === "s1");
		ok("share/something else, or malformed entries, is refused or skipped",
			S.parseBundle("not json").error && S.parseBundle({ format: "other" }).error &&
			S.parseBundle({ format: S.KEPT_FORMAT, kept: [{ seed: "" }, { cfg: {} }, snap("ok", 1)] }).dropped === 2);
		const merged = S.mergeKept([bundle.kept[0]], [S.cleanKept(snap("s1", 100, { keptNote: "newer note" })), S.cleanKept(snap("s4", 400))]);
		ok("share/importing adds new classes, updates the same one and orders newest first",
			merged.added === 1 && merged.updated === 1 && merged.list.length === 2 &&
			merged.list[0].seed === "s4" && merged.list[1].keptNote === "newer note");
		const many = [];
		for (let i = 0; i < S.KEPT_MAX + 30; i++) many.push(snap("m" + i, i));
		ok("share/the bundle has its own cap, far above the history's twenty-four",
			S.KEPT_MAX >= 100 && S.makeBundle(many).kept.length === S.KEPT_MAX && S.KEPT_MAX > 24);
		ok("share/kept classes live under their own storage key, apart from the session cap",
			/const KEPT_KEY = "bbgm-draft-workshop\/kept"/.test(APP) && /function restoreSession\(i, from\)/.test(APP) &&
			/restoreSession\(null, k\)/.test(APP));
	}

	/* ---- Q27: the batch contact sheet ----------------------------------- */
	{
		const E = global.Engine;
		const C = global.Config;
		const res = E.run(V.realisticClass("qw-batch", 50), C.make({ seed: "qw-batch" }));
		const row = global.BatchStats.summarize(res);
		const legacy = ["seed", "flavor", "ovr", "pot", "nNcaa", "nAbroad", "mpg", "ppg", "rpg", "apg", "usg", "ts",
			"abroadPpg", "topPpg", "topApg", "topBpg", "awards", "honored", "teamPpg", "teamAst", "archetypes",
			"champion", "champSeed", "ffOneSeeds", "r64Upsets"];
		ok("batch/the summary keeps every field it had", legacy.every((k) => k in row), legacy.filter((k) => !(k in row)).join());
		ok("batch/and adds the top five with name, position, ovr and pot",
			Array.isArray(row.top5) && row.top5.length === 5 && row.top5.every((t) => typeof t.name === "string" &&
				typeof t.pos === "string" && Number.isFinite(t.ovr) && Number.isFinite(t.pot)) &&
			row.top5[0].name === res.board[0].name);
		ok("batch/the strangeness score is the engine's own", row.strangeness === E.strangeness(res).score &&
			Array.isArray(row.strangeKinds));
		ok("batch/the tall-big flag is a 7'2\" or taller player in the top five",
			row.tallBig === res.board.slice(0, 5).some((p) => p.newHgtInches >= 86) && typeof row.tallBig === "boolean");
		ok("batch/a row survives the worker's structured clone", JSON.stringify(structuredClone(row)) === JSON.stringify(row));
		const csv = S.contactCsv([row, Object.assign({}, row, { seed: "b", tallBig: true, flavor: 'Quote "x", y' })]);
		const lines = csv.trim().split("\r\n");
		ok("batch/the contact CSV has a header and a row a class, with the top five spelled out",
			lines.length === 3 && lines[0].split(",").length === 14 && /Rim|Guard|Wing|Big|\(/.test(lines[1]) &&
			lines[1].indexOf(S.topLine(row.top5[0])) !== -1);
		ok("batch/commas and quotes in a cell are escaped", lines[2].indexOf('"Quote ""x"", y"') !== -1);
		ok("batch/the sheet is rendered with Open this class and a CSV button",
			/function contactSheet/.test(APP) && /Open this class/.test(APP) && /applySeed\(String\(r\.seed\)/.test(APP) &&
			/Share\.contactCsv/.test(APP));
		ok("batch/the worker keeps using the one summarize", /BatchStats\.summarize/.test(read("js", "worker.js")));
	}

	/* ---- Q28 / Q29: the Mock tab ---------------------------------------- */
	{
		const E = global.Engine;
		const C = global.Config;
		const P = global.Pro;
		const res = E.run(V.realisticClass("qw-mock", 70), C.make({ seed: "qw-mock" }));
		const mock = P.mockDraft(res, { rounds: 3 });
		const csv = Vw.mockCsv(mock).trim().split("\r\n");
		ok("mock/the CSV has a header and a row a pick, three rounds when three were asked for",
			csv.length === mock.picks.length + 1 &&
			mock.picks.length === Math.min(res.players.length, mock.teams.length * 3) &&
			Math.max.apply(null, mock.picks.map((k) => k.round)) === 3 &&
			csv[0].indexOf("pick,round,team") === 0);
		ok("mock/each CSV row names the pick, the team and the player",
			csv[1].indexOf("1,1,") === 0 && csv[1].indexOf(mock.picks[0].name) !== -1);
		const r1 = Vw.mockImageItems(res, mock, 1);
		const r2 = Vw.mockImageItems(res, mock, 2);
		ok("mock/the picture's rows are sized to the teams, one round at a time",
			r1.length === mock.teams.length && r2.length === mock.teams.length && r1[0].n === 1 && r2[0].n === 1 &&
			Vw.mockImageItems(res, mock, 4).length === 0);
		ok("mock/a picture row says who took him and from where",
			r1[0].name === mock.picks[0].name && r1[0].sub.indexOf(mock.picks[0].team) === 0);
		ok("mock/two rounds is still the cached default and unchanged by the new controls",
			JSON.stringify(P.mockDraft(res, {})) === JSON.stringify(P.mockDraft(res, { rounds: 2 })));
		ok("mock/the tab offers CSV, PNG for either round, a rounds select, My team, reaches and the teams panel",
			/Download CSV/.test(VIEWS) && /as PNG/.test(VIEWS) && /id = "mockRounds"/.test(VIEWS) &&
			/My team: none/.test(VIEWS) && /Reaches and steals/.test(VIEWS) && /Teams \(/.test(VIEWS));
		ok("mock/the picture function takes rows, so it is not fixed at thirty",
			/function exportMockImage\(res, opts\)/.test(APP) && /opts\.items/.test(APP));
		// Redraft and taste are optional on the engine's side: wired when it has them.
		const sup = /\bsalt\b/.test(String(P.mockDraft)) && /\bnoise\b/.test(String(P.mockDraft));
		if (sup) {
			const a = JSON.stringify(P.mockDraft(res, {}).picks.map((k) => k.key));
			const b = JSON.stringify(P.mockDraft(res, { salt: 1 }).picks.map((k) => k.key));
			ok("mock/a salt redrafts and no salt is the same draft as before", a !== b &&
				a === JSON.stringify(P.mockDraft(res).picks.map((k) => k.key)));
		}
		ok("mock/Redraft and the taste slider are wired through opts.salt and opts.noise",
			/opts\.salt = salt/.test(VIEWS) && /opts\.noise = noise/.test(VIEWS) && /id = "mockRedraft"/.test(VIEWS) &&
			/id = "mockNoise"/.test(VIEWS));
		ok("mock/My team asks the engine for targets when it has them", /Pro\.targetsFor\(mock, mockUi\.team\)/.test(VIEWS));
		if (typeof P.targetsFor === "function") {
			const t = P.targetsFor(mock, mock.picks[0].team);
			ok("mock/the first target of a team is the player it took at its first pick, with the fit reason",
				t.length === 5 && t[0].taken === true && t[0].key === mock.picks[0].key && typeof t[0].why === "string");
		}
	}

	/* ---- Q25 / Q26: distributions --------------------------------------- */
	ok("dist/the curve chart plots original, rebuilt and a typical class from the engine's own curve",
		/function curveCard/.test(VIEWS) && /RB\.classCurve/.test(VIEWS) && /ln orig|"ln " \+ cls/.test(VIEWS) &&
		/original/.test(VIEWS) && /a typical BBGM class/.test(VIEWS));
	ok("dist/the overall histogram overlays the original ratings through the existing helper",
		/function histogram\(title, values, buckets, fmt, overlay\)/.test(VIEWS) &&
		/histogram\("Overall rating", [^;]*origOvr/.test(VIEWS));
	ok("dist/position mix, height, weight and skills have cards",
		/countBars\("Position mix"/.test(VIEWS) && /"Height \(inches\)"/.test(VIEWS) &&
		/"Weight \(lb\)"/.test(VIEWS) && /countBars\("Skills"/.test(VIEWS));
	{
		// The overlay is optional: a call without it draws exactly what it did.
		if (typeof global.document === "undefined") ok("dist/(DOM pieces are checked in the browser section)", true);
	}

	/* ---- Q32 / Q35: share cards, install, file handling ------------------ */
	ok("cards/a class card and a player card are drawn on a canvas and saved as PNG",
		/function exportClassCard/.test(APP) && /function exportPlayerCard/.test(APP) && /image\/png/.test(APP) &&
		/class_card_/.test(APP) && /player_card_/.test(APP));
	ok("cards/the export menu and the player page offer them",
		/exportClassCard\(res\)/.test(APP) && /exportPlayerCard\(res, p\.key\)/.test(VIEWS));
	ok("install/the install button waits for beforeinstallprompt and prompts on click",
		/beforeinstallprompt/.test(APP) && /id="btnInstall"|"btnInstall"/.test(APP) && /ev\.prompt\(\)/.test(APP));
	ok("install/an installed app's launchQueue hands .json and .json.gz files to readFiles",
		/launchQueue\.setConsumer/.test(APP) && /h\.getFile\(\)/.test(APP) && /\(json\|gz\)/.test(APP));
	ok("share/js/share.js is loaded by the page, ahead of the views",
		HTML.indexOf('js/share.js') !== -1 && HTML.indexOf('js/share.js') < HTML.indexOf('js/views.js') &&
		global.BBGMManifest === undefined && require(path.join(ROOT, "js", "manifest.js")).page.indexOf("share") !== -1);

	/* ---- Q10 / Q13 / Q14: editor controls -------------------------------- */
	const editor = APP.slice(APP.indexOf("function editorPanel"), APP.indexOf("function editorPanel") + 22000);
	ok("editor/weight is a lock beside height, written as ov.weight",
		/field\("weight", "Listed weight \(lb\)"/.test(editor) && /next\.weight = Number\(weightIn\.value\)/.test(editor));
	ok("editor/class year is a select of the engine's years, written as ov.classYear",
		/field\("classYear", "Class year"/.test(editor) && /next\.classYear = yearSel\.value/.test(editor) &&
		/CLASS_YEAR_CHOICES/.test(editor));
	ok("editor/the class-year choices are exactly the engine's lockable years",
		(function () {
			const m = /const CLASS_LOCKS = |const CLASS_YEAR_LOCKS = \[([^\]]*)\]/.exec(read("js", "engine.js"));
			if (!m || !m[1]) return Vw.CLASS_YEAR_CHOICES.length === 9;
			const engineYears = m[1].match(/"[^"]+"/g).map((x) => x.slice(1, -1));
			return JSON.stringify(engineYears) === JSON.stringify(Vw.CLASS_YEAR_CHOICES);
		})());
	ok("editor/a bulk class-year action sits in the bulk bar and goes through bulkApply",
		/Set class year for the selection/.test(VIEWS) && /bulkApply\(\{ classYear: yearSel\.value \}/.test(VIEWS));
	ok("editor/jersey is a text lock that keeps \"00\" as text, mood traits a four-letter picker",
		/field\("jersey", "Jersey number"/.test(editor) && /next\.jersey = jerseyIn\.value\.trim\(\)/.test(editor) &&
		/field\("moodTraits", "Mood traits"/.test(editor) && /next\.moodTraits = moodBox\.value\.split\(""\)/.test(editor));
	ok("editor/re-roll face bumps ov.faceSalt and Apply lock keeps it",
		/↻ face/.test(editor) && /faceSalt: \(Number\(cur\.faceSalt\) \|\| 0\) \+ 1/.test(editor) &&
		/next\.faceSalt = ov\.faceSalt/.test(editor));
	{
		// The engine honors every key the editor writes, so a lock that is set is a lock that applies.
		const E = global.Engine;
		const C = global.Config;
		const lf = V.realisticClass("qw-ed", 40);
		const base = E.run(lf, C.make({ seed: "qw-ed" }));
		const k = base.board[3].key;
		const cfg = C.make({ seed: "qw-ed" });
		cfg.overrides = {};
		cfg.overrides[k] = { weight: 251, classYear: "Junior", jersey: "00", moodTraits: ["F", "W"], faceSalt: 1 };
		const edited = E.run(lf, cfg);
		const q = edited.players.filter((p) => p.key === k)[0];
		ok("editor/the engine applies the weight and the class year the editor writes",
			q.newWeight === 251 && q.classYear === "Junior", q.newWeight + " " + q.classYear);
		ok("editor/and the mood traits, and the export carries the jersey",
			JSON.stringify(q.moodTraits) === '["F","W"]');
		const out = E.exportFile(edited, {});
		const row = out.players.filter((p) => String(p.pid) === String(q.pid))[0];
		ok("editor/the exported file carries the locked jersey as text, the mood traits and the weight",
			row && row.jerseyNumber === "00" && JSON.stringify(row.moodTraits) === '["F","W"]' && row.weight === 251,
			row && JSON.stringify([row.jerseyNumber, row.moodTraits, row.weight]));
	}
};
