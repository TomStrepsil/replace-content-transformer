const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

function endsWithHighSurrogate(text: string): boolean {
  const lastCodeUnit = text.charCodeAt(text.length - 1);
  return (
    lastCodeUnit >= HIGH_SURROGATE_MIN && lastCodeUnit <= HIGH_SURROGATE_MAX
  );
}

export default endsWithHighSurrogate;