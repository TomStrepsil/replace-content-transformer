/**
 * Report: custom search strategies to migrate for 4.0
 *
 * In 3.x a strategy's `processChunk(haystack, state)` was a generator of
 * `MatchResult`s. In 4.0 it reports each result to a `MatchSink`, passed as a
 * third argument, and returns `undefined`:
 *
 *   *processChunk(haystack, state) {
 *     yield { isMatch: false, content: text };
 *     yield { isMatch: true, content: match, streamIndices };
 *   }
 *
 *   processChunk(haystack, state, sink) {
 *     sink.reportText(text);
 *     if (!sink.reportMatch(match, streamIndices)) return;
 *   }
 *
 * This lists every strategy that needs that change, what each `yield`
 * becomes, and code that reads a strategy's results itself, such as a custom
 * engine. It never edits a file: where the state is saved when the sink stops
 * the search is a decision about the strategy's own logic.
 *
 * A class or object counts as a strategy when it has `processChunk`,
 * `createState` and `matchToString`, implements `SearchStrategy`, or extends
 * one of this package's strategies.
 */

const PACKAGE = "replace-content-transformer";
const PROCESS_CHUNK = "processChunk";
const BUILT_IN_STRATEGIES = new Set([
  "StringAnchorSearchStrategy",
  "RegexSearchStrategy",
  "LeanRegexSearchStrategy",
  "BalancedPairSearchStrategy"
]);
const STRATEGY_INTERFACE = "SearchStrategy";
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
  "ClassPrivateMethod"
]);

function keyName(node) {
  if (node.computed) return null;
  if (node.key?.type === "Identifier") return node.key.name;
  if (node.key?.type === "StringLiteral") return node.key.value;
  return null;
}

function memberNames(members) {
  return new Set(members.map(keyName).filter(Boolean));
}

const SIGNATURE_TYPES = new Set(["TSDeclareMethod", "TSDeclareFunction"]);

function boundFunction(path, name) {
  for (const binding of path.scope?.lookup(name)?.getBindings()[name] ?? []) {
    const declaration = binding.parent.node;
    if (declaration.type === "FunctionDeclaration" && declaration.id === binding.node) return declaration;
    if (declaration.type === "VariableDeclarator" && FUNCTION_TYPES.has(declaration.init?.type)) return declaration.init;
  }
  return null;
}

function functionOf(member, path) {
  if (["ClassMethod", "ObjectMethod", ...SIGNATURE_TYPES].includes(member.type)) return member;
  const { value } = member;
  if (FUNCTION_TYPES.has(value?.type)) return value;
  return value?.type === "Identifier" ? boundFunction(path, value.name) : null;
}

function processChunkOf(members, path) {
  const candidates = members
    .filter((member) => keyName(member) === PROCESS_CHUNK)
    .map((member) => functionOf(member, path))
    .filter(Boolean);
  return candidates.find((candidate) => !SIGNATURE_TYPES.has(candidate.type)) ?? candidates[0] ?? null;
}

function typeName(node) {
  const expression = node?.expression ?? node;
  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type === "TSQualifiedName") return expression.right.name;
  if (expression?.type === "MemberExpression") return expression.property.name;
  return null;
}

function builtInStrategyLocals(root, j) {
  const locals = new Set();
  root
    .find(j.ImportDeclaration, { source: { value: PACKAGE } })
    .find(j.ImportSpecifier)
    .forEach(({ node }) => {
      const imported = node.imported.name ?? node.imported.value;
      if (BUILT_IN_STRATEGIES.has(imported)) locals.add(node.local.name);
    });
  return locals;
}

function matchTypeOf(classNode, j) {
  for (const clause of classNode.implements ?? []) {
    if (typeName(clause) !== STRATEGY_INTERFACE) continue;
    const matchType = clause.typeParameters?.params[1];
    return matchType ? j(matchType).toSource() : null;
  }
  return null;
}

