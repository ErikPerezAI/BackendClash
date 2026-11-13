import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseTimeStringToSeconds,
  parseNumericStat,
  parseResourceType
} from './extractWikiData.js';
import {
  DEFENSES,
  SPELLS,
  HERO_EQUIPMENT,
  UNITS,
  HEROES,
  PETS,
  SIEGE_MACHINES,
  BUILDER_BASE,
  CLAN_CAPITAL,
  resolveGameEntity
} from '../src/data/cocGameData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Iniciando verificación de integridad de cocMasterGameData.json y cocGameData.js...');

// 1. Tests de funciones de normalización
assert.strictEqual(parseTimeStringToSeconds('3d 12h'), 302400, '3d 12h debe ser 302400s');
assert.strictEqual(parseTimeStringToSeconds('14d'), 1209600, '14d debe ser 1209600s');
assert.strictEqual(parseTimeStringToSeconds('14h 30m'), 52200, '14h 30m debe ser 52200s');
assert.strictEqual(parseTimeStringToSeconds('45m'), 2700, '45m debe ser 2700s');
assert.strictEqual(parseTimeStringToSeconds('10s'), 10, '10s debe ser 10s');
assert.strictEqual(parseTimeStringToSeconds('None'), null, 'None debe ser null');
assert.strictEqual(parseTimeStringToSeconds('-'), null, '- debe ser null');
assert.strictEqual(parseTimeStringToSeconds('instant'), 0, 'instant debe ser 0s');
console.log('✅ 1. Test parseTimeStringToSeconds superado.');

assert.strictEqual(parseNumericStat('1,200'), 1200);
assert.strictEqual(parseNumericStat('4.5s'), 4.5);
assert.strictEqual(parseNumericStat('29%'), 29);
assert.strictEqual(parseNumericStat('-'), null);
assert.strictEqual(parseNumericStat('N/A'), null);
console.log('✅ 2. Test parseNumericStat superado.');

assert.strictEqual(parseResourceType('Gold'), 'Gold');
assert.strictEqual(parseResourceType('Dark Elixir'), 'Dark Elixir');
assert.strictEqual(parseResourceType('Elixir'), 'Elixir');
console.log('✅ 3. Test parseResourceType superado.');

// 2. Validación de archivo cocMasterGameData.json
const masterPath = path.resolve(__dirname, '../src/data/cocMasterGameData.json');
assert.ok(fs.existsSync(masterPath), 'cocMasterGameData.json debe existir');

const master = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));

// Comprobar ausencia de duplicados a nivel raíz
assert.strictEqual(master.structures, undefined, 'No debe existir "structures" en raíz (duplicado)');
assert.strictEqual(master.spells, undefined, 'No debe existir "spells" en raíz (duplicado)');
assert.strictEqual(master.hero_equipment, undefined, 'No debe existir "hero_equipment" en raíz (duplicado)');
assert.strictEqual(master.units, undefined, 'No debe existir "units" en raíz (duplicado)');
assert.strictEqual(master.heroes, undefined, 'No debe existir "heroes" en raíz (duplicado)');
assert.strictEqual(master.pets, undefined, 'No debe existir "pets" en raíz (duplicado)');
assert.strictEqual(master.siege_machines, undefined, 'No debe existir "siege_machines" en raíz (duplicado)');
console.log('✅ 4. Validación de CERO código/datos duplicados en la raíz superada.');

// Comprobar secciones canónicas de la wiki
assert.ok(master.home_village, 'home_village debe existir');
assert.ok(master.builder_base, 'builder_base debe existir');
assert.ok(master.other?.clan_capital, 'other.clan_capital debe existir');

const hv = master.home_village;
const structCount = Object.keys(hv.structures || {}).length;
const troopCount = Object.keys(hv.troops || {}).length;
const superTroopCount = Object.keys(hv.super_troops || {}).length;
const heroCount = Object.keys(hv.heroes || {}).length;
const equipCount = Object.keys(hv.hero_equipment || {}).length;
const spellCount = Object.keys(hv.spells || {}).length;
const siegeCount = Object.keys(hv.siege_machines || {}).length;
const petCount = Object.keys(hv.pets || {}).length;

console.log(`📊 Totales en Home Village:
  - Estructuras y Defensas: ${structCount}
  - Tropas Laboratorio: ${troopCount}
  - Super Tropas: ${superTroopCount}
  - Héroes: ${heroCount}
  - Equipamientos Heroicos: ${equipCount}
  - Hechizos: ${spellCount}
  - Máquinas de Asedio: ${siegeCount}
  - Mascotas: ${petCount}`);

