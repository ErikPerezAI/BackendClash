/**
 * Controlador de Enciclopedia de Datos de Clash of Clans (Game Data).
 * Expone listas y detalles con HP, daño, imágenes y niveles para defensas,
 * hechizos y equipamientos de héroes.
 */

import * as gameDataService from '../services/gameData.service.js';

/**
 * GET /api/coc/game-data/buildings
 * Lista todas las defensas y estructuras con su rango de niveles e imagen
 */
export const getDefenses = (req, res) => {
  try {
    const defenses = gameDataService.getAllDefenses();
    return res.status(200).json({
      total: defenses.length,
      defenses
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener defensas', detail: error.message });
  }
};

/**
 * GET /api/coc/game-data/buildings/:id
 * Detalle de una defensa específica. Permite query param `?level=X`
 */
export const getDefenseDetail = (req, res) => {
  try {
    const { id } = req.params;
    const { level, supercharge } = req.query;

    const defense = gameDataService.getDefenseById(id, level, supercharge);
    if (!defense) {
      return res.status(404).json({
        error: `Defensa o estructura '${id}' no encontrada` + (level ? ` en el nivel ${level}` : '')
      });
    }

    return res.status(200).json(defense);
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar defensa', detail: error.message });
  }
};

/**
 * GET /api/coc/game-data/spells
 * Lista todos los hechizos disponibles
 */
export const getSpells = (req, res) => {
  try {
    const spells = gameDataService.getAllSpells();
    return res.status(200).json({
      total: spells.length,
      spells
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener hechizos', detail: error.message });
  }
};

/**
 * GET /api/coc/game-data/spells/:id
 * Detalle de un hechizo específico. Permite query param `?level=X`
 */
export const getSpellDetail = (req, res) => {
  try {
    const { id } = req.params;
    const { level } = req.query;

    const spell = gameDataService.getSpellById(id, level);
    if (!spell) {
      return res.status(404).json({
        error: `Hechizo '${id}' no encontrado` + (level ? ` en el nivel ${level}` : '')
      });
    }

    return res.status(200).json(spell);
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar hechizo', detail: error.message });
  }
};

/**
 * GET /api/coc/game-data/equipment
 * Lista todo el equipamiento heroico (habilidades)
 */
export const getEquipment = (req, res) => {
  try {
    const equipment = gameDataService.getAllEquipment();
    return res.status(200).json({
      total: equipment.length,
      equipment
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener equipamiento', detail: error.message });
  }
};

/**
 * GET /api/coc/game-data/equipment/:id
 * Detalle de un equipamiento heroico. Permite query param `?level=X`
 */
export const getEquipmentDetail = (req, res) => {
  try {
    const { id } = req.params;
    const { level } = req.query;

    const item = gameDataService.getEquipmentById(id, level);
    if (!item) {
      return res.status(404).json({
        error: `Equipamiento '${id}' no encontrado` + (level ? ` en el nivel ${level}` : '')
      });
    }

    return res.status(200).json(item);
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar equipamiento', detail: error.message });
  }
};

