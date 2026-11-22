/**
 * Report: TextDecoderStream / TextEncoderStream pipelines around a web adapter
 *
 * 3.x's web adapters took and emitted strings, so a byte stream such as
 * `Response.body` was decoded before the adapter and encoded after it:
 *
 *   response.body
 *     .pipeThrough(new TextDecoderStream())
 *     .pipeThrough(new TransformStream(new ReplaceContentTransformer(engine)))
 *     .pipeThrough(new TextEncoderStream());
 *
 * In 4.0 that string adapter is `ReplaceContentTextTransformer`, which
 * rename-exports.js switches to, so the pipeline works as before. The byte
 * adapter, now `ReplaceContentTransformer`, takes and emits UTF-8 bytes, so it
 * can replace all three. It isn't a drop-in change: it keeps a byte order
 * mark at the start of the input, which `TextDecoderStream` drops.
 *
 * This lists each such pipeline, and the 4.0 byte adapter fed by a
 * `TextDecoderStream`, whose strings error it. It never edits a file.
 *
 * In a file that uses no 4.0 names, `ReplaceContentTransformer` is taken to
 * be the 3.x string adapter, as rename-exports.js does. A `TextDecoderStream`
 * for an encoding other than UTF-8, or one that may be `fatal`, isn't one the
 * byte adapter can replace: it reads only UTF-8, and writes U+FFFD for
 * malformed input.
 */

const PACKAGE = "replace-content-transformer";
const WEB = `${PACKAGE}/web`;
const BYTE_ADAPTER = "ReplaceContentTransformer";
const STRING_ADAPTERS = new Set(["ReplaceContentTextTransformer", "AsyncReplaceContentTransformer"]);
const PIPE_THROUGH = "pipeThrough";
const DECODER = "TextDecoderStream";
const ENCODER = "TextEncoderStream";
const TRANSFORM_STREAM = "TransformStream";
const CALLS = new Set(["CallExpression", "OptionalCallExpression"]);
const MEMBERS = new Set(["MemberExpression", "OptionalMemberExpression"]);
const WRAPPERS = new Set(["TSNonNullExpression", "TSAsExpression", "TSSatisfiesExpression", "ParenthesizedExpression"]);
const UTF8_LABELS = new Set(["unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf-8", "utf8", "x-unicode20utf8"]);

const NAMES_NEW_IN_4 = new Set([
  "BufferGuardOptions",
  "ByteEngineSink",
  "LeanRegexSearchStrategy",
  "LookaheadReplacementFn",
  "LookaheadTransformEngine",
  "LookaheadTransformEngineOptions",
  "MatchSink",
  "RegexSearchState",
  "RegexSearchStrategyOptions",
  "ReplaceContentTextTransformer",
  "SearchStrategy",
  "SerialEngineCallResult",
  "SerialReplacement",
  "SerialReplacementFn",
  "SerialTransformEngine",
  "SerialTransformEngineOptions",
  "StreamIndices",
  "StreamRegexMatch",
  "TransformEngine",
  "Utf8Bytes"
]);

function importedName(specifier) {
  return specifier.imported.name ?? specifier.imported.value;
}

function nameOf(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "StringLiteral") return node.value;
  return null;
}

function requiresPackage(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    isPackageSource(node.arguments[0]?.value)
  );
}

function usesNewNames(root, j) {
  const isNew = (node) => NAMES_NEW_IN_4.has(nameOf(node));
  const namespaces = new Set();
  let found = false;
  root.find(j.ImportDeclaration).forEach(({ node }) => {
    if (!isPackageSource(node.source.value)) return;
    for (const specifier of node.specifiers ?? []) {
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
      if (specifier.type === "ImportSpecifier" && isNew(specifier.imported)) found = true;
    }
  });
  root.find(j.ExportNamedDeclaration).forEach(({ node }) => {
    if (!isPackageSource(node.source?.value)) return;
    if ((node.specifiers ?? []).some((specifier) => isNew(specifier.local))) found = true;
  });
  root.find(j.VariableDeclarator).forEach(({ node }) => {
    if (!requiresPackage(node.init)) return;
    if (node.id.type === "Identifier") namespaces.add(node.id.name);
    if (node.id.type === "ObjectPattern" && node.id.properties.some((property) => isNew(property.key))) found = true;
  });
  const isNamespace = (node) => node?.type === "Identifier" && namespaces.has(node.name);
  root.find(j.MemberExpression).forEach(({ node }) => {
    if (isNamespace(node.object) && !node.computed && isNew(node.property)) found = true;
  });
  root.find(j.TSQualifiedName).forEach(({ node }) => {
    if (isNamespace(node.left) && isNew(node.right)) found = true;
  });
  root.find(j.TSImportType).forEach(({ node }) => {
    const argument = node.argument?.literal ?? node.argument;
    if (isPackageSource(argument?.value) && isNew(node.qualifier)) found = true;
  });
  return found;
}

function isPackageSource(value) {
  return value === PACKAGE || value?.startsWith(`${PACKAGE}/`);
}

function isNewOf(node, name) {
  return node?.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === name;
}

function unwrapped(node) {
  let current = node;
  while (WRAPPERS.has(current?.type)) current = current.expression;
  return current;
}

