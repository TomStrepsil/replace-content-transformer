import { bench, group, run } from "mitata";
import * as harnesses from "../../harnesses/index.ts";
import type { BaseHarness } from "../../harnesses/types.ts";

function createMockController(outputs: string[]) {
  return {
    enqueue: (chunk: string) => {
      outputs.push(chunk);
    },
    desiredSize: null,
    error: () => {},
    terminate: () => {}
  };
}

interface BenchmarkScenario {
  name: string;
  description: string;
  chunks: string[];
  tokens: string[];
  replacement: (match: string) => string;
  expectedMatches: number;
  validate?: (result: string) => boolean;
}

const scenarios: BenchmarkScenario[] = [
  {
    name: "Single chunk, multiple patterns",
    description:
      "Two anchor sequences in a single chunk - baseline performance",
    chunks: ["Hello {{name}}! Welcome to {{place}}."],
    tokens: ["{{", "}}"],
    replacement: (match: string) => (match === "{{name}}" ? "World" : "Earth"),
    expectedMatches: 2,
    validate: (result) => result === "Hello World! Welcome to Earth."
  },
  {
    name: "Cross-chunk boundary (50/50 split)",
    description: "Pattern split exactly in half across chunks",
    chunks: ["Hello {{na", "me}}! Welcome."],
    tokens: ["{{", "}}"],
    replacement: () => "World",
    expectedMatches: 1,
    validate: (result) => result === "Hello World! Welcome."
  },
  {
    name: "Multiple cross-chunk boundaries",
    description: "Three patterns split at different positions",
    chunks: ["{{na", "me}} and {{pla", "ce}} and {{thi", "ng}}"],
    tokens: ["{{", "}}"],
    replacement: (match: string) => match.slice(2, -2).toUpperCase(),
    expectedMatches: 3,
    validate: (result) => result === "NAME and PLACE and THING"
  },
  {
    name: "No matches (10 chunks)",
    description: "Fast-path test with no pattern matches",
    chunks: Array.from(
      { length: 10 },
      (_, i) => `chunk ${i + 1} with no pattern matches`
    ),
    tokens: ["{{", "}}"],
    replacement: () => "REPLACED",
    expectedMatches: 0
  },
  {
    name: "High match density (3 chunks, 3 per chunk)",
    description: "High match density to test match processing efficiency",
    chunks: Array.from(
      { length: 3 },
      (_, i) => `{{a}}{{b}}{{c}} in chunk ${i + 1}`
    ),
    tokens: ["{{", "}}"],
    replacement: () => "X",
    expectedMatches: 9
  },
  {
    name: "Consecutive patterns (no gap)",
    description: "Three consecutive anchor sequences with no text between",
    chunks: ["{{first}}{{second}}{{third}}"],
    tokens: ["{{", "}}"],
    replacement: (match: string) => match.slice(2, -2).toUpperCase(),
    expectedMatches: 3,
    validate: (result) => result === "FIRSTSECONDTHIRD"
  },
  {
    name: "Long content between anchors",
    description: "100 characters between anchor tokens",
    chunks: [`Before {{"${"a".repeat(100)}"}} after`],
    tokens: ["{{", "}}"],
    replacement: () => "REPLACED",
    expectedMatches: 1,
    validate: (result) => result === "Before REPLACED after"
  },
  {
    name: "Large chunks (~200 bytes each, 3 chunks)",
    description: "Test string concatenation overhead with large chunks",
    chunks: (() => {
      const baseText = "x".repeat(50) + "{{match}}" + "y".repeat(50);
      const largeChunk = baseText.repeat(2); // ~200 bytes
      return Array.from({ length: 3 }, () => largeChunk);
    })(),
    tokens: ["{{", "}}"],
    replacement: () => "FOUND",
    expectedMatches: 6
  },
  {
    name: "Pathological: Repeated prefix cross-chunk",
    description:
      "Many '{' characters with pattern split across chunks - tests backtracking",
    chunks: [
      "{ { { { { { { { { { {{ma",
      "tch}} { { { { { { { { { { {{ano",
      "ther}}"
    ],
    tokens: ["{{", "}}"],
    replacement: () => "X",
    expectedMatches: 2,
    validate: (result) =>
      result === "{ { { { { { { { { { X { { { { { { { { { { X"
  },
  {
    name: "Pathological: All-same-char tokens cross-chunk",
    description:
      "Worst case for naive search - repeated chars split across chunks",
    chunks: ["start aaaaa", "aaaaa{VAL", "UE}aaaaa", "aaaaa end"],
    tokens: ["aaaaaaaaaa{", "}aaaaaaaaaa"],
    replacement: (match) => `[${match.slice(11, -11)}]`,
    expectedMatches: 1,
    validate: (result) => result === "start [VALUE] end"
  },
  {
    name: "Pathological: Repetitive prefix tokens cross-chunk",
    description: "Long tokens with repeated chars split across boundaries",
    chunks: ["start {{{", "{{FIRST", "}}}}} middle {{{{{SEC", "OND}}}}} end"],
    tokens: ["{{{{{", "}}}}}"],
    replacement: (match) => match.slice(5, -5).toLowerCase(),
    expectedMatches: 2,
    validate: (result) => result === "start first middle second end"
  },
  {
    name: "HTML template with cross-chunk boundaries",
    description: "Realistic HTML template with pattern spanning chunks",
    chunks: [
      "<div>{{user.name}}</div>",
      "<span>Email: {{user.em",
      "ail}}</span>",
      "<p>{{user.bio}}</p>"
    ],
    tokens: ["{{", "}}"],
    replacement: (match: string) => {
      const userData: Record<string, string> = {
        "user.name": "Alice",
        "user.email": "alice@example.com",
        "user.bio": "Software Engineer"
      };
      const key = match.slice(2, -2);
      return userData[key] || "";
    },
    expectedMatches: 3,
    validate: (result) =>
      result ===
      "<div>Alice</div><span>Email: alice@example.com</span><p>Software Engineer</p>"
  },
  {
    name: "Markdown with code blocks",
    description: "Markdown backticks create noise similar to anchor characters",
    chunks: [
      "# Title\n\n```javascript\nconst x = {{value}};\n```\n\nThe value is `{{display}}`."
    ],
    tokens: ["{{", "}}"],
    replacement: (match) => (match === "{{value}}" ? "42" : "shown"),
    expectedMatches: 2,
    validate: (result) =>
      result ===
      "# Title\n\n```javascript\nconst x = 42;\n```\n\nThe value is `shown`."
  },
  {
    name: "Bash script with $ and braces",
    description:
      "Shell scripts mix $, {}, and anchor sequences creating false starts",
    chunks: ['#!/bin/bash\nNAME="{{name}}"\necho "${NAME} says {{message}}"'],
    tokens: ["{{", "}}"],
    replacement: (match) => (match === "{{name}}" ? "Alice" : "hello"),
    expectedMatches: 2,
    validate: (result) =>
      result === '#!/bin/bash\nNAME="Alice"\necho "${NAME} says hello"'
  },
  {
    name: "EJS template (multiple delimiter types)",
    description:
      "EJS uses <% %>, <%= %>, <%- %> creating complex pattern matching",
    chunks: [
      "<% if (user) { %>",
      "  <p>Name: <%= user.na",
      "me %></p>",
      "  <p>Bio: <%- user.bio %></p>",
      "<% } %>"
    ],
    tokens: ["<%= ", " %>"],
    replacement: (match) => {
      const inner = match.slice(4, -3);
      if (inner === "user.name") return "Alice";
      return "???";
    },
    expectedMatches: 1,
    validate: (result) =>
      result.includes("<p>Name: Alice</p>") &&
      result.includes("<%- user.bio %>")
  },
  {
    name: "MediaWiki template (triple braces)",
    description:
      "MediaWiki uses {{template}} and {{{param}}} - triple braces create unique challenges",
    chunks: [
      "{{Infobox|name={{{na",
      "me}}}|title={{{ti",
      "tle}}}}}",
      "Text with {{template}} reference."
    ],
    tokens: ["{{{", "}}}"],
    replacement: (match) => {
      const inner = match.slice(3, -3);
      if (inner === "name") return "Alice";
      if (inner === "title") return "Engineer";
      return "???";
    },
    expectedMatches: 2,
    validate: (result) =>
      result.includes("name=Alice") && result.includes("title=Engineer")
  },
  {
    name: "XSLT attribute value template",
    description:
      "XSLT uses {} within XML attributes - unique single-char delimiters in attribute context",
    chunks: [
      '<a href="{li',
      'nk}" title="{tit',
      'le}">{text}</a>',
      '<img src="{image}" alt="{alt}"/>'
    ],
    tokens: ["{", "}"],
    replacement: (match) => {
      const values: Record<string, string> = {
        "{link}": "/page",
        "{title}": "Click here",
        "{text}": "Link",
        "{image}": "/img.png",
        "{alt}": "Image"
      };
      return values[match] || "???";
    },
    expectedMatches: 5,
    validate: (result) =>
      result.includes('href="/page"') &&
      result.includes('title="Click here"') &&
      result.includes(">Link</a>")
  },
  {
    name: "Medium tokens (7 chars) - V8 threshold",
    description:
      "Tokens at ~7 characters where V8 switches to Boyer-Moore-Horspool",
    chunks: [
      "Some text <|START|>content here<|END|> more text <|START|>another<|END|>"
    ],
    tokens: ["<|START|>", "<|END|>"],
    replacement: (match) =>
      match === "<|START|>content here<|END|>" ? "REPLACED1" : "REPLACED2",
    expectedMatches: 2
  },
  {
    name: "Long tokens (15 chars) cross-chunk",
    description:
      "JSP/Velocity-style long tokens split across chunks - tests buffering",
    chunks: [
      "Welcome <%=REQUEST_USER_NA",
      "ME%> to <%=REQUEST_APPLICATION_TI",
      "TLE%>!"
    ],
    tokens: ["<%=REQUEST_", "%>"],
    replacement: (match) => {
      if (match === "<%=REQUEST_USER_NAME%>") return "Alice";
      if (match === "<%=REQUEST_APPLICATION_TITLE%>") return "MyApp";
      return "UNKNOWN";
    },
    expectedMatches: 2,
    validate: (result) => result === "Welcome Alice to MyApp!"
  },
  {
    name: "Django/Jinja2 template tags",
    description: "Template tags with spaces - {% tag %} style delimiters",
    chunks: [
      "{% extends 'base.html' %} {% block content %}Hello {% user_display_name %}{% endblock %}"
    ],
    tokens: ["{% ", " %}"],
    replacement: (match) => {
      const inner = match.slice(3, -3);
      if (inner === "user_display_name") return "Alice";
      return `{${inner}}`;
    },
    expectedMatches: 4
  },
  {
    name: "Empty content between consecutive anchors",
    description: "Adjacent patterns with no characters between closers/openers",
    chunks: ["Before {{}}{{}}{{}} after"],
    tokens: ["{{", "}}"],
    replacement: () => "X",
    expectedMatches: 3,
    validate: (result) => result === "Before XXX after"
  },
  {
    name: "Single character between patterns",
    description: "Minimal non-match content between anchor sequences",
    chunks: ["{{a}}x{{b}}y{{c}}"],
    tokens: ["{{", "}}"],
    replacement: (match) => match.slice(2, -2).toUpperCase(),
    expectedMatches: 3,
    validate: (result) => result === "AxByC"
  },
  {
    name: "Asymmetric token lengths",
    description:
      "Short start token, very long end token (realistic for some formats)",
    chunks: [
      "Code: <%LONG_PROPERTY_NAME_THAT_IS_DESCRIPTIVE%> more <%ANOTHER_VERY_LONG_PROPER",
      "TY%>"
    ],
    tokens: ["<%", "_DESCRIPTIVE%>"],
    replacement: () => "VALUE",
    expectedMatches: 1
  }
];

