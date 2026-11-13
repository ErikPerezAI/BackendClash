/**
 * Limpia y codifica un tag de jugador o clan para que sea seguro usar en una URL.
 * Si el tag empieza con # o no, lo asegura y lo codifica como %23.
 *
 * @param {string} tag
 * @returns {string} Tag codificado de forma segura
 */
export const encodeTag = (tag) => {
  if (!tag) return '';
  // Si el tag ya viene con %23, lo decodificamos primero para evitar doble codificación
  const decoded = decodeURIComponent(tag);
  // Eliminamos el '#' si lo trae y lo volvemos a poner para asegurar que solo haya uno
  const cleanTag = decoded.startsWith('#') ? decoded.substring(1) : decoded;
  // Retornamos el tag codificado
  return encodeURIComponent(`#${cleanTag.toUpperCase()}`);
};
