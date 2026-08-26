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
 *   - a flush whose returned value is not a single expression per return statement
 *   - a flush that returns the result of another method call (composition)
 */

const FLUSH = "flush";

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

function returnsString(fn) {
  const annotation = fn.returnType?.typeAnnotation;
  if (!annotation) return true;
  return (
    annotation.type === "TSStringKeyword" ||
    (annotation.type === "StringTypeAnnotation")
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

function matchTypeParameter(fn) {
  const annotation = fn.returnType?.typeAnnotation;
  if (annotation && annotation.type !== "TSStringKeyword") return null;
  return "string";
}

export default function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const skipped = [];
  let changed = false;

  root
    .find(j.Node)
    .filter((path) => isFlushMethod(path.node))
    .forEach((path) => {
      const method = path.node;
      const fn = functionOf(method);

      if (fn.generator) return;
      if (!returnsString(fn)) {
        skipped.push(
          `${fileInfo.path}: flush() has a non-string return type; migrate it by hand`
        );
        return;
      }

      const returns = j(path).find(j.ReturnStatement);
      let unsupported = false;

      returns.forEach((returnPath) => {
        const argument = returnPath.node.argument;
        if (!argument) return;
        if (argument.type === "BinaryExpression") {
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

        if (isDelegatingCall(argument)) {
          j(returnPath).replaceWith(
            j.expressionStatement(j.yieldExpression(argument, true))
          );
          return;
        }

        const yieldResult = j.expressionStatement(
          j.yieldExpression(
            j.objectExpression([
              j.property("init", j.identifier("isMatch"), j.booleanLiteral(false)),
              j.property("init", j.identifier("content"), argument)
            ]),
            false
          )
        );

        j(returnPath).replaceWith(
          argument.type === "Identifier"
            ? j.ifStatement(argument, yieldResult)
            : yieldResult
        );
      });

      fn.generator = true;
      if (fn.returnType) {
        fn.returnType = j.tsTypeAnnotation(
          j.tsTypeReference(
            j.identifier("Generator"),
            j.tsTypeParameterInstantiation([
              j.tsTypeReference(
                j.identifier("MatchResult"),
                j.tsTypeParameterInstantiation([
                  j.tsTypeReference(j.identifier(matchTypeParameter(fn) ?? "string"))
                ])
              ),
              j.tsVoidKeyword(),
              j.tsUndefinedKeyword()
            ])
          )
        );
      }
      changed = true;
    });

  for (const message of skipped) {
    api.report(message);
  }

  return changed ? root.toSource({ quote: "double" }) : null;
}
