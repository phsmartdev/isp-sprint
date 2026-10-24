/** Agrupa uma lista por chave (evita filtrar a lista inteira para cada item: O(n) em vez de O(n²)). */
export function groupBy<T, K>(list: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}
