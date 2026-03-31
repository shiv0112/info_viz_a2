// ===== Configuration =====
// Okabe-Ito colorblind-safe palette
const REGION_COLORS = {
    "Africa": "#D55E00",
    "Americas": "#009E73",
    "Asia": "#0072B2",
    "Europe": "#E69F00",
    "Oceania": "#CC79A7"
};

// Data quality encoded via stroke style only — no opacity fade
const QUALITY_STYLES = {
    high:   { opacity: 0.85, dasharray: "none" },
    medium: { opacity: 0.85, dasharray: "5 3" },
    low:    { opacity: 0.85, dasharray: "2 3" }
};

const QUALITY_LABELS = {
    high: "High confidence",
    medium: "Medium — some estimation",
    low: "Low — rough estimates"
};

// Small multiples: 6 key years spanning the full range
const MULTI_YEARS = [1952, 1962, 1977, 1992, 2002, 2007];

// ===== State =====
let allData = [];
let state = {
    xScale: "log",           // "log" or "linear"
    showQuality: true,
    sizeMode: "population",  // "population" or "equal"
    activeRegions: new Set(Object.keys(REGION_COLORS)),
    highlightedCountry: null,
    selectedYear: 2007,
    searchResults: []
};

// ===== Load Data & Initialize =====
// Try relative path (local server) then fallback
const DATA_PATH = window.location.hostname === "localhost" ? "../data/gapminder.csv" : "../data/gapminder.csv";
d3.csv(DATA_PATH, d => ({
    country: d.country,
    continent: d.continent,
    year: +d.year,
    lifeExp: +d.lifeExp,
    pop: +d.pop,
    gdpPercap: +d.gdpPercap,
    iso_alpha: d.iso_alpha,
    dataQuality: d.dataQuality
})).then(data => {
    allData = data;
    initControls();
    renderSmallMultiples();
    renderDetailChart();
    renderSizeLegend();
    renderRegionLegend();
});

// ===== Scales (shared) =====
function getXScale(width, type) {
    if (type === "log") {
        return d3.scaleLog().domain([200, 120000]).range([0, width]).clamp(true);
    }
    // Linear: use 50K cap so the bulk of countries spread out nicely.
    // Outliers beyond 50K get clamped to the right edge.
    return d3.scaleLinear().domain([0, 50000]).range([0, width]).clamp(true);
}

function getYScale(height) {
    return d3.scaleLinear().domain([20, 88]).range([height, 0]);
}

// Perceptually corrected radius scale using sqrt (fixes Steven's Power Law bias)
// sqrt maps population to radius so that AREA is proportional to population
function getRadiusScale(maxR) {
    return d3.scaleSqrt()
        .domain([0, 1.4e9])
        .range([0, maxR]);
}

// ===== Controls =====
function initControls() {
    // Region filter checkboxes
    const regionContainer = d3.select("#region-filters");
    Object.entries(REGION_COLORS).forEach(([region, color]) => {
        const lbl = regionContainer.append("label");
        lbl.append("input")
            .attr("type", "checkbox")
            .attr("checked", true)
            .on("change", function() {
                if (this.checked) state.activeRegions.add(region);
                else state.activeRegions.delete(region);
                updateAll();
            });
        lbl.append("span").attr("class", "region-color-dot").style("background", color);
        lbl.append("span").text(region);
    });

    // Scale toggle
    d3.select("#btn-log").on("click", () => setScale("log"));
    d3.select("#btn-linear").on("click", () => setScale("linear"));

    // Quality toggle
    d3.select("#btn-quality-on").on("click", () => { state.showQuality = true; updateToggles(); updateAll(); });
    d3.select("#btn-quality-off").on("click", () => { state.showQuality = false; updateToggles(); updateAll(); });

    // Size toggle
    d3.select("#btn-size-pop").on("click", () => { state.sizeMode = "population"; updateToggles(); updateAll(); renderSizeLegend(); });
    d3.select("#btn-size-equal").on("click", () => { state.sizeMode = "equal"; updateToggles(); updateAll(); renderSizeLegend(); });

    // Year slider — maps index to actual data years
    const availableYears = [...new Set(allData.map(d => d.year))].sort((a, b) => a - b);
    d3.select("#year-slider")
        .attr("max", availableYears.length - 1)
        .attr("value", availableYears.length - 1)
        .on("input", function() {
            state.selectedYear = availableYears[+this.value];
            d3.select("#year-label").text(state.selectedYear);
            updateDetailChart();
        });

    // Country search
    const searchInput = d3.select("#country-search");
    const dropdown = d3.select("#search-dropdown");

    searchInput.on("input", function() {
        const query = this.value.toLowerCase().trim();
        if (query.length < 1) {
            dropdown.classed("visible", false);
            state.highlightedCountry = null;
            applyHighlighting();
            return;
        }
        const countries = [...new Set(allData.map(d => d.country))];
        const matches = countries.filter(c => c.toLowerCase().includes(query)).slice(0, 8);

        dropdown.html("").classed("visible", matches.length > 0);
        matches.forEach(c => {
            dropdown.append("div")
                .attr("class", "search-option")
                .text(c)
                .on("click", () => {
                    searchInput.property("value", c);
                    dropdown.classed("visible", false);
                    state.highlightedCountry = c;
                    applyHighlighting();
                });
        });
    });

    searchInput.on("blur", () => {
        setTimeout(() => dropdown.classed("visible", false), 200);
    });

    // Clear search on Escape
    searchInput.on("keydown", function(event) {
        if (event.key === "Escape") {
            this.value = "";
            state.highlightedCountry = null;
            dropdown.classed("visible", false);
            applyHighlighting();
        }
    });

    updateToggles();
}

