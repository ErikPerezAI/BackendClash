/**
 * ============================================================================
 * CLASH TACTICS - CANONICAL UNIFIED GAME DATA SCHEMA (SSOT)
 * ============================================================================
 * Esquema de datos canónico de TypeScript para Clash of Clans.
 * Unifica las necesidades analíticas de:
 * 1. Calculadora Táctica (Combate: HP, DPS, Daño por impacto, Rangos, Efectos)
 * 2. Tracker de Progresión (Gestión: Costes, Tiempos en segundos, Ayuntamiento, Minerales)
 *
 * Reglas de integridad:
 * - Tiempos estrictamente normalizados en segundos enteros (upgrade_time_seconds).
 * - Ausencia de estadística representada con `null` explícito (nunca omitir ni falsear con 0).
 */

// ============================================================================
// TIPOS BASE Y ENUMERACIONES
// ============================================================================

export type ResourceType = 'Gold' | 'Elixir' | 'Dark Elixir';

export type VillageType = 'home' | 'builder_base';

export type StructureCategory =
  | 'Defense'
  | 'Resource'
  | 'Army'
  | 'Trap'
  | 'Town Hall'
  | 'Crafted Defense'
  | 'Other';

export type UnitType = 'Troop' | 'Spell' | 'Siege';

export type UnitSubtype = 'Elixir' | 'Dark Elixir' | 'Super';

export type TargetType = 'Ground' | 'Air' | 'Ground & Air' | 'None' | null;

export type DamageType = 'Single Target' | 'Area Splash' | 'Chain' | null;

export type HeroName =
  | 'Barbarian King'
  | 'Archer Queen'
  | 'Grand Warden'
  | 'Royal Champion'
  | 'Minion Prince';

export type EquipmentRarity = 'Common' | 'Epic';

// ============================================================================
// 1. DOMINIO: ESTRUCTURAS (DEFENSAS, RECURSOS, TRAMPAS, EJÉRCITO)
// ============================================================================

/**
 * Supercargas aplicadas a los niveles máximos de defensas (TH16+)
 */
export interface SuperchargeLevelData {
  hitpoints: number | null;
  damage_per_second: number | null;
  damage_per_shot: number | null;
  range: number | null;
  attack_speed: number | null;
}

/**
 * Datos por nivel de una estructura (unión Tracker + Calculadora)
 */
export interface StructureLevelData {
  /** Nivel de la estructura (ej: 1, 2, ... 21) */
  level: number;

  // --- DATOS TRACKER DE PROGRESIÓN ---
  /** Tiempo de construcción/mejora expresado estrictamente en segundos enteros (0 para nivel 1 instantáneo) */
  upgrade_time_seconds: number | null;
  /** Coste numérico de la mejora */
  upgrade_cost: number | null;
  /** Tipo de recurso requerido para pagar la mejora */
  resource_type: ResourceType | null;
  /** Nivel de Ayuntamiento (Town Hall) mínimo requerido para desbloquear este nivel */
  town_hall_required: number;

  // --- DATOS CALCULADORA TÁCTICA ---
  /** Puntos de impacto totales del edificio */
  hitpoints: number | null;
  /** Daño infligido por segundo */
  damage_per_second: number | null;
  /** Daño infligido en cada disparo individual */
  damage_per_shot: number | null;
  /** Rango máximo de alcance en casillas (tiles) */
  range: number | null;
  /** Velocidad de ataque en segundos entre disparos */
  attack_speed: number | null;

  // --- EXTENSIONES OPCIONALES (NULLABLE) ---
  /** Nivel de supercarga (1, 2, 3...) disponible en el nivel máximo */
  supercharges: Record<number, SuperchargeLevelData> | null;
}

/**
 * Entidad completa de una estructura en el juego
 */
export interface StructureEntity {
  /** Slug identificador canónico (ej: "cannon", "air_defense") */
  id: string;
  /** Identificador numérico oficial de Supercell CSV (ej: 1000000) si existe */
  data_id: number | null;
  /** Nombre en inglés según la wiki */
  name: string;
  /** Nombre localizado en español */
  spanish_name: string;
  /** Categoría funcional de la estructura */
  category: StructureCategory;
  /** Aldea a la que pertenece */
  village_type: VillageType;
  /** Nivel de Ayuntamiento inicial para desbloquear la estructura */
  town_hall_required: number;
  /** Mapeo de niveles indexados por su número */
  levels: Record<number, StructureLevelData>;
}

// ============================================================================
// 2. DOMINIO: TROPAS, HECHIZOS Y MÁQUINAS DE ASEDIO
// ============================================================================

/**
 * Datos por nivel de una tropa, hechizo o asedio (unión Tracker + Calculadora)
 */
export interface UnitSpellLevelData {
  /** Nivel de la unidad o hechizo */
  level: number;

  // --- DATOS TRACKER DE PROGRESIÓN ---
  /** Tiempo de investigación en el laboratorio en segundos enteros */
  research_time_seconds: number | null;
  /** Coste de investigación */
  research_cost: number | null;
  /** Recurso consumido en la investigación */
  resource_type: ResourceType | null;
  /** Nivel de Laboratorio requerido para iniciar la mejora */
  laboratory_level_required: number | null;
  /** Nivel de Ayuntamiento requerido indirectamente por el laboratorio */
  town_hall_required: number | null;