// Benchmark setup costs (strategy + transformer creation)
// Uses first scenario as representative example
group("Setup Cost (strategy + transformer creation)", async () => {
  const representativeScenario = scenarios[0]; // "Single chunk, multiple patterns"

  for (const harness of Object.values(harnesses) as BaseHarness[]) {
    const {
      name,
      createSearchStrategy,
      createTransformer,
      isAsync,
      isStateful
    } = harness;

    const benchReplacement = isAsync
      ? async (match: string) =>
          Promise.resolve(representativeScenario.replacement(match))
      : representativeScenario.replacement;

    bench(name, () => {
      const strategy = createSearchStrategy(
        isStateful
          ? {
              tokens: representativeScenario.tokens,
              replacement: benchReplacement
            }
          : { tokens: representativeScenario.tokens }
      );

      createTransformer({ strategy, replacement: benchReplacement });
    });
  }
});

for (const scenario of scenarios) {
  group(scenario.name, async () => {
    for (const harness of Object.values(harnesses) as BaseHarness[]) {
      const {
        name,
        createSearchStrategy,
        createTransformer,
        isAsync,
        isStateful
      } = harness;

      const benchReplacement = isAsync
        ? async (match: string) => Promise.resolve(scenario.replacement(match))
        : scenario.replacement;

      bench(name, function* () {
        const statelessStrategy = isStateful
          ? null
          : createSearchStrategy({ tokens: scenario.tokens });

        yield {
          async bench() {
            const strategy =
              statelessStrategy ??
              createSearchStrategy({
                tokens: scenario.tokens,
                replacement: benchReplacement
              });

            const transformer = createTransformer({
              strategy,
              replacement: benchReplacement
            });
            const outputs: string[] = [];
            const controller = createMockController(outputs);
            for (const chunk of scenario.chunks) {
              await transformer.transform!(chunk, controller);
            }
            transformer.flush!(controller);
          }
        };
      });
    }
  });
}

const useJson = process.argv.includes("--json");

if (!useJson) {
  console.log("🚀 Algorithm Comparison Benchmark\n");
  console.log(
    `Running ${scenarios.length} scenarios across ${
      Object.keys(harnesses).length
    } harnesses...\n`
  );
}

if (useJson) {
  run({
    format: {
      json: {
        debug: false,
        samples: false
      }
    }
  });
} else {
  run();
}
