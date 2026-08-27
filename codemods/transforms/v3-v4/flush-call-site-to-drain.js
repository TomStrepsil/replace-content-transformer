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
const STRATEGY_RECEIVER = /strategy/i;
const TODO =
  " TODO(v4): flush() now yields matches; apply your replacement here if wanted.";

/**
 * `flush()` is an ordinary name on cache, logger, stream and database APIs that
 * this change does not touch, so the receiver has to look like a search strategy
 * before its call site is rewritten. Anything else is reported for a human.
 */
function looksLikeStrategy(receiver) {
  if (receiver?.type === "Identifier") {
    return STRATEGY_RECEIVER.test(receiver.name);
  }
  if (receiver?.type === "MemberExpression") {
    return STRATEGY_RECEIVER.test(receiver.property?.name ?? "");
  }
  return false;
}

/** A loop variable that cannot shadow anything the moved statements read. */
function unusedName(base, root, j) {
  const taken = new Set();
  root.find(j.Identifier).forEach((path) => taken.add(path.node.name));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

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

      const declarationNode = path.parent.parent.node;
      const isSimpleDeclaration =
        parent.type === "VariableDeclarator" &&
        parent.id.type === "Identifier" &&
        declarationNode.type === "VariableDeclaration";

      if (!looksLikeStrategy(path.node.callee.object)) {
        if (parent.type === "ForOfStatement") return;
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() is called on something that is not identifiably a SearchStrategy; migrate it by hand if it is one`
        );
        return;
      }

      if (!isSimpleDeclaration) {
        if (parent.type === "ForOfStatement") return;
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() result flows somewhere this codemod will not rewrite; migrate it by hand`
        );
        return;
      }

      if (declarationNode.declarations?.length !== 1) {
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() shares a declaration that declares more than one variable; migrate it by hand`
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

      // Only statements that actually read the tail belong inside the loop.
      // Anything else would start running once per yielded result.
      const consumed = [];
      for (const statement of following) {
        if (!usesTail(statement)) break;
        consumed.push(statement);
      }

      if (consumed.length === 0) {
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() result is not read by the statement that follows it; migrate it by hand`
        );
        return;
      }

      const strays = following.slice(consumed.length).filter(usesTail);
      if (strays.length > 0) {
        skipped.push(
          `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}: flush() result is read again after an unrelated statement; migrate it by hand`
        );
        return;
      }

      const resultName = unusedName("result", root, j);

      const loop = j.forOfStatement(
        j.variableDeclaration("const", [
          j.variableDeclarator(j.identifier(resultName), null)
        ]),
        path.node,
        j.blockStatement([
          j.variableDeclaration("const", [
            j.variableDeclarator(
              j.identifier(tailName),
              j.conditionalExpression(
                j.memberExpression(
                  j.identifier(resultName),
                  j.identifier("isMatch")
                ),
                j.callExpression(
                  j.memberExpression(receiver, j.identifier("matchToString")),
                  [
                    j.memberExpression(
                      j.identifier(resultName),
                      j.identifier("content")
                    )
                  ]
                ),
                j.memberExpression(
                  j.identifier(resultName),
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
