/**
 * Codemod: SearchStrategy.flush implementation -> generator
 *
 * Rewrites:
 *   flush(state: StringBufferState): string {
 *     const flushed = state.buffer;
 *     state.buffer = "";
 *     return flushed;
 *   }
 *
 * To:
 *   *flush(state: StringBufferState): Generator<MatchResult<string>, void, undefined> {
 *     const flushed = state.buffer;
 *     state.buffer = "";
 *     if (flushed) yield { isMatch: false, content: flushed };
 *   }
 *
 * Strategies that inherit `flush` from StringBufferStrategyBase are left alone —
 * the base class default covers them.
 *
 * Skipped and reported, never guessed at:
 *   - a class that is not identifiably a SearchStrategy, since `flush(): string`
 *     is an ordinary name for cache, logger and stream APIs this change does not
 *     touch
 *   - a flush whose returned value is not a single expression per return statement
 *   - a flush that returns the result of another method call (composition)
 */

const FLUSH = "flush";
const STRATEGY_NAME = /SearchStrategy|StrategyBase/;
const MATCH_RESULT = "MatchResult";

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
 * that identifies the class as something this migration applies to.
 */
function strategyClause(classNode) {
  if (!classNode) return null;
  const implemented = classNode.implements ?? classNode.superTypeParameters ?? [];
  for (const clause of Array.isArray(implemented) ? implemented : []) {
    if (STRATEGY_NAME.test(typeNameOf(clause) ?? "")) return clause;
  }
  if (STRATEGY_NAME.test(typeNameOf(classNode.superClass) ?? "")) {
    return {
      typeParameters:
        classNode.superTypeParameters ?? classNode.superClass?.typeParameters
    };
  }
  return null;
}

/**
 * `SearchStrategy<TState, TMatch>` names the match type second;
 * `StringBufferStrategyBase<TMatch>` names it first. Absent either, `string` is
 * the interface's own default.
 */
function matchTypeFrom(clause) {
  const parameters =
    clause?.typeParameters?.params ?? clause?.typeArguments?.params ?? [];
  if (parameters.length >= 2) return parameters[1];
  if (parameters.length === 1) return parameters[0];
  return null;
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

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod"
]);

/** The function a `return` belongs to — nested callbacks own their own. */
function owningFunction(returnPath) {
  for (let current = returnPath.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.node.type)) return current.node;
  }
  return null;
}

function isFinalStatement(fn, node) {
  const statements = fn.body?.body;
  return (
    Array.isArray(statements) && statements[statements.length - 1] === node
  );
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
  const skipped = [];
  let changed = false;
  let needsMatchResultImport = false;

  root
    .find(j.Node)
    .filter((path) => isFlushMethod(path.node))
    .forEach((path) => {
      const method = path.node;
      const fn = functionOf(method);

      if (fn.generator) return;

      const clause = strategyClause(enclosingClass(path));
      if (clause === null) {
        skipped.push(
          `${fileInfo.path}:${method.loc?.start.line ?? "?"}: flush() is on a class that is not identifiably a SearchStrategy; migrate it by hand if it is one`
        );
        return;
      }

      if (!returnsString(fn)) {
        skipped.push(
          `${fileInfo.path}: flush() has a non-string return type; migrate it by hand`
        );
        return;
      }

      const returns = j(path)
        .find(j.ReturnStatement)
        .filter((returnPath) => owningFunction(returnPath) === fn);

      let unsupported = false;
      returns.forEach((returnPath) => {
        if (returnPath.node.argument?.type === "BinaryExpression") {
          unsupported = true;
        }
      });

      if (unsupported) {
        skipped.push(
          `${fileInfo.path}: flush() composes its result from several sources; migrate it by hand`
        );
        return;
      }

      returns.forEach((returnPath) => {
        const argument = returnPath.node.argument;
        if (!argument) return;

        const emit = isDelegatingCall(argument)
          ? j.expressionStatement(j.yieldExpression(argument, true))
          : j.expressionStatement(
              j.yieldExpression(
                j.objectExpression([
                  j.property(
                    "init",
                    j.identifier("isMatch"),
                    j.booleanLiteral(false)
                  ),
                  j.property("init", j.identifier("content"), argument)
                ]),
                false
              )
            );

        const guarded =
          !isDelegatingCall(argument) && argument.type === "Identifier"
            ? j.ifStatement(argument, emit)
            : emit;

        // A `return` mid-body still has to end the generator; one in tail
        // position needs nothing, and reads better without it.
        j(returnPath).replaceWith(
          isFinalStatement(fn, returnPath.node)
            ? guarded
            : j.blockStatement([guarded, j.returnStatement(null)])
        );
      });

      fn.generator = true;
      if (fn.returnType) {
        const matchType = matchTypeFrom(clause) ?? j.tsStringKeyword();
        fn.returnType = j.tsTypeAnnotation(
          j.tsTypeReference(
            j.identifier("Generator"),
            j.tsTypeParameterInstantiation([
              j.tsTypeReference(
                j.identifier(MATCH_RESULT),
                j.tsTypeParameterInstantiation([matchType])
              ),
              j.tsVoidKeyword(),
              j.tsUndefinedKeyword()
            ])
          )
        );
        needsMatchResultImport = true;
      }
      changed = true;
    });

  if (needsMatchResultImport && !importsMatchResult(root, j)) {
    skipped.push(
      `${fileInfo.path}: the rewritten signature references ${MATCH_RESULT}; add a type import for it`
    );
  }

  for (const message of skipped) {
    api.report(message);
  }

  return changed ? root.toSource({ quote: "double" }) : null;
}