function extendsBuiltIn(superClass, builtIns, namespaces) {
  if (superClass?.type === "Identifier") return builtIns.has(superClass.name);
  return (
    superClass?.type === "MemberExpression" &&
    !superClass.computed &&
    superClass.object.type === "Identifier" &&
    namespaces.has(superClass.object.name) &&
    BUILT_IN_STRATEGIES.has(superClass.property.name)
  );
}

function isStrategy(container, builtIns, namespaces) {
  const names = memberNames(container.members);
  if (!names.has(PROCESS_CHUNK)) return false;
  if (names.has("createState") && names.has("matchToString")) return true;
  if ((container.implements ?? []).some((clause) => typeName(clause) === STRATEGY_INTERFACE)) return true;
  return extendsBuiltIn(container.superClass, builtIns, namespaces);
}

function nameOfContainer(path) {
  const { node, parent } = path;
  if (node.id?.name) return node.id.name;
  if (parent.node.type === "VariableDeclarator" && parent.node.id.type === "Identifier") return parent.node.id.name;
  return "This strategy";
}

function lineOf(path) {
  for (let current = path; current; current = current.parent) {
    if (current.node.loc) return current.node.loc.start.line;
  }
  return "?";
}

function owningFunction(path) {
  for (let current = path.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.node.type)) return current.node;
  }
  return null;
}

const CALLS = new Set(["CallExpression", "OptionalCallExpression"]);

function isProcessChunkCall(node) {
  if (!CALLS.has(node?.type)) return false;
  const { callee } = node;
  if (!["MemberExpression", "OptionalMemberExpression"].includes(callee.type)) return false;
  const { property } = callee;
  return callee.computed
    ? property.type === "StringLiteral" && property.value === PROCESS_CHUNK
    : property.name === PROCESS_CHUNK;
}

function packageNamespaces(root, j) {
  const names = new Set();
  root
    .find(j.ImportDeclaration, { source: { value: PACKAGE } })
    .find(j.ImportNamespaceSpecifier)
    .forEach(({ node }) => names.add(node.local.name));
  root.find(j.VariableDeclarator).forEach(({ node }) => {
    const { init } = node;
    const requiresPackage =
      init?.type === "CallExpression" &&
      init.callee.type === "Identifier" &&
      init.callee.name === "require" &&
      init.arguments[0]?.value === PACKAGE;
    if (requiresPackage && node.id.type === "Identifier") names.add(node.id.name);
  });
  return names;
}

function literalResult(argument) {
  if (argument?.type !== "ObjectExpression") return null;
  const fields = new Map();
  for (const property of argument.properties) {
    if (property.type !== "ObjectProperty" && property.type !== "Property") return null;
    const name = keyName(property);
    if (!name) return null;
    fields.set(name, property.value);
  }
  const isMatch = fields.get("isMatch");
  if (isMatch?.type !== "BooleanLiteral" || !fields.has("content")) return null;
  return { isMatch: isMatch.value, content: fields.get("content"), streamIndices: fields.get("streamIndices") };
}