assert.ok(structCount >= 40, `Debe haber al menos 40 estructuras en HV (actual: ${structCount})`);
assert.ok(spellCount >= 18, `Debe haber al menos 18 hechizos en HV (actual: ${spellCount})`);
assert.ok(equipCount === 41, `Debe haber exactamente 41 equipamientos (actual: ${equipCount})`);
assert.strictEqual(heroCount, 6, `Debe haber exactamente 6 héroes en HV (actual: ${heroCount})`);

// 3. Validación específica de los 6 Héroes
const expectedHeroes = [
  'barbarian_king',
  'archer_queen',
  'grand_warden',
  'royal_champion',
  'minion_prince',
  'dragon_duke'
];

for (const heroId of expectedHeroes) {
  assert.ok(hv.heroes[heroId], `El héroe '${heroId}' debe existir en home_village.heroes`);
}

// Validar Minion Prince
const mp = hv.heroes.minion_prince;
assert.strictEqual(mp.name, 'Minion Prince');
assert.strictEqual(mp.data_id, 28000005);
assert.strictEqual(Object.keys(mp.levels).length, 95, 'Minion Prince debe tener 95 niveles');

// Validar Dragon Duke
const dd = hv.heroes.dragon_duke;
assert.strictEqual(dd.name, 'Dragon Duke');
assert.strictEqual(dd.data_id, 28000006);
assert.strictEqual(Object.keys(dd.levels).length, 25, 'Dragon Duke debe tener 25 niveles');
console.log('✅ 5. Validación de los 6 Héroes oficiales de Home Village superada.');

// 4. Validación de Equipamientos Heroicos (asignación canónica según Wiki)
const expectedHeroEquipmentCount = {
  'Barbarian King': 7,
  'Archer Queen': 7,
  'Grand Warden': 7,
  'Royal Champion': 7,
  'Minion Prince': 7,
  'Dragon Duke': 6
};

const equipHeroCounts = {};
for (const [id, eq] of Object.entries(hv.hero_equipment)) {
  const h = eq.hero || 'Desconocido';
  equipHeroCounts[h] = (equipHeroCounts[h] || 0) + 1;
}

for (const [heroName, count] of Object.entries(expectedHeroEquipmentCount)) {
  assert.strictEqual(
    equipHeroCounts[heroName],
    count,
    `${heroName} debe tener ${count} equipamientos heroicos (actual: ${equipHeroCounts[heroName]})`
  );
}

// Validar equipamientos clave de Minion Prince
assert.strictEqual(hv.hero_equipment.dark_crown.hero, 'Minion Prince');
assert.strictEqual(hv.hero_equipment.dark_crown.rarity, 'Epic');
assert.strictEqual(hv.hero_equipment.henchmen_puppet.hero, 'Minion Prince');
assert.strictEqual(hv.hero_equipment.portal_pendant.hero, 'Minion Prince');

// Validar equipamientos clave de Dragon Duke
assert.strictEqual(hv.hero_equipment.rocket_backpack.hero, 'Dragon Duke');
assert.strictEqual(hv.hero_equipment.rocket_backpack.rarity, 'Epic');
assert.strictEqual(hv.hero_equipment.fire_heart.hero, 'Dragon Duke');
assert.strictEqual(hv.hero_equipment.revenge_deck.hero, 'Dragon Duke');
console.log('✅ 6. Asignación canónica de equipamientos heroicos por héroe superada.');

// 5. Validar que Apprentice Warden es Tropa y no Héroe
assert.strictEqual(hv.heroes.apprentice_warden, undefined, 'Apprentice Warden NO debe estar en heroes');
assert.ok(hv.troops.apprentice_warden, 'Apprentice Warden debe estar en troops');
assert.strictEqual(hv.troops.apprentice_warden.data_id, 4000178);
console.log('✅ 7. Apprentice Warden correctamente clasificado como tropa (no héroe).');

// 7. Validación del Daño en Equipamientos Heroicos (Flecha Gigante, Mochila Cohete, etc.)
assert.strictEqual(hv.hero_equipment.giant_arrow.levels[18].damage, 1500, 'Flecha Gigante lvl 18 debe tener 1500 de daño');
assert.strictEqual(hv.hero_equipment.giant_arrow.levels[18].projectile_damage, 1500, 'Flecha Gigante lvl 18 projectile_damage');

