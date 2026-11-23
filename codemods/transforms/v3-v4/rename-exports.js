/**
 * Codemod: 3.x export names -> 4.0 export names
 *
 * Renames what `replace-content-transformer`, `/web` and `/node` exported in
 * 3.0.2 and 4.0 exports under another name, wherever a file imports them
 * (named, aliased, type-only or namespace imports, `require()` destructuring,
 * `import("…")` types, and re-exports):
 *
 *   SyncReplacementTransformEngine, AsyncSerialReplacementTransformEngine -> SerialTransformEngine
 *   SyncReplacementTransformEngineOptions, AsyncSerialReplacementTransformEngineOptions -> SerialTransformEngineOptions
 *   SyncReplacementFn<T>        -> SerialReplacementFn<T, string | Iterable<string>>
 *   AsyncSerialReplacementFn<T> -> SerialReplacementFn<T>
 *   SyncTransformEngine, AsyncTransformEngine -> TransformEngine
 *   AsyncLookaheadTransformEngine        -> LookaheadTransformEngine
 *   AsyncLookaheadTransformEngineOptions -> LookaheadTransformEngineOptions
 *   ReplacementFn               -> LookaheadReplacementFn
 *   ReplaceContentTransformer, AsyncReplaceContentTransformer (/web) -> ReplaceContentTextTransformer
 *   AsyncReplaceContentTransform (/node) -> ReplaceContentTransform
 *
 * The sync engine and its options also gain the replacement type argument
 * their 3.x names implied, so `write()` and `end()` keep returning `void`.
 *
 * Two imports that become the same name merge into one specifier, local
 * aliases are kept, and names imported from elsewhere are left alone.
 *
 * Re-exports keep their 3.x public name, and are reported, as is an
 * `export *` of this package. So are a 3.x async serial engine's `write()` and
 * `end()` calls whose result is used other than by `await`, since 4.0 returns
 * `undefined` from a call that finished synchronously. So is a
 * `RegExpExecArray` type in a file that uses a regex strategy, whose matches
 * are a `StreamRegexMatch` in 4.0.
 */

const PACKAGE = "replace-content-transformer";
const WEB = `${PACKAGE}/web`;
const NODE = `${PACKAGE}/node`;

const SYNC_ENGINE = "SyncReplacementTransformEngine";
const SYNC_ENGINE_OPTIONS = "SyncReplacementTransformEngineOptions";
const SYNC_REPLACEMENT_FN = "SyncReplacementFn";
const SERIAL_REPLACEMENT_FN = "SerialReplacementFn";
const WEB_STRING_ADAPTER = "ReplaceContentTransformer";
const SYNC_RETURN_TYPE = "string | Iterable<string>";
const ASYNC_SERIAL_ENGINE = "AsyncSerialReplacementTransformEngine";
const WIDENED = [SYNC_ENGINE, SYNC_ENGINE_OPTIONS, SYNC_REPLACEMENT_FN];
const HERITAGE_CLAUSES = new Set(["TSExpressionWithTypeArguments", "TSInterfaceHeritage", "TSClassImplements"]);
const ENGINE_CALLS = new Set(["write", "end"]);
const RESULT_UNUSED_OR_AWAITED = new Set(["ExpressionStatement", "AwaitExpression"]);
const FUNCTION_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "ObjectMethod",
  "ClassPrivateMethod"
]);
const PROMISE_COMBINATORS = new Set(["resolve", "all", "allSettled", "any", "race"]);

const RENAMES = new Map([
  [
    PACKAGE,
    new Map([
      [SYNC_ENGINE, "SerialTransformEngine"],
      ["AsyncSerialReplacementTransformEngine", "SerialTransformEngine"],
      [SYNC_ENGINE_OPTIONS, "SerialTransformEngineOptions"],
      ["AsyncSerialReplacementTransformEngineOptions", "SerialTransformEngineOptions"],
      [SYNC_REPLACEMENT_FN, SERIAL_REPLACEMENT_FN],
      ["AsyncSerialReplacementFn", SERIAL_REPLACEMENT_FN],
      ["SyncTransformEngine", "TransformEngine"],
      ["AsyncTransformEngine", "TransformEngine"],
      ["AsyncLookaheadTransformEngine", "LookaheadTransformEngine"],
      ["AsyncLookaheadTransformEngineOptions", "LookaheadTransformEngineOptions"],
      ["ReplacementFn", "LookaheadReplacementFn"]
    ])
  ],
  [
    WEB,
    new Map([
      [WEB_STRING_ADAPTER, "ReplaceContentTextTransformer"],
      ["AsyncReplaceContentTransformer", "ReplaceContentTextTransformer"]
    ])
  ],
  [NODE, new Map([["AsyncReplaceContentTransform", "ReplaceContentTransform"]])]
]);

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
  SERIAL_REPLACEMENT_FN,
  "SerialTransformEngine",
  "SerialTransformEngineOptions",
  "StreamIndices",
  "StreamRegexMatch",
  "TransformEngine",
  "Utf8Bytes"
]);

