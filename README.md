Open src/index.html in Chrome (requires local server: `python3 -m http.server 8080` from project root, then visit http://localhost:8080/src/index.html)

**Case:** B — Gapminder Animated Bubble Chart

**Tech Stack:** D3.js v7, vanilla HTML/CSS/JavaScript (no build step, no framework)

**Dependencies:** None. D3.js is loaded via CDN. Requires a modern browser (Chrome recommended).

**Setup Instructions:**
1. Unzip the submission
2. Open a terminal in the project root directory
3. Run `python3 -m http.server 8080`
4. Open http://localhost:8080/src/index.html in Chrome

A local server is required because D3 loads the CSV data file via fetch (blocked by CORS on file:// protocol).
