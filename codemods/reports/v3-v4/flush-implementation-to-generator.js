/**
 * Report: SearchStrategy.flush implementations to migrate for v4
 *
 * v3 returned a string:
 *
 *   flush(state: StringBufferState): string {
 *     const flushed = state.buffer;
 *     state.buffer = "";
 *     return flushed;
 *   }
 *
 * v4 yields results:
 *
 *   *flush(state: StringBufferState): Generator<MatchResult<string>, void, undefined> {
 *     const flushed = state.buffer;
 *     state.buffer = "";
 *     if (flushed) yield { isMatch: false, content: flushed };
 *   }
 *
 * This **reports** every implementation that needs that change, with the exact
 * signature to write and what each `return` becomes. It never edits a file.
 *
 * Rewriting it mechanically is the part that goes wrong: `flush(): string` is
 * an ordinary name on cache and stream APIs, a `return` inside a nested callback
 * is not the method's own, a `return` that was not in tail position still has to
 * end the generator, and an empty buffer must not yield an empty result. Getting
 * any of those wrong edits a consumer's source silently. Reporting carries the
 * same analysis with none of that risk.
 *
 * Strategies that inherit `flush` from StringBufferStrategyBase are left alone —
 * the base class default covers them.
 */

const FLUSH = "flush";
const STRATEGY_NAME = /SearchStrategy|StrategyBase/;
const GENERIC_BASE = /StrategyBase$/;
const MATCH_RESULT = "MatchResult";
const PACKAGE = "replace-content-transformer";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod"
]);

function isFlushKey(key) {
  return (
    (key.type === "Identifier" && key.name === FLUSH) ||
    (key.type === "StringLiteral" && key.value === FLUSH)
  );
}

function isFlushMethod(node) {
  return (
    node.type === "ClassMethod" &&
    !node.computed &&
    !node.static &&
    isFlushKey(node.key) &&
    !["get", "set"].includes(node.kind)
  );
}

function enclosingClass(path) {
  for (let current = path.parent; current; current = current.parent) {
    const { type } = current.node;
    if (["ClassDeclaration", "ClassExpression"].includes(type)) {
      return current.node;
    }
  }
}

function typeNameOf(node) {
  const expression = node?.expression ?? node;
  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type === "TSQualifiedName") return expression.right?.name;
  return null;
}

function qualifierOf(node) {
  const expression = node?.expression ?? node;
  if (expression?.type !== "TSQualifiedName") return null;
  return expression.left?.type === "Identifier" ? expression.left.name : "";
}

/**
 * The `implements SearchStrategy<...>` or `extends …StrategyBase<...>` clause
 * that identifies the class as one this migration applies to.
 *
 * Which one it is decides where the match type sits, so the kind is carried
 * rather than just the type arguments.
 */
function strategyClause(classNode, importedNames, foreignNames, packageNamespaces) {
  const resolve = (node) => {
    const name = typeNameOf(node);
    const qualifier = qualifierOf(node);
    if (qualifier !== null) return packageNamespaces.has(qualifier) ? name : "";
    return foreignNames.has(name) ? "" : (importedNames.get(name) ?? name);
  };
  for (const clause of classNode.implements) {
    if (STRATEGY_NAME.test(resolve(clause))) {
      return { isInterface: true, node: clause };
    }
  }
  const superName = resolve(classNode.superClass);
  if (GENERIC_BASE.test(superName)) {
    return {
      isInterface: false,
      node: {
        typeParameters: classNode.superTypeParameters
      }
    };
  }
  // A concrete strategy (`extends RegexSearchStrategy`) fixes its own match
  // type, which is not readable from this file — say so rather than guess.
  if (STRATEGY_NAME.test(superName)) {
    return { isInterface: false, inheritedFrom: superName };
  }
  return null;
}

/**
 * `SearchStrategy<TState, TMatch>` names the match type second, so a clause
 * naming only its state leaves `TMatch` at the interface's own `string` default.
 * `StringBufferStrategyBase<TMatch>` names it first.
 */
function matchTypeName(clause, j) {
  if (clause.inheritedFrom) return null;
  const parameters = clause.node.typeParameters?.params ?? [];
  const type = clause.isInterface ? parameters[1] : parameters[0];
  if (!type) return "string";
  return j(type).toSource();
}

function returnsString(fn) {
  const annotation = fn.returnType?.typeAnnotation;
  if (!annotation) return true;
  return annotation.type === "TSStringKeyword";
}

function isDelegatingCall(argument) {
  return (
    argument.type === "CallExpression" &&
    argument.callee.type === "MemberExpression" &&
    !argument.callee.computed &&
    argument.callee.property.type === "Identifier" &&
    argument.callee.property.name === FLUSH
  );
}

