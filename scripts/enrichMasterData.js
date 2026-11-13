/**
 * Script de enriquecimiento y consolidación para cocMasterGameData.json.
 * Inyecta las entidades huérfanas de cocSupercellIds.js (Helpers, Guardianes,
 * IDs de Builder Base, IDs secundarios de defensas fusionadas) para que
 * cocMasterGameData.json sea la Fuente Única de Verdad (SSOT) 100% completa.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  SUPERCELL_BUILDER_BASE
} from '../src/data/cocSupercellIds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MASTER_PATH = path.resolve(__dirname, '../src/data/cocMasterGameData.json');

const master = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));

// 1. Inyectar Helpers en home_village
if (!master.home_village.helpers) {
  master.home_village.helpers = {};
}
for (const [dataIdStr, item] of Object.entries(SUPERCELL_HELPERS)) {
  const dataId = Number(dataIdStr);
  const slug = item.slug || item.id;
  master.home_village.helpers[slug] = {
    id: item.id,
    data_id: dataId,
    name: item.name,
    spanish_name: item.spanishName,
    spanishName: item.spanishName,
    slug,
    category: 'Helpers',
    village_type: 'home',
    max_level: item.maxLevel,
    maxLevel: item.maxLevel
  };
}

// 2. Inyectar Guardians en home_village
if (!master.home_village.guardians) {
  master.home_village.guardians = {};
}
for (const [dataIdStr, item] of Object.entries(SUPERCELL_GUARDIANS)) {
  const dataId = Number(dataIdStr);
  const slug = item.slug || item.id;
  master.home_village.guardians[slug] = {
    id: item.id,
    data_id: dataId,
    name: item.name,
    spanish_name: item.spanishName,
    spanishName: item.spanishName,
    slug,
    category: 'Guardianes',
    village_type: 'home',
    max_level: item.maxLevel,
    maxLevel: item.maxLevel
  };
}

// 3. Estructuras de Home Village faltantes o con IDs secundarios
const hvStructs = master.home_village.structures || {};

// Secondary IDs para defensas fusionadas y alternativas
if (hvStructs.spell_tower) {
  hvStructs.spell_tower.secondary_data_ids = [1000072];
}
if (hvStructs.ricochet_cannon) {
  hvStructs.ricochet_cannon.secondary_data_ids = [1000089];
}
if (hvStructs.multi_archer_tower) {
  hvStructs.multi_archer_tower.secondary_data_ids = [1000102];
}
if (hvStructs.workshop) {
  hvStructs.workshop.secondary_data_ids = [1000070];
}

// Helper Hut (1000093)
if (!hvStructs.helper_hut) {
  hvStructs.helper_hut = {
    id: 'helper_hut',
    data_id: 1000093,
    name: "Helper's Hut",
    spanish_name: 'Cabaña de aprendices',
    spanishName: 'Cabaña de aprendices',
    category: 'Recursos',
    village_type: 'home',
    range: null,
    attack_speed: null,
    levels: {
      '1': { level: 1, hitpoints: 300, town_hall_required: 14 },
      '2': { level: 2, hitpoints: 350, town_hall_required: 15 },
      '3': { level: 3, hitpoints: 400, town_hall_required: 16 },
      '4': { level: 4, hitpoints: 450, town_hall_required: 17 },
      '5': { level: 5, hitpoints: 500, town_hall_required: 18 }
    }
  };
}

// Crafted Defense / Cake-A-Pult (1000097)
if (!hvStructs.cake_a_pult && !hvStructs.crafted_defense) {
  hvStructs.cake_a_pult = {
    id: 'cake_a_pult',
    data_id: 1000097,
    name: 'Crafted Defense (Cake-A-Pult / Hero Hunter)',
    spanish_name: 'Estructura crafteada temporal',
    spanishName: 'Estructura crafteada temporal',
    category: 'Defensas',
    village_type: 'home',
    range: 14,
    attack_speed: 3.5,
    levels: {
      '1': { level: 1, hitpoints: 1500, town_hall_required: 11 },
      '2': { level: 2, hitpoints: 1800, town_hall_required: 12 },
      '3': { level: 3, hitpoints: 2200, town_hall_required: 13 },
      '4': { level: 4, hitpoints: 2600, town_hall_required: 14 },
      '5': { level: 5, hitpoints: 3000, town_hall_required: 15 },
      '6': { level: 6, hitpoints: 3400, town_hall_required: 16 },
      '7': { level: 7, hitpoints: 3800, town_hall_required: 16 },
      '8': { level: 8, hitpoints: 4200, town_hall_required: 17 },
      '9': { level: 9, hitpoints: 4400, town_hall_required: 17 },
      '10': { level: 10, hitpoints: 4600, town_hall_required: 18 }
    }
  };
}

// Freeze Trap (12000020)
if (!hvStructs.freeze_trap) {
  hvStructs.freeze_trap = {
    id: 'freeze_trap',
    data_id: 12000020,
    name: 'Freeze Trap',
    spanish_name: 'Trampa de congelación',
    spanishName: 'Trampa de congelación',
    category: 'Trampas',
    village_type: 'home',
    range: 2,
    levels: {
      '1': { level: 1, hitpoints: null, town_hall_required: 11 },
      '2': { level: 2, hitpoints: null, town_hall_required: 12 },
      '3': { level: 3, hitpoints: null, town_hall_required: 13 },
      '4': { level: 4, hitpoints: null, town_hall_required: 14 }
    }
  };
}

// Spells: Ice Storm (26000120), Warp Spell (26000123)
const hvSpells = master.home_village.spells || {};
if (!hvSpells.ice_storm_spell) {
  hvSpells.ice_storm_spell = {
    id: 'ice_storm_spell',
    data_id: 26000120,
    name: 'Ice Storm Spell',
    spanish_name: 'Hechizo de tormenta gélida',
    spanishName: 'Hechizo de tormenta gélida',
    category: 'Hechizos',
    sub_type: 'Dark Elixir',
    housing_space: 1,
    levels: {
      '1': { level: 1, town_hall_required: 15 },
      '2': { level: 2, town_hall_required: 16 },
      '3': { level: 3, town_hall_required: 17 },
      '4': { level: 4, town_hall_required: 18 }
    }
  };
}
if (!hvSpells.warp_spell) {
  hvSpells.warp_spell = {
    id: 'warp_spell',
    data_id: 26000123,
    name: 'Warp Spell',
    spanish_name: 'Hechizo de portal',
    spanishName: 'Hechizo de portal',
    category: 'Hechizos',
    sub_type: 'Dark Elixir',
    housing_space: 1,
    levels: {
      '1': { level: 1, town_hall_required: 17 }
    }
  };
}

// Equipment: asociar data_id a lavaloon_puppet (90000039) y secondary_data_ids a meteor_staff (90000060)
// Preservando exactamente los 41 equipamientos canónicos
const hvEq = master.home_village.hero_equipment || {};
if (hvEq.lavaloon_puppet) {
  hvEq.lavaloon_puppet.data_id = 90000039;
  hvEq.lavaloon_puppet.secondary_data_ids = [90000039];
  hvEq.lavaloon_puppet.aliases = ['lava_balloon'];
}
if (hvEq.meteor_staff) {
  hvEq.meteor_staff.secondary_data_ids = [90000060];
  hvEq.meteor_staff.aliases = ['meteor_strike'];
}

// 4. Inyectar IDs en Builder Base
const bb = master.builder_base || {};

// Heroes de Builder Base
if (bb.heroes?.battle_machine) {
  bb.heroes.battle_machine.data_id = 28000003;
  bb.heroes.battle_machine.spanish_name = 'Máquina bélica';
  bb.heroes.battle_machine.spanishName = 'Máquina bélica';
}
if (bb.heroes?.battle_copter) {
  bb.heroes.battle_copter.data_id = 28000005;
  bb.heroes.battle_copter.spanish_name = 'Helicóptero bélico';
  bb.heroes.battle_copter.spanishName = 'Helicóptero bélico';
}

// Tropas de Builder Base
const bbTroopIdMap = {
  raged_barbarian: 4000031,
  sneaky_archer: 4000032,
  boxer_giant: 4000033,
  beta_minion: 4000034,
  bomber: 4000035,
  baby_dragon: 4000036,
  cannon_cart: 4000037,
  night_witch: 4000038,
  drop_ship: 4000041,
  power_pekka: 4000042,
  hog_glider: 4000070,
  electrofire_wizard: 4000106
};

for (const [slug, dataId] of Object.entries(bbTroopIdMap)) {
  if (bb.troops?.[slug]) {
    bb.troops[slug].data_id = dataId;
    const orig = SUPERCELL_BUILDER_BASE.units[dataId];
    if (orig) {
      bb.troops[slug].spanish_name = orig.spanishName;
      bb.troops[slug].spanishName = orig.spanishName;
    }
  }
}

// Estructuras de Builder Base: asociar data_id o mapear diccionario
if (!bb.supercell_buildings) {
  bb.supercell_buildings = {};
}
for (const [idStr, item] of Object.entries(SUPERCELL_BUILDER_BASE.buildings)) {
  bb.supercell_buildings[idStr] = {
    id: item.id,
    data_id: Number(idStr),
    name: item.name,
    spanish_name: item.spanishName,
    spanishName: item.spanishName,
    slug: item.slug,
    category: item.category || 'Taller',
    max_level: item.maxLevel,
    maxLevel: item.maxLevel
  };
}

// Actualizar metadata
master.metadata.last_enriched_at = new Date().toISOString();
master.metadata.ssot_unified = true;

fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2), 'utf8');
console.log('✅ cocMasterGameData.json enriquecido exitosamente con todos los IDs y entidades faltantes.');

