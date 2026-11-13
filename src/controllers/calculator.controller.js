/**
 * Controlador de la Calculadora Táctica de Daño de Clash of Clans.
 * Recibe una estructura objetivo y los niveles del usuario y genera
 * las recetas óptimas para destruirla.
 */

import * as calculatorService from '../services/calculator.service.js';

/**
 * POST /api/coc/calculator/optimal-recipes
 * GET  /api/coc/calculator/optimal-recipes
 *
 * Calcula las recetas óptimas para derribar una defensa.
 *
 * Formato del body (POST):
 * {
 *   "target": {
 *     "building": "air_defense",
 *     "level": 13
 *   },
 *   "userLevels": {
 *     "lightning": 11,
 *     "earthquake": 5,
 *     "giant_arrow": 18,
 *     "fireball": 24
 *   }
 * }
 */
export const getOptimalRecipes = (req, res) => {
  try {
    const isPost = req.method === 'POST';
    const body = isPost ? (req.body || {}) : {};
    const query = req.query || {};

    // 1. Extraer target
    const building = body.target?.building || body.building || query.building;
    const level = body.target?.level || body.level || query.level;
    const supercharge = body.target?.supercharge ?? body.supercharge ?? query.supercharge ?? null;

    if (!building) {
      return res.status(400).json({
        error: "El campo 'building' es obligatorio (ej: 'air_defense', 'scattershot', 'inferno_tower')"
      });
    }

    if (!level) {
      return res.status(400).json({
        error: "El campo 'level' es obligatorio para la estructura objetivo (ej: 13)"
      });
    }

    // 2. Extraer userLevels preservando explícitamente null / 0 cuando el usuario desactiva una habilidad
    const pickUserLevel = (...keys) => {
      for (const k of keys) {
        if (body.userLevels && Object.prototype.hasOwnProperty.call(body.userLevels, k)) {
          return body.userLevels[k];
        }
        if (Object.prototype.hasOwnProperty.call(body, k)) {
          return body[k];
        }
        if (Object.prototype.hasOwnProperty.call(query, k)) {
          return query[k];
        }
      }
      return undefined;
    };

    const userLevels = {
      lightning: pickUserLevel('lightning'),
      earthquake: pickUserLevel('earthquake'),
      giant_arrow: pickUserLevel('giant_arrow'),
      fireball: pickUserLevel('fireball'),
      spiky_ball: pickUserLevel('spiky_ball'),
      seeking_shield: pickUserLevel('seeking_shield'),
      rocket_spear: pickUserLevel('rocket_spear'),
      rocket_backpack: pickUserLevel('rocket_backpack', 'duque')
    };

    // 3. Ejecutar cálculo
    const result = calculatorService.calculateOptimalRecipes({
      building: String(building),
      level: Number(level),
      supercharge: supercharge !== null ? Number(supercharge) : null,
      userLevels
    });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error: 'Error al calcular recetas de daño',
      detail: error.message
    });
  }
};

