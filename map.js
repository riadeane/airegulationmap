const WIDTH = 1000;
const HEIGHT = 500;
 
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

    // Modified projection to fit wider rectangular shape
    const projection = d3.geoEquirectangular()
      .fitSize([WIDTH, HEIGHT], {type: "Sphere"});

    const path = d3.geoPath().projection(projection);

    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
        .domain([1, 5]);

    // Create a tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    // Load and display the world map
    const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    const countries = topojson.feature(world, world.objects.countries).features;

    const mapGroup = g.append("g")
    .attr('class', 'map-group');

mapGroup.append("path")
    .datum({type: "Sphere"})
    .attr("fill", "#dcf4f7")
    .attr("d", path);

mapGroup.selectAll(".country")
    .data(countries)
    .enter().append("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", d => {
        const countryName = d.properties.name;
        return scoreData[countryName] ? colorScale(scoreData[countryName][scoreAttribute]) : "#ccc";
    })
    .on("mouseover", function(event, d) {
      const countryName = d.properties.name;
      const score = scoreData[countryName] ? scoreData[countryName][scoreAttribute] : "N/A";
      tooltip.transition()
          .duration(200)
          .style("opacity", .9);
      tooltip.html(`${countryName}: ${score}`)
          .style("left", (event.pageX) + "px")
          .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseout", function(d) {
        tooltip.transition()
            .duration(500)
            .style("opacity", 0);
    })
    .on("click", function(event, d) {
        const countryName = d.properties.name;
        updateCountryData(countryName, scoreData, regulationData);
        highlightCountry(this);
    });

    // Add zoom and pan functionality
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .extent([[0, 0], [WIDTH, HEIGHT]])
      .translateExtent([[0, 0], [WIDTH, HEIGHT]])
      .on("zoom", zoomed);

    svg.call(zoom);

    function zoomed(event) {
        mapGroup.attr("transform", event.transform);
    }

    // Add zoom controls
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
}

const updateMap = (countryData, scoreAttribute) => {
    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
    .domain([1, 5]);

    d3.select("#map")
        .selectAll(".country")
        .transition()
        .duration(500)
        .attr("fill", d => {
            const countryName = d.properties.name;
            return countryData[countryName] ? colorScale(countryData[countryName][scoreAttribute]) : "#ccc";
        });
}

function updateCountryData(countryName, countryData, regulationData) {
    const scoreData = countryData[countryName];
    const regData = regulationData[countryName];

    console.log('Updating country data:', countryName, scoreData, regData);
    
    document.getElementById("country-name").textContent = countryName;
    
    if (scoreData) {
        document.getElementById("regulation").textContent = scoreData.regulationStatus;
        document.getElementById("policy").textContent = scoreData.policyLever;
        document.getElementById("governance").textContent = scoreData.governanceType;
        document.getElementById("actors").textContent = scoreData.actorInvolvement;
    } else {
        document.getElementById("regulation").textContent = "N/A";
        document.getElementById("policy").textContent = "N/A";
        document.getElementById("governance").textContent = "N/A";
        document.getElementById("actors").textContent = "N/A";
    }
    
    if (regData) {
        document.getElementById("regulation-details").textContent = regData.regulationStatus || "N/A";
        document.getElementById("policy-details").textContent = regData.policyLever || "N/A";
        document.getElementById("governance-details").textContent = regData.governanceType || "N/A";
        document.getElementById("actors-details").textContent = regData.actorInvolvement || "N/A";
    } else {
        document.getElementById("regulation-details").textContent = "N/A";
        document.getElementById("policy-details").textContent = "N/A";
        document.getElementById("governance-details").textContent = "N/A";
        document.getElementById("actors-details").textContent = "N/A";
    }
}

function highlightCountry(element) {
    // Remove highlight from previously selected country
    d3.selectAll(".country").classed("selected", false).attr("stroke", "#fff").attr("stroke-width", 0.5);
    
    // Highlight the clicked country
    d3.select(element).classed("selected", true).attr("stroke", "red").attr("stroke-width", 2);
}

async function initialLoad() {
  const scoreData = await d3.csv("scores.csv", function (d) {
    return {
      country: d.Country,
      regulationStatus: +d['Regulation Status'],
      policyLever: +d['Policy Lever'],
      governanceType: +d['Governance Type'],
      actorInvolvement: +d['Actor Involvement'],
      averageScore: +d['Average Score']
    }
  });

  const regulationData = await d3.csv("regulation_data.csv", function (d) {
    return {
      country: d.Country,
      regulationStatus: d['Regulation Status'],
      policyLever: d['Policy Lever'],
      governanceType: d['Governance Type'],
      actorInvolvement: d['Actor Involvement'],
    }
  });

  const countries = Object.fromEntries(scoreData.map(d => [d.country, d]));
  const regulationInfo = Object.fromEntries(regulationData.map(d => [d.country, d]));



  // Create the select element
  const inputContainer = d3.select("#input-container");

  const scoreSelector = inputContainer.append("select")
    .attr("id", "score-select");

  // Add options to the select element
  const options = [
    {value: "averageScore", text: "Average Score"},
    {value: "regulationStatus", text: "Regulation Status"},
    {value: "policyLever", text: "Policy Lever"},
    {value: "governanceType", text: "Governance Type"},
    {value: "actorInvolvement", text: "Actor Involvement"}
  ];

  scoreSelector.selectAll("option")
    .data(options)
    .enter()
    .append("option")
    .attr("value", d => d.value)
    .text(d => d.text);

  // Set up the onChange event listener
  scoreSelector.on("change", function() {
    const selectedScore = d3.select(this).property("value");
    updateMap(countries, selectedScore);
  });

  // Initial map generation
  generateMap(countries, 'averageScore', regulationInfo);
}

initialLoad();