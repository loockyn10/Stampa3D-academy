/**
 * Unión-búsqueda genérica (compresión de camino) sobre claves comparables.
 * Compartida entre el cableado eléctrico de Carteles (verificación de buses en
 * `installation/wiring.ts`) y Neon (verificación de buses + MST de puentes traseros en
 * `neon/installation/`) — misma estructura, dos usos distintos, sin duplicar la lógica.
 */
export class UnionFind<T = string> {
  private readonly parent = new Map<T, T>();

  find(a: T): T {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let root = a;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as T;
    this.parent.set(a, root);
    return root;
  }

  union(a: T, b: T): void {
    this.parent.set(this.find(a), this.find(b));
  }

  connected(a: T, b: T): boolean {
    return this.find(a) === this.find(b);
  }
}