function setScale(type) {
    state.xScale = type;
    updateToggles();
    updateAll();
}

function updateToggles() {
    d3.select("#btn-log").classed("active", state.xScale === "log");
    d3.select("#btn-linear").classed("active", state.xScale === "linear");
    d3.select("#btn-quality-on").classed("active", state.showQuality);
    d3.select("#btn-quality-off").classed("active", !state.showQuality);
    d3.select("#btn-size-pop").classed("active", state.sizeMode === "population");
    d3.select("#btn-size-equal").classed("active", state.sizeMode === "equal");
}

function updateAll() {
    updateSmallMultiples();
    updateDetailChart();
}

// ===== Tooltip =====
const tooltip = d3.select("#tooltip");

function showTooltip(event, d) {
    const fmt = d3.format(",.0f");
    const fmtGdp = d3.format("$,.0f");

    tooltip.html(`
        <div class="tooltip-title">${d.country} (${d.year})</div>
        <div class="tooltip-row"><span class="tooltip-label">Life Expectancy</span><span class="tooltip-value">${d.lifeExp.toFixed(1)} years</span></div>
        <div class="tooltip-row"><span class="tooltip-label">GDP per capita</span><span class="tooltip-value">${fmtGdp(d.gdpPercap)}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Population</span><span class="tooltip-value">${fmt(d.pop)}</span></div>
        <div class="tooltip-row"><span class="tooltip-label">Region</span><span class="tooltip-value">${d.continent}</span></div>
        <div class="tooltip-quality">Data quality: ${QUALITY_LABELS[d.dataQuality]}</div>
    `);

    tooltip.classed("visible", true);
    positionTooltip(event);
}

function positionTooltip(event) {
    const ttNode = tooltip.node();
    const ttW = ttNode.offsetWidth;
    const ttH = ttNode.offsetHeight;
    let x = event.clientX + 14;
    let y = event.clientY - 10;

    if (x + ttW > window.innerWidth - 10) x = event.clientX - ttW - 14;
    if (y + ttH > window.innerHeight - 10) y = event.clientY - ttH - 10;

    tooltip.style("left", x + "px").style("top", y + "px");
}

function hideTooltip() {
    tooltip.classed("visible", false);
}

// ===== Bubble rendering helper =====
function renderBubbles(svg, data, xScale, yScale, rScale, panelType) {
    const filteredData = data.filter(d => state.activeRegions.has(d.continent));

    // Sort so smaller bubbles render on top (prevent occlusion)
    filteredData.sort((a, b) => b.pop - a.pop);

    const bubbles = svg.selectAll(".bubble")
        .data(filteredData, d => d.country);

    // Enter
    const enter = bubbles.enter().append("circle")
        .attr("class", "bubble");

    // Enter + Update
    const merged = enter.merge(bubbles);

    merged.transition().duration(150)
        .attr("cx", d => xScale(Math.max(d.gdpPercap, state.xScale === "log" ? 200 : 0)))
        .attr("cy", d => yScale(d.lifeExp))
        .attr("r", d => state.sizeMode === "population" ? Math.max(rScale(d.pop), 2) : (panelType === "small" ? 3.5 : 5))
        .attr("fill", d => REGION_COLORS[d.continent])
        .attr("stroke", d => d3.color(REGION_COLORS[d.continent]).darker(0.8))
        .attr("stroke-width", d => state.highlightedCountry === d.country ? 2.5 : 1)
        .attr("stroke-dasharray", d => state.showQuality ? QUALITY_STYLES[d.dataQuality].dasharray : "none")
        .attr("opacity", d => {
            let op = state.showQuality ? QUALITY_STYLES[d.dataQuality].opacity : 0.8;
            if (state.highlightedCountry && state.highlightedCountry !== d.country) op = 0.08;
            return op;
        });

    // Highlight class
    merged
        .classed("highlighted", d => state.highlightedCountry === d.country)
        .classed("dimmed", d => state.highlightedCountry && state.highlightedCountry !== d.country);

    // Events — use fast CSS-based highlighting instead of full re-render
    merged
        .on("mouseover", function(event, d) {
            state.highlightedCountry = d.country;
            applyHighlighting();
            showTooltip(event, d);
        })
        .on("mousemove", (event) => positionTooltip(event))
        .on("mouseout", function() {
            state.highlightedCountry = null;
            applyHighlighting();
            hideTooltip();
        });

    // Exit
    bubbles.exit().transition().duration(100).attr("r", 0).remove();
}

