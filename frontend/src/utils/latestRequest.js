export function createLatestRequestGuard() {
  let sequence = 0;
  return {
    begin: () => ++sequence,
    isCurrent: identity => identity === sequence,
    invalidate: () => { sequence += 1; },
  };
}
