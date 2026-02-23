const WIDTH = 1000;
const HEIGHT = 500;

// Module-level state
let currentAttribute = 'averageScore';
let currentScoreData = {};
let currentRegulationInfo = {};
let filterMin = 1;
let filterMax = 5;

const ATTRIBUTE_LABELS = {
  averageScore: 'Average Score',
  regulationStatus: 'Regulation Status',
  policyLever: 'Policy Lever',
  governanceType: 'Governance Type',
  actorInvolvement: 'Actor Involvement',
  enforcementLevel: 'Enforcement Level'
};

// ── Legend ──────────────────────────────────────────────────

function addLegend(svg, colorScale) {
  const legendWidth = 300;
  const legendHeight = 30;
  const legendMargin = { top: 10, right: 20, bottom: 10, left: 20 };

  const legend = svg.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${WIDTH - legendWidth - legendMargin.right}, ${HEIGHT - legendHeight - legendMargin.bottom})`);

  const legendScale = d3.scaleLinear()
    .domain([1, 5])
    .range([0, legendWidth]);

  const legendAxis = d3.axisBottom(legendScale)
    .tickValues([1, 2, 3, 4, 5])
    .tickFormat(d3.format("d"));

  legend.append("g")
    .attr("transform", `translate(0, ${legendHeight - legendMargin.bottom - 10})`)
    .call(legendAxis);

  const gradientData = d3.range(0, 1, 0.01).map(d => ({
    offset: d,
    color: colorScale(1 + d * 4)
  }));

  const gradient = legend.append("defs")
    .append("linearGradient")
    .attr("id", "legend-gradient")
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "100%")
    .attr("y2", "0%");

  gradient.selectAll("stop")
    .data(gradientData)
    .enter().append("stop")
    .attr("offset", d => `${d.offset * 100}%`)
    .attr("stop-color", d => d.color);

  legend.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight - legendMargin.bottom - legendMargin.top)
    .style("fill", "url(#legend-gradient)");

  legend.append("text")
    .attr("class", "legend-title")
    .attr("x", legendWidth / 2)
    .attr("y", -5)
    .attr("text-anchor", "middle")
    .text("Score Legend");
}

// ── Map generation ───────────────────────────────────────────

const generateMap = async (scoreData, scoreAttribute, regulationData) => {

  const svg = d3.select("#map")
    .append("svg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, WIDTH, HEIGHT]);

  const clipPath = svg.append("defs")
    .append("clipPath")
    .attr("id", "clip")
    .append("rect")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("rx", 20)
    .attr("ry", 20);

  const g = svg.append("g")
    .attr("clip-path", "url(#clip)");

  const projection = d3.geoEquirectangular()
    .fitSize([WIDTH, HEIGHT], { type: "Sphere" });

  const path = d3.geoPath().projection(projection);

  const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
    .domain([1, 5]);

  const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);

  const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
  const countries = topojson.feature(world, world.objects.countries).features;

  const mapGroup = g.append("g")
    .attr('class', 'map-group');

  mapGroup.append("path")
    .datum({ type: "Sphere" })
    .attr("fill", "#dcf4f7")
    .attr("d", path);

  mapGroup.selectAll(".country")
    .data(countries)
    .enter().append("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", d => {
      const countryName = d.properties.name;
      const entry = scoreData[countryName];
      return entry ? colorScale(entry[scoreAttribute]) : "#ccc";
    })
    .attr("stroke", "black")
    .attr("stroke-width", 0.5)
    .on("mouseover", function (event, d) {
      const countryName = d.properties.name;
      const entry = scoreData[countryName];
      const score = entry ? entry[currentAttribute] : null;
      const label = ATTRIBUTE_LABELS[currentAttribute] || currentAttribute;
      tooltip.transition().duration(200).style("opacity", .9);
      tooltip.html(
        `<strong>${countryName}</strong>` +
        (score != null ? `${label}: ${score} / 5` : 'No data')
      )
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseout", function () {
      tooltip.transition().duration(500).style("opacity", 0);
    })
    .on("click", function (event, d) {
      const countryName = d.properties.name;
      updateCountryData(countryName, scoreData, regulationData);
      highlightCountry(this);
    });

  // Zoom and pan
  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .extent([[0, 0], [WIDTH, HEIGHT]])
    .translateExtent([[0, 0], [WIDTH, HEIGHT]])
    .on("zoom", zoomed);

  svg.call(zoom);

  function zoomed(event) {
    mapGroup.attr("transform", event.transform);
  }

  const zoomIn = d3.select("#zoom-controls").append("button")
    .text("+")
    .on("click", () => zoom.scaleBy(svg.transition().duration(750), 1.5));

  const zoomOut = d3.select("#zoom-controls").append("button")
    .text("-")
    .on("click", () => zoom.scaleBy(svg.transition().duration(750), 0.67));

  const resetZoom = d3.select("#zoom-controls").append("button")
    .text("Reset")
    .on("click", () => {
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    });

  addLegend(svg, colorScale);
};

// ── Map color + opacity update ────────────────────────────────

const updateMap = (countryData, scoreAttribute) => {
  const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
    .domain([1, 5]);

  d3.select("#map")
    .selectAll(".country")
    .transition()
    .duration(500)
    .attr("fill", d => {
      const countryName = d.properties.name;
      const entry = countryData[countryName];
      return entry ? colorScale(entry[scoreAttribute]) : "#ccc";
    })
    .style("opacity", d => {
      const countryName = d.properties.name;
      const entry = countryData[countryName];
      if (!entry) return 0.4;
      const score = entry[scoreAttribute];
      if (score == null) return 0.4;
      return (score >= filterMin && score <= filterMax) ? 1 : 0.15;
    });
};

// ── Country detail panel ──────────────────────────────────────

function showSection(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}

function updateCountryData(countryName, countryData, regulationData) {
  const scoreData = countryData[countryName];
  const regData = regulationData[countryName];

  // Hide default message, show sections
  document.getElementById("no-selection-message").style.display = 'none';
  showSection('data-general-section', true);
  showSection('regulation-section', true);
  showSection('policy-section', true);
  showSection('governance-section', true);
  showSection('actors-section', true);

  document.getElementById("country-name").textContent = countryName;

  // Confidence badge
  const badge = document.getElementById("confidence-badge");
  if (regData && regData.confidence === 'low') {
    badge.textContent = 'Low confidence';
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  // Last updated
  const lastUpdatedEl = document.getElementById("last-updated");
  const dateStr = (scoreData && scoreData.lastUpdated) || (regData && regData.lastUpdated);
  lastUpdatedEl.textContent = dateStr ? `Data as of: ${dateStr}` : '';

  // Scores
  if (scoreData) {
    document.getElementById("average-score").textContent = `${scoreData.averageScore} / 5`;
    document.getElementById("regulation").textContent = `${scoreData.regulationStatus} / 5`;
    document.getElementById("policy").textContent = `${scoreData.policyLever} / 5`;
    document.getElementById("governance").textContent = `${scoreData.governanceType} / 5`;
    document.getElementById("actors").textContent = `${scoreData.actorInvolvement} / 5`;

    if (scoreData.enforcementLevel) {
      document.getElementById("enforcement").textContent = `${scoreData.enforcementLevel} / 5`;
      showSection('enforcement-section', true);
    } else {
      showSection('enforcement-section', false);
    }
  } else {
    ['average-score', 'regulation', 'policy', 'governance', 'actors'].forEach(id => {
      document.getElementById(id).textContent = 'N/A';
    });
    showSection('enforcement-section', false);
  }

  // Qualitative details
  if (regData) {
    document.getElementById("regulation-details").textContent = regData.regulationStatus || 'N/A';
    document.getElementById("policy-details").textContent = regData.policyLever || 'N/A';
    document.getElementById("governance-details").textContent = regData.governanceType || 'N/A';
    document.getElementById("actors-details").textContent = regData.actorInvolvement || 'N/A';

    if (regData.enforcementLevel) {
      document.getElementById("enforcement-details").textContent = regData.enforcementLevel;
      showSection('enforcement-section', true);
    }

    // Specific laws
    if (regData.specificLaws) {
      document.getElementById("specific-laws").textContent = regData.specificLaws;
      showSection('laws-section', true);
    } else {
      showSection('laws-section', false);
    }

    // Sources
    const sourcesContainer = document.getElementById("sources-list");
    sourcesContainer.innerHTML = '';
    if (regData.sources && regData.sources !== 'NA') {
      const urls = regData.sources.split('|').map(u => u.trim()).filter(Boolean);
      if (urls.length > 0) {
        urls.forEach((url, i) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          try {
            a.textContent = new URL(url).hostname.replace('www.', '');
          } catch {
            a.textContent = `Source ${i + 1}`;
          }
          li.appendChild(a);
          sourcesContainer.appendChild(li);
        });
        showSection('sources-section', true);
      } else {
        showSection('sources-section', false);
      }
    } else {
      showSection('sources-section', false);
    }
  } else {
    ['regulation-details', 'policy-details', 'governance-details', 'actors-details'].forEach(id => {
      document.getElementById(id).textContent = 'N/A';
    });
    showSection('enforcement-section', false);
    showSection('laws-section', false);
    showSection('sources-section', false);
  }
}

function highlightCountry(element) {
  d3.selectAll(".country").classed("selected", false).attr("stroke-width", 0.5);
  d3.select(element).classed("selected", true).attr("stroke-width", 2);
}

// ── Search ───────────────────────────────────────────────────

function initSearch(countriesList, scoreData, regulationData) {
  const searchInput = document.getElementById('country-search');
  const suggestions = document.getElementById('search-suggestions');

  searchInput.addEventListener('input', function () {
    const query = this.value.trim().toLowerCase();
    suggestions.innerHTML = '';
    if (query.length < 2) return;

    const matches = countriesList
      .filter(name => name.toLowerCase().includes(query))
      .sort((a, b) => {
        // Prefer names that start with the query
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 8);

    matches.forEach(name => {
      const li = document.createElement('li');
      li.textContent = name;
      li.setAttribute('role', 'option');
      li.addEventListener('click', () => {
        searchInput.value = name;
        suggestions.innerHTML = '';
        selectCountryByName(name, scoreData, regulationData);
      });
      suggestions.appendChild(li);
    });
  });

  // Close suggestions on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-container')) {
      suggestions.innerHTML = '';
    }
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', function (e) {
    const items = suggestions.querySelectorAll('li');
    if (!items.length) return;
    const highlighted = suggestions.querySelector('li.highlighted');
    let idx = highlighted ? Array.from(items).indexOf(highlighted) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
    } else if (e.key === 'Enter' && highlighted) {
      highlighted.click();
      return;
    } else if (e.key === 'Escape') {
      suggestions.innerHTML = '';
      return;
    } else {
      return;
    }
    items.forEach(li => li.classList.remove('highlighted'));
    items[idx].classList.add('highlighted');
  });
}

function selectCountryByName(countryName, scoreData, regulationData) {
  updateCountryData(countryName, scoreData, regulationData);
  d3.selectAll(".country")
    .filter(d => d.properties.name === countryName)
    .each(function () { highlightCountry(this); });
}

// ── Filter ───────────────────────────────────────────────────

function initFilter(scoreData) {
  const minSlider = document.getElementById('filter-min');
  const minLabel = document.getElementById('filter-min-label');

  minSlider.addEventListener('input', function () {
    filterMin = parseFloat(this.value);
    filterMax = 5;
    minLabel.textContent = filterMin <= 1 ? 'Any' : filterMin;
    updateMap(currentScoreData, currentAttribute);
  });
}

// ── Score selector ────────────────────────────────────────────

function buildScoreSelector() {
  const selectEl = document.getElementById('score-select');
  const options = [
    { value: "averageScore", text: "Average Score" },
    { value: "regulationStatus", text: "Regulation Status" },
    { value: "policyLever", text: "Policy Lever" },
    { value: "governanceType", text: "Governance Type" },
    { value: "actorInvolvement", text: "Actor Involvement" },
    { value: "enforcementLevel", text: "Enforcement Level" }
  ];

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.text;
    selectEl.appendChild(option);
  });

  selectEl.addEventListener('change', function () {
    currentAttribute = this.value;
    updateMap(currentScoreData, currentAttribute);
  });
}

// ── Timeline / History ────────────────────────────────────────

async function loadHistory() {
  try {
    return await d3.json('history.json');
  } catch (e) {
    console.warn('history.json not available, timeline disabled');
    return null;
  }
}

function buildScoresAtDate(history, targetDate) {
  const result = {};
  Object.entries(history.countries).forEach(([country, snapshots]) => {
    const applicable = snapshots
      .filter(s => s.date <= targetDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (applicable.length > 0) {
      result[country] = applicable[0];
    }
  });
  return result;
}

function initTimeline(history) {
  if (!history) return;

  const allDates = new Set();
  Object.values(history.countries).forEach(snapshots => {
    snapshots.forEach(s => allDates.add(s.date));
  });
  const sortedDates = Array.from(allDates).sort();

  if (sortedDates.length <= 1) return;

  const container = document.getElementById('timeline-container');
  container.style.display = 'block';

  const slider = document.getElementById('timeline-slider');
  slider.max = sortedDates.length - 1;
  slider.value = sortedDates.length - 1;

  const dateLabel = document.getElementById('timeline-date-label');

  slider.addEventListener('input', function () {
    const selectedDate = sortedDates[parseInt(this.value)];
    dateLabel.textContent = selectedDate;
    const historicScores = buildScoresAtDate(history, selectedDate);
    updateMap(historicScores, currentAttribute);
  });

  document.getElementById('timeline-reset').addEventListener('click', () => {
    slider.value = sortedDates.length - 1;
    dateLabel.textContent = 'Latest';
    updateMap(currentScoreData, currentAttribute);
  });
}

// ── Site last updated ─────────────────────────────────────────

function updateSiteLastUpdated(scoreData) {
  const dates = Object.values(scoreData)
    .map(d => d.lastUpdated)
    .filter(Boolean)
    .sort();
  const latest = dates[dates.length - 1];
  const el = document.getElementById('site-last-updated');
  if (el) el.textContent = latest || '2024';
}

// ── Initial load ──────────────────────────────────────────────

async function initialLoad() {
  const scoreRows = await d3.csv("scores.csv", function (d) {
    return {
      country: d.Country,
      regulationStatus: +d['Regulation Status'] || null,
      policyLever: +d['Policy Lever'] || null,
      governanceType: +d['Governance Type'] || null,
      actorInvolvement: +d['Actor Involvement'] || null,
      averageScore: +d['Average Score'] || null,
      enforcementLevel: d['Enforcement Level'] ? +d['Enforcement Level'] : null,
      lastUpdated: d['Last Updated'] || null,
      dataVersion: +d['Data Version'] || 1
    };
  });

  const regulationRows = await d3.csv("regulation_data.csv", function (d) {
    return {
      country: d.Country,
      regulationStatus: d['Regulation Status'],
      policyLever: d['Policy Lever'],
      governanceType: d['Governance Type'],
      actorInvolvement: d['Actor Involvement'],
      enforcementLevel: d['Enforcement Level'] || null,
      specificLaws: d['Specific Laws'] || null,
      sources: d['Sources'] || null,
      lastUpdated: d['Last Updated'] || null,
      confidence: d['Confidence'] || null
    };
  });

  currentScoreData = Object.fromEntries(scoreRows.map(d => [d.country, d]));
  currentRegulationInfo = Object.fromEntries(regulationRows.map(d => [d.country, d]));

  const countriesList = scoreRows.map(d => d.country).sort();

  buildScoreSelector();
  initSearch(countriesList, currentScoreData, currentRegulationInfo);
  initFilter(currentScoreData);

  await generateMap(currentScoreData, 'averageScore', currentRegulationInfo);

  updateSiteLastUpdated(currentScoreData);

  // Load history non-blocking — shows timeline slider if >1 date exists
  loadHistory().then(history => initTimeline(history));
}

initialLoad();