assert.strictEqual(hv.hero_equipment.rocket_backpack.levels[27].damage, 2150, 'Mochila Cohete lvl 27 debe tener 2150 de daño');
assert.strictEqual(hv.hero_equipment.rocket_backpack.levels[27].ability_damage, 2150, 'Mochila Cohete lvl 27 ability_damage');

assert.strictEqual(hv.hero_equipment.fireball.levels[27].damage, 4100, 'Bola de Fuego lvl 27 debe tener 4100 de daño');
assert.strictEqual(hv.hero_equipment.fireball.levels[27].projectile_damage, 4100, 'Bola de Fuego lvl 27 projectile_damage');

assert.strictEqual(hv.hero_equipment.spiky_ball.levels[27].damage, 3250, 'Bola con Pinchos lvl 27 debe tener 3250 de daño');
assert.strictEqual(hv.hero_equipment.spiky_ball.levels[27].number_of_targets, 8, 'Bola con Pinchos lvl 27 rebotes');

assert.strictEqual(hv.hero_equipment.seeking_shield.levels[18].damage, 2500, 'Escudo Rastreador lvl 18 debe tener 2500 de daño');
assert.strictEqual(hv.hero_equipment.flame_blower.levels[18].damage, 2500, 'Soplador de Llamas lvl 18 debe tener 2500 de daño');
assert.strictEqual(hv.hero_equipment.meteor_staff.levels[27].damage, 850, 'Vara de Meteorito lvl 27 debe tener 850 de daño por golpe');

console.log('✅ 8. Extracción y mapeo de daño numérico en habilidades heroicas superada.');

// 8. Validación de la capa en memoria cocGameData.js y Calculadora Táctica
assert.strictEqual(Object.keys(HEROES).length, 6, 'HEROES en memoria debe contener 6 héroes');
assert.strictEqual(Object.keys(HERO_EQUIPMENT).length, 41, 'HERO_EQUIPMENT en memoria debe contener 41 ítems');
assert.ok(Object.keys(DEFENSES).length >= 40, 'DEFENSES en memoria debe contener al menos 40 defensas');
assert.ok(Object.keys(SPELLS).length >= 18, 'SPELLS en memoria debe contener al menos 18 hechizos');
assert.ok(Object.keys(UNITS).length >= 50, 'UNITS en memoria debe contener tropas + super tropas + asedios');

// Búsqueda multi-criterio con resolveGameEntity
const resolvedMP = resolveGameEntity('minion_prince');
assert.strictEqual(resolvedMP.entityType, 'hero');
assert.strictEqual(resolvedMP.data.name, 'Minion Prince');

const resolvedDD = resolveGameEntity(28000006);
assert.strictEqual(resolvedDD.entityType, 'hero');
assert.strictEqual(resolvedDD.data.name, 'Dragon Duke');

const resolvedRB = resolveGameEntity('rocket_backpack');
assert.strictEqual(resolvedRB.entityType, 'equipment');
assert.strictEqual(resolvedRB.data.hero, 'Dragon Duke');

const resolvedAW = resolveGameEntity('apprentice_warden');
assert.strictEqual(resolvedAW.entityType, 'unit');

// Verificación de integración con la Calculadora Táctica
const { calculateOptimalRecipes } = await import('../src/services/calculator.service.js');
const calcResult = calculateOptimalRecipes({
  building: 'air_defense',
  level: 14,
  userLevels: {
    lightning: 11,
    earthquake: 5,
    giant_arrow: 18,
    rocket_backpack: 27
  }
});

assert.ok(calcResult.recipes.length > 0, 'Debe generar recetas óptimas');
const dualSnipe = calcResult.recipes.find((r) => r.id === 'dual_line_snipe');
assert.ok(dualSnipe, 'Debe existir la receta dual_line_snipe');
assert.strictEqual(dualSnipe.totalDamage, 3650, 'Flecha Gigante (1500) + Mochila Cohete (2150) debe ser 3650');

console.log('✅ 9. Capa de adaptadores en memoria y Calculadora Táctica con habilidades heroicas 100% operativas.');
console.log('\n🎉 ¡TODOS LOS TESTS DE INTEGRIDAD Y CONSISTENCIA PASARON EXITOSAMENTE!');