  // --- DATOS CALCULADORA TÁCTICA ---
  /** Puntos de vida */
  hitpoints: number | null;
  /** Daño por segundo */
  dps: number | null;
  /** Daño por cada impacto o pulso */
  damage_per_shot: number | null;
  /** Velocidad de movimiento */
  movement_speed: number | null;
  /** Espacio ocupado en campamentos / caldero */
  housing_space: number | null;
  /** Tiempo de entrenamiento en segundos */
  training_time_seconds: number | null;
  /** Alcance del proyectil o radio de efecto */
  range: number | null;
  /** Cadencia o intervalo de ataque */
  attack_speed: number | null;
  /** Porcentaje de daño directo (ej: Hechizo de Terremoto) */
  damage_percent: number | null;
  /** Daño directo acumulado para hechizos de daño fijo (ej: Hechizo de Rayo) */
  total_damage: number | null;
}

/**
 * Entidad completa de una tropa, hechizo o máquina de asedio
 */
export interface UnitSpellEntity {
  /** Slug identificador (ej: "root_rider", "lightning_spell") */
  id: string;
  /** Identificador numérico de Supercell CSV (ej: 4000102) */
  data_id: number | null;
  /** Nombre en inglés */
  name: string;
  /** Nombre en español */
  spanish_name: string;
  /** Tipo general */
  type: UnitType;
  /** Subtipo de recurso o variante */
  sub_type: UnitSubtype;
  /** Nivel de Laboratorio para desbloquear la unidad */
  laboratory_level_required: number | null;
  /** Objetivos válidos */
  targets: TargetType;
  /** Modalidad de daño */
  damage_type: DamageType;
  /** Niveles indexados */
  levels: Record<number, UnitSpellLevelData>;
}

// ============================================================================
// 3. DOMINIO: HÉROES Y EQUIPAMIENTO DE HÉROES (HERO EQUIPMENT)
// ============================================================================

/**
 * Datos por nivel del héroe base
 */
export interface HeroLevelData {
  level: number;
  upgrade_time_seconds: number | null;
  upgrade_cost: number | null;
  resource_type: ResourceType | null;
  town_hall_required: number;
  hitpoints: number | null;
  damage_per_second: number | null;
  damage_per_shot: number | null;
  ability_level: number | null;
  ability_duration_seconds: number | null;
  health_recovery: number | null;
}

/**
 * Entidad de Héroe base
 */
export interface HeroEntity {
  id: string;
  data_id: number | null;
  name: HeroName;
  spanish_name: string;
  town_hall_required: number;
  levels: Record<number, HeroLevelData>;
}

/**
 * Datos por nivel de equipamiento de héroe (unión Tracker + Calculadora)
 */
export interface HeroEquipmentLevelData {
  /** Nivel del equipamiento (1..18 para Comunes, 1..27 para Épicos) */
  level: number;

  // --- DATOS TRACKER DE PROGRESIÓN (MINERALES & HERRERÍA) ---
  /** Mineral brillante requerido para este nivel */
  shiny_ore: number;
  /** Mineral resplandeciente requerido para este nivel */
  glowy_ore: number;
  /** Mineral estelar requerido (null para comunes o niveles donde no se requiere) */
  starry_ore: number | null;
  /** Nivel de Herrería (Blacksmith) requerido para mejorar a este nivel */
  blacksmith_level_required: number;

  // --- DATOS CALCULADORA TÁCTICA (BONUS ACTIVOS Y PASIVOS) ---
  /** Aumento plano de daño del héroe o de habilidad */
  damage_increase: number | null;
  /** Aumento de puntos de vida del héroe */
  hp_increase: number | null;
  /** Duración de la habilidad activa en segundos */
  ability_duration: number | null;
  /** Bono de DPS pasivo */
  damage_per_second_boost: number | null;
  /** Reducción porcentual de daño recibido (ej: 50% en Guantelete Gigante) */
  damage_reduction_percent: number | null;
  /** Radio de impacto en casillas (tiles) de la habilidad */
  area_damage_radius: number | null;
  /** Curación por segundo o regeneración */
  self_heal_per_second: number | null;
}

/**
 * Entidad completa de un equipamiento de héroe
 */
export interface HeroEquipmentEntity {
  /** Slug identificador (ej: "giant_gauntlet", "giant_arrow") */
  id: string;
  /** Identificador numérico de Supercell CSV (ej: 9000000) */
  data_id: number | null;
  /** Nombre en inglés */
  name: string;
  /** Nombre en español */
  spanish_name: string;
  /** Héroe al que pertenece */
  hero: HeroName;
  /** Rareza del equipo */
  rarity: EquipmentRarity;
  /** Nivel de Herrería para desbloquear el equipamiento */
  blacksmith_level_required: number;
  /** Niveles indexados */
  levels: Record<number, HeroEquipmentLevelData>;
}

// ============================================================================
// BASE DE DATOS MAESTRA UNIFICADA (ROOT SCHEMA)
// ============================================================================

export interface DatabaseMetadata {
  extracted_at: string;
  source: string;
  schema_version: string;
  game_version_compatibility: string;
  total_structures: number;
  total_units: number;
  total_heroes: number;
  total_equipment: number;
}

export interface MasterCoCDatabase {
  metadata: DatabaseMetadata;
  structures: Record<string, StructureEntity>;
  units: Record<string, UnitSpellEntity>;
  heroes: Record<string, HeroEntity>;
  hero_equipment: Record<string, HeroEquipmentEntity>;
}

