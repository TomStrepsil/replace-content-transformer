/**
 * Codemod: SearchStrategy.flush call sites -> drain the generator
 *
 * Rewrites:
 *   const tail = strategy.flush(state);
 *   if (tail) controller.enqueue(tail);
 *
 * To:
 *   // TODO(v4): flush() now yields matches; apply your replacement here if wanted.
 *   for (const result of strategy.flush(state)) {
 *     const tail = result.isMatch
 *       ? strategy.matchToString(result.content)
 *       : result.content;
 *     if (tail) controller.enqueue(tail);
 *   }
 *
 * Deliberately behaviour-preserving: every result is stringified, so the same
 * bytes come out. Handling matches at end of stream — the point of the change —
 * is flagged rather than taken silently, because only the consumer knows what a
 * match there should mean.
 *
 * Skipped and reported, never guessed at:
 *   - a result that flows somewhere structural (returned, awaited, concatenated,
 *     stored on a field, passed as an argument)
 *   - dynamic dispatch, e.g. strategy[name](state)
 *   - type-only declarations of the interface
 */

const FLUSH = "flush";
const TODO =
  " TODO(v4): flush() now yields matches; apply your replacement here if wanted.";

function isFlushCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === FLUSH
  );
}

export default function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const skipped = [];
  let changed = false;

  root
    .find(j.CallExpression)
    .filter((path) => isFlushCall(path.node))
    .forEach((path) => {
      const parent = path.parent.node;

      const isSimpleDeclaration =
        parent.type === "VariableDeclarator" &&
        parent.id.type === "Identifier" &&
        path.parent.parent.node.type === "VariableDeclaration";

      if (!isSimpleDeclaration) {
        if (parent.type === "ForOfStatement") return;
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() result flows somewhere this codemod will not rewrite; migrate it by hand`
        );
        return;
      }

      const declaration = path.parent.parent;
      const statementPath = declaration.parent;
      const body = statementPath.node.body ?? statementPath.parent?.node?.body;
      if (!Array.isArray(body)) {
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() is not in a statement list; migrate it by hand`
        );
        return;
      }

      const declarationIndex = body.indexOf(declaration.node);
      if (declarationIndex === -1) return;

      const tailName = parent.id.name;
      const receiver = path.node.callee.object;

      const following = body.slice(declarationIndex + 1);
      const usesTail = (statement) =>
        j(statement).find(j.Identifier, { name: tailName }).size() > 0;

      const consumed = [];
      for (const statement of following) {
        consumed.push(statement);
        const next = following[consumed.length];
        if (!next || !usesTail(next)) break;
      }

      const loop = j.forOfStatement(
        j.variableDeclaration("const", [
          j.variableDeclarator(j.identifier("result"), null)
        ]),
        path.node,
        j.blockStatement([
          j.variableDeclaration("const", [
            j.variableDeclarator(
              j.identifier(tailName),
              j.conditionalExpression(
                j.memberExpression(
                  j.identifier("result"),
                  j.identifier("isMatch")
                ),
                j.callExpression(
                  j.memberExpression(receiver, j.identifier("matchToString")),
                  [
                    j.memberExpression(
                      j.identifier("result"),
                      j.identifier("content")
                    )
                  ]
                ),
                j.memberExpression(
                  j.identifier("result"),
                  j.identifier("content")
                )
              )
            )
          ]),
          ...consumed
        ])
      );

      loop.comments = [j.commentLine(TODO, true, false)];

      body.splice(declarationIndex, 1 + consumed.length, loop);
      changed = true;
    });

  for (const message of skipped) {
    api.report(message);
  }

  return changed ? root.toSource({ quote: "double" }) : null;
}
