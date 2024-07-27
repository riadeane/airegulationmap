const WIDTH = 1000;
const HEIGHT = 500;
const margin = {
    top: 15,
    bottom: 15,
    left: 5,
    right: 5
};

const width = WIDTH - margin.left - margin.right,
height = HEIGHT - margin.top - margin.bottom;  
 
const generateMap = async (countryData, scoreAttribute) => {
    
    const svg = d3.select("#map")
    .append("svg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, WIDTH, HEIGHT]);

    const g = svg.append("g")
      .attr('transform', `translate(${margin.left}, ${margin.top})`)

    // Modified projection to fit wider rectangular shape
    const projection = d3.geoEquirectangular()
      .fitSize([width, height], {type: "Sphere"});

    const path = d3.geoPath().projection(projection);

    const colorScale = d3.scaleSequential(d3.interpolate("lightgrey", "green"))
        .domain([1, 5]);

    // Create a tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    // Load and display the world map
    const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    const countries = topojson.feature(world, world.objects.countries).features;

    g.append("path")
        .datum({type: "Sphere"})
        .attr("fill", "#dcf4f7")
        .attr("d", path)
        .attr('class', 'map-group');

    g.selectAll(".country")
        .data(countries)
        .enter().append("path")
        .attr("class", "country")
        .attr("d", path)
        .attr("fill", d => {
            const countryName = d.properties.name;
            return countryData[countryName] ? colorScale(countryData[countryName][scoreAttribute]) : "#ccc";
        })
        .on("mouseover", function(event, d) {
          const countryName = d.properties.name;
          const score = countryData[countryName] ? countryData[countryName][scoreAttribute] : "N/A";
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
        });
}

const updateMap = (countryData, scoreAttribute) => {
    const colorScale = d3.scaleSequential(d3.interpolate("lightgrey", "green"))
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

async function initialLoad() {
  const data = await d3.csv("scores.csv", function (d) {
    return {
      country: d.Country,
      regulationStatus: +d['Regulation Status'],
      policyLever: +d['Policy Lever'],
      governanceType: +d['Governance Type'],
      actorInvolvement: +d['Actor Involvement'],
      averageScore: +d['Average Score']
    }
  });

  const countries = Object.fromEntries(data.map(d => [d.country, d]));

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
  generateMap(countries, 'averageScore');
}

initialLoad();