function nameOf(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral" || node.type === "Literal") return node.value;
  return null;
}

function sourceOf(node) {
  const value = node?.source?.value;
  return RENAMES.has(value) ? value : null;
}

function requiredSource(node) {
  const isRequire =
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments.length === 1;
  if (!isRequire) return null;
  const value = nameOf(node.arguments[0]);
  return RENAMES.has(value) ? value : null;
}

function isPackageSource(value) {
  return value === PACKAGE || value?.startsWith(`${PACKAGE}/`);
}

function preferredQuote(source) {
  return /\bfrom\s+'/.test(source) ? "single" : "double";
}

const REGEX_STRATEGY_USES = new Set(["RegexSearchStrategy", "LeanRegexSearchStrategy", "searchStrategyFactory"]);
const EXEC_ARRAY = "RegExpExecArray";

const COMMENT_FIELDS = ["comments", "leadingComments", "trailingComments"];

function withComments(from, to) {
  for (const field of COMMENT_FIELDS) {
    if (from[field]) to[field] = from[field];
  }
  return to;
}

function importTypeSource(node) {
  const argument = node.argument?.literal ?? node.argument;
  return RENAMES.has(argument?.value) ? argument.value : null;
}

/** Whether the file uses any of `names` from this package. */
function usesNames(root, j, names) {
  const isNew = (node) => names.has(nameOf(node));
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
    if (!requiredSource(node.init)) return;
    if (node.id.type === "Identifier") namespaces.add(node.id.name);
    if (node.id.type === "ObjectPattern" && node.id.properties.some((property) => isNew(property.key))) found = true;
  });
  const isNamespace = (path) =>
    path.node?.type === "Identifier" && namespaces.has(path.node.name) && resolvesToImport(path);
  root.find(j.MemberExpression).forEach((path) => {
    const { node } = path;
    if (isNamespace(path.get("object")) && !node.computed && isNew(node.property)) found = true;
  });
  root.find(j.TSQualifiedName).forEach((path) => {
    if (isNamespace(path.get("left")) && isNew(path.node.right)) found = true;
  });
  root.find(j.TSImportType).forEach(({ node }) => {
    if (importTypeSource(node) && isNew(node.qualifier)) found = true;
  });
  return found;
}

function isTypePosition(path) {
  if (path.node.type === "TSTypeParameter") return true;
  const parent = path.parent.node;
  switch (parent.type) {
    case "TSTypeReference":
      return parent.typeName === path.node;
    case "TSQualifiedName":
      return parent.left === path.node;
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
      return parent.id === path.node;
    default:
      return HERITAGE_CLAUSES.has(parent.type) && parent.expression === path.node;
  }
}

function isImportBinding(binding) {
  const declarator = binding.parent.node;
  const isRequiredNamespace =
    declarator.type === "VariableDeclarator" && declarator.id === binding.node && requiredSource(declarator.init) !== null;
  return isRequiredNamespace || isPackageBinding(binding);
}

function declaresTypeToo(binding) {
  return ["ClassDeclaration", "ClassExpression"].includes(binding.parent.node.type);
}

function resolvesToImport(path) {
  const { name } = path.node;
  const inTypePosition = isTypePosition(path);
  for (let scope = path.scope; scope; scope = scope.parent) {
    if (inTypePosition && scope.declaresType(name)) return false;
    if (!scope.declares(name)) continue;
    const bindings = scope.getBindings()[name];
    if (bindings.some(isImportBinding)) return true;
    if (!inTypePosition || bindings.some(declaresTypeToo)) return false;
  }
  return true;
}

