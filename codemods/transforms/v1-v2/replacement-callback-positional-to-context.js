/**
 * Codemod: replacement callback positional args -> context object
 *
 * Rewrites legacy callback signatures:
 *   (match, matchIndex) => ...
 *   (match, matchIndex, streamIndices) => ...
 *
 * To:
 *   (match, { matchIndex }) => ...
 *   (match, { matchIndex, streamIndices }) => ...
 */

const MATCH_INDEX_KEY = "matchIndex";
const STREAM_INDICES_KEY = "streamIndices";

function isReplacementProperty(node) {
  if (
    !node ||
    (node.type !== "Property" && node.type !== "ObjectProperty") ||
    node.computed
  ) {
    return false;
  }

  if (node.key.type === "Identifier") {
    return node.key.name === "replacement";
  }

  if (node.key.type === "Literal" || node.key.type === "StringLiteral") {
    return node.key.value === "replacement";
  }

  return false;
}

function isFunctionExpression(node) {
  return (
    node &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression")
  );
}

function isAlreadyContextStyle(params) {
  return params.length === 2 && params[1]?.type === "ObjectPattern";
}

function buildContextProperty(j, sourceParam, contextKey) {
  if (!sourceParam) {
    return null;
  }

  if (sourceParam.type === "Identifier") {
    const value = j.identifier(sourceParam.name);
    const property = j.property("init", j.identifier(contextKey), value);

    if (sourceParam.name === contextKey) {
      property.shorthand = true;
    }

    return property;
  }

  if (
    sourceParam.type === "AssignmentPattern" &&
    sourceParam.left?.type === "Identifier"
  ) {
    const assignment = j.assignmentPattern(
      j.identifier(sourceParam.left.name),
      sourceParam.right
    );

    return j.property("init", j.identifier(contextKey), assignment);
  }

  return null;
}

export default function replacementCallbackPositionalToContext(
  fileInfo,
  api
) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let changed = false;

  root.find(j.ObjectExpression).forEach((objectExpressionPath) => {
    for (const property of objectExpressionPath.node.properties) {
      if (!isReplacementProperty(property)) {
        continue;
      }

      const callback = property.value;

      if (!isFunctionExpression(callback)) {
        continue;
      }

      if (callback.params.length < 2 || callback.params.length > 3) {
        continue;
      }

      if (isAlreadyContextStyle(callback.params)) {
        continue;
      }

      const matchParam = callback.params[0];
      const matchIndexProperty = buildContextProperty(
        j,
        callback.params[1],
        MATCH_INDEX_KEY
      );

      if (!matchIndexProperty) {
        continue;
      }

      const contextProperties = [matchIndexProperty];

      if (callback.params.length === 3) {
        const streamIndicesProperty = buildContextProperty(
          j,
          callback.params[2],
          STREAM_INDICES_KEY
        );

        if (!streamIndicesProperty) {
          continue;
        }

        contextProperties.push(streamIndicesProperty);
      }

      callback.params = [matchParam, j.objectPattern(contextProperties)];
      changed = true;
    }
  });

  if (!changed) {
    return null;
  }

  return root.toSource();
}

export const parser = "tsx";
