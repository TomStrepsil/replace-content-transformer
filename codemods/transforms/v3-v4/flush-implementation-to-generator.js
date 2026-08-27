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
const MATCH_RESULT = "MatchResult";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod"
]);

function isFlushMethod(node) {
  return (
    (node.type === "ClassMethod" || node.type === "MethodDefinition") &&
    !node.computed &&
    !node.static &&
    node.key?.type === "Identifier" &&
    node.key.name === FLUSH &&
    node.kind !== "get" &&
    node.kind !== "set"
  );
}

function functionOf(node) {
  return node.type === "MethodDefinition" ? node.value : node;
}

function enclosingClass(path) {
  for (let current = path.parent; current; current = current.parent) {
    const { type } = current.node;
    if (type === "ClassDeclaration" || type === "ClassExpression") {
      return current.node;
    }
  }
  return null;
}

function typeNameOf(node) {
  const expression = node?.expression ?? node?.id ?? node;
  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type === "TSQualifiedName") return expression.right?.name;
  return null;
}

/**
 * The `implements SearchStrategy<...>` or `extends …StrategyBase<...>` clause
 * that identifies the class as one this migration applies to.
 *
 * Which one it is decides where the match type sits, so the kind is carried
 * rather than just the type arguments.
 */
function strategyClause(classNode) {
  if (!classNode) return null;
  const implemented = classNode.implements ?? [];
  for (const clause of Array.isArray(implemented) ? implemented : []) {
    if (STRATEGY_NAME.test(typeNameOf(clause) ?? "")) {
      return { isInterface: true, node: clause };
    }
  }
  if (STRATEGY_NAME.test(typeNameOf(classNode.superClass) ?? "")) {
    return {
      isInterface: false,
      node: {
        typeParameters:
          classNode.superTypeParameters ?? classNode.superClass?.typeParameters
      }
    };
  }
  return null;
}

/**
 * `SearchStrategy<TState, TMatch>` names the match type second, so a clause
 * naming only its state leaves `TMatch` at the interface's own `string` default.
 * `StringBufferStrategyBase<TMatch>` names it first.
 */
function matchTypeName(clause, j) {
  const parameters =
    clause?.node?.typeParameters?.params ??
    clause?.node?.typeArguments?.params ??
    [];
  const type = clause?.isInterface ? parameters[1] : parameters[0];
  if (!type) return "string";
  return j(type).toSource();
}

function returnsString(fn) {
  const annotation = fn.returnType?.typeAnnotation;
  if (!annotation) return true;
  return (
    annotation.type === "TSStringKeyword" ||
    annotation.type === "StringTypeAnnotation"
  );
}

function isDelegatingCall(argument) {
  return (
    argument?.type === "CallExpression" &&
    argument.callee?.type === "MemberExpression" &&
    argument.callee.property?.type === "Identifier" &&
    argument.callee.property.name === FLUSH
  );
}

/** The function a `return` belongs to — nested callbacks own their own. */
function owningFunction(returnPath) {
  for (let current = returnPath.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.node.type)) return current.node;
  }
  return null;
}

function isFinalStatement(fn, node) {
  const statements = fn.body?.body;
  return Array.isArray(statements) && statements[statements.length - 1] === node;
}

function parameterList(fn, j) {
  return fn.params.map((parameter) => j(parameter).toSource()).join(", ");
}

function importsMatchResult(root, j) {
  return (
    root
      .find(j.ImportDeclaration)
      .find(j.Identifier, { name: MATCH_RESULT })
      .size() > 0
  );
}

export default function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const findings = [];
  let signatureNeedsMatchResult = false;

  root
    .find(j.Node)
    .filter((path) => isFlushMethod(path.node))
    .forEach((path) => {
      const method = path.node;
      const fn = functionOf(method);
      if (fn.generator) return;

      // `flush(): string` is an ordinary name on cache, logger and stream APIs.
      // Saying nothing about those is the point; a report full of false hits is
      // one nobody reads.
      const clause = strategyClause(enclosingClass(path));
      if (clause === null) return;

      const at = `${fileInfo.path}:${method.loc?.start.line ?? "?"}`;

      if (!returnsString(fn)) {
        findings.push(
          `${at}: flush() does not return a string; check whether it is already migrated`
        );
        return;
      }

      const matchType = matchTypeName(clause, j);
      signatureNeedsMatchResult = true;
      findings.push(
        `${at}: flush(${parameterList(fn, j)}): string\n` +
          `    becomes *flush(${parameterList(fn, j)}): Generator<${MATCH_RESULT}<${matchType}>, void, undefined>`
      );

      const returns = j(path)
        .find(j.ReturnStatement)
        .filter((returnPath) => owningFunction(returnPath) === fn);

      returns.forEach((returnPath) => {
        const argument = returnPath.node.argument;
        if (!argument) return;

        const line = returnPath.node.loc?.start.line ?? "?";
        const source = j(argument).toSource();
        const terminator = isFinalStatement(fn, returnPath.node)
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

  if (signatureNeedsMatchResult && !importsMatchResult(root, j)) {
    findings.push(
      `${fileInfo.path}: add a type import for ${MATCH_RESULT}`
    );
  }

  for (const finding of findings) {
    api.report(finding);
  }

  return null;
}
