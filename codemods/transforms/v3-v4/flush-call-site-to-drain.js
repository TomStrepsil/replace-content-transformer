/**
 * Report: SearchStrategy.flush call sites to migrate for v4
 *
 * v3 returned a string:
 *
 *   const tail = strategy.flush(state);
 *   if (tail) controller.enqueue(tail);
 *
 * v4 yields results, so the call site drains them:
 *
 *   for (const result of strategy.flush(state)) {
 *     const tail = result.isMatch
 *       ? strategy.matchToString(result.content)
 *       : result.content;
 *     if (tail) controller.enqueue(tail);
 *   }
 *
 * This **reports** every call site that needs that change, with the drain loop
 * written out for the names actually in use. It never edits a file.
 *
 * Two reasons it stops there. Mechanically, wrapping a call site means deciding
 * which following statements belong inside the loop, and getting that wrong runs
 * them once per result or drops them entirely. Substantively, the loop above is
 * only the *behaviour-preserving* migration — every result stringified, the same
 * bytes out. The point of the change is that a match can now settle at end of
 * stream, and what a replacement should do with it is a decision only the
 * consumer can make.
 */

const FLUSH = "flush";
const STRATEGY_RECEIVER = /strategy/i;

function isFlushCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === FLUSH
  );
}

/**
 * `flush()` is an ordinary name on cache, logger, stream and database APIs, so
 * the receiver has to look like a search strategy before the site is reported.
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

function drainLoop(call, tailName, receiver) {
  return [
    `    for (const result of ${call}) {`,
    `      const ${tailName} = result.isMatch`,
    `        ? ${receiver}.matchToString(result.content)`,
    `        : result.content;`,
    `      // …the statements that used \`${tailName}\`, unchanged`,
    `    }`
  ].join("\n");
}

export default function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const findings = [];

  root
    .find(j.CallExpression)
    .filter((path) => isFlushCall(path.node))
    .forEach((path) => {
      const receiver = path.node.callee.object;
      if (!looksLikeStrategy(receiver)) return;

      const parent = path.parent.node;
      if (parent.type === "ForOfStatement") return;

      const at = `${fileInfo.path}:${path.node.loc?.start.line ?? "?"}`;
      const call = j(path.node).toSource();

      const isSimpleDeclaration =
        parent.type === "VariableDeclarator" && parent.id.type === "Identifier";

      if (!isSimpleDeclaration) {
        findings.push(
          `${at}: ${call} now yields results rather than a string; the result flows somewhere that needs rethinking by hand`
        );
        return;
      }

      findings.push(
        `${at}: ${call} now yields results rather than a string. To keep the current bytes:\n` +
          drainLoop(call, parent.id.name, j(receiver).toSource()) +
          `\n    A match settling here is the point of the change — decide whether to replace it.`
      );
    });

  for (const finding of findings) {
    api.report(finding);
  }

  return null;
}
