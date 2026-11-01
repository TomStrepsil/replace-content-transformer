const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;

function endsWithHighSurrogate(text: string, end = text.length): boolean {
  const lastCodeUnit = text.charCodeAt(end - 1);
  return (
    lastCodeUnit >= HIGH_SURROGATE_MIN && lastCodeUnit <= HIGH_SURROGATE_MAX
  );
}

export default endsWithHighSurrogate;