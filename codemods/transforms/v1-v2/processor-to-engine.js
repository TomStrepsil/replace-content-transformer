/**
 * Codemod: replacement processors -> transform engines (v1 -> v2)
 *
 * Run this AFTER replacement-callback-positional-to-context.
 *
 * Transforms:
 *   1. Renames the five deprecated processor classes to their engine equivalents
 *      in both `new` expressions and named import specifiers.
 *   2. Deduplicates import specifiers when multiple processors map to the same
 *      engine name (e.g. FunctionReplacementProcessor and StaticReplacementProcessor
 *      both become SyncReplacementTransformEngine).
 *   3. When an engine is constructed inline as the first argument of an adapter
 *      constructor and a stopReplacingSignal is passed as the second argument,
 *      moves the signal into the engine options object and removes it from the
 *      adapter call.
 *   4. Strips the now-dropped type parameter from adapter constructors
 *      (e.g. new ReplaceContentTransformer<Promise<string>>(...)).
 *
 * Processor -> Engine mapping:
 *   StaticReplacementProcessor            -> SyncReplacementTransformEngine
 *   FunctionReplacementProcessor          -> SyncReplacementTransformEngine
 *   IterableFunctionReplacementProcessor  -> SyncReplacementTransformEngine
 *   AsyncFunctionReplacementProcessor     -> AsyncSerialReplacementTransformEngine
 *   AsyncIterableFunctionReplacementProcessor -> AsyncSerialReplacementTransformEngine
 *
 * Limitations:
 *   - Aliased imports (import { FunctionReplacementProcessor as FRP }) are not
 *     renamed; the local alias and all its usages must be updated manually.
 *   - When stopReplacingSignal is held in a variable rather than inlined,
 *     it cannot be moved automatically; TypeScript will surface the remaining
 *     mismatch after migration.
 */

const PROCESSOR_TO_ENGINE = new Map([
  ["StaticReplacementProcessor", "SyncReplacementTransformEngine"],
  ["FunctionReplacementProcessor", "SyncReplacementTransformEngine"],
  ["IterableFunctionReplacementProcessor", "SyncReplacementTransformEngine"],
  ["AsyncFunctionReplacementProcessor", "AsyncSerialReplacementTransformEngine"],
  [
    "AsyncIterableFunctionReplacementProcessor",
    "AsyncSerialReplacementTransformEngine",
  ],
]);

const ADAPTER_NAMES = new Set([
  "ReplaceContentTransformer",
  "AsyncReplaceContentTransformer",
  "ReplaceContentTransform",
  "AsyncReplaceContentTransform",
]);

function identifierName(node) {
  return node?.type === "Identifier" ? node.name : null;
}

export default function processorToEngine(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let changed = false;

  // 1. Rename processor import specifiers
  root.find(j.ImportSpecifier).forEach((path) => {
    const name = identifierName(path.node.imported);
    if (!name) return;
    const engineName = PROCESSOR_TO_ENGINE.get(name);
    if (!engineName) return;

    const isShorthand = path.node.local.name === name;
    path.node.imported = j.identifier(engineName);
    if (isShorthand) {
      path.node.local = j.identifier(engineName);
    }
    changed = true;
  });

  // Deduplicate specifiers: multiple processors may collapse to the same engine name
  root.find(j.ImportDeclaration).forEach((path) => {
    const before = path.node.specifiers.length;
    const seen = new Set();
    path.node.specifiers = path.node.specifiers.filter((spec) => {
      if (spec.type !== "ImportSpecifier") return true;
      const key = `${identifierName(spec.imported)}:${spec.local.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (path.node.specifiers.length !== before) changed = true;
  });

  // 2. Rename new XxxProcessor(...) expressions
  root
    .find(j.NewExpression, (node) => {
      const name = identifierName(node.callee);
      return name != null && PROCESSOR_TO_ENGINE.has(name);
    })
    .forEach((path) => {
      path.node.callee = j.identifier(
        PROCESSOR_TO_ENGINE.get(path.node.callee.name)
      );
      changed = true;
    });

  // 3. Move inline stopReplacingSignal from adapter 2nd arg into engine options
  // Matches: new Adapter(new Engine({ ... }), signal)
  // Produces: new Adapter(new Engine({ ..., stopReplacingSignal: signal }))
  root
    .find(j.NewExpression, (node) => {
      const name = identifierName(node.callee);
      return (
        name != null &&
        ADAPTER_NAMES.has(name) &&
        node.arguments.length === 2 &&
        node.arguments[0]?.type === "NewExpression"
      );
    })
    .forEach((path) => {
      const [engineNew, signalArg] = path.node.arguments;
      const engineArgs = engineNew.arguments;

      if (
        engineArgs.length !== 1 ||
        engineArgs[0].type !== "ObjectExpression"
      ) {
        return;
      }

      engineArgs[0].properties.push(
        j.property(
          "init",
          j.identifier("stopReplacingSignal"),
          signalArg
        )
      );
      path.node.arguments = [engineNew];
      changed = true;
    });

  // 4. Strip type parameters from adapter constructors
  // e.g. new ReplaceContentTransformer<Promise<string>>(...) -> new ReplaceContentTransformer(...)
  root
    .find(j.NewExpression, (node) => {
      const name = identifierName(node.callee);
      return name != null && ADAPTER_NAMES.has(name) && node.typeParameters != null;
    })
    .forEach((path) => {
      path.node.typeParameters = null;
      changed = true;
    });

  if (!changed) return null;
  return root.toSource();
}

export const parser = "tsx";
