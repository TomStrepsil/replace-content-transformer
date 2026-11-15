export function ignore(): void {}

export async function closeAbandoned(replacement: AsyncIterable<string>): Promise<void> {
  const iterator = replacement[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
}
