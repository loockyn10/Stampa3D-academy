/** Volumen (mm³) del tronco de cono de radios r1, r2 y altura h. Con r1 = r2 es el cilindro π·r²·h. */
export function frustumVolumeMm3(r1: number, r2: number, h: number): number {
  return (Math.PI * Math.abs(h) * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
}

/**
 * Capacidad geométrica aproximada (ml) integrando el perfil interior punto a punto (suma de troncos de cono).
 * "Geométrica": llena hasta el borde, sin descontar meniscos, inclinación ni volumen útil real.
 */
export function capacityMl(innerPoints: { r: number; z: number }[]): number {
  let v = 0;
  for (let i = 1; i < innerPoints.length; i++) {
    const a = innerPoints[i - 1], b = innerPoints[i];
    v += frustumVolumeMm3(a.r, b.r, b.z - a.z);
  }
  return v / 1000;
}