function mergeComments(from, into) {
  for (const field of COMMENT_FIELDS) {
    if (from[field]) into[field] = [...(into[field] ?? []), ...from[field]];
  }
}

function isTypeOnly(declaration, specifier) {
  return declaration.importKind === "type" || specifier.importKind === "type";
}

function isPackageBinding(path) {
  const parent = path.parent.node;
  if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(parent.type)) {
    return isPackageSource(path.parent.parent.node.source.value);
  }
  const pattern = path.parent.parent?.node;
  const declarator = path.parent.parent?.parent?.node;
  return (
    ["ObjectProperty", "Property"].includes(parent.type) &&
    pattern?.type === "ObjectPattern" &&
    declarator?.type === "VariableDeclarator" &&
    requiredSource(declarator.init) !== null
  );
}

function packageExportOf(binding) {
  const parent = binding.parent.node;
  if (parent.type === "ImportSpecifier") {
    return { source: binding.parent.parent.node.source.value, exported: nameOf(parent.imported) };
  }
  if (["ObjectProperty", "Property"].includes(parent.type)) {
    return { source: requiredSource(binding.parent.parent.parent.node.init), exported: nameOf(parent.key) };
  }
  return null;
}

/**
 * Each name in use, mapped to the entry point whose import of that same name a
 * renamed import merges with, or to null where a renamed import would clash.
 */
function takenNames(root, j, renameFor) {
  const names = new Map();
  const take = (name, mergesWith) => {
    names.set(name, names.has(name) && names.get(name) !== mergesWith ? null : mergesWith);
  };
  root
    .find(j.Identifier)
    .filter(isReferencePosition)
    .forEach((path) => {
      const { name } = path.node;
      const bindings = path.scope?.lookup(name)?.getBindings()[name] ?? [];
      if (bindings.length === 0) take(name, null);
      for (const binding of bindings) {
        const imported = isPackageBinding(binding) ? packageExportOf(binding) : null;
        const finalName = imported && (renameFor(imported.source, imported.exported) ?? imported.exported);
        take(name, finalName === name ? imported.source : null);
      }
    });
  return names;
}

function isReferencePosition(path) {
  const parent = path.parent.node;
  const { node } = path;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.object === node || parent.computed;
    case "TSQualifiedName":
      return parent.left === node;
    case "ObjectProperty":
    case "Property":
      if (path.parent.parent?.node.type === "ObjectPattern") return false;
      return parent.value === node || parent.computed;
    case "ClassProperty":
    case "ClassMethod":
    case "ClassPrivateProperty":
    case "ClassAccessorProperty":
    case "TSDeclareMethod":
    case "TSPropertySignature":
    case "TSMethodSignature":
    case "ObjectMethod":
      return parent.key !== node || parent.computed;
    case "TSEnumMember":
      return parent.id !== node;
    case "TSImportType":
      return parent.qualifier !== node;
    case "PrivateName":
    case "ImportSpecifier":
    case "ExportSpecifier":
    case "ImportNamespaceSpecifier":
    case "ImportDefaultSpecifier":
      return false;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return false;
    default:
      return true;
  }
}

