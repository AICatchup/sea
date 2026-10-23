/** Decode the provider's signed, little-endian 16-bit samples without an
 * intermediate JavaScript number array. Each call owns its mutable result. */
export function decodeElevation(base64: string, expectedSamples: number): Int16Array {
  const native = (Uint8Array as typeof Uint8Array & {
    fromBase64?: (source: string) => Uint8Array;
  }).fromBase64;
  if (native) {
    const bytes = native.call(Uint8Array, base64);
    if (bytes.byteLength !== expectedSamples * 2) throw new Error('Incomplete elevation grid');
    // All shipped data is little-endian. Preserve it on other host byte orders too.
    const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    if (!littleEndian) {
      for (let i = 0; i < bytes.length; i += 2) {
        const low = bytes[i]; bytes[i] = bytes[i + 1]; bytes[i + 1] = low;
      }
    }
    return new Int16Array(bytes.buffer, bytes.byteOffset, expectedSamples);
  }
  // Older browsers retain at most one decoded string, rather than the
  // iterator/number-array expansion caused by Uint8Array.from(atob(...)).
  const binary = atob(base64);
  if (binary.length !== expectedSamples * 2) throw new Error('Incomplete elevation grid');
  const values = new Int16Array(expectedSamples);
  for (let i = 0; i < values.length; i++) {
    values[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  }
  return values;
}
