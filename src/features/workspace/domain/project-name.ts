export function suggestedProjectName(goal: string, fallback: string) {
  const line = goal.trim().split(/[\r\n]/, 1)[0]?.replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length <= 80 ? line : `${line.slice(0, 77).trimEnd()}…`;
}
