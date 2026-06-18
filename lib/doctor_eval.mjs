export function parseEvalValue(value) {
  if (typeof value === 'string') return JSON.parse(value);
  if (value && typeof value === 'object') return value;
  throw new Error(`unexpected eval value: ${typeof value}`);
}