// ===== Fast Highlighting (no full re-render) =====
function applyHighlighting() {
    const country = state.highlightedCountry;

    d3.selectAll(".bubble")
        .classed("highlighted", d => country === d.country)
        .classed("dimmed", d => country && country !== d.country)
        .attr("opacity", d => {
            let op = state.showQuality ? QUALITY_STYLES[d.dataQuality].opacity : 0.8;
            if (country && country !== d.country) op = 0.08;
            return op;
        })
        .attr("stroke-width", d => country === d.country ? 2.5 : 1);

    // Update country labels across all bubble groups
    d3.selectAll(".bubbles").each(function() {
        const g = d3.select(this);
        const labelData = [];

        if (country) {
            g.selectAll(".bubble").each(function(d) {
                if (d.country === country) {
                    labelData.push({
                        country: d.country,
                        cx: +d3.select(this).attr("cx"),
                        cy: +d3.select(this).attr("cy"),
                        r: +d3.select(this).attr("r")
                    });
                }
            });
        }

        const labels = g.selectAll(".country-label").data(labelData, d => d.country);
        labels.enter().append("text")
            .attr("class", "country-label")
            .merge(labels)
            .attr("x", d => d.cx)
            .attr("y", d => d.cy - d.r - 4)
            .text(d => d.country);
        labels.exit().remove();
    });
}

// ===== Small Multiples =====
const multipleCharts = {};

