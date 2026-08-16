function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('JCS strings must not contain lone surrogates');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('JCS strings must not contain lone surrogates');
    }
  }
}

function canonicalize(value) {
  if (typeof value === 'string') {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => {
        assertValidUnicode(key);
        return `${JSON.stringify(key)}:${canonicalize(value[key])}`;
      })
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported JCS value type: ${typeof value}`);
}

export function canonicalizeJcs(value) {
  return canonicalize(value);
}
