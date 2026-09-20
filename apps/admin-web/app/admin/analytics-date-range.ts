/** Calendar dates for reports follow Vietnam time regardless of the browser's timezone. */
export function analyticsPresetRange(preset: string, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getTime() + 7 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  if (preset === 'month') return { from: monthStart, to: today };
  if (preset === 'lastMonth') {
    const to = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  const days = Number(preset) || 30;
  return {
    from: new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    to: today,
  };
}
