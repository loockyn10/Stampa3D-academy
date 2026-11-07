/** Resumen de conteo del panel de búsqueda de Mi Taller: «5 productos» o, con filtros activos, «2 de 5 productos». */
export function workshopCountLabel(shown: number, total: number, singular: string, plural: string): string {
  const noun = (total === 1 ? singular : plural);
  return shown === total ? `${total} ${noun}` : `${shown} de ${total} ${noun}`;
}
