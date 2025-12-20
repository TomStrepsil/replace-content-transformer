#!/usr/bin/env -S node --experimental-strip-types

/**
 * Visualise harness comparison results
 *
 * Can generate:
 * 1. Terminal charts comparing harnesses for a single run
 * 2. HTML charts for single run comparison
 * 3. Time-series charts tracking performance across multiple runs
 *
 * Usage:
 *   # Single run terminal chart
 *   node --experimental-strip-types test/benchmarks/algorithm/visualise-results.ts results/comparison-2025-11-07.json
 *
 *   # Generate HTML chart
 *   node --experimental-strip-types test/benchmarks/algorithm/visualise-results.ts results/comparison-2025-11-07.json --html > chart.html
 *
 *   # Time-series comparison (multiple files)
 *   node --experimental-strip-types test/benchmarks/algorithm/visualise-results.ts results/*.json --timeseries --html > trends.html
 */

import { readFile } from "node:fs/promises";

interface SuccinctRun {
  harness: string;
  avg: number;
  min: number;
  max: number;
  p75: number;
  p99: number;
}

interface SuccinctScenario {
  scenario: string;
  runs: SuccinctRun[];
  winner: string;
}

interface SuccinctResult {
  timestamp: string;
  context: {
    cpu: string;
    arch: string;
    runtime: string;
  };
  scenarios: SuccinctScenario[];
}

// Terminal colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m"
};

// Format nanoseconds to human-readable
function formatNs(ns: number): string {
  if (ns >= 1_000_000) {
    return `${(ns / 1_000_000).toFixed(2)} ms`;
  } else if (ns >= 1_000) {
    return `${(ns / 1_000).toFixed(2)} µs`;
  } else {
    return `${ns.toFixed(2)} ns`;
  }
}

// Create a simple horizontal bar chart
function createBarChart(
  value: number,
  maxValue: number,
  width: number = 40
): string {
  const barLength = Math.round((value / maxValue) * width);
  const bar = "█".repeat(barLength);
  const empty = "░".repeat(width - barLength);
  return bar + empty;
}

// Generate terminal visualization for a single run
function visualiseTerminal(result: SuccinctResult): void {
  console.log(`${colors.bright}📊 Harness Comparison Results${colors.reset}`);
  console.log(
    `${colors.dim}Timestamp: ${new Date(result.timestamp).toLocaleString()}${
      colors.reset
    }`
  );
  console.log(
    `${colors.dim}System: ${result.context.cpu} (${result.context.arch})${colors.reset}`
  );
  console.log(
    `${colors.dim}Runtime: ${result.context.runtime}${colors.reset}\n`
  );

  // Get unique harness names
  const harnessNames = Array.from(
    new Set(result.scenarios.flatMap((s) => s.runs.map((r) => r.harness)))
  );

  // Calculate wins per harness
  const wins = new Map<string, number>();
  harnessNames.forEach((h) => wins.set(h, 0));
  result.scenarios.forEach((scenario) => {
    const count = wins.get(scenario.winner) || 0;
    wins.set(scenario.winner, count + 1);
  });

  console.log(`${colors.bright}Overall Winners:${colors.reset}`);
  const sortedWins = Array.from(wins.entries()).sort((a, b) => b[1] - a[1]);
  sortedWins.forEach(([harness, count]) => {
    const percentage = ((count / result.scenarios.length) * 100).toFixed(1);
    console.log(
      `  ${colors.green}🏆${colors.reset} ${harness.padEnd(
        15
      )} ${count} wins (${percentage}%)`
    );
  });

  console.log(
    `\n${colors.bright}Per-Scenario Performance (avg time):${colors.reset}\n`
  );

  // Display each scenario
  result.scenarios.forEach((scenario, idx) => {
    console.log(
      `${colors.cyan}${idx + 1}. ${scenario.scenario}${colors.reset}`
    );

    // Find max value for scaling bars
    const maxAvg = Math.max(...scenario.runs.map((r) => r.avg));

    // Calculate the maximum name length for alignment
    const maxNameLength = Math.max(...harnessNames.map((h) => h.length));

    scenario.runs.forEach((run) => {
      const isWinner = run.harness === scenario.winner;
      const bar = createBarChart(run.avg, maxAvg, 30);
      const winnerMark = isWinner ? `${colors.yellow}★${colors.reset}` : " ";

      // Pad the name to maxNameLength to ensure bars align
      const paddedName = run.harness.padEnd(maxNameLength);

      console.log(
        `  ${winnerMark} ${paddedName} ${bar} ${colors.dim}${formatNs(
          run.avg
        )}${colors.reset}`
      );
    });
    console.log();
  });
}

