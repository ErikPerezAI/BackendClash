/**
 * Motor de Cálculo Táctico de Daño para Clash of Clans.
 * Calcula las recetas óptimas y la combinación perfecta con el daño justo
 * para destruir defensas y estructuras combinando Hechizos (Rayo, Terremoto)
 * y Habilidades Heroicas (Flecha Gigante, Bola de Fuego, Bola con Pinchos,
 * Escudo Rastreador, Mochila Cohete).
 */

import { getDefenseById, getSpellById, getEquipmentById } from './gameData.service.js';

/**
 * Calcula el daño acumulado de N hechizos de Terremoto según la fórmula oficial de Supercell:
 * 1er Terremoto: 100% del porcentaje base (ej. 29%)
 * 2do Terremoto: 1/3 del porcentaje base
 * 3er Terremoto: 1/5 del porcentaje base
 */
function computeEarthquakeDamage(maxHp, basePercent, count) {
  if (!count || count <= 0 || !basePercent) return 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const divisor = 2 * i + 1; // 1, 3, 5...
    const pct = basePercent / divisor;
    total += Math.floor(maxHp * (pct / 100));
  }
  return total;
}

/**
 * Genera todos los subconjuntos no vacíos de un arreglo de habilidades (hasta tamaño máximo 3 para evitar explosión combinatoria, más el conjunto completo)
 */
function getAbilitySubsets(abilities) {
  const subsets = [[]];
  const n = abilities.length;

  // Individuales (tamaño 1)
  for (let i = 0; i < n; i++) {
    subsets.push([abilities[i]]);
  }

  // Pares (tamaño 2)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      subsets.push([abilities[i], abilities[j]]);
    }
  }

  // Trios (tamaño 3)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        subsets.push([abilities[i], abilities[j], abilities[k]]);
      }
    }
  }

  // Si seleccionó 4 o más habilidades, incluir también el conjunto completo
  if (n >= 4) {
    subsets.push([...abilities]);
  }

  return subsets;
}

/**
 * Calcula todas las combinaciones óptimas para destruir una estructura defensiva
 *
 * @param {object} params
 * @param {string} params.building - ID de la defensa (ej: 'air_defense', 'scattershot', 'inferno_tower')
 * @param {number} params.level - Nivel de la defensa (ej: 13)
 * @param {number|null} [params.supercharge] - Nivel de supercarga (ej: 1 o 2)
 * @param {object} [params.userLevels] - Niveles de hechizos y habilidades del usuario
 * @returns {object} Objetivo enriquecido, combinación perfecta y lista de recetas óptimas
 */
