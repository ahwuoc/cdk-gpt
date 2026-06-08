export function stripWrappingQuotes(value: string) {
  let output = value.trim();

  while (output.length >= 2) {
    const first = output[0];
    const last = output[output.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      output = output.slice(1, -1).trim();
      continue;
    }
    break;
  }

  return output;
}

export function readEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;

  const normalized = stripWrappingQuotes(value);
  return normalized || undefined;
}

export function readCsvEnv(name: string) {
  return readEnv(name)
    ?.split(",")
    .map(stripWrappingQuotes)
    .filter(Boolean);
}
