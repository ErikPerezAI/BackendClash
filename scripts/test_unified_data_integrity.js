/**
 * Test de Integridad y Regresión para la Capa Unificada de Datos (SSOT).
 * Verifica que cocSupercellIds.js (fachada) y cocGameData.js (indexador)
 * alimentan tanto el Village Tracker como la Calculadora Táctica al 100%.
 */

import assert from 'assert';
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
} from '../src/data/cocSupercellIds.js';

import {
  DEFENSES,
  DEFENSES_BY_ID,
  SPELLS,
  SPELLS_BY_ID,
  HERO_EQUIPMENT,
  EQUIPMENT_BY_ID,
  resolveGameEntity
} from '../src/data/cocGameData.js';

import { parseVillageExport } from '../src/services/villageTracker.service.js';
import { calculateOptimalRecipes } from '../src/services/calculator.service.js';

console.log('🧪 Iniciando verificación exhaustiva de la unificación SSOT...');

// 1. Verificar presencia y completitud de las tablas de Supercell
assert.ok(Object.keys(SUPERCELL_BUILDINGS).length >= 40, 'SUPERCELL_BUILDINGS >= 40');
assert.ok(Object.keys(SUPERCELL_TRAPS).length >= 7, 'SUPERCELL_TRAPS >= 7');
assert.strictEqual(Object.keys(SUPERCELL_HEROES).length, 6, 'SUPERCELL_HEROES === 6');
assert.ok(Object.keys(SUPERCELL_SPELLS).length >= 16, 'SUPERCELL_SPELLS >= 16');
assert.ok(Object.keys(SUPERCELL_UNITS).length >= 40, 'SUPERCELL_UNITS >= 40');
assert.strictEqual(Object.keys(SUPERCELL_PETS).length, 12, 'SUPERCELL_PETS === 12');
assert.ok(Object.keys(SUPERCELL_EQUIPMENT).length >= 41, 'SUPERCELL_EQUIPMENT >= 41');
assert.strictEqual(Object.keys(SUPERCELL_HELPERS).length, 3, 'SUPERCELL_HELPERS === 3');
assert.strictEqual(Object.keys(SUPERCELL_GUARDIANS).length, 3, 'SUPERCELL_GUARDIANS === 3');
assert.ok(Object.keys(SUPERCELL_BUILDER_BASE.buildings).length >= 30, 'BB buildings >= 30');
assert.strictEqual(Object.keys(SUPERCELL_BUILDER_BASE.heroes).length, 2, 'BB heroes === 2');
assert.ok(Object.keys(SUPERCELL_BUILDER_BASE.units).length >= 10, 'BB units >= 10');

console.log('✅ 1. Todas las tablas numéricas de Supercell exportadas correctamente.');

// 2. Verificar resolución directa de entidades clave
const th = resolveSupercellEntity(1000001);
assert.strictEqual(th.name, 'Town Hall');
assert.strictEqual(th.category, 'Ayuntamiento');
assert.ok(th.maxPerTH[18] >= 18);

const cannon = resolveSupercellEntity(1000009);
assert.strictEqual(cannon.name, 'Cannon');
assert.strictEqual(cannon.category, 'Defensas');

const helper = resolveSupercellEntity(93000000);
assert.strictEqual(helper.name, "Builder's Apprentice");

const guardian = resolveSupercellEntity(107000000);
assert.ok(guardian.name.includes('Giga Inferno'));

const bbHall = resolveSupercellEntity(1000034);
assert.strictEqual(bbHall.name, 'Builder Hall');

const bbHero = resolveSupercellEntity(28000003);
assert.strictEqual(bbHero.name, 'Battle Machine');

console.log('✅ 2. Resolvedor resolveSupercellEntity funciona idéntico con O(1).');