export default function reportSearchStrategies(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const builtIns = builtInStrategyLocals(root, j);
  const namespaces = packageNamespaces(root, j);
  const findCalls = (collection) => collection.find(j.Node, ({ type }) => CALLS.has(type));
  const source = (node) => j(node).toSource();
  const migratedBodies = new Set();

  const reportStrategy = (path, members, classNode) => {
    const name = nameOfContainer(path);
    const method = processChunkOf(members, path);
    if (!method) {
      api.report(
        `line ${lineOf(path)}: ${name} is a search strategy, whose processChunk reports to a MatchSink in 4.0. ` +
          "Its processChunk isn't a function this file defines, so check that it takes the sink as its third argument, " +
          "reports each result to it rather than yielding, and returns undefined"
      );
      return;
    }
    migratedBodies.add(method);
    const isMigrated = !method.generator && method.params.length >= 3;
    if (isMigrated) return;

    const params = method.params.map(source);
    const matchType = classNode ? matchTypeOf(classNode, j) : null;
    const sinkType = matchType ? `MatchSink<${matchType}>` : "MatchSink";
    const findings = [
      `line ${lineOf(path)}: ${name} is a search strategy, whose processChunk reports to a MatchSink in 4.0`,
      `    processChunk(${params.join(", ")}) becomes processChunk(${[...params.slice(0, 2), `sink: ${sinkType}`].join(", ")}): undefined, and is no longer a generator`
    ];

    const ownYields = j(method)
      .find(j.YieldExpression)
      .filter((yieldPath) => owningFunction(yieldPath) === method);
    ownYields.forEach(({ node }) => {
      const line = node.loc.start.line;
      const written = `\`${source(node)}\``;
      if (node.delegate && isProcessChunkCall(node.argument)) {
        const call = node.argument;
        const passed = [...call.arguments.map(source), "sink"].join(", ");
        findings.push(`    line ${line}: ${written} becomes \`${source(call.callee)}(${passed})\``);
        return;
      }
      const result = literalResult(node.argument);
      if (result && !result.isMatch) {
        findings.push(`    line ${line}: ${written} becomes \`sink.reportText(${source(result.content)})\``);
        return;
      }
      if (result?.isMatch && result.streamIndices) {
        findings.push(
          `    line ${line}: ${written} becomes \`if (!sink.reportMatch(${source(result.content)}, ${source(result.streamIndices)})) return;\`. ` +
            'Leave the state past the match before returning: the engine calls processChunk("", state, sink) to carry on from it'
        );
        return;
      }
      findings.push(
        `    line ${line}: ${written} reports its result to \`sink.reportText(content)\` or \`sink.reportMatch(content, streamIndices)\`, by its isMatch, ` +
          "stopping when reportMatch returns false"
      );
    });

    findCalls(j(method))
      .filter(({ node, parent }) => isProcessChunkCall(node) && node.arguments.length < 3 && !(parent.node.type === "YieldExpression" && parent.node.delegate))
      .forEach(({ node }) => {
        findings.push(
          `    line ${node.loc.start.line}: \`${source(node)}\` takes the sink as its third argument, and returns nothing to read`
        );
      });

    const hasFinally = j(method).find(j.TryStatement).filter(({ node }) => node.finalizer).size() > 0;
    if (method.body && !hasFinally) {
      findings.push(
        "    save the state in a finally block, so it stays intact when a sink call throws or stops the search, as the built-in strategies do"
      );
    }
    api.report(findings.join("\n"));
  };

  root
    .find(j.Node, ({ type }) => type === "ClassDeclaration" || type === "ClassExpression")
    .forEach((path) => {
      const members = path.node.body.body;
      const container = { members, implements: path.node.implements, superClass: path.node.superClass };
      if (isStrategy(container, builtIns, namespaces)) reportStrategy(path, members, path.node);
    });

  root.find(j.ObjectExpression).forEach((path) => {
    const members = path.node.properties.filter((property) => property.type !== "SpreadElement");
    if (isStrategy({ members }, builtIns, namespaces)) reportStrategy(path, members, null);
  });

  findCalls(root)
    .filter((path) => {
      if (!isProcessChunkCall(path.node) || path.node.arguments.length !== 2) return false;
      if (path.node.callee.object.type === "Super") return false;
      for (let current = path.parent; current; current = current.parent) {
        if (migratedBodies.has(current.node)) return false;
      }
      return true;
    })
    .forEach(({ node }) => {
      api.report(
        `line ${node.loc.start.line}: \`${source(node)}\` no longer returns results; pass a MatchSink as its third argument, ` +
          "whose reportText(content) and reportMatch(content, streamIndices) receive what this code read. reportMatch returns true to carry on, or false to stop the search, " +
          'which processChunk("", state, sink) resumes'
      );
    });

  return null;
}

export const parser = "tsx";