export const calculateOptimalRecipes = ({ building, level, supercharge = null, userLevels = {} }) => {
  // 1. Obtener y validar el objetivo
  const target = getDefenseById(building, level, supercharge);
  if (!target) {
    throw new Error(
      `La estructura '${building}' de nivel ${level}${supercharge ? ` (Supercarga ${supercharge})` : ''} no fue encontrada en la base de datos.`
    );
  }

  const maxHp = Number(target.hp) || 0;
  if (maxHp <= 0) {
    throw new Error(
      `La estructura '${target.spanishName || target.name}' no tiene puntos de vida destruibles con hechizos o habilidades.`
    );
  }

  // 2. Resolver niveles del usuario
  const parseOptionalLevel = (val, defaultIfUndefined = null) => {
    if (val === undefined) return defaultIfUndefined;
    if (val === null || val === false || val === '' || Number(val) <= 0) return null;
    return Number(val);
  };

  const lightningLvl = parseOptionalLevel(userLevels.lightning, 11);
  const earthquakeLvl = parseOptionalLevel(userLevels.earthquake, 5);

  const giantArrowLvl = parseOptionalLevel(userLevels.giant_arrow, 18);
  const fireballLvl = parseOptionalLevel(userLevels.fireball, null);
  const spikyBallLvl = parseOptionalLevel(userLevels.spiky_ball, null);
  const seekingShieldLvl = parseOptionalLevel(userLevels.seeking_shield, null);
  const rocketBackpackLvl = parseOptionalLevel(
    userLevels.rocket_backpack !== undefined ? userLevels.rocket_backpack : userLevels.duque,
    null
  );

  // 3. Obtener estadísticas de los hechizos
  const lightningSpell = lightningLvl ? getSpellById('lightning_spell', lightningLvl) : null;
  const earthquakeSpell = earthquakeLvl ? getSpellById('earthquake_spell', earthquakeLvl) : null;

  const lightningDmg = lightningSpell?.damage ? Number(lightningSpell.damage) : (lightningLvl ? 640 : 0);
  const earthquakePct = earthquakeSpell?.damagePercent
    ? Number(earthquakeSpell.damagePercent)
    : earthquakeSpell?.earthquakePercent
      ? Number(earthquakeSpell.earthquakePercent)
      : (earthquakeLvl ? 29 : 0);

  // 4. Construir lista de habilidades heroicas activadas por el usuario
  const abilityDefinitions = [
    {
      id: 'giant_arrow',
      spanishLabel: 'Flecha Gigante',
      heroSpanish: 'Reina Arquera',
      level: giantArrowLvl
    },
    {
      id: 'fireball',
      spanishLabel: 'Bola de Fuego',
      heroSpanish: 'Gran Centinela',
      level: fireballLvl
    },
    {
      id: 'spiky_ball',
      spanishLabel: 'Bola con Pinchos',
      heroSpanish: 'Rey Bárbaro',
      level: spikyBallLvl
    },
    {
      id: 'seeking_shield',
      spanishLabel: 'Escudo Rastreador',
      heroSpanish: 'Luchadora Real',
      level: seekingShieldLvl
    },
    {
      id: 'rocket_backpack',
      spanishLabel: 'Mochila Cohete',
      heroSpanish: 'Duque Dragón',
      level: rocketBackpackLvl
    }
  ];

  const activeAbilities = [];
  for (const def of abilityDefinitions) {
    if (def.level !== null && def.level > 0) {
      const eqData = getEquipmentById(def.id, def.level);
      if (eqData && Number(eqData.damage) > 0) {
        activeAbilities.push({
          id: def.id,
          name: eqData.spanishName || def.spanishLabel || eqData.name,
          englishName: eqData.name,
          hero: eqData.hero,
          heroSpanish: def.heroSpanish,
          level: def.level,
          damage: Number(eqData.damage),
          splashRadiusTiles: eqData.splashRadiusTiles ?? null,
          bounces: eqData.bounces ?? null,
          imageUrl: eqData.imageUrl
        });
      }
    }
  }

  const subsets = getAbilitySubsets(activeAbilities);
  const rawRecipes = [];

  for (const abilityGroup of subsets) {
    const heroDamage = abilityGroup.reduce((sum, a) => sum + a.damage, 0);

    // Si hay múltiples habilidades en el grupo pero quitando una ya destruía el edificio sin hechizos,
    // evitar agregar habilidades redundantes innecesarias (salvo que sea la selección exacta del usuario)
    const isExactUserSelection =
      abilityGroup.length === activeAbilities.length && activeAbilities.length > 0;

    if (abilityGroup.length > 1 && heroDamage >= maxHp && !isExactUserSelection) {
      const anySubgroupDestroys = abilityGroup.some(
        (ab) => heroDamage - ab.damage >= maxHp
      );
      if (anySubgroupDestroys) {
        continue;
      }
    }

    const maxEqToTest = earthquakeSpell && earthquakePct > 0 ? (maxHp >= 3500 ? 2 : 1) : 0;

    for (let eqCount = 0; eqCount <= maxEqToTest; eqCount++) {
      // Si sin terremoto (o con menos terremotos) ya estaba destruido en 0 rayos, no agregar terremotos extra
      const prevEqDamage = eqCount > 0 ? computeEarthquakeDamage(maxHp, earthquakePct, eqCount - 1) : 0;
      if (eqCount > 0 && heroDamage + prevEqDamage >= maxHp) {
        continue;
      }

      const eqDamage = computeEarthquakeDamage(maxHp, earthquakePct, eqCount);
      const hpAfterHeroAndEq = Math.max(0, maxHp - heroDamage - eqDamage);

      // Si aún queda vida y el usuario desactivó Rayo, no se puede completar con rayos
      if (hpAfterHeroAndEq > 0 && (!lightningSpell || lightningDmg <= 0)) {
        continue;
      }

      const zapsCount = hpAfterHeroAndEq === 0 ? 0 : Math.ceil(hpAfterHeroAndEq / lightningDmg);
      const zapsDamage = zapsCount * lightningDmg;
      const totalDamage = heroDamage + eqDamage + zapsDamage;
      const overkill = totalDamage - maxHp;
      const spellHousingSpace = eqCount * 1 + zapsCount * 1;

      // Construir componentes detallados
      const components = [];

      for (const ab of abilityGroup) {
        components.push({
          type: 'equipment',
          id: ab.id,
          name: ab.name,
          spanishName: ab.name,
          hero: ab.heroSpanish || ab.hero,
          level: ab.level,
          quantity: 1,
          count: 1,
          damagePerUnit: ab.damage,
          totalDamage: ab.damage,
          damageDealt: ab.damage,
          housingSpace: 0,
          radiusTiles: ab.splashRadiusTiles,
          bounces: ab.bounces,
          imageUrl: ab.imageUrl
        });
      }

      if (eqCount > 0 && earthquakeSpell) {
        components.push({
          type: 'spell',
          id: 'earthquake_spell',
          name: earthquakeSpell.spanishName || 'Hechizo de Terremoto',
          spanishName: earthquakeSpell.spanishName || 'Hechizo de Terremoto',
          level: earthquakeLvl,
          quantity: eqCount,
          count: eqCount,
          damagePercent: earthquakePct,
          totalDamage: eqDamage,
          damageDealt: eqDamage,
          housingSpace: eqCount,
          radiusTiles: earthquakeSpell.radiusTiles ?? 3.5,
          imageUrl: earthquakeSpell.imageUrl
        });
      }

      if (zapsCount > 0 && lightningSpell) {
        components.push({
          type: 'spell',
          id: 'lightning_spell',
          name: lightningSpell.spanishName || 'Hechizo de Rayo',
          spanishName: lightningSpell.spanishName || 'Hechizo de Rayo',
          level: lightningLvl,
          quantity: zapsCount,
          count: zapsCount,
          damagePerUnit: lightningDmg,
          totalDamage: zapsDamage,
          damageDealt: zapsDamage,
          housingSpace: zapsCount,
          radiusTiles: lightningSpell.radiusTiles ?? 2,
          imageUrl: lightningSpell.imageUrl
        });
      }

      // Nombre y descripción táctica en español
      const heroNames = abilityGroup.map((a) => a.name).join(' + ');
      let recipeName = '';
      if (abilityGroup.length === 0) {
        if (eqCount === 0) {
          recipeName = `Solo Rayos (${zapsCount}x Rayo)`;
        } else if (eqCount === 1 && zapsCount > 0) {
          recipeName = `ZapQuake (1 Terremoto + ${zapsCount}x Rayo)`;
        } else if (eqCount === 1 && zapsCount === 0) {
          recipeName = `1x Terremoto`;
        } else {
          recipeName = `${eqCount}x Terremoto + ${zapsCount}x Rayo`;
        }
      } else {
        if (eqCount === 0 && zapsCount === 0) {
          recipeName = `${heroNames} (Destrucción Directa)`;
        } else if (eqCount > 0 && zapsCount === 0) {
          recipeName = `${heroNames} + ${eqCount}x Terremoto`;
        } else if (eqCount === 0 && zapsCount > 0) {
          recipeName = `${heroNames} + ${zapsCount}x Rayo`;
        } else {
          recipeName = `${heroNames} + ${eqCount}x Terremoto + ${zapsCount}x Rayo`;
        }
      }

      const descParts = components.map(
        (c) => `${c.count}x ${c.name} (Niv. ${c.level}: ${c.damageDealt.toLocaleString('es-ES')} daño)`
      );
      const description =
        spellHousingSpace === 0
          ? `${descParts.join(' + ')} — ¡Destrucción instantánea sin gastar hechizos!`
          : `${descParts.join(' + ')}`;

      const idParts = [
        ...abilityGroup.map((a) => a.id),
        ...(eqCount > 0 ? [`eq${eqCount}`] : []),
        ...(zapsCount > 0 ? [`zap${zapsCount}`] : [])
      ];

      rawRecipes.push({
        id: idParts.join('_') || 'pure_recipe',
        name: recipeName,
        description,
        components,
        heroAbilityUsed: heroNames || null,
        heroAbilitiesCount: abilityGroup.length,
        usesSelectedAbilities: abilityGroup.length > 0,
        usesAllSelectedAbilities:
          activeAbilities.length > 0
            ? abilityGroup.length === activeAbilities.length
            : abilityGroup.length === 0,
        totalDamage,
        targetHp: maxHp,
        remainingHp: 0,
        overkill,
        spellHousingSpace,
        destroyed: true
      });
    }
  }

  // 5. Filtrar recetas dominadas dentro del mismo grupo de habilidades
  // (Por ejemplo, si 2 Terremotos + Rayos ocupa más o igual espacio y deja más overkill que 1 Terremoto + Rayos)
  const recipes = rawRecipes.filter((candidate) => {
    const sameHeroGroup = rawRecipes.filter(
      (r) => r.id !== candidate.id && (r.heroAbilityUsed || '') === (candidate.heroAbilityUsed || '')
    );
    const isStrictlyDominated = sameHeroGroup.some(
      (better) =>
        better.spellHousingSpace < candidate.spellHousingSpace &&
        better.overkill <= candidate.overkill
    );
    return !isStrictlyDominated;
  });

  // 6. Ordenar recetas:
  // Prioridad 1: Menor espacio de hechizos (spellHousingSpace)
  // Prioridad 2: Menor overkill (daño más justo a la vida del edificio)
  // Prioridad 3: Menor cantidad de habilidades heroicas necesarias
  recipes.sort((a, b) => {
    if (a.spellHousingSpace !== b.spellHousingSpace) {
      return a.spellHousingSpace - b.spellHousingSpace;
    }
    if (a.overkill !== b.overkill) {
      return a.overkill - b.overkill;
    }
    return a.heroAbilitiesCount - b.heroAbilitiesCount;
  });

  // 7. Identificar la receta más eficiente global y la combinación perfecta para las habilidades seleccionadas
  const minSpellSpace = recipes[0]?.spellHousingSpace ?? 0;
  recipes.forEach((recipe) => {
    recipe.isMostEfficient = recipe.spellHousingSpace === minSpellSpace;
    recipe.isBestForSelectedAbilities = false;
  });

  // Buscar la mejor receta que utilice las habilidades seleccionadas por el usuario (o todas sus habilidades seleccionadas)
  let bestForSelection = null;
  if (activeAbilities.length > 0) {
    // Primero buscamos entre las que usan todas las habilidades seleccionadas o un subconjunto óptimo con menor espacio y menor overkill
    const withSelected = recipes.filter((r) => r.usesSelectedAbilities);
    if (withSelected.length > 0) {
      bestForSelection = withSelected[0];
      bestForSelection.isBestForSelectedAbilities = true;
    }
  } else if (recipes.length > 0) {
    bestForSelection = recipes[0];
    bestForSelection.isBestForSelectedAbilities = true;
  }

  return {
    target: {
      id: target.id,
      name: target.name,
      spanishName: target.spanishName,
      level: target.level,
      supercharge: target.activeSupercharge || null,
      maxHp,
      dps: target.dps ?? null,
      townHallRequired: target.townHall ?? target.thRequired ?? null,
      imageUrl: target.imageUrl
    },
    userLevelsEvaluated: {
      lightning: lightningLvl,
      earthquake: earthquakeLvl,
      giant_arrow: giantArrowLvl,
      rocket_backpack: rocketBackpackLvl,
      fireball: fireballLvl,
      spiky_ball: spikyBallLvl,
      seeking_shield: seekingShieldLvl
    },
    bestRecipeForSelection: bestForSelection,
    totalRecipesFound: recipes.length,
    recipes
  };
};