// Generate HTML visualization for a single run
function generateHtmlSingle(result: SuccinctResult): string {
  const harnessNames = Array.from(
    new Set(result.scenarios.flatMap((s) => s.runs.map((r) => r.harness)))
  );

  // Separate setup cost from runtime scenarios
  const setupScenario = result.scenarios.find((s) =>
    s.scenario.toLowerCase().includes("setup cost")
  );
  const runtimeScenarios = result.scenarios.filter(
    (s) => !s.scenario.toLowerCase().includes("setup cost")
  );

  const colors = [
    "rgb(31,119,180)", // Blue
    "rgb(255,127,14)", // Orange
    "rgb(44,160,44)", // Green
    "rgb(214,39,40)", // Red
    "rgb(148,103,189)", // Purple
    "rgb(140,86,75)", // Brown
    "rgb(227,119,194)", // Pink
    "rgb(127,127,127)", // Grey
    "rgb(188,189,34)", // Olive
    "rgb(23,190,207)", // Cyan
    "rgb(0,114,178)", // Dark Blue
    "rgb(255,215,0)", // Gold
    "rgb(0,153,136)", // Teal
    "rgb(170,51,119)" // Deep Magenta
  ];

  // Prepare data for Chart.js - Runtime scenarios
  const scenarios = runtimeScenarios.map((s) => s.scenario);
  const datasets = harnessNames.map((harness, idx) => {
    return {
      label: harness,
      data: runtimeScenarios.map((scenario) => {
        const run = scenario.runs.find((r) => r.harness === harness);
        return run ? run.avg : null;
      }),
      backgroundColor: colors[idx % colors.length],
      borderColor: colors[idx % colors.length],
      borderWidth: 2
    };
  });

  // Prepare setup cost data
  const setupDatasets = setupScenario
    ? harnessNames.map((harness, idx) => {
        const run = setupScenario.runs.find((r) => r.harness === harness);
        return {
          label: harness,
          data: [run ? run.avg : null],
          backgroundColor: colors[idx % colors.length],
          borderColor: colors[idx % colors.length],
          borderWidth: 2
        };
      })
    : [];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Harness Comparison - ${new Date(
    result.timestamp
  ).toLocaleDateString()}</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 1600px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { margin: 0 0 10px 0; color: #333; }
    .meta { color: #666; font-size: 14px; }
    .controls {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .controls h2 {
      margin-top: 0;
      color: #333;
      font-size: 18px;
    }
    .strategy-toggles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }
    .strategy-toggle {
      display: flex;
      align-items: center;
      padding: 8px;
      background: #f9f9f9;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .strategy-toggle:hover {
      background: #f0f0f0;
    }
    .strategy-toggle input[type="checkbox"] {
      margin-right: 8px;
      cursor: pointer;
    }
    .strategy-toggle label {
      cursor: pointer;
      user-select: none;
      flex: 1;
      display: flex;
      align-items: center;
    }
    .color-indicator {
      width: 16px;
      height: 16px;
      border-radius: 3px;
      margin-right: 8px;
      border: 1px solid rgba(0,0,0,0.1);
    }
    .chart-container {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .chart-container h2 {
      margin-top: 0;
      color: #333;
    }
    canvas {
      max-height: 500px;
    }
    .winners {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .winner-item {
      display: flex;
      align-items: center;
      margin: 10px 0;
      padding: 10px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .winner-item .trophy { font-size: 24px; margin-right: 10px; }
    .winner-item .name { flex: 1; font-weight: 600; }
    .winner-item .count { color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 Harness Comparison Results</h1>
    <div class="meta">
      <strong>Timestamp:</strong> ${new Date(
        result.timestamp
      ).toLocaleString()}<br>
      <strong>System:</strong> ${result.context.cpu} (${
    result.context.arch
  })<br>
      <strong>Runtime:</strong> ${result.context.runtime}
    </div>
  </div>

  <div class="controls">
    <h2>Strategy Selection</h2>
    <div class="strategy-toggles" id="strategyToggles"></div>
  </div>

  ${
    setupScenario
      ? `<div class="chart-container">
    <h2>Setup Cost: Strategy + Transformer Creation (lower is better)</h2>
    <canvas id="setupChart" style="max-height: 300px;"></canvas>
  </div>`
      : ""
  }

  <div class="chart-container">
    <h2>Runtime Performance by Scenario (lower is better)</h2>
    <canvas id="scenarioChart"></canvas>
  </div>

  <div class="winners">
    <h2>Winner Summary</h2>
    <div id="winnerSummary">${generateWinnerSummaryHtml(result)}</div>
  </div>

  <script type="module">
    import { Chart, registerables } from 'https://esm.sh/chart.js@4.4.0';
    Chart.register(...registerables);

    const allDatasets = ${JSON.stringify(datasets)};
    const scenarios = ${JSON.stringify(scenarios)};
    const setupDatasets = ${JSON.stringify(setupDatasets)};
    const hasSetupData = ${!!setupScenario};
    
    // Setup cost chart (if available)
    let setupChart;
    if (hasSetupData) {
      const setupCtx = document.getElementById('setupChart');
      setupChart = new Chart(setupCtx, {
        type: 'bar',
        data: {
          labels: ['Setup Cost'],
          datasets: setupDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: false
            },
            legend: {
              display: true,
              position: 'bottom'
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  const value = context.parsed.y;
                  if (value >= 1000000) {
                    label += (value / 1000000).toFixed(2) + ' ms';
                  } else if (value >= 1000) {
                    label += (value / 1000).toFixed(2) + ' µs';
                  } else {
                    label += value.toFixed(2) + ' ns';
                  }
                  return label;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Average Time (nanoseconds)'
              }
            }
          }
        }
      });
    }
    
    // Runtime scenarios chart
    const ctx = document.getElementById('scenarioChart');
    let chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: scenarios,
        datasets: allDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                const value = context.parsed.y;
                if (value >= 1000000) {
                  label += (value / 1000000).toFixed(2) + ' ms';
                } else if (value >= 1000) {
                  label += (value / 1000).toFixed(2) + ' µs';
                } else {
                  label += value.toFixed(2) + ' ns';
                }
                return label;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Average Time (nanoseconds)'
            }
          },
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    });

    // Create strategy toggles
    const togglesContainer = document.getElementById('strategyToggles');
    allDatasets.forEach((dataset, index) => {
      const div = document.createElement('div');
      div.className = 'strategy-toggle';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'strategy-' + index;
      checkbox.checked = true;
      checkbox.addEventListener('change', updateChart);
      
      const label = document.createElement('label');
      label.htmlFor = 'strategy-' + index;
      
      const colorIndicator = document.createElement('span');
      colorIndicator.className = 'color-indicator';
      colorIndicator.style.backgroundColor = dataset.backgroundColor;
      
      const text = document.createTextNode(dataset.label);
      
      label.appendChild(colorIndicator);
      label.appendChild(text);
      div.appendChild(checkbox);
      div.appendChild(label);
      
      togglesContainer.appendChild(div);
    });

    function updateChart() {
      const activeDatasets = [];
      const activeSetupDatasets = [];
      const activeHarnesses = [];
      const checkboxes = document.querySelectorAll('#strategyToggles input[type="checkbox"]');
      
      checkboxes.forEach((checkbox, index) => {
        if (checkbox.checked) {
          activeDatasets.push(allDatasets[index]);
          if (hasSetupData) {
            activeSetupDatasets.push(setupDatasets[index]);
          }
          activeHarnesses.push(allDatasets[index].label);
        }
      });

      // Calculate max value from active datasets for proper y-axis scaling
      let maxValue = 0;
      activeDatasets.forEach(dataset => {
        dataset.data.forEach(value => {
          if (value !== null && value > maxValue) {
            maxValue = value;
          }
        });
      });

      // Update runtime chart data
      chart.data.datasets = activeDatasets;
      
      // Update y-axis max to fit only selected strategies
      if (maxValue > 0) {
        chart.options.scales.y.max = maxValue * 1.1; // Add 10% padding
      } else {
        delete chart.options.scales.y.max; // Reset to auto
      }
      
      chart.update();

      // Update setup chart if it exists
      if (hasSetupData && typeof setupChart !== 'undefined') {
        setupChart.data.datasets = activeSetupDatasets;
        setupChart.update();
      }

      // Update winner summary
      updateWinnerSummary(activeHarnesses);
    }

    function updateWinnerSummary(activeHarnesses) {
      if (activeHarnesses.length === 0) {
        document.getElementById('winnerSummary').innerHTML = '<p style="color: #999; text-align: center;">Select strategies to see winners</p>';
        return;
      }

      const allScenarios = ${JSON.stringify(result.scenarios)};
      
      // Calculate wins for active harnesses only
      const wins = new Map();
      activeHarnesses.forEach(h => wins.set(h, 0));
      
      allScenarios.forEach(scenario => {
        // Find the winner among active harnesses for this scenario
        let winner = null;
        let minAvg = Infinity;
        
        scenario.runs.forEach(run => {
          if (activeHarnesses.includes(run.harness) && run.avg < minAvg) {
            minAvg = run.avg;
            winner = run.harness;
          }
        });
        
        if (winner && wins.has(winner)) {
          wins.set(winner, wins.get(winner) + 1);
        }
      });

      // Sort by wins (descending), then alphabetically
      const sortedWins = Array.from(wins.entries())
        .sort((a, b) => {
          if (b[1] !== a[1]) {
            return b[1] - a[1]; // Sort by wins descending
          }
          return a[0].localeCompare(b[0]); // Then alphabetically
        });

      // Generate HTML
      const summaryHtml = sortedWins.map(([harness, count]) => {
        const percentage = ((count / allScenarios.length) * 100).toFixed(1);
        return \`
          <div class="winner-item">
            <span class="trophy">🏆</span>
            <span class="name">\${harness}</span>
            <span class="count">\${count} wins (\${percentage}%)</span>
          </div>
        \`;
      }).join('');

      document.getElementById('winnerSummary').innerHTML = summaryHtml;
    }

    function selectAll() {
      const checkboxes = document.querySelectorAll('#strategyToggles input[type="checkbox"]');
      checkboxes.forEach(cb => cb.checked = true);
      updateChart();
    }

    function deselectAll() {
      const checkboxes = document.querySelectorAll('#strategyToggles input[type="checkbox"]');
      checkboxes.forEach(cb => cb.checked = false);
      updateChart();
    }

    function selectOnlyCallbacks() {
      const checkboxes = document.querySelectorAll('#strategyToggles input[type="checkbox"]');
      checkboxes.forEach((cb, index) => {
        const label = allDatasets[index].label;
        cb.checked = label.includes('Callback');
      });
      updateChart();
    }

    function selectOnlyGenerators() {
      const checkboxes = document.querySelectorAll('#strategyToggles input[type="checkbox"]');
      checkboxes.forEach((cb, index) => {
        const label = allDatasets[index].label;
        cb.checked = !label.includes('Callback');
      });
      updateChart();
    }
  </script>
</body>
</html>`;
}

// Generate winner summary HTML
function generateWinnerSummaryHtml(result: SuccinctResult): string {
  const harnessNames = Array.from(
    new Set(result.scenarios.flatMap((s) => s.runs.map((r) => r.harness)))
  );

  // Exclude setup cost from winner count
  const runtimeScenarios = result.scenarios.filter(
    (s) => !s.scenario.toLowerCase().includes("setup cost")
  );

  const wins = new Map<string, number>();
  harnessNames.forEach((h) => wins.set(h, 0));
  runtimeScenarios.forEach((scenario) => {
    const count = wins.get(scenario.winner) || 0;
    wins.set(scenario.winner, count + 1);
  });

  const sortedWins = Array.from(wins.entries()).sort((a, b) => b[1] - a[1]);

  return sortedWins
    .map(([harness, count]) => {
      const percentage = ((count / runtimeScenarios.length) * 100).toFixed(1);
      return `
      <div class="winner-item">
        <span class="trophy">🏆</span>
        <span class="name">${harness}</span>
        <span class="count">${count} wins (${percentage}%)</span>
      </div>
    `;
    })
    .join("");
}

// Generate HTML time-series visualization
function generateHtmlTimeseries(results: SuccinctResult[]): string {
  // Sort by timestamp
  results.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Get unique harness names
  const harnessNames = Array.from(
    new Set(
      results.flatMap((r) =>
        r.scenarios.flatMap((s) => s.runs.map((run) => run.harness))
      )
    )
  );

  // Get unique scenario names (use first result as reference)
  const scenarioNames = results[0]?.scenarios.map((s) => s.scenario) || [];

  // Prepare datasets for each scenario
  const chartHtmls = scenarioNames
    .map((scenarioName, scenarioIdx) => {
      const datasets = harnessNames.map((harness, idx) => {
        const colors = [
          "rgb(75, 192, 192)", // Teal
          "rgb(255, 99, 132)", // Red
          "rgb(54, 162, 235)", // Blue
          "rgb(255, 159, 64)", // Orange
          "rgb(153, 102, 255)", // Purple
          "rgb(255, 205, 86)", // Yellow
          "rgb(201, 203, 207)", // Grey
          "rgb(255, 99, 71)", // Tomato
          "rgb(46, 204, 113)", // Emerald
          "rgb(52, 152, 219)", // Peter River
          "rgb(155, 89, 182)", // Amethyst
          "rgb(241, 196, 15)" // Sun Flower
        ];

        return {
          label: harness,
          data: results.map((result) => {
            const scenario = result.scenarios.find(
              (s) => s.scenario === scenarioName
            );
            const run = scenario?.runs.find((r) => r.harness === harness);
            return run ? run.avg : null;
          }),
          borderColor: colors[idx % colors.length],
          backgroundColor: colors[idx % colors.length] + "33",
          tension: 0.3,
          fill: false
        };
      });

      const labels = results.map((r) =>
        new Date(r.timestamp).toLocaleDateString()
      );

      return `
      <div class="chart-container">
        <h2>${scenarioName}</h2>
        <canvas id="chart${scenarioIdx}"></canvas>
      </div>
      <script type="module">
        import { Chart, registerables } from 'https://esm.sh/chart.js@4.4.0';
        Chart.register(...registerables);

        new Chart(document.getElementById('chart${scenarioIdx}'), {
          type: 'line',
          data: {
            labels: ${JSON.stringify(labels)},
            datasets: ${JSON.stringify(datasets)}
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              tooltip: {
                callbacks: {
                  label: function(context) {
                    let label = context.dataset.label || '';
                    if (label) {
                      label += ': ';
                    }
                    const value = context.parsed.y;
                    if (value >= 1000000) {
                      label += (value / 1000000).toFixed(2) + ' ms';
                    } else if (value >= 1000) {
                      label += (value / 1000).toFixed(2) + ' µs';
                    } else {
                      label += value.toFixed(2) + ' ns';
                    }
                    return label;
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Average Time (nanoseconds)'
                }
              }
            }
          }
        });
      </script>
    `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Harness Performance Trends</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { margin: 0 0 10px 0; color: #333; }
    .meta { color: #666; font-size: 14px; }
    .chart-container {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .chart-container h2 {
      margin-top: 0;
      color: #333;
      font-size: 18px;
    }
    canvas {
      max-height: 400px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📈 Harness Performance Trends</h1>
    <div class="meta">
      <strong>Runs analyzed:</strong> ${results.length}<br>
      <strong>Date range:</strong> ${new Date(
        results[0].timestamp
      ).toLocaleDateString()} - ${new Date(
    results[results.length - 1].timestamp
  ).toLocaleDateString()}<br>
      <strong>Scenarios tracked:</strong> ${scenarioNames.length}
    </div>
  </div>

  ${chartHtmls}
</body>
</html>`;
}

// Main function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log(`
Usage:
  # Terminal visualization (single run)
  node --experimental-strip-types test/benchmarks/algorithm/visualise-results.ts <file.json>

  # HTML chart (single run)
  node --experimental-strip-types test/benchmarks/algorithm/visualise-results.ts <file.json> --html > chart.html

  # Time-series trends (multiple runs)
  node --experimental-strip-types test/benchmarks/algorithm/visualise-results.ts results/*.json --timeseries --html > trends.html
    `);
    process.exit(0);
  }

  const isTimeseries = args.includes("--timeseries");
  const isHtml = args.includes("--html");
  const files = args.filter((arg) => !arg.startsWith("--"));

  if (files.length === 0) {
    console.error("Error: No input files specified");
    process.exit(1);
  }

  // Load results
  const results: SuccinctResult[] = [];
  for (const file of files) {
    try {
      const content = await readFile(file, "utf-8");
      const result = JSON.parse(content) as SuccinctResult;
      results.push(result);
    } catch (error) {
      console.error(`Error reading ${file}:`, (error as Error).message);
    }
  }

  if (results.length === 0) {
    console.error("Error: No valid result files found");
    process.exit(1);
  }

  // Generate visualization
  if (isTimeseries) {
    if (isHtml) {
      console.log(generateHtmlTimeseries(results));
    } else {
      console.error("Time-series visualization only supports --html output");
      process.exit(1);
    }
  } else {
    // Single run
    if (results.length > 1) {
      console.error(
        "Warning: Multiple files provided but --timeseries not specified. Using first file only."
      );
    }

    if (isHtml) {
      console.log(generateHtmlSingle(results[0]));
    } else {
      visualiseTerminal(results[0]);
    }
  }
}

main().catch(console.error);
