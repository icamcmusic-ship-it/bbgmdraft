/* College database: BBGM's college names + frequencies (the frequency doubles
   as historical program prestige), conference alignment, and the non-NCAA
   destinations used to replace blank ("None") colleges. */
(function (global) {
	"use strict";

	// Conference base strength (0-100 = average team quality in that league).
	const CONFERENCES = {
		"ACC":            { strength: 91, bids: 7, tier: "high" },
		"SEC":            { strength: 92, bids: 8, tier: "high" },
		"Big Ten":        { strength: 90, bids: 8, tier: "high" },
		"Big 12":         { strength: 91, bids: 7, tier: "high" },
		"Big East":       { strength: 87, bids: 5, tier: "high" },
		"WCC":            { strength: 74, bids: 3, tier: "mid" },
		"American":       { strength: 76, bids: 2, tier: "mid" },
		"Mountain West":  { strength: 76, bids: 3, tier: "mid" },
		"Atlantic 10":    { strength: 75, bids: 2, tier: "mid" },
		"Missouri Valley":{ strength: 69, bids: 1, tier: "mid" },
		"Conference USA": { strength: 65, bids: 1, tier: "mid" },
		"MAC":            { strength: 64, bids: 1, tier: "mid" },
		"Sun Belt":       { strength: 63, bids: 1, tier: "mid" },
		"Big West":       { strength: 63, bids: 1, tier: "mid" },
		"CAA":            { strength: 63, bids: 1, tier: "mid" },
		"WAC":            { strength: 62, bids: 1, tier: "low" },
		"Horizon":        { strength: 61, bids: 1, tier: "low" },
		"MAAC":           { strength: 58, bids: 1, tier: "low" },
		"Southern":       { strength: 59, bids: 1, tier: "low" },
		"Ivy":            { strength: 59, bids: 1, tier: "low" },
		"Ohio Valley":    { strength: 58, bids: 1, tier: "low" },
		"Big Sky":        { strength: 58, bids: 1, tier: "low" },
		"Summit":         { strength: 57, bids: 1, tier: "low" },
		"ASUN":           { strength: 57, bids: 1, tier: "low" },
		"Southland":      { strength: 55, bids: 1, tier: "low" },
		"Big South":      { strength: 55, bids: 1, tier: "low" },
		"Patriot":        { strength: 55, bids: 1, tier: "low" },
		"America East":   { strength: 54, bids: 1, tier: "low" },
		"NEC":            { strength: 50, bids: 1, tier: "low" },
		"SWAC":           { strength: 48, bids: 1, tier: "low" },
		"MEAC":           { strength: 48, bids: 1, tier: "low" },
		/* The rebuilt Pac-12. The dataset was half-migrated: the ACC and the
		   Big Ten already carried their post-realignment eighteen while the
		   conference the four schools they took came FROM did not exist, so
		   Gonzaga, Oregon State and Washington State sat in a WCC that in fact
		   lost them, and five Mountain West schools were in a league they
		   left. */
		"Pac-12":         { strength: 78, bids: 3, tier: "mid" },
		// Catch-all for colleges outside the built-in database (league files
		// drift across BBGM versions). Not a real league: no members in
		// byConference. NOTE it still receives an auto bid whenever it has
		// two or more members — selectField() awards one to every non-empty
		// conference pool, DELIBERATELY, so out-of-database schools in a
		// modded class are not silently excluded from the postseason. See
		// the comment in js/tournament.js; the two files agree on this.
		"Independent":    { strength: 62, bids: 0, tier: "mid" },
	};

	/* THE SEASON THIS TABLE IS AUTHORED TO: 2027-28.

	   It had been drifting between two of them, which is how a conference
	   table goes quietly wrong — UC Davis sat in the Big West it leaves in
	   2026, Louisiana Tech in the Conference USA it leaves in 2027, St.
	   Francis (PA) was still here after dropping to Division II at the end
	   of 2025-26, and New Haven, Division I since 2025-26, was missing. One
	   season, applied to all four: UC Davis is Mountain West, Louisiana Tech
	   is Sun Belt, New Haven is in the NEC and St. Francis (PA) is out. */
	// school -> [BBGM frequency, conference]
	const COLLEGES = {
		"Abilene Christian": [0.1, "WAC"],
		"Air Force": [1, "Mountain West"],
		"Akron": [4, "MAC"],
		"Alabama": [28, "SEC"],
		"Alabama A&M": [1, "SWAC"],
		"Alabama State": [2, "SWAC"],
		"Albany": [5, "America East"],
		"Alcorn State": [6, "SWAC"],
		"American University": [2, "Patriot"],
		"Appalachian State": [1, "Sun Belt"],
		"Arizona": [57, "Big 12"],
		"Arizona State": [29, "Big 12"],
		"Arkansas": [33, "SEC"],
		"Arkansas State": [3, "Sun Belt"],
		"Arkansas-Pine Bluff": [1, "SWAC"],
		"Army": [0.1, "Patriot"],
		"Auburn": [23, "SEC"],
		"Austin Peay": [7, "ASUN"],
		"BYU": [22, "Big 12"],
		"Ball State": [3, "MAC"],
		"Baylor": [19, "Big 12"],
		"Belmont": [1, "Missouri Valley"],
		"Bethune-Cookman": [3, "SWAC"],
		"Binghamton": [0.1, "America East"],
		"Boise State": [6, "Pac-12"],
		"Boston College": [27, "ACC"],
		"Boston University": [6, "Patriot"],
		"Bowling Green": [16, "MAC"],
		"Bradley": [21, "Missouri Valley"],
		"Brown": [2, "Ivy"],
		"Bryant University": [0.1, "America East"],
		"Bucknell": [1, "Patriot"],
		"Buffalo": [1, "MAC"],
		"Butler": [6, "Big East"],
		"Cal Poly": [1, "Big West"],
		"Cal State Bakersfield": [1, "Big West"],
		"Cal State Fullerton": [12, "Big West"],
		"Cal State Northridge": [1, "Big West"],
		"California": [37, "ACC"],
		"California Baptist": [0.1, "WAC"],
		"Campbell": [2, "CAA"],
		"Canisius": [11, "MAAC"],
		"Central Arkansas": [1, "ASUN"],
		"Central Connecticut State": [2, "NEC"],
		"Central Michigan": [8, "MAC"],
		"Charleston": [3, "CAA"],
		"Charleston Southern": [0.1, "Big South"],
		"Charlotte": [8, "American"],
		"Chattanooga": [4, "Southern"],
		"Chicago State": [0.1, "NEC"],
		"Cincinnati": [37, "Big 12"],
		"Citadel": [0.1, "Southern"],
		"Clemson": [20, "ACC"],
		"Cleveland State": [6, "Horizon"],
		"Coastal Carolina": [0.1, "Sun Belt"],
		"Colgate": [4, "Patriot"],
		"Colorado": [25, "Big 12"],
		"Colorado State": [11, "Pac-12"],
		"Columbia": [5, "Ivy"],
		"Connecticut": [37, "Big East"],
		"Coppin State": [2, "MEAC"],
		"Cornell": [3, "Ivy"],
		"Creighton": [16, "Big East"],
		"Dartmouth": [6, "Ivy"],
		"Davidson": [6, "Atlantic 10"],
		"Dayton": [22, "Atlantic 10"],
		"DePaul": [37, "Big East"],
		"Delaware": [0.1, "Conference USA"],
		"Delaware State": [1, "MEAC"],
		"Denver": [6, "Summit"],
		"Detroit Mercy": [22, "Horizon"],
		"Drake": [14, "Missouri Valley"],
		"Drexel": [3, "CAA"],
		"Duke": [86, "ACC"],
		"Duquesne": [22, "Atlantic 10"],
		"East Carolina": [3, "American"],
		"East Tennessee State": [3, "Southern"],
		"Eastern Illinois": [2, "Ohio Valley"],
		"Eastern Kentucky": [7, "ASUN"],
		"Eastern Michigan": [11, "MAC"],
		"Eastern Washington": [2, "Big Sky"],
		"Elon": [1, "CAA"],
		"Evansville": [5, "Missouri Valley"],
		"Fairfield": [2, "MAAC"],
		"Fairleigh Dickinson": [0.1, "NEC"],
		"Florida": [33, "SEC"],
		"Florida A&M": [4, "SWAC"],
		"Florida Atlantic": [0.1, "American"],
		"Florida Gulf Coast": [1, "ASUN"],
		"Florida International": [2, "Conference USA"],
		"Florida State": [38, "ACC"],
		"Fordham": [11, "Atlantic 10"],
		"Fresno State": [23, "Pac-12"],
		"Furman": [3, "Southern"],
		"Gardner-Webb": [4, "Big South"],
		"George Mason": [3, "Atlantic 10"],
		"George Washington": [13, "Atlantic 10"],
		"Georgetown": [45, "Big East"],
		"Georgia": [22, "SEC"],
		"Georgia Southern": [3, "Sun Belt"],
		"Georgia State": [2, "Sun Belt"],
		"Georgia Tech": [39, "ACC"],
		"Gonzaga": [20, "Pac-12"],
		"Grambling State": [12, "SWAC"],
		"Grand Canyon": [2, "Mountain West"],
		"Green Bay": [4, "Horizon"],
		"Hampton": [2, "CAA"],
		"Harvard": [4, "Ivy"],
		"Hawaii": [8, "Big West"],
		"High Point": [1, "Big South"],
		"Hofstra": [5, "CAA"],
		"Holy Cross": [11, "Patriot"],
		"Houston": [34, "Big 12"],
		"Houston Christian": [1, "Southland"],
		"Howard": [2, "MEAC"],
		"IU Indianapolis": [1, "Horizon"],
		"Idaho": [4, "Big Sky"],
		"Idaho State": [6, "Big Sky"],
		"Illinois": [44, "Big Ten"],
		"Illinois State": [5, "Missouri Valley"],
		"Illinois-Chicago": [2, "Missouri Valley"],
		"Incarnate Word": [0.1, "Southland"],
		"Indiana": [68, "Big Ten"],
		"Indiana State": [10, "Missouri Valley"],
		"Iona": [6, "MAAC"],
		"Iowa": [32, "Big Ten"],
		"Iowa State": [33, "Big 12"],
		"Jackson State": [14, "SWAC"],
		"Jacksonville": [11, "ASUN"],
		"Jacksonville State": [1, "Conference USA"],
		"James Madison": [2, "Sun Belt"],
		"Kansas": [76, "Big 12"],
		"Kansas City": [1, "Summit"],
		"Kansas State": [26, "Big 12"],
		"Kennesaw State": [0.1, "Conference USA"],
		"Kent State": [3, "MAC"],
		"Kentucky": [116, "SEC"],
		"LIU": [23, "NEC"],
		"LSU": [45, "SEC"],
		"La Salle": [24, "Atlantic 10"],
		"Lafayette": [0.1, "Patriot"],
		"Lamar": [5, "Southland"],
		"Lehigh": [1, "Patriot"],
		"Liberty": [3, "Conference USA"],
		"Lipscomb": [1, "ASUN"],
		"Long Beach State": [20, "Big West"],
		"Longwood": [1, "Big South"],
		"Louisiana Tech": [8, "Sun Belt"],
		"Louisiana": [10, "Sun Belt"],
		"Louisiana-Monroe": [6, "Sun Belt"],
		"Louisville": [60, "ACC"],
		"Loyola (MD)": [2, "Patriot"],
		"Loyola Chicago": [16, "Atlantic 10"],
		"Loyola Marymount": [9, "WCC"],
		"Maine": [2, "America East"],
		"Manhattan": [11, "MAAC"],
		"Marist": [1, "MAAC"],
		"Marquette": [40, "Big East"],
		"Marshall": [13, "Sun Belt"],
		"Maryland": [43, "Big Ten"],
		"Maryland-Eastern Shore": [4, "MEAC"],
		"Massachusetts": [8, "MAC"],
		"Massachusetts-Lowell": [0.1, "America East"],
		"McNeese State": [6, "Southland"],
		"Memphis": [37, "American"],
		"Mercer": [1, "Southern"],
		"Merrimack": [0.1, "MAAC"],
		"Miami (FL)": [16, "ACC"],
		"Miami (OH)": [0.1, "MAC"],
		"Michigan": [57, "Big Ten"],
		"Michigan State": [49, "Big Ten"],
		"Middle Tennessee": [2, "Conference USA"],
		"Milwaukee": [0.1, "Horizon"],
		"Minnesota": [49, "Big Ten"],
		"Mississippi State": [18, "SEC"],
		"Mississippi Valley State": [1, "SWAC"],
		"Missouri": [32, "SEC"],
		"Missouri State": [5, "Conference USA"],
		"Monmouth": [1, "CAA"],
		"Montana": [5, "Big Sky"],
		"Montana State": [1, "Big Sky"],
		"Morehead State": [6, "Ohio Valley"],
		"Morgan State": [1, "MEAC"],
		"Mount St. Mary's": [2, "MAAC"],
		"Murray State": [12, "Missouri Valley"],
		"N.J.I.T.": [0.1, "America East"],
		"Navy": [2, "Patriot"],
		"Nebraska": [13, "Big Ten"],
		"Nevada": [12, "Mountain West"],
		"New Hampshire": [0.1, "America East"],
		"New Mexico": [22, "Mountain West"],
		"New Mexico State": [16, "Conference USA"],
		"New Orleans": [8, "Southland"],
		"Niagara": [11, "MAAC"],
		"Nicholls State": [2, "Southland"],
		"Norfolk State": [5, "MEAC"],
		"North Alabama": [0.1, "ASUN"],
		"North Carolina": [97, "ACC"],
		"North Carolina A&T": [5, "CAA"],
		"North Carolina Central": [3, "MEAC"],
		"North Carolina State": [48, "ACC"],
		"North Carolina-Wilmington": [2, "CAA"],
		"North Dakota": [2, "Summit"],
		"North Dakota State": [0.1, "Summit"],
		"North Florida": [0.1, "ASUN"],
		"North Texas": [5, "American"],
		"Northeastern": [5, "CAA"],
		"Northern Arizona": [3, "Big Sky"],
		"Northern Colorado": [1, "Big Sky"],
		"Northern Illinois": [8, "MAC"],
		"Northern Iowa": [0.1, "Missouri Valley"],
		"Northern Kentucky": [0.1, "Horizon"],
		"Northwestern": [18, "Big Ten"],
		"Northwestern State": [2, "Southland"],
		"Notre Dame": [59, "ACC"],
		"Oakland": [4, "Horizon"],
		"Ohio": [10, "MAC"],
		"Ohio State": [47, "Big Ten"],
		"Oklahoma": [25, "SEC"],
		"Oklahoma State": [28, "Big 12"],
		"Old Dominion": [9, "Sun Belt"],
		"Ole Miss": [9, "SEC"],
		"Oral Roberts": [9, "Summit"],
		"Oregon": [31, "Big Ten"],
		"Oregon State": [29, "Pac-12"],
		"Pacific": [8, "WCC"],
		"Penn State": [14, "Big Ten"],
		"Pennsylvania": [11, "Ivy"],
		"Pepperdine": [19, "WCC"],
		"Pittsburgh": [22, "ACC"],
		"Portland": [8, "WCC"],
		"Portland State": [2, "Big Sky"],
		"Prairie View A&M": [2, "SWAC"],
		"Presbyterian": [0.1, "Big South"],
		"Princeton": [9, "Ivy"],
		"Providence": [30, "Big East"],
		"Purdue": [38, "Big Ten"],
		"Purdue Fort Wayne": [1, "Horizon"],
		"Quinnipiac": [0.1, "MAAC"],
		"Radford": [1, "Big South"],
		"Rhode Island": [17, "Atlantic 10"],
		"Rice": [12, "American"],
		"Richmond": [3, "Atlantic 10"],
		"Rider": [2, "MAAC"],
		"Robert Morris": [1, "Horizon"],
		"Rutgers": [13, "Big Ten"],
		"SIU-Edwardsville": [0.1, "Ohio Valley"],
		"SMU": [17, "ACC"],
		"Sacramento State": [0.1, "Big Sky"],
		"Sacred Heart": [0.1, "MAAC"],
		"Saint Joseph's (PA)": [21, "Atlantic 10"],
		"Saint Louis": [15, "Atlantic 10"],
		"Saint Mary's": [7, "WCC"],
		"Sam Houston State": [2, "Conference USA"],
		"Samford": [0.1, "Southern"],
		"San Diego": [1, "WCC"],
		"San Diego State": [12, "Pac-12"],
		"San Francisco": [25, "WCC"],
		"San Jose State": [9, "Mountain West"],
		"Santa Clara": [14, "WCC"],
		"Seattle": [11, "WCC"],
		"Seton Hall": [28, "Big East"],
		"Siena": [1, "MAAC"],
		"South Alabama": [5, "Sun Belt"],
		"South Carolina": [26, "SEC"],
		"South Carolina State": [3, "MEAC"],
		"South Dakota": [1, "Summit"],
		"South Dakota State": [3, "Summit"],
		"South Florida": [6, "American"],
		"Southeast Missouri State": [2, "Ohio Valley"],
		"Southeastern Louisiana": [0.1, "Southland"],
		"Southern Illinois": [10, "Missouri Valley"],
		"Southern Miss": [5, "Sun Belt"],
		"Southern University": [6, "SWAC"],
		"Southern Utah": [0.1, "WAC"],
		"St. Bonaventure": [17, "Atlantic 10"],
		"St. John's": [54, "Big East"],
		"St. Peter's": [4, "MAAC"],
		"Stanford": [32, "ACC"],
		"Stephen F. Austin": [2, "Southland"],
		"Stetson": [2, "ASUN"],
		"Stony Brook": [1, "CAA"],
		"Syracuse": [53, "ACC"],
		"TCU": [10, "Big 12"],
		"Temple": [35, "American"],
		"Tennessee": [39, "SEC"],
		"Tennessee State": [19, "Ohio Valley"],
		"Tennessee Tech": [4, "Ohio Valley"],
		"Tennessee-Martin": [1, "Ohio Valley"],
		"Texas": [34, "SEC"],
		"Texas A&M": [17, "SEC"],
		"Texas A&M-CC": [0.1, "Southland"],
		"Texas Southern": [5, "SWAC"],
		"Texas State": [2, "Pac-12"],
		"Texas Tech": [14, "Big 12"],
		"Texas-Arlington": [1, "WAC"],
		"Toledo": [11, "MAC"],
		"Towson": [3, "CAA"],
		"Troy": [0.1, "Sun Belt"],
		"Tulane": [14, "American"],
		"Tulsa": [18, "American"],
		"UAB": [10, "American"],
		"UC Davis": [0.1, "Mountain West"],
		"UC Irvine": [8, "Big West"],
		"UC Riverside": [1, "Big West"],
		"UC San Diego": [0.3, "Big West"],
		"UC Santa Barbara": [9, "Big West"],
		"UCF": [8, "Big 12"],
		"UCLA": [99, "Big Ten"],
		"UMBC": [0.1, "America East"],
		"UNC Asheville": [0.1, "Big South"],
		"UNC Greensboro": [0.1, "Southern"],
		"UNLV": [41, "Mountain West"],
		"USC": [44, "Big Ten"],
		"USC Upstate": [2, "Big South"],
		"UTEP": [17, "Mountain West"],
		"UTSA": [2, "American"],
		"Utah": [31, "Big 12"],
		"Utah State": [9, "Pac-12"],
		"Utah Valley": [3, "WAC"],
		"VCU": [10, "Atlantic 10"],
		"Valparaiso": [7, "Missouri Valley"],
		"Vanderbilt": [27, "SEC"],
		"Vermont": [0.1, "America East"],
		"Villanova": [49, "Big East"],
		"Virginia": [31, "ACC"],
		"Virginia Military": [2, "Southern"],
		"Virginia Tech": [16, "ACC"],
		/* Programs that reclassified to Division I and were missing, which is
		   why the table held 353 against a real ~364. Every one of them is a
		   real destination for a fringe prospect and a real conference member
		   whose league was a man short without it. Draft frequency 0.1: none of
		   them has produced an NBA pick, which is the honest number and is what
		   prestige() reads. */
		"Le Moyne": [0.1, "NEC"],
		"New Haven": [0.1, "NEC"],
		"Stonehill": [0.1, "NEC"],
		"Mercyhurst": [0.1, "NEC"],
		"Queens": [0.1, "ASUN"],
		"Bellarmine": [0.1, "ASUN"],
		"West Georgia": [0.1, "ASUN"],
		"Lindenwood": [0.1, "Ohio Valley"],
		"Southern Indiana": [0.1, "Ohio Valley"],
		"East Texas A&M": [0.1, "Southland"],
		"Tarleton State": [0.2, "WAC"],
		"UT Rio Grande Valley": [0.3, "Southland"],
		"Utah Tech": [0.1, "WAC"],
		"Little Rock": [7, "Ohio Valley"],
		"Omaha": [0.3, "Summit"],
		"St. Thomas": [0.2, "Summit"],
		"Wagner": [0.1, "NEC"],
		"Wake Forest": [31, "ACC"],
		"Washington": [39, "Big Ten"],
		"Washington State": [17, "Pac-12"],
		"Weber State": [10, "Big Sky"],
		"West Virginia": [16, "Big 12"],
		"Western Carolina": [7, "Southern"],
		"Western Illinois": [1, "Ohio Valley"],
		"Western Kentucky": [33, "Conference USA"],
		"Western Michigan": [7, "MAC"],
		"Wichita State": [19, "American"],
		"William & Mary": [2, "CAA"],
		"Winthrop": [0.1, "Big South"],
		"Wisconsin": [27, "Big Ten"],
		"Wofford": [1, "Southern"],
		"Wright State": [2, "Horizon"],
		"Wyoming": [25, "Mountain West"],
		"Xavier": [20, "Big East"],
		"Yale": [4, "Ivy"],
		"Youngstown State": [0.1, "Horizon"],
	};

	/* Destinations for players whose college is blank ("None" in game).

	   `strength` is the level of competition on the same 0-100 team scale.
	   `w` is the default weight in the blank-college draw, and `regions` scales
	   it by where the player was born — a Serbian leans EuroLeague and the ABA,
	   an Australian leans NBL and NBL1, a Chinese prospect leans CBA.

	   Before this there were exactly three destinations plus a rare DII roll,
	   which meant every blank-college prospect in the world went to one of
	   EuroLeague, the G League or the NBL. Liga ACB, the BBL, the Adriatic
	   League, LNB Pro A, the EuroCup, the CBA, NBL1, Overtime Elite and the NBA
	   Academies are all real destinations for exactly this population. */
	const NON_NCAA = {
		"EuroLeague":     { strength: 88, pro: true, w: 26, tier: 1,
			regions: { usa: 0.35, canada: 0.6, europe: 2.4, oceania: 0.5, asia: 0.4, latam: 0.6, africa: 0.7, other: 1.0 } },
		"NBA G League":   { strength: 84, pro: true, w: 30, tier: 1,
			regions: { usa: 1.7, canada: 1.9, europe: 0.5, oceania: 0.6, asia: 0.5, latam: 0.9, africa: 0.8, other: 1.0 } },
		"Liga ACB":       { strength: 80, pro: true, w: 10, tier: 2, domestic: "Spain", relegation: 2,
			regions: { usa: 0.2, canada: 0.3, europe: 1.5, oceania: 0.2, asia: 0.2, latam: 1.4, africa: 0.9, other: 0.7 } },
		"NBL":            { strength: 80, pro: true, w: 12, tier: 1,
			regions: { usa: 0.3, canada: 0.3, europe: 0.2, oceania: 2.6, asia: 0.6, latam: 0.2, africa: 0.3, other: 0.7 } },
		"Chinese CBA":    { strength: 78, pro: true, w: 6, tier: 2, domestic: "China",
			regions: { usa: 0.2, canada: 0.2, europe: 0.15, oceania: 0.3, asia: 2.8, latam: 0.2, africa: 0.4, other: 0.4 } },
		"LNB Pro A":      { strength: 76, pro: true, w: 9, tier: 2, domestic: "France", relegation: 2,
			regions: { usa: 0.25, canada: 0.3, europe: 1.3, oceania: 0.2, asia: 0.2, latam: 0.4, africa: 1.5, other: 0.7 } },
		"EuroCup":        { strength: 76, pro: true, w: 9, tier: 2,
			regions: { usa: 0.3, canada: 0.3, europe: 1.6, oceania: 0.3, asia: 0.3, latam: 0.5, africa: 0.6, other: 0.8 } },
		"Basketball Bundesliga": { strength: 74, pro: true, w: 8, tier: 2, domestic: "Germany", relegation: 2,
			regions: { usa: 0.3, canada: 0.3, europe: 1.3, oceania: 0.2, asia: 0.2, latam: 0.3, africa: 0.6, other: 0.7 } },
		"Adriatic League": { strength: 74, pro: true, w: 8, tier: 2,
			regions: { usa: 0.1, canada: 0.1, europe: 1.5, oceania: 0.1, asia: 0.1, latam: 0.2, africa: 0.3, other: 0.5 } },
		"NBL1":           { strength: 58, pro: true, w: 4, tier: 3, domestic: "Australia",
			regions: { usa: 0.2, canada: 0.2, europe: 0.1, oceania: 2.2, asia: 0.3, latam: 0.1, africa: 0.2, other: 0.4 } },
		"Overtime Elite": { strength: 46, pro: true, w: 5, tier: 3, youth: true,
			regions: { usa: 1.6, canada: 1.4, europe: 0.4, oceania: 0.5, asia: 0.4, latam: 0.6, africa: 0.9, other: 0.8 } },
		"NBA Academy":    { strength: 40, pro: false, w: 4, tier: 3, youth: true,
			regions: { usa: 0.2, canada: 0.3, europe: 0.4, oceania: 1.1, asia: 1.6, latam: 1.6, africa: 2.0, other: 1.2 } },
		"DII NCAA":       { strength: 38, pro: false, w: 0, tier: 3,
			regions: { usa: 1, canada: 0.7, europe: 0.2, oceania: 0.2, asia: 0.2, latam: 0.3, africa: 0.3, other: 0.3 } },
		/* Pathways that a modern draft class actually contains and that the
		   table did not. The three EuroLeague feeders (Turkey, Greece, Israel)
		   were modeled only through the EuroLeague itself, so a nineteen-year
		   old at a Turkish club could only be simulated as if he were playing
		   the strongest league in Europe. The BAL matters because NBA Academy
		   already weights Africa at 2.0 and had nowhere to send those players
		   next; Canada now has a domestic league of its own to match the
		   region it just got. */
		"Basketball Champions League": { strength: 72, pro: true, w: 7, tier: 2,
			regions: { usa: 0.35, canada: 0.3, europe: 1.5, oceania: 0.2, asia: 0.3, latam: 0.5, africa: 0.9, other: 0.8 } },
		"Turkish BSL":    { strength: 73, pro: true, w: 6, tier: 2, domestic: "Turkey", relegation: 2,
			regions: { usa: 0.25, canada: 0.2, europe: 1.4, oceania: 0.1, asia: 0.6, latam: 0.2, africa: 0.5, other: 0.6 } },
		"Greek Basket League": { strength: 72, pro: true, w: 5, tier: 2, domestic: "Greece", relegation: 2,
			regions: { usa: 0.25, canada: 0.2, europe: 1.4, oceania: 0.1, asia: 0.2, latam: 0.3, africa: 0.5, other: 0.6 } },
		"Israeli Premier League": { strength: 70, pro: true, w: 5, tier: 2, domestic: "Israel", relegation: 2,
			regions: { usa: 0.4, canada: 0.3, europe: 1.2, oceania: 0.1, asia: 0.4, latam: 0.2, africa: 0.3, other: 0.6 } },
		"Japan B.League": { strength: 66, pro: true, w: 4, tier: 3, domestic: "Japan", relegation: 2,
			regions: { usa: 0.2, canada: 0.15, europe: 0.1, oceania: 0.5, asia: 2.6, latam: 0.15, africa: 0.3, other: 0.4 } },
		"Brazil NBB":     { strength: 64, pro: true, w: 4, tier: 3, domestic: "Brazil",
			regions: { usa: 0.1, canada: 0.1, europe: 0.1, oceania: 0.1, asia: 0.1, latam: 2.8, africa: 0.2, other: 0.4 } },
		"Basketball Africa League": { strength: 60, pro: true, w: 4, tier: 3,
			regions: { usa: 0.15, canada: 0.1, europe: 0.1, oceania: 0.1, asia: 0.1, latam: 0.1, africa: 3.0, other: 0.4 } },
		"CEBL":           { strength: 58, pro: true, w: 3, tier: 3, domestic: "Canada",
			regions: { usa: 0.4, canada: 2.6, europe: 0.1, oceania: 0.1, asia: 0.1, latam: 0.2, africa: 0.3, other: 0.3 } },
		/* Not every prospect plays a league season. A postgrad year at
		   Montverde or IMG and a genuine "did not play" (a redshirt, a visa, a
		   torn ACL in October) are both real draft-class outcomes and neither
		   was expressible: the tool could only put a man in a league. */
		"Prep / Postgrad": { strength: 34, pro: false, w: 4, tier: 3, youth: true,
			regions: { usa: 1.5, canada: 0.9, europe: 0.4, oceania: 0.4, asia: 0.5, latam: 0.7, africa: 1.0, other: 0.8 } },
		"NAIA":           { strength: 36, pro: false, w: 2, tier: 3,
			regions: { usa: 1.0, canada: 0.8, europe: 0.2, oceania: 0.2, asia: 0.2, latam: 0.3, africa: 0.4, other: 0.3 } },
		"Did not play":   { strength: 30, pro: false, w: 2, tier: 3, idle: true,
			regions: { usa: 1.0, canada: 1.0, europe: 1.0, oceania: 1.0, asia: 1.0, latam: 1.0, africa: 1.0, other: 1.0 } },
		/* Thirteen more, because the map still had holes a real class fills
		   every year: Italy and Lithuania are two of the four or five
		   European leagues that actually produce first-round picks, Korea,
		   the Philippines and Argentina each have a domestic league a
		   prospect born there plays in before anyone abroad sees him, and
		   the American amateur ladder below Division I is JUCO and DIII, not
		   only the NAIA. */
		"Italian LBA":    { strength: 75, pro: true, w: 6, tier: 2, domestic: "Italy", relegation: 2,
			regions: { usa: 0.3, canada: 0.2, europe: 1.4, oceania: 0.2, asia: 0.2, latam: 0.6, africa: 0.5, other: 0.6 } },
		"Lithuanian LKL": { strength: 68, pro: true, w: 4, tier: 2, domestic: "Lithuania", relegation: 1,
			regions: { usa: 0.25, canada: 0.15, europe: 1.3, oceania: 0.1, asia: 0.1, latam: 0.2, africa: 0.3, other: 0.5 } },
		"VTB United League": { strength: 72, pro: true, w: 4, tier: 2,
			regions: { usa: 0.2, canada: 0.1, europe: 1.2, oceania: 0.1, asia: 0.5, latam: 0.2, africa: 0.3, other: 0.6 } },
		"Polish PLK":     { strength: 62, pro: true, w: 3, tier: 3, domestic: "Poland", relegation: 1,
			regions: { usa: 0.3, canada: 0.15, europe: 1.1, oceania: 0.1, asia: 0.1, latam: 0.2, africa: 0.3, other: 0.4 } },
		"BNXT League":    { strength: 60, pro: true, w: 3, tier: 3, domestic: "Belgium and the Netherlands", relegation: 1,
			regions: { usa: 0.3, canada: 0.2, europe: 1.1, oceania: 0.1, asia: 0.1, latam: 0.2, africa: 0.5, other: 0.4 } },
		"Korean KBL":     { strength: 62, pro: true, w: 3, tier: 3, domestic: "South Korea",
			regions: { usa: 0.15, canada: 0.1, europe: 0.1, oceania: 0.2, asia: 2.4, latam: 0.1, africa: 0.2, other: 0.3 } },
		"Philippine PBA": { strength: 56, pro: true, w: 2, tier: 3, domestic: "the Philippines",
			regions: { usa: 0.2, canada: 0.1, europe: 0.05, oceania: 0.3, asia: 1.8, latam: 0.1, africa: 0.1, other: 0.3 } },
		"Argentine Liga Nacional": { strength: 60, pro: true, w: 3, tier: 3, domestic: "Argentina", relegation: 1,
			regions: { usa: 0.1, canada: 0.05, europe: 0.15, oceania: 0.05, asia: 0.05, latam: 2.6, africa: 0.1, other: 0.3 } },
		"Mexican LNBP":   { strength: 54, pro: true, w: 2, tier: 3, domestic: "Mexico",
			regions: { usa: 0.4, canada: 0.1, europe: 0.1, oceania: 0.05, asia: 0.05, latam: 1.8, africa: 0.1, other: 0.3 } },
		"Puerto Rico BSN": { strength: 56, pro: true, w: 2, tier: 3, domestic: "Puerto Rico",
			regions: { usa: 0.5, canada: 0.1, europe: 0.1, oceania: 0.05, asia: 0.05, latam: 1.6, africa: 0.1, other: 0.3 } },
		"New Zealand NBL": { strength: 54, pro: true, w: 2, tier: 3, domestic: "New Zealand",
			regions: { usa: 0.25, canada: 0.1, europe: 0.1, oceania: 2.0, asia: 0.2, latam: 0.05, africa: 0.1, other: 0.3 } },
		"JUCO":           { strength: 33, pro: false, w: 3, tier: 3,
			regions: { usa: 1.4, canada: 0.6, europe: 0.2, oceania: 0.2, asia: 0.2, latam: 0.4, africa: 0.4, other: 0.3 } },
		"DIII NCAA":      { strength: 28, pro: false, w: 1, tier: 3,
			regions: { usa: 1.0, canada: 0.4, europe: 0.1, oceania: 0.1, asia: 0.1, latam: 0.2, africa: 0.2, other: 0.2 } },
	};

	/* Real clubs for the non-NCAA destinations, so a prospect abroad gets a
	   team, a league table and a finish instead of a one-line note reading
	   "EuroLeague". `s` is a strength offset against the league's own level —
	   Real Madrid is not a relegation side. */
	const PRO_CLUBS = {
		"EuroLeague": [
			["Real Madrid", 9], ["FC Barcelona", 8], ["Panathinaikos", 7],
			["Olympiacos", 7], ["Fenerbahce", 6], ["Anadolu Efes", 5],
			["Maccabi Tel Aviv", 5], ["Zalgiris Kaunas", 3], ["Virtus Bologna", 3],
			["Olimpia Milano", 2], ["AS Monaco", 4], ["Baskonia", 1],
			["Partizan Belgrade", 2], ["Crvena Zvezda", 1], ["LDLC ASVEL", -2],
			["Hapoel Tel Aviv", -3], ["Paris Basketball", -2], ["Bayern Munich", 0],
			["Valencia Basket", 0], ["Dubai BC", -4],
		],
		"NBA G League": [
			["Austin Spurs", 3], ["Rio Grande Valley Vipers", 3],
			["Santa Cruz Warriors", 2], ["Oklahoma City Blue", 2],
			["Raptors 905", 1], ["Long Island Nets", 1], ["Delaware Blue Coats", 1],
			["Sioux Falls Skyforce", 0], ["Wisconsin Herd", 0], ["Stockton Kings", 0],
			["Salt Lake City Stars", -1], ["Grand Rapids Gold", -1],
			["Maine Celtics", -1], ["Memphis Hustle", -2], ["Iowa Wolves", -2],
			["Westchester Knicks", -2], ["Cleveland Charge", -3],
			["Birmingham Squadron", -3], ["College Park Skyhawks", -3],
			["Capital City Go-Go", -4],
		],
		"Basketball Champions League": [
			["Unicaja Malaga", 6], ["La Laguna Tenerife", 5], ["Hapoel Jerusalem", 4],
			["Telekom Baskets Bonn", 2], ["Galatasaray", 2], ["Pinar Karsiyaka", 1],
			["Tofas Bursa", 0], ["Rytas Vilnius", 0], ["Nymburk", -2],
			["Peristeri", -2], ["Cholet Basket", -3], ["Falco Szombathely", -4],
		],
		"Turkish BSL": [
			["Fenerbahce", 8], ["Anadolu Efes", 7], ["Galatasaray", 3],
			["Bahcesehir Koleji", 2], ["Pinar Karsiyaka", 1], ["Besiktas", 0],
			["Turk Telekom", 0], ["Merkezefendi", -2], ["Bursaspor", -3],
			["Manisa BBSK", -4],
		],
		"Greek Basket League": [
			["Panathinaikos", 9], ["Olympiacos", 9], ["AEK Athens", 3],
			["Peristeri", 1], ["PAOK", 0], ["Aris Midea", 0], ["Promitheas", -2],
			["Kolossos Rodou", -3], ["Lavrio", -4], ["Panionios", -5],
		],
		"Israeli Premier League": [
			["Maccabi Tel Aviv", 9], ["Hapoel Tel Aviv", 4], ["Hapoel Jerusalem", 4],
			["Hapoel Holon", 2], ["Maccabi Rishon LeZion", 0], ["Bnei Herzliya", -1],
			["Hapoel Galil Elyon", -3], ["Ironi Ness Ziona", -3], ["Elitzur Netanya", -5],
		],
        "Japan B.League": [
			["Chiba Jets", 6], ["Ryukyu Golden Kings", 5], ["Alvark Tokyo", 4],
			["Utsunomiya Brex", 3], ["Hiroshima Dragonflies", 2], ["Nagoya Diamond Dolphins", 1],
			["Shimane Susanoo Magic", -1], ["Kawasaki Brave Thunders", 0],
			["SeaHorses Mikawa", -2], ["Osaka Evessa", -4],
		],
		"Brazil NBB": [
			["Flamengo", 7], ["Franca", 6], ["Minas", 4], ["Sao Paulo", 3],
			["Pinheiros", 1], ["Bauru", 0], ["Paulistano", 0], ["Corinthians", -2],
			["Brasilia", -3], ["Unifacisa", -4],
		],
		"Basketball Africa League": [
			["Al Ahly", 6], ["Petro de Luanda", 5], ["US Monastir", 4],
			["Zamalek", 3], ["AS Sale", 1], ["Rivers Hoopers", 0],
			["APR", -1], ["FUS Rabat", -2], ["Al Ahli Tripoli", -1],
			["Stade Malien", -2], ["City Oilers", -3], ["Kriol Star", -5],
		],
		"CEBL": [
			["Scarborough Shooting Stars", 4], ["Niagara River Lions", 3],
			["Vancouver Bandits", 2], ["Winnipeg Sea Bears", 1],
			["Calgary Surge", 0], ["Brampton Honey Badgers", -1],
			["Edmonton Stingers", 0], ["Montreal Alliance", -3],
			["Ottawa BlackJacks", -3], ["Saskatchewan Rattlers", -4],
		],
		"Prep / Postgrad": [
			["Montverde Academy", 6], ["IMG Academy", 5], ["Sunrise Christian", 3],
			["Link Academy", 3], ["Oak Hill Academy", 2], ["Prolific Prep", 2],
			["La Lumiere", 0], ["Wasatch Academy", 0], ["Long Island Lutheran", -1],
			["Brewster Academy", -1],
		],
		"Italian LBA": [
			["Virtus Bologna", 8], ["Olimpia Milano", 8], ["Germani Brescia", 4],
			["Reyer Venezia", 3], ["Dolomiti Energia Trento", 2], ["Derthona Tortona", 2],
			["Dinamo Sassari", 1], ["Pallacanestro Trieste", 0], ["Reggio Emilia", 0],
			["Napoli Basket", -1], ["Vanoli Cremona", -2], ["Udine", -2],
			["Cantu", -3], ["Trapani Shark", -1], ["Varese", -2], ["Treviso", -3],
		],
		"Lithuanian LKL": [
			["Zalgiris Kaunas", 9], ["Rytas Vilnius", 6], ["Lietkabelis Panevezys", 2],
			["Neptunas Klaipeda", 1], ["Juventus Utena", 0], ["Wolves Twinsbet", 1],
			["Siauliai", -1], ["Nevezis Kedainiai", -3], ["Jonava", -3], ["Pieno Zvaigzdes", -4],
		],
		"VTB United League": [
			["CSKA Moscow", 8], ["Zenit St. Petersburg", 6], ["UNICS Kazan", 5],
			["Lokomotiv Kuban", 4], ["Avtodor Saratov", 0], ["Parma Perm", 0],
			["Nizhny Novgorod", -1], ["Enisey Krasnoyarsk", -2], ["Uralmash Yekaterinburg", -1],
			["Astana", -3], ["Samara", -2], ["MBA Moscow", -3],
		],
		"Polish PLK": [
			["Anwil Wloclawek", 5], ["Legia Warszawa", 4], ["Slask Wroclaw", 4],
			["Trefl Sopot", 2], ["Start Lublin", 1], ["Stal Ostrow", 2],
			["Arka Gdynia", 0], ["Spojnia Stargard", -1], ["GTK Gliwice", -2],
			["Krol Krosno", -3], ["Czarni Slupsk", -1], ["Zastal Zielona Gora", 0],
		],
		"BNXT League": [
			["Filou Oostende", 6], ["Antwerp Giants", 3], ["Limburg United", 2],
			["Spirou Charleroi", 1], ["Leuven Bears", 0], ["Mons-Hainaut", -1],
			["ZZ Leiden", 4], ["Heroes Den Bosch", 3], ["Donar Groningen", 1],
			["Landstede Hammers", 0], ["Yoast United", -3], ["Feyenoord Basketball", -4],
		],
		"Korean KBL": [
			["Seoul SK Knights", 5], ["Busan KCC Egis", 4], ["Wonju DB Promy", 3],
			["Changwon LG Sakers", 3], ["Suwon KT Sonicboom", 1], ["Anyang Jung Kwan Jang", 2],
			["Ulsan Hyundai Mobis", 1], ["Goyang Sono Skygunners", -2],
			["Daegu KOGAS Pegasus", -2], ["Seoul Samsung Thunders", -4],
		],
		"Philippine PBA": [
			["San Miguel Beermen", 6], ["Barangay Ginebra", 5], ["TNT Tropang Giga", 5],
			["Magnolia Hotshots", 2], ["Meralco Bolts", 2], ["Rain or Shine", 0],
			["NLEX Road Warriors", -1], ["Phoenix Fuel Masters", -2],
			["Converge FiberXers", -2], ["NorthPort Batang Pier", -3],
			["Terrafirma Dyip", -5], ["Blackwater Bossing", -4],
		],
		"Argentine Liga Nacional": [
			["Quimsa", 5], ["Boca Juniors", 4], ["Instituto de Cordoba", 4],
			["San Lorenzo", 2], ["Obras Sanitarias", 2], ["Gimnasia Comodoro", 1],
			["Regatas Corrientes", 0], ["Olimpico La Banda", 0], ["Penarol Mar del Plata", -1],
			["Ferro Carril Oeste", -2], ["Atenas Cordoba", -2], ["Union Santa Fe", -3],
			["Platense", -3], ["Zarate Basket", -4],
		],
		"Mexican LNBP": [
			["Fuerza Regia de Monterrey", 6], ["Halcones de Xalapa", 5], ["Astros de Jalisco", 4],
			["Abejas de Leon", 2], ["Soles de Mexicali", 1], ["Diablos Rojos", 3],
			["Libertadores de Queretaro", 0], ["Plateros de Fresnillo", -2],
			["Dorados de Chihuahua", -1], ["Mineros de Zacatecas", -2], ["Panteras de Aguascalientes", -4],
		],
		"Puerto Rico BSN": [
			["Cangrejeros de Santurce", 5], ["Vaqueros de Bayamon", 5], ["Capitanes de Arecibo", 4],
			["Leones de Ponce", 3], ["Atleticos de San German", 1], ["Piratas de Quebradillas", 0],
			["Criollos de Caguas", 0], ["Gigantes de Carolina", -1], ["Mets de Guaynabo", -2],
			["Osos de Manati", -3], ["Indios de Mayaguez", -3], ["Santeros de Aguada", -4],
		],
		"New Zealand NBL": [
			["Canterbury Rams", 4], ["Wellington Saints", 4], ["Auckland Tuatara", 3],
			["Otago Nuggets", 2], ["Hawke's Bay Hawks", 1], ["Nelson Giants", 0],
			["Taranaki Airs", -1], ["Tauranga Whai", -1], ["Franklin Bulls", -2],
			["Manawatu Jets", -3],
		],
		"JUCO": [
			["Chipola College", 5], ["John A. Logan", 4], ["Indian Hills CC", 4],
			["South Plains College", 3], ["Salt Lake CC", 3], ["Northwest Florida State", 2],
			["Trinity Valley CC", 2], ["Odessa College", 1], ["Hutchinson CC", 1],
			["Vincennes", 0], ["Casper College", -1], ["Cowley College", -1],
			["Eastern Florida State", -2], ["Moberly Area CC", -2], ["Tallahassee State College", -3],
			["Northeastern JC", -4],
		],
		"DIII NCAA": [
			["Christopher Newport", 5], ["Trinity (CT)", 4], ["Wisconsin-Platteville", 4],
			["Mount Union", 3], ["Williams", 3], ["Randolph-Macon", 2],
			["Swarthmore", 2], ["Johns Hopkins", 1], ["Nichols", 0], ["Illinois Wesleyan", 0],
			["Oswego State", -1], ["Whitman", -2], ["Elmhurst", -3], ["Rowan", -3],
		],
		"NAIA": [
			["Indiana Wesleyan", 4], ["Talladega", 3], ["Georgetown (KY)", 2],
			["Arizona Christian", 1], ["Freed-Hardeman", 0], ["Cumberlands", 0],
			["Ottawa (AZ)", -2], ["Bethel (IN)", -2], ["Grace (IN)", -3],
			["Xavier (LA)", -4],
		],
		"Liga ACB": [
			["Real Madrid", 8], ["FC Barcelona", 7], ["Unicaja Malaga", 5],
			["Valencia Basket", 5], ["Baskonia", 4], ["Dreamland Gran Canaria", 2],
			["Joventut Badalona", 2], ["La Laguna Tenerife", 3],
			["UCAM Murcia", 0], ["Casademont Zaragoza", 0], ["Bilbao Basket", -1],
			["BAXI Manresa", -1], ["Basquet Girona", -2], ["MoraBanc Andorra", -3],
			/* Rio Breogan and Leyma Coruna were relegated; these three are
			   the sides actually in the ACB. */
			["Hiopos Lleida", -3], ["Coviran Granada", -3], ["San Pablo Burgos", -4],
		],
		"NBL": [
			["Melbourne United", 4], ["Sydney Kings", 4], ["Perth Wildcats", 3],
			["New Zealand Breakers", 2], ["Illawarra Hawks", 1],
			["Tasmania JackJumpers", 1], ["Brisbane Bullets", -1],
			["Adelaide 36ers", -1], ["South East Melbourne Phoenix", -2],
			["Cairns Taipans", -3],
		],
		"Chinese CBA": [
			["Liaoning Flying Leopards", 6], ["Zhejiang Golden Bulls", 5],
			["Guangdong Southern Tigers", 5], ["Xinjiang Flying Tigers", 3],
			["Shenzhen Aviators", 2], ["Beijing Ducks", 1], ["Zhejiang Lions", 1],
			["Shanghai Sharks", 0], ["Shandong Heroes", 0], ["Shanxi Loongs", -1],
			["Jiangsu Dragons", -2], ["Qingdao Eagles", -2],
			["Nanjing Monkey Kings", -3], ["Sichuan Blue Whales", -3],
			["Fujian Sturgeons", -4], ["Tianjin Pioneers", -5],
		],
		"LNB Pro A": [
			["AS Monaco", 7], ["LDLC ASVEL", 5], ["Paris Basketball", 5],
			["Cholet Basket", 1], ["Nanterre 92", 1], ["Le Mans Sarthe", 1],
			["SIG Strasbourg", 0], ["JDA Dijon", 0], ["Limoges CSP", -1],
			["JL Bourg", 2], ["BCM Gravelines-Dunkerque", -2],
			["Saint-Quentin", -2], ["ESSM Le Portel", -3], ["SLUC Nancy", -3],
			["Elan Chalon", -3],
		],
		"EuroCup": [
			["Dreamland Gran Canaria", 4], ["Turk Telekom", 3], ["Buducnost", 2],
			["Joventut Badalona", 3], ["Bahcesehir Koleji", 2],
			/* Four clubs used to be listed under a name their own domestic
			   league did not use — and the pro-league sim matches a prospect
			   to his club BY NAME, so Trento, Aris, Cholet and Tenerife were
			   four different clubs depending on which competition you asked
			   about.
			   The names agree now, and the sponsor name is the one that wins
			   because that is what the leagues themselves print.

			   Two clubs were also in this list TWICE under two names of their
			   own (Wolves Vilnius / Wolves Twinsbet, Veolia Towers Hamburg /
			   Hamburg Towers), which gave a sixteen-team EuroCup fourteen
			   clubs and two ghosts. */
			["Cedevita Olimpija", 1], ["Wolves Twinsbet", 0], ["Aris Midea", 0],
			["Dolomiti Energia Trento", 0], ["Veolia Towers Hamburg", -1],
			["Slask Wroclaw", -2], ["U-BT Cluj-Napoca", -1], ["Trefl Sopot", -3],
			["Besiktas", -2], ["Ratiopharm Ulm", 1], ["Hapoel Holon", -2],
		],
		"Basketball Bundesliga": [
			["Bayern Munich", 6], ["Alba Berlin", 4], ["Ratiopharm Ulm", 3],
			["Telekom Baskets Bonn", 3], ["MHP Riesen Ludwigsburg", 1],
			["Wurzburg Baskets", 1], ["Niners Chemnitz", 1],
			["Basketball Lowen Braunschweig", -1], ["EWE Baskets Oldenburg", 0],
			["Veolia Towers Hamburg", -1], ["BG Gottingen", -2],
			["Bamberg Baskets", -1], ["Skyliners Frankfurt", -2],
			["MLP Academics Heidelberg", -3], ["Rostock Seawolves", -3],
			["Rasta Vechta", -4],
		],
		"Adriatic League": [
			["Crvena Zvezda", 7], ["Partizan Belgrade", 7], ["Buducnost", 3],
			["Cedevita Olimpija", 2], ["Igokea", 0], ["Zadar", 0], ["Cibona", -1],
			["Split", -2], ["Mega Basket", 1], ["FMP Beograd", -1],
			["Borac Cacak", -2], ["Studentski Centar", -3], ["Krka", -3],
			["Dubai BC", 5], ["Spartak Subotica", -4],
		],
		"NBL1": [
			["Melbourne Tigers", 3], ["Nunawading Spectres", 2],
			["Basketball Australia CoE", 2], ["Ringwood Hawks", 1],
			["Frankston Blues", 0], ["Geelong Supercats", 0], ["Bendigo Braves", 0],
			["Sandringham Sabres", -1], ["Knox Raiders", -1],
			["Perth Redbacks", -1], ["Joondalup Wolves", -2],
			["Lakeside Lightning", -2], ["Norths Bears", -2],
			["Sutherland Sharks", -3], ["Bankstown Bruins", -3],
			["Brisbane Capitals", -3],
		],
		"Overtime Elite": [
			["City Reapers", 2], ["Cold Hearts", 1], ["YNG Dreamerz", 0],
			["RWE", 0], ["Diamond Doves", -1], ["Fear of God Athletics", -1],
		],
		"NBA Academy": [
			["NBA Global Academy", 3], ["NBA Academy Africa", 1],
			/* One academy, not two: the Latin America academy IS the one in
			   Mexico City. */
			["NBA Academy Latin America", 0], ["NBA Academy India", -2],
		],
		"DII NCAA": [
			["Northwest Missouri State", 6], ["Nova Southeastern", 5],
			["Minnesota State", 4], ["West Liberty", 3], ["Black Hills State", 2],
			["Indiana (PA)", 2], ["Cal State San Bernardino", 1],
			["Augusta University", 0], ["Lincoln Memorial", 0],
			["Colorado School of Mines", -1], ["Bentley", -2], ["Barry", -2],
			["West Texas A&M", -3], ["Fort Hays State", -3], ["Flagler", -4],
			["Angelo State", -5],
		],
	};

	/* Club -> the league it plays in.

	   The export writes a prospect abroad's CLUB into `college`, because that
	   is the field BBGM prints under that heading and "LNB Pro A" is not a
	   school. Re-importing the same file then has to get him back to the
	   right league, or a round trip turns a Cholet player into a college
	   prospect at an unrecognised program. A club that plays in more than one
	   competition resolves to the CONTINENTAL one — the EuroLeague, the
	   EuroCup, the Champions League — because that is the league the tool
	   sent him to in the first place: assignCollege draws a league and then
	   a club from it, and a club good enough to be in Europe is reached
	   through Europe far more often than through its domestic table. Getting
	   this backwards put a Barcelona player in the ACB on re-import. */
	const CLUB_LEAGUE = {};
	{
		const order = Object.keys(PRO_CLUBS).slice().sort((a, b) => {
			const dom = (n) => (NON_NCAA[n] && NON_NCAA[n].domestic ? 1 : 0);
			return dom(a) - dom(b);
		});
		for (const lg of order) {
			for (const [club] of PRO_CLUBS[lg]) {
				if (CLUB_LEAGUE[club] === undefined) CLUB_LEAGUE[club] = lg;
			}
		}
	}
	const leagueOfClub = (name) => CLUB_LEAGUE[String(name || "").trim()] || null;

	// Countries/regions that read as European for EuroLeague weighting.
	const EURO_HINTS = [
		"Spain","Serbia","France","Italy","Greece","Lithuania","Slovenia","Croatia",
		"Turkey","Germany","Russia","Montenegro","Bosnia","Latvia","Estonia","Poland",
		"Czech","Ukraine","Israel","Georgia","Finland","Sweden","Norway","Denmark",
		"Netherlands","Belgium","Switzerland","Austria","Portugal","Hungary","Romania",
		"Bulgaria","Slovakia","North Macedonia","Kosovo","Albania","England","Scotland",
		"Ireland","Wales","Iceland","Cyprus","Armenia",
		/* The country a BBGM export actually writes for a British player.
		   England / Scotland / Wales are above, but "United Kingdom" — which
		   is the string BBGM's own country list uses — matched none of them
		   and fell through to `other`, so a British prospect got a flat 1.0
		   on every destination and was as likely to turn up in the PBA as in
		   the BBL. */
		"United Kingdom","UK","Great Britain","Northern Ireland",
		// Everything below fell through to "other", i.e. to a flat 1.0
		// multiplier on every destination — no regional signal at all. (The
		// sixteen that were already listed above are not repeated: the list
		// is scanned in order and a duplicate is dead weight.)
		"Moldova","Belarus","Luxembourg","Malta","Azerbaijan","Herzegovina",
	];
	const OCEANIA_HINTS = ["Australia","New Zealand","Fiji","Samoa","Tonga","Papua"];
	const ASIA_HINTS = [
		"China","Japan","Korea","Philippines","Taiwan","Iran","India","Lebanon",
		"Indonesia","Kazakhstan","Jordan","Vietnam","Thailand","Malaysia",
		"Singapore","Mongolia","Syria","Qatar","Emirates","Saudi",
		"Uzbekistan","Iraq","Pakistan","Bangladesh","Sri Lanka","Hong Kong",
		"Bahrain","Kuwait","Oman","Nepal","Myanmar","Cambodia","Afghanistan",
	];
	const LATAM_HINTS = [
		"Brazil","Argentina","Mexico","Dominican","Puerto Rico","Venezuela",
		"Colombia","Chile","Uruguay","Panama","Cuba","Bahamas","Jamaica",
		"Haiti","Trinidad","Ecuador","Peru","Bolivia","Paraguay","Guatemala",
		"Honduras","Costa Rica","Virgin Islands",
		"El Salvador","Nicaragua","Guyana","Suriname","Belize","Barbados",
		"Curacao","Cura\u00e7ao","Aruba","Cayman","Saint Lucia","St. Lucia",
		"Saint Vincent","St. Vincent","Grenada","Antigua","Dominica",
		"Guadeloupe","Martinique","Bermuda",
	];
	const AFRICA_HINTS = [
		"Nigeria","Senegal","Cameroon","Congo","Sudan","Mali","Angola","Egypt",
		"Tunisia","Morocco","Algeria","Ghana","Kenya","Ivory Coast","Guinea",
		"South Africa","Rwanda","Uganda","Tanzania","Zimbabwe","Burkina",
		"Benin","Togo","Gabon","Chad","Niger","Somalia","Ethiopia","Libya",
		"Mozambique","Zambia","Botswana","Namibia","Madagascar","Malawi",
		"Liberia","Sierra Leone","Gambia","Burundi","Eritrea","Cape Verde",
		"Cabo Verde","Central African Republic","South Sudan","Mauritania",
		"Lesotho","Eswatini","Djibouti","Equatorial Guinea",
	];

	/* Canada is its own region. It is a top-three source of NBA prospects with
	   its own pathways (CEBL, U Sports, the OSBA) and mapping it to "usa"
	   silently gave every Canadian the American destination weighting. */
	const CANADA_HINTS = ["Canada", "Ontario", "Quebec", "Alberta",
		"British Columbia", "Manitoba", "Saskatchewan", "Nova Scotia",
		"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

	function isUSA(loc) {
		return typeof loc === "string" && /USA$/.test(loc);
	}

	/* Hints match on WORD BOUNDARIES, not on substrings.

	   `indexOf` had no boundaries at all, so every hint was a trap for a
	   longer word containing it: "Niger" caught Nigeria (the check that fires
	   first wins, and Africa is checked as a block so that one was harmless),
	   "India" caught Indiana, "Ireland" caught Northern Ireland — and
	   "Georgia" caught "Atlanta, Georgia", routing an American prospect to the
	   EuroLeague weighting whenever a file spelled the state out rather than
	   ending the string in USA. */
	const hintRe = (hints) => new RegExp(
		"(^|[^A-Za-z])(" +
			hints.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
			")([^A-Za-z]|$)", "i");
	const GEORGIAN_CITIES = ["Tbilisi", "Batumi", "Kutaisi", "Rustavi", "Zugdidi"];
	const US_STATES = [
		"Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
		"Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
		"Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
		"Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
		"Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
		"New Hampshire", "New Jersey", "New Mexico", "New York",
		"North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
		"Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
		"Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
		"West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
		"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
		"HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
		"MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
		"NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
		"SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
	];
	const RE = {
		georgianCity: hintRe(GEORGIAN_CITIES),
		usState: hintRe(US_STATES),
		canada: hintRe(CANADA_HINTS),
		europe: hintRe(EURO_HINTS),
		oceania: hintRe(OCEANIA_HINTS),
		africa: hintRe(AFRICA_HINTS),
		latam: hintRe(LATAM_HINTS),
		asia: hintRe(ASIA_HINTS),
	};

	function region(loc) {
		if (isUSA(loc)) return "usa";
		const s = String(loc || "");
		/* "Atlanta, Georgia" is not in the Caucasus. Files that spell a state
		   out instead of ending the string in USA used to route every American
		   prospect born in Georgia to the EuroLeague weighting, because
		   "Georgia" is in EURO_HINTS and EURO_HINTS was checked first. A named
		   Georgian city wins; otherwise a US state name means the United
		   States, which is true of all fifty including this one. */
		if (RE.georgianCity.test(s)) return "europe";
		if (RE.usState.test(s)) return "usa";
		// Canada next: several of its provinces and cities collide with hints
		// in the other lists.
		if (RE.canada.test(s)) return "canada";
		if (RE.europe.test(s)) return "europe";
		if (RE.oceania.test(s)) return "oceania";
		if (RE.africa.test(s)) return "africa";
		if (RE.latam.test(s)) return "latam";
		if (RE.asia.test(s)) return "asia";
		return "other";
	}

	/* Weight of one non-NCAA destination for a player born in `loc`. */
	function leagueWeight(name, loc, override) {
		const lg = NON_NCAA[name];
		if (!lg) return 0;
		const base = Number.isFinite(override) ? override : lg.w;
		const mult = (lg.regions && lg.regions[region(loc)]) !== undefined
			? lg.regions[region(loc)]
			: 1;
		return Math.max(0, base) * mult;
	}

	/* Real abbreviations for the well-known programs, the way a ticker or a
	   bracket would print them — Kentucky is UK and Kansas is KU because that
	   is what those schools actually call themselves, and no generator can
	   know that. Everything not listed here falls through to the generated
	   abbreviation in abbrev() below. Hand-checked unique. */
	const ABBREVS = {
		/* The initials generator is right about most schools and confidently
		   wrong about a handful, because the abbreviation a school uses is
		   not a function of its name: it produced IC, MO, II, WG, GC, TAC and
		   SPS where the tickers read UIC, M-OH, IUI, UWG, GCU, TAMUCC and
		   SPU. Named here, which is what this table is for. */
		"Illinois-Chicago": "UIC",
		"Miami (OH)": "M-OH",
		"IU Indianapolis": "IUI",
		"West Georgia": "UWG",
		"Grand Canyon": "GCU",
		"Texas A&M-CC": "TAMUCC",
		"St. Peter's": "SPU",
		"Kentucky": "UK",
		"UCLA": "UCLA",
		"North Carolina": "UNC",
		"Duke": "DUKE",
		"Kansas": "KU",
		"Indiana": "IND",
		"Louisville": "LOU",
		"Notre Dame": "ND",
		"Michigan": "MICH",
		"Michigan State": "MSU",
		"Arizona": "ARIZ",
		"Arizona State": "ASU",
		"St. John's": "SJU",
		"Syracuse": "SYR",
		"USC": "USC",
		"Illinois": "ILL",
		"Maryland": "MD",
		"Minnesota": "MINN",
		"Villanova": "NOVA",
		"Georgia Tech": "GT",
		"Georgetown": "GTWN",
		"Tennessee": "TENN",
		"Washington": "WASH",
		"Washington State": "WSU",
		"Florida State": "FSU",
		"Purdue": "PUR",
		"Cincinnati": "CIN",
		"California": "CAL",
		"Connecticut": "UCONN",
		"DePaul": "DEP",
		"Memphis": "MEM",
		"Ohio State": "OSU",
		"North Carolina State": "NCST",
		"Marquette": "MARQ",
		"UNLV": "UNLV",
		"LSU": "LSU",
		"Iowa": "IOWA",
		"Iowa State": "ISU",
		"Missouri": "MIZZ",
		"Stanford": "STAN",
		"Texas": "TEX",
		"Texas A&M": "TAMU",
		"Texas Tech": "TTU",
		"Houston": "HOU",
		"Arkansas": "ARK",
		"Florida": "FLA",
		"Western Kentucky": "WKU",
		"Temple": "TEM",
		"Oklahoma": "OU",
		"Oklahoma State": "OKST",
		"Alabama": "ALA",
		"Seton Hall": "HALL",
		"Oregon": "ORE",
		"Oregon State": "ORST",
		"Utah": "UTAH",
		"Utah State": "USU",
		"Virginia": "UVA",
		"Virginia Tech": "VT",
		"Wake Forest": "WAKE",
		"Colorado": "COLO",
		"Colorado State": "CSU",
		"San Francisco": "SF",
		"South Florida": "USF",
		"Vanderbilt": "VANDY",
		"Boston College": "BC",
		"Wisconsin": "WIS",
		"Kansas State": "KSU",
		"South Carolina": "SCAR",
		"Providence": "PROV",
		"Auburn": "AUB",
		"Fresno State": "FRES",
		"BYU": "BYU",
		"Dayton": "DAY",
		"Duquesne": "DUQ",
		"Detroit Mercy": "DET",
		"Georgia": "UGA",
		"La Salle": "LAS",
		"Baylor": "BAY",
		"Pepperdine": "PEPP",
		"Wichita State": "WICH",
		"Clemson": "CLEM",
		"Gonzaga": "GONZ",
		"Xavier": "XAV",
		"Long Beach State": "LBSU",
		"Creighton": "CREI",
		"Bowling Green": "BGSU",
		"Miami (FL)": "MIA",
		"New Mexico": "UNM",
		"New Mexico State": "NMSU",
		"West Virginia": "WVU",
		"Nebraska": "NEB",
		"Penn State": "PSU",
		"Pennsylvania": "PENN",
		"TCU": "TCU",
		"SMU": "SMU",
		"UTEP": "UTEP",
		"Rhode Island": "URI",
		"St. Bonaventure": "BONA",
		"San Diego State": "SDSU",
		"VCU": "VCU",
		"UCF": "UCF",
		"Saint Joseph's (PA)": "SJOE",
		"Saint Louis": "SLU",
		"Saint Mary's": "SMC",
		"Santa Clara": "SCU",
		"San Diego": "USD",
		"Northwestern": "NW",
		"Pittsburgh": "PITT",
		"UAB": "UAB",
		"Wyoming": "WYO",
		"Ole Miss": "MISS",
		"Mississippi State": "MSST",
		"Tulsa": "TLSA",
		"Tulane": "TULN",
		"Boise State": "BSU",
		"Nevada": "NEV",
		"Texas State": "TXST",
	};

	/* Abbreviations for everyone else are generated, deterministically, from
	   the name: initials for a multi-word name (which is how W&M or UTSA-style
	   abbreviations arise naturally), the first four letters otherwise, then a
	   fixed ladder of longer candidates until one is free. The whole map is
	   resolved once at load in COLLEGES key order, so the same college gets
	   the same abbreviation every run and no two colleges ever share one. */
	function abbrevCandidates(name) {
		const words = String(name).toUpperCase().split(/[^A-Z&]+/).filter(Boolean);
		const letters = words.join("");
		const cands = [];
		if (words.length >= 2) {
			const initials = words.map((w) => w[0]).join("");
			if (initials.length >= 2 && initials.length <= 6) cands.push(initials);
		}
		for (const n of [4, 5, 6]) {
			if (letters.length >= 2) cands.push(letters.slice(0, n));
		}
		// Last resort: a fifth-letter suffix walk. With 368 schools this is
		// essentially never reached, but it keeps resolution total.
		const stem = letters.slice(0, 5);
		for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") cands.push(stem + c);
		return cands;
	}

	const RESOLVED_ABBREVS = {};
	{
		const used = new Set(Object.keys(ABBREVS).map((k) => ABBREVS[k]));
		for (const name of Object.keys(COLLEGES)) {
			if (ABBREVS[name]) {
				RESOLVED_ABBREVS[name] = ABBREVS[name];
				continue;
			}
			for (const cand of abbrevCandidates(name)) {
				if (!used.has(cand)) {
					used.add(cand);
					RESOLVED_ABBREVS[name] = cand;
					break;
				}
			}
		}
	}

	function abbrev(name) {
		if (RESOLVED_ABBREVS[name]) return RESOLVED_ABBREVS[name];
		// An out-of-database school (modded league file): first candidate that
		// does not collide with a database school's abbreviation.
		const taken = new Set(Object.keys(RESOLVED_ABBREVS).map((k) => RESOLVED_ABBREVS[k]));
		for (const cand of abbrevCandidates(name)) {
			if (!taken.has(cand)) return cand;
		}
		return String(name).toUpperCase().replace(/[^A-Z&]/g, "").slice(0, 6) || "XX";
	}

	/* Names a BBGM export may still carry for a program that has since
	   rebranded. The table is anchored on 2023-26, and three of its names
	   were stale against 2025-26 membership: IUPUI became IU Indianapolis,
	   Texas A&M-Commerce became East Texas A&M, and Louisiana-Lafayette is
	   simply Louisiana. A file that says the old name still lands on the
	   right program; the export writes the current one. */
	const ALIASES = {
		"IUPUI": "IU Indianapolis",
		/* Three programs were in the table TWICE, under the name BBGM's list
		   carries and under the name the school uses now, and were simulated
		   as two different teams — Omaha in the Summit League twice, Little
		   Rock in the Ohio Valley twice, UTRGV in two conferences at once. The
		   old name resolves to the current one; the row is the current one. */
		"Nebraska-Omaha": "Omaha",
		"Arkansas-Little Rock": "Little Rock",
		"Texas Rio Grande Valley": "UT Rio Grande Valley",
		"Texas-Rio Grande Valley": "UT Rio Grande Valley",
		"UTRGV": "UT Rio Grande Valley",
		/* The 2022 rename. BBGM's own college list still writes the old
		   name for older players. St. Francis (BKN) — BBGM's own string for
		   it — is gone from here: the
		   Brooklyn school dropped athletics in 2023 and was never the
		   Pennsylvania one, so a player from it is an out-of-table program
		   rather than a Red Flash alumnus. */
		"Houston Baptist": "Houston Christian",
		"Texas A&M-Commerce": "East Texas A&M",
		"Louisiana-Lafayette": "Louisiana",
		"Louisiana Lafayette": "Louisiana",
		"UL Lafayette": "Louisiana",
		/* The other direction. Every entry above answers "the file has the
		   old name" — but a modded or hand-edited class carries the OTHER
		   spelling just as often, and each of these landed as an
		   out-of-database program: no conference, no prestige, no schedule,
		   and the export wrote the unrecognised string back out. The
		   right-hand side is always the key this table actually holds. */
		"Dixie State": "Utah Tech",
		"UMKC": "Kansas City",
		"Missouri-Kansas City": "Kansas City",
		"IPFW": "Purdue Fort Wayne",
		"Fort Wayne": "Purdue Fort Wayne",
		"College of Charleston": "Charleston",
		"Charleston (SC)": "Charleston",
		"Central Florida": "UCF",
		"Southern Mississippi": "Southern Miss",
		"Miami": "Miami (FL)",
		"UConn": "Connecticut",
		"Mississippi": "Ole Miss",
		"Penn": "Pennsylvania",
	};
	const canonical = (name) => {
		if (name === undefined || name === null) return name;
		const key = String(name).trim();
		return ALIASES[key] || key;
	};

	const conferenceOf = (name) => (COLLEGES[name] ? COLLEGES[name][1] : null);
	const frequencyOf = (name) => (COLLEGES[name] ? COLLEGES[name][0] : 1);

	// Program prestige 0-100 from BBGM draft frequency (log-scaled: Kentucky 116
	// and Wagner 0.1 should not be 1000x apart in on-court terms).
	function prestige(name) {
		const f = frequencyOf(name);
		const p = (Math.log(f + 0.6) - Math.log(0.7)) / (Math.log(116.6) - Math.log(0.7));
		return Math.max(0, Math.min(1, p)) * 100;
	}

	const byConference = {};
	for (const name of Object.keys(COLLEGES)) {
		const c = COLLEGES[name][1];
		(byConference[c] = byConference[c] || []).push(name);
	}

	global.Colleges = {
		COLLEGES, CONFERENCES, NON_NCAA, PRO_CLUBS, byConference,
		conferenceOf, frequencyOf, prestige, region, isUSA, leagueWeight,
		ALIASES, canonical, CLUB_LEAGUE, leagueOfClub,
		ABBREVS, abbrev,
		CANADA_HINTS, US_STATES, GEORGIAN_CITIES, EURO_HINTS, OCEANIA_HINTS, ASIA_HINTS, LATAM_HINTS, AFRICA_HINTS,
		names: Object.keys(COLLEGES),
	};
})(typeof window !== "undefined" ? window : self);