function renderSmallMultiples() {
    const container = d3.select("#multiples-container");
    const margin = { top: 26, right: 16, bottom: 40, left: 48 };
    const width = 380 - margin.left - margin.right;
    const height = 280 - margin.top - margin.bottom;

    MULTI_YEARS.forEach(year => {
        const panel = container.append("div").attr("class", "multiple-panel");
        panel.append("div").attr("class", "panel-title").text(year);

        const svg = panel.append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .style("width", "100%")
            .style("height", "auto")
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Grid
        svg.append("g").attr("class", "grid x-grid");
        svg.append("g").attr("class", "grid y-grid");

        // Axes groups
        svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`);
        svg.append("g").attr("class", "axis y-axis");

        // Axis labels
        svg.append("text")
            .attr("class", "axis-label x-label")
            .attr("x", width / 2)
            .attr("y", height + 32)
            .attr("text-anchor", "middle")
            .text("GDP per capita ($)");

        svg.append("text")
            .attr("class", "axis-label y-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -height / 2)
            .attr("y", -34)
            .attr("text-anchor", "middle")
            .text("Life Exp.");

        // Bubble layer
        svg.append("g").attr("class", "bubbles");

        multipleCharts[year] = { svg, width, height, margin };
    });

    updateSmallMultiples();
}

function updateSmallMultiples() {
    MULTI_YEARS.forEach(year => {
        const { svg, width, height } = multipleCharts[year];
        const yearData = allData.filter(d => d.year === year);

        const xScale = getXScale(width, state.xScale);
        const yScale = getYScale(height);
        const rScale = getRadiusScale(26);

        // Update axes
        const xAxis = state.xScale === "log"
            ? d3.axisBottom(xScale).ticks(4, "~s")
            : d3.axisBottom(xScale).ticks(4, "~s");

        svg.select(".x-axis").transition().duration(150).call(xAxis);
        svg.select(".y-axis").transition().duration(150).call(d3.axisLeft(yScale).ticks(5));

        // Grid lines
        svg.select(".x-grid").transition().duration(150)
            .call(d3.axisBottom(xScale).ticks(4).tickSize(height).tickFormat(""))
            .attr("transform", "translate(0,0)");

        svg.select(".y-grid").transition().duration(150)
            .call(d3.axisLeft(yScale).ticks(5).tickSize(-width).tickFormat(""));

        // Bubbles
        renderBubbles(svg.select(".bubbles"), yearData, xScale, yScale, rScale, "small");
    });
}

// ===== Detail Chart =====
let detailChart = null;

function renderDetailChart() {
    const container = d3.select("#detail-chart");
    const margin = { top: 24, right: 36, bottom: 56, left: 64 };
    const width = 960 - margin.left - margin.right;
    const height = 540 - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("width", "100%")
        .style("height", "auto")
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Grid
    svg.append("g").attr("class", "grid x-grid");
    svg.append("g").attr("class", "grid y-grid");

    // Axes
    svg.append("g").attr("class", "axis x-axis").attr("transform", `translate(0,${height})`);
    svg.append("g").attr("class", "axis y-axis");

    // Labels
    svg.append("text")
        .attr("class", "axis-label x-label")
        .attr("x", width / 2)
        .attr("y", height + 44)
        .attr("text-anchor", "middle")
        .text("GDP per capita (PPP, constant international $)");

    svg.append("text")
        .attr("class", "axis-label y-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -44)
        .attr("text-anchor", "middle")
        .text("Life Expectancy (years)");

    // Bubble layer
    svg.append("g").attr("class", "bubbles");

    detailChart = { svg, width, height, margin };
    updateDetailChart();
}

function updateDetailChart() {
    if (!detailChart) return;
    const { svg, width, height } = detailChart;
    const yearData = allData.filter(d => d.year === state.selectedYear);

    const xScale = getXScale(width, state.xScale);
    const yScale = getYScale(height);
    const rScale = getRadiusScale(45);

    // Axes
    const xAxis = state.xScale === "log"
        ? d3.axisBottom(xScale).ticks(8, "$,.0f")
        : d3.axisBottom(xScale).ticks(8, "$,.0f");

    svg.select(".x-axis").transition().duration(150).call(xAxis);
    svg.select(".y-axis").transition().duration(150).call(d3.axisLeft(yScale).ticks(8));

    // Grid
    svg.select(".x-grid").transition().duration(150)
        .call(d3.axisBottom(xScale).ticks(8).tickSize(height).tickFormat(""))
        .attr("transform", "translate(0,0)");

    svg.select(".y-grid").transition().duration(150)
        .call(d3.axisLeft(yScale).ticks(8).tickSize(-width).tickFormat(""));

    // Bubbles
    renderBubbles(svg.select(".bubbles"), yearData, xScale, yScale, rScale, "detail");
}

// ===== Size Legend =====
function renderSizeLegend() {
    const container = d3.select("#size-legend");
    container.html("");

    container.append("h3").text("Population");

    if (state.sizeMode === "equal") {
        container.append("p").style("font-size", "0.82rem").style("color", "#888")
            .text("Equal bubble size — population not encoded. Check values via hover.");
        return;
    }

    const svg = container.append("svg")
        .attr("width", 140)
        .attr("height", 180);

    const rScale = getRadiusScale(45);
    const populations = [1e9, 3e8, 5e7, 1e7];
    const fmt = d3.format(".0s");

    let y = 10;
    populations.forEach(pop => {
        const r = Math.max(rScale(pop), 2);
        const cx = 50;
        const cy = y + r;

        svg.append("circle")
            .attr("cx", cx)
            .attr("cy", cy)
            .attr("r", r)
            .attr("fill", "none")
            .attr("stroke", "#999")
            .attr("stroke-width", 1);

        svg.append("text")
            .attr("x", cx + r + 8)
            .attr("y", cy + 4)
            .attr("font-size", "11px")
            .attr("fill", "#555")
            .text(fmt(pop));

        y = cy + r + 8;
    });

    // Add note about perceptual correction
    container.append("p")
        .style("font-size", "0.75rem")
        .style("color", "#999")
        .style("margin-top", "8px")
        .text("Area is proportional to population (sqrt-scaled radius for perceptual accuracy).");
}

// ===== Region Legend =====
function renderRegionLegend() {
    const container = d3.select("#region-legend");
    Object.entries(REGION_COLORS).forEach(([region, color]) => {
        const item = container.append("div").attr("class", "legend-item");
        item.append("svg")
            .attr("width", 24)
            .attr("height", 24)
            .append("circle")
            .attr("cx", 12)
            .attr("cy", 12)
            .attr("r", 8)
            .attr("fill", color)
            .attr("stroke", d3.color(color).darker(0.8))
            .attr("stroke-width", 1);
        item.append("span").text(region);
    });
}
