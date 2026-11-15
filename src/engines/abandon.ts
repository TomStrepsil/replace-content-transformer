export function ignore(): void {}

export async function closeAbandoned(replacement: AsyncIterable<string>): Promise<void> {
  if (replacement instanceof ReadableStream && !replacement.locked) return replacement.cancel();
  const iterator = replacement[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
}