function pipedFrom(call) {
  const callee = call.callee;
  if (!MEMBERS.has(callee.type) || callee.computed || callee.property.name !== PIPE_THROUGH) return null;
  return unwrapped(callee.object);
}

function pipedThrough(node, streamName) {
  if (!CALLS.has(node?.type) || pipedFrom(node) === null) return null;
  const stream = node.arguments[0];
  return isNewOf(stream, streamName) ? stream : null;
}

function literalText(node) {
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function isUndefined(node) {
  return !node || (node.type === "Identifier" && node.name === "undefined");
}

function namesUtf8(label) {
  if (isUndefined(label)) return true;
  const text = literalText(label);
  return text !== null && UTF8_LABELS.has(text.trim().toLowerCase());
}

function isNeverFatal(options) {
  if (isUndefined(options)) return true;
  if (options.type !== "ObjectExpression") return false;
  return options.properties.every((property) => {
    if (property.type !== "ObjectProperty" || property.computed) return false;
    const key = property.key.name ?? property.key.value;
    return key !== "fatal" || (property.value.type === "BooleanLiteral" && !property.value.value);
  });
}

function keepsByteOrderMark(decoder) {
  const options = decoder.arguments[1];
  return (
    options?.type === "ObjectExpression" &&
    options.properties.some(
      (property) =>
        property.type === "ObjectProperty" &&
        !property.computed &&
        (property.key.name ?? property.key.value) === "ignoreBOM" &&
        property.value.type === "BooleanLiteral" &&
        property.value.value
    )
  );
}

function decodesAsTheByteAdapterDoes(decoder) {
  const [label, options] = decoder.arguments;
  return namesUtf8(label) && isNeverFatal(options);
}

export default function reportTextStreamPipelines(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const importsNewNames = usesNewNames(root, j);

  const kindOf = (exported) => {
    if (STRING_ADAPTERS.has(exported)) return "string";
    if (exported === BYTE_ADAPTER) return importsNewNames ? "byte" : "string";
    return null;
  };

  const adapterLocals = new Map();
  const webNamespaces = new Set();
  root.find(j.ImportDeclaration, { source: { value: WEB } }).forEach(({ node }) => {
    for (const specifier of node.specifiers ?? []) {
      if (specifier.type === "ImportNamespaceSpecifier") webNamespaces.add(specifier.local.name);
      if (specifier.type !== "ImportSpecifier") continue;
      const kind = kindOf(importedName(specifier));
      if (kind) adapterLocals.set(specifier.local.name, kind);
    }
  });

  const adapterKindOfNew = (node) => {
    if (node?.type !== "NewExpression") return null;
    const { callee } = node;
    if (callee.type === "Identifier") return adapterLocals.get(callee.name) ?? null;
    const isNamespaced =
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.object.type === "Identifier" &&
      webNamespaces.has(callee.object.name);
    return isNamespaced ? kindOf(callee.property.name) : null;
  };

  const adapterVariables = new Map();
  const adapterKindOf = (node) =>
    node?.type === "Identifier" ? (adapterVariables.get(node.name) ?? null) : adapterKindOfNew(node);
  const streamKindOf = (node) => {
    if (node?.type === "Identifier") return adapterVariables.get(node.name) ?? null;
    return isNewOf(node, TRANSFORM_STREAM) ? adapterKindOf(node.arguments[0]) : null;
  };

  root.find(j.VariableDeclarator).forEach(({ node }) => {
    const kind = adapterKindOfNew(node.init) ?? streamKindOf(node.init);
    if (kind && node.id.type === "Identifier") adapterVariables.set(node.id.name, kind);
  });

  root.find(j.Node, ({ type }) => CALLS.has(type)).forEach((path) => {
    const { node } = path;
    const source = pipedFrom(node);
    if (!source) return;
    const kind = streamKindOf(node.arguments[0]);
    if (!kind) return;
    const decoder = pipedThrough(source, DECODER);
    const decodedBefore = decoder !== null;
    let member = path.parent;
    while (WRAPPERS.has(member.node.type)) member = member.parent;
    const encodedAfter = MEMBERS.has(member.node.type) && pipedThrough(member.parent?.node, ENCODER) !== null;
    const at = `line ${node.arguments[0].loc.start.line}`;

    const byteAdapterCanDecode = decodedBefore && decodesAsTheByteAdapterDoes(decoder);
    if (kind === "byte" && decodedBefore) {
      api.report(
        `${at}: the byte adapter, ReplaceContentTransformer, is given the strings a TextDecoderStream emits, which error it. ` +
          (byteAdapterCanDecode
            ? "Drop the TextDecoderStream, and any TextEncoderStream after it, or use ReplaceContentTextTransformer"
            : "Use ReplaceContentTextTransformer, which keeps this decoder: the byte adapter reads only UTF-8, and writes U+FFFD for malformed input")
      );
      return;
    }
    if (kind === "string" && byteAdapterCanDecode && encodedAfter) {
      api.report(
        `${at}: the string adapter sits between a TextDecoderStream and a TextEncoderStream. ` +
          "The byte adapter, ReplaceContentTransformer, can replace all three, since it takes and emits UTF-8 bytes" +
          (keepsByteOrderMark(decoder)
            ? ""
            : ". Unlike TextDecoderStream, it keeps a byte order mark at the start of the input in its output, without searching it")
      );
    }
  });

  return null;
}

export const parser = "tsx";
