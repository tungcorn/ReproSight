let counter = 0;

export function nextFindingId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function resetFindingIds(): void {
  counter = 0;
}
