/**
 * ============================================================================
 * CLASH TACTICS - SUPERCELL IDS COMPATIBILITY FACADE
 * ============================================================================
 * Capa de fachada y retrocompatibilidad para los identificadores numéricos de Supercell.
 * Todos los mapas y funciones ahora se generan dinámicamente y se indexan en O(1)
 * a partir de `cocMasterGameData.json` (Fuente Única de Verdad - SSOT) a través de `cocGameData.js`.
 *
 * Mantiene intactas las firmas de exportación para que ningún servicio existente se rompa.
 */

export {
  SUPERCELL_BUILDINGS,
  SUPERCELL_TRAPS,
  SUPERCELL_HEROES,
  SUPERCELL_SPELLS,
  SUPERCELL_UNITS,
  SUPERCELL_PETS,
  SUPERCELL_EQUIPMENT,
  SUPERCELL_HELPERS,
  SUPERCELL_GUARDIANS,
  SUPERCELL_BUILDER_BASE,
  resolveSupercellEntity
} from './cocGameData.js';

import {
  SUPERCELL_BUILDINGS,
  SUPERCELL_TRAPS,
  SUPERCELL_HEROES,
  SUPERCELL_SPELLS,
  SUPERCELL_UNITS,
  SUPERCELL_PETS,
  SUPERCELL_EQUIPMENT,
  SUPERCELL_HELPERS,
  SUPERCELL_GUARDIANS,
  SUPERCELL_BUILDER_BASE,
  resolveSupercellEntity
} from './cocGameData.js';

export default {
  SUPERCELL_BUILDINGS,
  SUPERCELL_TRAPS,
  SUPERCELL_HEROES,
  SUPERCELL_SPELLS,
  SUPERCELL_UNITS,
  SUPERCELL_PETS,
  SUPERCELL_EQUIPMENT,
  SUPERCELL_HELPERS,
  SUPERCELL_GUARDIANS,
  SUPERCELL_BUILDER_BASE,
  resolveSupercellEntity
};