export default function renameExports(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const at = (node) => `line ${node.loc?.start.line ?? "?"}`;
  let changed = false;

  const importsNewNames = usesNames(root, j, NAMES_NEW_IN_4);

  const renameFor = (source, name) => {
    if (source === WEB && name === WEB_STRING_ADAPTER && importsNewNames) return undefined;
    return RENAMES.get(source)?.get(name);
  };

  const taken = takenNames(root, j, renameFor);
  const isTaken = (name, source) => taken.has(name) && taken.get(name) !== source;

  const reportReExport = (specifier, renamed, publicName) =>
    api.report(
      `${at(specifier)}: re-exports ${renamed} as ${publicName}, its 3.x name; rename it if your own consumers should see the 4.0 name`
    );

  if (usesNames(root, j, REGEX_STRATEGY_USES)) {
    root
      .find(j.TSTypeReference, { typeName: { type: "Identifier", name: EXEC_ARRAY } })
      .forEach(({ node }) => {
        api.report(
          `${at(node)}: ${EXEC_ARRAY}: a match from RegexSearchStrategy is a StreamRegexMatch in 4.0, whose index and indices are stream-relative and whose input is undefined. Where this types one, use StreamRegexMatch`
        );
      });
  }

  const localRenames = new Map();
  const widenedLocals = new Map();
  const namespaces = new Map();
  let serialReplacementFnLocal = null;
  let rootImport = null;
  const asyncSerialEngineLocals = new Set();

  const rememberWidening = (local, exported) => {
    if (WIDENED.includes(exported)) {
      widenedLocals.set(local, exported);
    }
  };

  root.find(j.ImportDeclaration).forEach(({ node: declaration }) => {
    const source = sourceOf(declaration);
    if (!source) return;
    if (source === PACKAGE && declaration.specifiers?.some((specifier) => specifier.type === "ImportSpecifier")) {
      if (!rootImport || rootImport.importKind === "type") rootImport = declaration;
    }
    for (const specifier of [...(declaration.specifiers ?? [])]) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.set(specifier.local.name, source);
        continue;
      }
      if (specifier.type !== "ImportSpecifier") continue;
      const exported = nameOf(specifier.imported);
      if (source === PACKAGE && exported === SERIAL_REPLACEMENT_FN) {
        serialReplacementFnLocal = specifier.local.name;
      }
      const renamed = renameFor(source, exported);
      if (!renamed) continue;
      const local = specifier.local.name;
      rememberWidening(local, exported);
      if (exported === ASYNC_SERIAL_ENGINE) asyncSerialEngineLocals.add(local);
      const keepsLocal = local !== exported || isTaken(renamed, source);
      const rebuilt = j.importSpecifier(j.identifier(renamed), keepsLocal ? specifier.local : j.identifier(renamed));
      rebuilt.importKind = specifier.importKind;
      declaration.specifiers[declaration.specifiers.indexOf(specifier)] = withComments(specifier, rebuilt);
      if (!keepsLocal) localRenames.set(local, renamed);
      if (source === PACKAGE && renamed === SERIAL_REPLACEMENT_FN) {
        serialReplacementFnLocal ??= keepsLocal ? local : renamed;
      }
      changed = true;
    }
  });

  const reportExportAll = (declaration, source) => {
    const renames = [...RENAMES.get(source)].map(([before, after]) => `${before} (now ${after})`);
    api.report(
      `${at(declaration)}: re-exports everything from ${source}, so your own consumers see its 4.0 names in place of ${renames.join(", ")}; ` +
        "re-export the 3.x names they import if those should keep working"
    );
  };
  root.find(j.ExportAllDeclaration).forEach(({ node: declaration }) => {
    const source = sourceOf(declaration);
    if (source) reportExportAll(declaration, source);
  });

  root.find(j.ExportNamedDeclaration).forEach(({ node: declaration }) => {
    const source = sourceOf(declaration);
    if (!source) return;
    if (declaration.specifiers?.some((specifier) => specifier.type === "ExportNamespaceSpecifier")) {
      reportExportAll(declaration, source);
    }
    for (const specifier of [...(declaration.specifiers ?? [])]) {
      const exported = nameOf(specifier.local);
      const renamed = renameFor(source, exported);
      if (!renamed) continue;
      const publicName = nameOf(specifier.exported) ?? exported;
      const rebuilt = j.exportSpecifier.from({ local: j.identifier(renamed), exported: j.identifier(publicName) });
      rebuilt.exportKind = specifier.exportKind;
      declaration.specifiers[declaration.specifiers.indexOf(specifier)] = withComments(specifier, rebuilt);
      if (publicName === exported) reportReExport(specifier, renamed, publicName);
      changed = true;
    }
  });

  root.find(j.VariableDeclarator).forEach(({ node: declarator }) => {
    const source = requiredSource(declarator.init);
    if (!source) return;
    if (declarator.id.type === "Identifier") {
      namespaces.set(declarator.id.name, source);
      return;
    }
    if (declarator.id.type !== "ObjectPattern") return;
    for (const property of [...declarator.id.properties]) {
      if (!["ObjectProperty", "Property"].includes(property.type) || property.computed) continue;
      const exported = nameOf(property.key);
      const renamed = renameFor(source, exported);
      if (!renamed) continue;
      const local = nameOf(property.value);
      rememberWidening(local, exported);
      if (exported === ASYNC_SERIAL_ENGINE) asyncSerialEngineLocals.add(local);
      const keepsLocal = local !== exported || isTaken(renamed, source);
      const keptValue = property.value === property.key ? j.identifier(local) : property.value;
      const rebuilt = j.objectProperty(j.identifier(renamed), keepsLocal ? keptValue : j.identifier(renamed));
      rebuilt.shorthand = !keepsLocal;
      declarator.id.properties[declarator.id.properties.indexOf(property)] = withComments(property, rebuilt);
      if (!keepsLocal) localRenames.set(local, renamed);
      changed = true;
    }
  });

  const serialReplacementFnType = () => {
    if (serialReplacementFnLocal) return j.identifier(serialReplacementFnLocal);
    const namespace = [...namespaces].find(([, source]) => source === PACKAGE)?.[0];
    if (namespace) return j.tsQualifiedName(j.identifier(namespace), j.identifier(SERIAL_REPLACEMENT_FN));
    if (!rootImport || isTaken(SERIAL_REPLACEMENT_FN, PACKAGE)) return null;
    const specifier = j.importSpecifier(j.identifier(SERIAL_REPLACEMENT_FN), j.identifier(SERIAL_REPLACEMENT_FN));
    if (rootImport.importKind !== "type") specifier.importKind = "type";
    rootImport.specifiers.push(specifier);
    serialReplacementFnLocal = SERIAL_REPLACEMENT_FN;
    return j.identifier(SERIAL_REPLACEMENT_FN);
  };

  const syncReturnType = () =>
    j.tsUnionType([
      j.tsStringKeyword(),
      j.tsTypeReference(j.identifier("Iterable"), j.tsTypeParameterInstantiation([j.tsStringKeyword()]))
    ]);

  const widen = (exported, typeArguments, node, fnTypeFor = serialReplacementFnType) => {
    if (!typeArguments) return;
    const { params } = typeArguments;
    if (exported === SYNC_REPLACEMENT_FN) {
      if (params.length === 1) params.push(syncReturnType());
      return;
    }
    if (params.length > 2) return;
    const fnType = fnTypeFor();
    if (!fnType) {
      api.report(
        `${at(node)}: add \`string | SerialReplacementFn<TMatch, ${SYNC_RETURN_TYPE}>\` as the third type argument, so write() and end() keep returning void`
      );
      return;
    }
    if (params.length === 1) params.push(j.tsStringKeyword());
    const fnTypeArguments = j.tsTypeParameterInstantiation([params[1], syncReturnType()]);
    const fnReference =
      fnType.type === "TSImportType"
        ? Object.assign(fnType, { typeParameters: fnTypeArguments })
        : j.tsTypeReference(fnType, fnTypeArguments);
    params.push(j.tsUnionType([j.tsStringKeyword(), fnReference]));
  };

  const isPackageNamespace = (path) =>
    path.node.type === "Identifier" && namespaces.get(path.node.name) === PACKAGE && resolvesToImport(path);
  const exportedNameAt = (path) => {
    const { node } = path;
    if (node?.type === "Identifier") return resolvesToImport(path) ? widenedLocals.get(node.name) : undefined;
    const isNamespaced =
      (node?.type === "TSQualifiedName" && isPackageNamespace(path.get("left"))) ||
      (node?.type === "MemberExpression" && isPackageNamespace(path.get("object")));
    if (!isNamespaced) return undefined;
    const name = nameOf(node.right ?? node.property);
    return WIDENED.includes(name) ? name : undefined;
  };

  root.find(j.TSTypeReference).forEach((path) => {
    const { node } = path;
    const exported = exportedNameAt(path.get("typeName"));
    if (exported) widen(exported, node.typeParameters, node);
  });
  root.find(j.NewExpression).forEach((path) => {
    const { node } = path;
    const exported = exportedNameAt(path.get("callee"));
    if (exported === SYNC_ENGINE) widen(exported, node.typeParameters, node);
  });
  root.find(j.Node, (node) => ["ClassDeclaration", "ClassExpression"].includes(node.type)).forEach((path) => {
    const { node } = path;
    if (!node.superClass) return;
    const exported = exportedNameAt(path.get("superClass"));
    if (exported === SYNC_ENGINE) widen(exported, node.superTypeParameters, node);
  });
  root.find(j.Node, (node) => HERITAGE_CLAUSES.has(node.type)).forEach((path) => {
    const { node } = path;
    const exported = exportedNameAt(path.get("expression"));
    if (exported) widen(exported, node.typeParameters, node);
  });
  root.find(j.TSImportType).forEach(({ node }) => {
    const source = importTypeSource(node);
    const exported = nameOf(node.qualifier);
    const renamed = source && renameFor(source, exported);
    if (!renamed) return;
    if (source === PACKAGE && WIDENED.includes(exported)) {
      widen(exported, node.typeParameters, node, () =>
        j.tsImportType(j.stringLiteral(PACKAGE), j.identifier(SERIAL_REPLACEMENT_FN))
      );
    }
    node.qualifier = j.identifier(renamed);
    changed = true;
  });

  const isAsyncSerialEngine = (path) => {
    const callee = path.node;
    if (callee?.type === "Identifier") return asyncSerialEngineLocals.has(callee.name) && resolvesToImport(path);
    return (
      callee?.type === "MemberExpression" &&
      isPackageNamespace(path.get("object")) &&
      nameOf(callee.property) === ASYNC_SERIAL_ENGINE
    );
  };
  const asyncSerialEngineScopes = new Map();
  const rememberEngine = (path, name) => {
    const scope = path.scope?.lookup(name);
    if (scope) asyncSerialEngineScopes.set(scope, [...(asyncSerialEngineScopes.get(scope) ?? []), name]);
  };
  root.find(j.VariableDeclarator).forEach((path) => {
    const { node } = path;
    if (node.id.type === "Identifier" && node.init?.type === "NewExpression" && isAsyncSerialEngine(path.get("init", "callee"))) {
      rememberEngine(path, node.id.name);
    }
  });
  root.find(j.AssignmentExpression).forEach((path) => {
    const { node } = path;
    if (node.left.type === "Identifier" && node.right.type === "NewExpression" && isAsyncSerialEngine(path.get("right", "callee"))) {
      rememberEngine(path, node.left.name);
    }
  });
  const isAsyncSerialEngineReference = (path) => {
    const { name } = path.node;
    return asyncSerialEngineScopes.get(path.scope?.lookup(name))?.includes(name) ?? false;
  };
  const isPromiseCombinatorCall = (node) =>
    node?.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    nameOf(node.callee.object) === "Promise" &&
    PROMISE_COMBINATORS.has(nameOf(node.callee.property));
  const isAsyncFunction = (node) => FUNCTION_NODE_TYPES.has(node?.type) && node.async;
  const resultIsSafe = (path) => {
    const parent = path.parent.node;
    if (RESULT_UNUSED_OR_AWAITED.has(parent.type)) return true;
    if (parent.type === "UnaryExpression" && parent.operator === "void") return true;
    if (isPromiseCombinatorCall(parent)) return true;
    if (parent.type === "ArrayExpression" && isPromiseCombinatorCall(path.parent.parent?.node)) return true;
    if (parent.type === "ArrowFunctionExpression" && parent.body === path.node) return parent.async;
    if (parent.type === "ReturnStatement") {
      for (let current = path.parent; current; current = current.parent) {
        if (FUNCTION_NODE_TYPES.has(current.node.type)) return isAsyncFunction(current.node);
      }
    }
    return false;
  };
  root
    .find(j.CallExpression)
    .filter((path) => {
      const { callee } = path.node;
      const isEngineCall =
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        ENGINE_CALLS.has(nameOf(callee.property)) &&
        isAsyncSerialEngineReference(path.get("callee", "object"));
      return isEngineCall && !resultIsSafe(path);
    })
    .forEach(({ node }) => {
      api.report(
        `${at(node)}: ${node.callee.object.name}'s write() and end() return undefined in 4.0 when they finish synchronously, rather than a Promise. ` +
          "Await the call, or wrap it in Promise.resolve()"
      );
    });

  const renameMember = (path, key) => {
    const container = path.node;
    const namespacePath = path.get(container.type === "TSQualifiedName" ? "left" : "object");
    const namespace = namespacePath.node;
    if (namespace.type !== "Identifier" || !namespaces.has(namespace.name) || !resolvesToImport(namespacePath)) return;
    const source = namespaces.get(namespace.name);
    const exported = nameOf(container[key]);
    const renamed = renameFor(source, exported);
    if (!renamed || container.computed) return;
    container[key] = j.identifier(renamed);
    changed = true;
  };
  root.find(j.TSQualifiedName).forEach((path) => renameMember(path, "right"));
  root.find(j.MemberExpression).forEach((path) => renameMember(path, "property"));

  root.find(j.ExportNamedDeclaration, (node) => !node.source).forEach(({ node: declaration }) => {
    for (const specifier of [...(declaration.specifiers ?? [])]) {
      const local = nameOf(specifier.local);
      const renamed = localRenames.get(local);
      if (!renamed) continue;
      const publicName = nameOf(specifier.exported) ?? local;
      const rebuilt = j.exportSpecifier.from({ local: j.identifier(renamed), exported: j.identifier(publicName) });
      rebuilt.exportKind = specifier.exportKind;
      declaration.specifiers[declaration.specifiers.indexOf(specifier)] = withComments(specifier, rebuilt);
      if (publicName === local) reportReExport(specifier, renamed, publicName);
    }
  });

  root
    .find(j.Identifier)
    .filter((path) => localRenames.has(path.node.name) && isReferencePosition(path) && resolvesToImport(path))
    .forEach((path) => {
      const property = path.parent.node;
      const isShorthandValue =
        ["ObjectProperty", "Property"].includes(property.type) && property.shorthand && property.value === path.node;
      if (isShorthandValue) {
        path.parent.replace(
          withComments(property, j.objectProperty(j.identifier(path.node.name), j.identifier(localRenames.get(path.node.name))))
        );
        return;
      }
      path.node.name = localRenames.get(path.node.name);
    });

  changed = mergeDuplicateImports(root, j) || changed;
  changed = mergeDuplicateRequires(root, j) || changed;

  if (!changed) return null;
  return root.toSource({ quote: preferredQuote(fileInfo.source) });
}