/** The function a `return` belongs to — nested callbacks own their own. */
function owningFunction(returnPath) {
  for (let current = returnPath.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.node.type)) return current.node;
  }
}

function isFinalStatement(fn, node) {
  const statements = fn.body.body;
  return statements[statements.length - 1] === node;
}

function parameterList(fn, j) {
  return fn.params.map((parameter) => j(parameter).toSource()).join(", ");
}

function isPackageImport(declaration) {
  const source = declaration.source.value;
  return source === PACKAGE || source.startsWith(`${PACKAGE}/`);
}

/** Local name -> exported name, for every named import from this package. */
function importedNamesByLocal(root, j) {
  const names = new Map();
  root
    .find(j.ImportDeclaration)
    .filter(({ node }) => isPackageImport(node))
    .find(j.ImportSpecifier)
    .forEach(({ node }) => {
      names.set(node.local.name, node.imported.name ?? node.imported.value);
    });
  return names;
}

function foreignLocalNames(root, j) {
  const names = new Set();
  root
    .find(j.ImportDeclaration)
    .filter(({ node }) => !isPackageImport(node))
    .forEach(({ node }) => {
      for (const specifier of node.specifiers ?? []) names.add(specifier.local.name);
    });
  return names;
}

function packageNamespaceNames(root, j) {
  const names = new Set();
  root
    .find(j.ImportDeclaration)
    .filter(({ node }) => isPackageImport(node))
    .find(j.ImportNamespaceSpecifier)
    .forEach(({ node }) => names.add(node.local.name));
  return names;
}

function localNameOf(importedNames, exportedName) {
  for (const [local, imported] of importedNames) {
    if (imported === exportedName) return local;
  }
  return null;
}

export default function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const findings = [];
  const importedNames = importedNamesByLocal(root, j);
  const foreignNames = foreignLocalNames(root, j);
  const packageNamespaces = packageNamespaceNames(root, j);
  const matchResultName = localNameOf(importedNames, MATCH_RESULT);
  let signatureNeedsMatchResult = false;

  root
    .find(j.Node)
    .filter((path) => isFlushMethod(path.node))
    .forEach((path) => {
      const method = path.node;
      if (method.generator) return;

      // `flush(): string` is an ordinary name on cache, logger and stream APIs.
      // Saying nothing about those is the point; a report full of false hits is
      // one nobody reads.
      const clause = strategyClause(
        enclosingClass(path),
        importedNames,
        foreignNames,
        packageNamespaces
      );
      if (clause === null) return;

      const at = `${fileInfo.path}:${method.loc.start.line}`;

      if (!returnsString(method)) {
        findings.push(
          `${at}: flush() does not return a string; check whether it is already migrated`
        );
        return;
      }

      const matchType = matchTypeName(clause, j);
      signatureNeedsMatchResult = true;
      findings.push(
        `${at}: flush(${parameterList(method, j)}): string\n` +
          `    becomes *flush(${parameterList(method, j)}): Generator<${matchResultName ?? MATCH_RESULT}<${matchType ?? "TMatch"}>, void, undefined>` +
          (matchType === null
            ? `\n    TMatch is inherited from ${clause.inheritedFrom}; use that class's match type`
            : "")
      );

      const returns = j(path)
        .find(j.ReturnStatement)
        .filter((returnPath) => owningFunction(returnPath) === method);

      returns.forEach((returnPath) => {
        const argument = returnPath.node.argument;
        if (!argument) return;

        const line = returnPath.node.loc.start.line;
        const source = j(argument).toSource();
        const terminator = isFinalStatement(method, returnPath.node)
          ? ""
          : ", then `return;` to end the generator";

        if (isDelegatingCall(argument)) {
          findings.push(
            `    line ${line}: \`return ${source}\` becomes \`yield* ${source}\`${terminator}`
          );
          return;
        }

        if (argument.type === "BinaryExpression") {
          findings.push(
            `    line ${line}: \`return ${source}\` composes its result; yield each part in turn${terminator}`
          );
          return;
        }

        // The guard is what keeps an empty buffer from yielding an empty
        // result, which v3 consumers never saw; anything but a plain binding is
        // bound first so the guard cannot evaluate it twice.
        findings.push(
          argument.type === "Identifier"
            ? `    line ${line}: \`return ${source}\` becomes \`if (${source}) yield { isMatch: false, content: ${source} }\`${terminator}`
            : `    line ${line}: \`return ${source}\` becomes \`const flushed = ${source}; if (flushed) yield { isMatch: false, content: flushed };\`${terminator}`
        );
      });
    });

  if (signatureNeedsMatchResult && matchResultName === null) {
    findings.push(
      `${fileInfo.path}: add a type import for ${MATCH_RESULT}`
    );
  }

  for (const finding of findings) {
    api.report(finding);
  }

  return null;
}