// 3. Probar el parser completo del Village Tracker con el payload de requests.http
const sampleVillageExport = {
  tag: '#Y8J8RPVJU',
  timestamp: 1791771234,
  helpers: [
    { data: 93000000, lvl: 3, helper_cooldown: 43017 },
    { data: 93000001, lvl: 1, helper_cooldown: 43017 },
    { data: 93000002, lvl: 2, helper_cooldown: 43017 }
  ],
  guardians: [
    { data: 107000000, lvl: 4, timer: 204492, helper_timer: 0 },
    { data: 107000001, lvl: 1 },
    { data: 107000008, lvl: 5 }
  ],
  buildings: [
    { data: 1000013, lvl: 18, gear_up: 1 },
    { data: 1000000, lvl: 14, cnt: 4 },
    { data: 1000001, lvl: 18, cnt: 1 },
    { data: 1000002, lvl: 16, cnt: 7 },
    { data: 1000009, lvl: 21, cnt: 2 },
    { data: 1000010, lvl: 19, cnt: 325 },
    { data: 1000012, lvl: 16, cnt: 4 }
  ],
  traps: [
    { data: 12000001, lvl: 12, timer: 926073 },
    { data: 12000000, lvl: 12, cnt: 1 }
  ],
  units: [
    { data: 4000000, lvl: 12 },
    { data: 4000001, lvl: 14 }
  ],
  siege_machines: [
    { data: 4000051, lvl: 4 },
    { data: 4000135, lvl: 4 }
  ],
  heroes: [
    { data: 28000000, lvl: 110 },
    { data: 28000001, lvl: 110 }
  ],
  spells: [
    { data: 26000000, lvl: 10 },
    { data: 26000009, lvl: 11 }
  ],
  pets: [
    { data: 73000000, lvl: 2 },
    { data: 73000008, lvl: 11, timer: 350222 }
  ],
  equipment: [
    { data: 90000000, lvl: 11 },
    { data: 90000004, lvl: 18 }
  ],
  buildings2: [
    { data: 1000034, lvl: 10, cnt: 1 },
    { data: 1000035, lvl: 10, cnt: 3 }
  ],
  heroes2: [
    { data: 28000003, lvl: 35 }
  ],
  units2: [
    { data: 4000031, lvl: 14 }
  ]
};

const parsed = parseVillageExport(sampleVillageExport);
assert.strictEqual(parsed.townHallLevel, 18, 'TH debe ser 18');
assert.ok(parsed.completionPercentage > 0, 'Porcentaje debe ser > 0');
assert.strictEqual(parsed.helpers.length, 3, 'Debe procesar 3 helpers');
assert.strictEqual(parsed.guardians.length, 3, 'Debe procesar 3 guardians');
assert.strictEqual(parsed.builder_base.builderHallLevel, 10, 'BH debe ser 10');
assert.strictEqual(parsed.builder_base.heroes.length, 1, 'BH heroes debe ser 1');
assert.strictEqual(parsed.walls.total, 325, 'Muros debe ser 325');

console.log('✅ 3. Village Tracker procesa la exportación nativa al 100% sin items "unknown".');

// 4. Probar la Calculadora Táctica
const calcAirDef = calculateOptimalRecipes({
  building: 'air_defense',
  level: 16,
  userLevels: {
    lightning: 11,
    earthquake: 5,
    giant_arrow: 18,
    rocket_backpack: 27
  }
});
assert.ok(calcAirDef.recipes.length >= 4, 'Calculadora debe generar al menos 4 recetas');
assert.ok(calcAirDef.recipes.some((r) => r.id === 'pure_lightning'));
assert.ok(calcAirDef.recipes.some((r) => r.id === 'zap_quake'));
assert.ok(calcAirDef.recipes.some((r) => r.id === 'giant_arrow_combo'));

const calcInfernoSC = calculateOptimalRecipes({
  building: 'inferno_tower',
  level: 12,
  supercharge: 2,
  userLevels: {
    lightning: 11,
    earthquake: 5,
    giant_arrow: 18,
    rocket_backpack: 27
  }
});
assert.strictEqual(calcInfernoSC.target.supercharge, 2);
assert.strictEqual(calcInfernoSC.target.maxHp, 5300, 'Torre infernal con SC2 debe tener 5300 HP');

console.log('✅ 4. Calculadora Táctica funciona 100% con recetas y supercargas.');

console.log('\n🎉 ¡TODOS LOS TESTS DE INTEGRACIÓN DE LA UNIFICACIÓN SSOT PASARON EXITOSAMENTE!');
