/**
 * Report: code that builds a ReplacementContext without a `signal`
 *
 * In 4.0 a `ReplacementContext` has a required `signal`, which aborts once the
 * replacement's output is no longer wanted. Code that builds one, such as a
 * custom engine, or a test that calls a replacement function directly, has to
 * supply it.
 *
 * This lists every object literal with a context's `matchIndex` and
 * `streamIndices` and no `signal`. It never edits a file: which signal to
 * pass is the caller's to decide. A literal that spreads another object in is
 * skipped, since the spread may carry the signal.
 */

const CONTEXT_FIELDS = ["matchIndex", "streamIndices"];
const SIGNAL = "signal";

function keyName(property) {
  if (property.computed) return null;
  if (property.key?.type === "Identifier") return property.key.name;
  if (property.key?.type === "StringLiteral") return property.key.value;
  return null;
}

export default function reportReplacementContexts(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  root.find(j.ObjectExpression).forEach(({ node }) => {
    if (node.properties.some((property) => property.type === "SpreadElement")) return;
    const names = new Set(node.properties.map(keyName));
    if (!CONTEXT_FIELDS.every((name) => names.has(name)) || names.has(SIGNAL)) return;
    api.report(
      `line ${node.loc.start.line}: \`${j(node).toSource()}\` builds a ReplacementContext without the signal 4.0 requires. ` +
        "Pass one that aborts when the replacement's output is no longer wanted, such as an engine's own AbortController's signal, " +
        "or `new AbortController().signal` in a test"
    );
  });

  return null;
}

export const parser = "tsx";