function mergeDuplicateImports(root, j) {
  const trimmed = new Set();
  const seen = new Map();
  root.find(j.ImportDeclaration).forEach((path) => {
    const declaration = path.node;
    const source = sourceOf(declaration);
    if (!source) return;
    declaration.specifiers = declaration.specifiers.filter((specifier) => {
      if (specifier.type !== "ImportSpecifier") return true;
      const key = `${source}:${nameOf(specifier.imported)}:${specifier.local.name}`;
      const earlier = seen.get(key);
      if (!earlier) {
        seen.set(key, { declaration, specifier });
        return true;
      }
      if (isTypeOnly(earlier.declaration, earlier.specifier) && !isTypeOnly(declaration, specifier)) {
        if (earlier.declaration.importKind === "type") {
          seen.set(key, { declaration, specifier });
          earlier.declaration.specifiers = earlier.declaration.specifiers.filter((s) => s !== earlier.specifier);
          trimmed.add(earlier.declaration);
          mergeComments(earlier.specifier, specifier);
          return true;
        }
        earlier.specifier.importKind = "value";
      }
      mergeComments(specifier, earlier.specifier);
      trimmed.add(declaration);
      return false;
    });
  });
  root
    .find(j.ImportDeclaration)
    .filter(({ node }) => trimmed.has(node) && node.specifiers.length === 0)
    .remove();
  return trimmed.size > 0;
}

function mergeDuplicateRequires(root, j) {
  let merged = false;
  const seenByScope = new Map();
  root
    .find(j.VariableDeclarator)
    .filter(({ node }) => requiredSource(node.init) && node.id.type === "ObjectPattern")
    .forEach((path) => {
      const { node } = path;
      const source = requiredSource(node.init);
      if (!seenByScope.has(path.scope)) seenByScope.set(path.scope, new Map());
      const seen = seenByScope.get(path.scope);
      node.id.properties = node.id.properties.filter((property) => {
        if (!["ObjectProperty", "Property"].includes(property.type) || property.computed) return true;
        const key = `${source}:${nameOf(property.key)}:${nameOf(property.value)}`;
        if (seen.has(key)) {
          mergeComments(property, seen.get(key));
          merged = true;
          return false;
        }
        seen.set(key, property);
        return true;
      });
      if (node.id.properties.length > 0) return;
      const declaration = path.parent;
      if (declaration.node.declarations.length === 1) declaration.prune();
      else path.prune();
    });
  return merged;
}

export const parser = "tsx";
