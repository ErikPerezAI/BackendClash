/**
 * Rutas de Enciclopedia de Juego y Calculadora Táctica de Daño de Clash of Clans.
 */

import { Router } from 'express';
import * as gameDataController from '../controllers/gameData.controller.js';
import * as calculatorController from '../controllers/calculator.controller.js';

const router = Router();

// =============================================================================
// 1. ENCICLOPEDIA / GAME DATA
// =============================================================================

// Estructuras y Defensas
router.get('/game-data/buildings', gameDataController.getDefenses);
router.get('/game-data/buildings/:id', gameDataController.getDefenseDetail);

// Hechizos
router.get('/game-data/spells', gameDataController.getSpells);
router.get('/game-data/spells/:id', gameDataController.getSpellDetail);

// Equipamiento y Habilidades Heroicas
router.get('/game-data/equipment', gameDataController.getEquipment);
router.get('/game-data/equipment/:id', gameDataController.getEquipmentDetail);

// =============================================================================
// 2. CALCULADORA TÁCTICA DE DAÑO
// =============================================================================

// Generador de Recetas Óptimas de Destrucción (ZapQuake, Flecha Gigante, Bola de Fuego)
router.post('/calculator/optimal-recipes', calculatorController.getOptimalRecipes);
router.get('/calculator/optimal-recipes', calculatorController.getOptimalRecipes);

export default router;

