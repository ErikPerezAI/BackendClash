/**
 * Mapeo y enriquecimiento de imágenes para entidades de Clash of Clans.
 * Asigna URLs oficiales del CDN estándar de Clash of Clans (assets.clashk.ing)
 * en formato WebP transparente de alta resolución para tropas, héroes,
 * equipamiento/habilidades, hechizos, mascotas y niveles de ayuntamiento.
 */

const DEFAULT_ASSET_BASE = process.env.COC_ASSETS_BASE_URL || 'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/assets';

/**
 * Convierte un nombre con espacios y símbolos al formato estándar de asset (snake_case)
 * Ej: "Super Miner" -> "super_miner", "P.E.K.K.A" -> "pekka", "L.A.S.S.I" -> "lassi"
 */
export const cleanAssetName = (name) => {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\./g, '')
    .replace(/['’]/g, '')
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
};

// Alias para compatibilidad con código existente
export const slugify = cleanAssetName;

// Conjunto de mascotas conocidas de Clash of Clans (vienen en el array de 'troops' de Supercell)
const PET_SLUGS = new Set([
  'lassi',
  'electro_owl',
  'mighty_yak',
  'unicorn',
  'frosty',
  'diggy',
  'poison_lizard',
  'phoenix',
  'angry_jelly',
  'spirit_fox',
  'sneezy',
  'greedy_raven'
]);

/**
 * Obtiene la URL de la imagen para el nivel de Ayuntamiento (Town Hall)
 */
export const getTownHallImageUrl = (thLevel) => {
  if (!thLevel) return null;
  return `${DEFAULT_ASSET_BASE}/buildings/home-village/town_hall/level_${thLevel}.webp`;
};

/**
 * Obtiene la URL de la imagen para el nivel de Taller de Constructor (Builder Hall)
 */
export const getBuilderHallImageUrl = (bhLevel) => {
  if (!bhLevel) return null;
  return `${DEFAULT_ASSET_BASE}/buildings/builder-base/builder_hall/level_${bhLevel}.webp`;
};

/**
 * Resuelve la URL de imagen para un héroe
 */
export const getHeroImageUrl = (name) => {
  const slug = cleanAssetName(name);
  return `${DEFAULT_ASSET_BASE}/heroes/${slug}/icon.webp`;
};

/**
 * Resuelve la URL de imagen para equipamiento de héroe
 */
export const getEquipmentImageUrl = (name) => {
  const slug = cleanAssetName(name);
  return `${DEFAULT_ASSET_BASE}/equipment/${slug}.webp`;
};

/**
 * Resuelve la URL de imagen para un hechizo
 */
export const getSpellImageUrl = (name) => {
  const slug = cleanAssetName(name);
  return `${DEFAULT_ASSET_BASE}/spells/${slug}.webp`;
};

/**
 * Resuelve la URL de imagen para una mascota
 */
export const getPetImageUrl = (name) => {
  const slug = cleanAssetName(name);
  return `${DEFAULT_ASSET_BASE}/pets/${slug}/icon.webp`;
};

/**
 * Resuelve la URL de imagen para una tropa, super tropa, máquina de asedio o mascota
 */
export const getTroopImageUrl = (name, village = 'home') => {
  const slug = cleanAssetName(name);

  // 1. Si es una mascota (Supercell las lista dentro del array 'troops')
  if (PET_SLUGS.has(slug)) {
    return `${DEFAULT_ASSET_BASE}/pets/${slug}/icon.webp`;
  }

  // 2. Tropas regulares, super tropas, tropas del taller del constructor y asedios
  return `${DEFAULT_ASSET_BASE}/troops/${slug}/icon.webp`;
};

/**
 * Resuelve la URL de imagen para una liga de la Base del Constructor
 * Ej: "Diamond League" -> ".../leagues/builder-base/diamond_league.png"
 *     "Ruby League I"  -> ".../leagues/builder-base/ruby_league_1.png"
 */
const ROMAN_TO_NUM = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };

export const getBuilderBaseLeagueImageUrl = (leagueName) => {
  if (!leagueName) return null;
  const slug = cleanAssetName(leagueName);
  const parts = slug.split('_');
  const last = parts[parts.length - 1];
  if (ROMAN_TO_NUM[last]) {
    parts[parts.length - 1] = ROMAN_TO_NUM[last];
  }
  return `${DEFAULT_ASSET_BASE}/leagues/builder-base/${parts.join('_')}.png`;
};

/**
 * Resuelve la URL de imagen para una Liga de Guerra de Clanes (CWL)
 * Ej: "Crystal League III" -> ".../leagues/cwl/crystal_league_3.png"
 *     "Champion League I"  -> ".../leagues/cwl/champion_league_1.png"
 *     "Unranked"           -> ".../leagues/cwl/unranked.png"
 */
export const getWarLeagueImageUrl = (leagueName) => {
  if (!leagueName) return `${DEFAULT_ASSET_BASE}/leagues/cwl/unranked.png`;
  const slug = cleanAssetName(leagueName);
  const parts = slug.split('_');
  const last = parts[parts.length - 1];
  if (ROMAN_TO_NUM[last]) {
    parts[parts.length - 1] = ROMAN_TO_NUM[last];
  }
  return `${DEFAULT_ASSET_BASE}/leagues/cwl/${parts.join('_')}.png`;
};

/**
 * Resuelve la URL de imagen para una Liga de la Capital del Clan
 * Ej: "Titan League I" -> ".../leagues/capital-leagues/titan_league_1.png"
 *     "Legend League"  -> ".../leagues/capital-leagues/legend_league.png"
 *     "Unranked"       -> ".../leagues/capital-leagues/unranked.png"
 */
export const getCapitalLeagueImageUrl = (leagueName) => {
  if (!leagueName) return `${DEFAULT_ASSET_BASE}/leagues/capital-leagues/unranked.png`;
  const slug = cleanAssetName(leagueName);
  const parts = slug.split('_');
  const last = parts[parts.length - 1];
  if (ROMAN_TO_NUM[last]) {
    parts[parts.length - 1] = ROMAN_TO_NUM[last];
  }
  return `${DEFAULT_ASSET_BASE}/leagues/capital-leagues/${parts.join('_')}.png`;
};

/**
 * Resuelve la URL de imagen para el Ayuntamiento de la Capital (Capital Hall)
 */
export const getCapitalHallImageUrl = (level) => {
  if (!level) return null;
  return `${DEFAULT_ASSET_BASE}/capital-base/capital-hall-pics/Building_CC_Capital_Hall_level_${level}.png`;
};

/**
 * Resuelve la URL de imagen para el Ayuntamiento de un Distrito (District Hall)
 */
export const getDistrictHallImageUrl = (level) => {
  if (!level) return null;
  return `${DEFAULT_ASSET_BASE}/capital-base/capital-hall-pics/Building_CC_District_Hall_level_${level}.png`;
};

/**
 * Resuelve la URL de la bandera de un país por su código ISO (ej. "AR" -> flagcdn.com/w80/ar.png)
 */
export const getCountryFlagUrl = (countryCode) => {
  if (!countryCode || countryCode === 'GL') {
    return `${DEFAULT_ASSET_BASE}/icons/Icon_HV_Planet.png`;
  }
  return `https://flagcdn.com/w80/${String(countryCode).toLowerCase()}.png`;
};

/**
 * Extrae el nombre y el ícono real de la liga de un jugador (soportando League Tiers y Ligas clásicas)
 */
export const resolvePlayerLeagueInfo = (playerOrItem) => {
  if (!playerOrItem) return { leagueName: null, leagueImageUrl: null };

  const tier = playerOrItem.leagueTier;
  const classic = playerOrItem.league;

  if (tier && (tier.iconUrls?.small || tier.iconUrls?.large)) {
    return {
      leagueName: tier.name || classic?.name || 'Liga',
      leagueImageUrl: tier.iconUrls.small || tier.iconUrls.large
    };
  }

  if (classic && (classic.iconUrls?.small || classic.iconUrls?.medium || classic.iconUrls?.tiny)) {
    return {
      leagueName: classic.name,
      leagueImageUrl: classic.iconUrls.small || classic.iconUrls.medium || classic.iconUrls.tiny
    };
  }

  return {
    leagueName: classic?.name || tier?.name || null,
    leagueImageUrl: `${DEFAULT_ASSET_BASE}/leagues/league-tier/unranked.png`
  };
};

/**
 * Enriquece el objeto de datos del jugador recibido de Supercell agregando
 * URLs de imagen válidas a cada tropa, héroe, habilidad/equipamiento, hechizo, ligas y ayuntamiento.
 *
 * @param {object} player - Datos crudos del jugador provenientes de la API de Supercell
 * @returns {object} Datos del jugador enriquecidos con campos imageUrl
 */
export const enrichPlayerWithAssets = (player) => {
  if (!player) return player;

  // Copia superficial para no mutar el objeto original inesperadamente
  const enriched = { ...player };

  // 1. Imagen del Ayuntamiento
  if (enriched.townHallLevel) {
    enriched.townHallImageUrl = getTownHallImageUrl(enriched.townHallLevel);
  }

  // 2. Imagen del Taller de Constructor (si existe)
  if (enriched.builderHallLevel) {
    enriched.builderHallImageUrl = getBuilderHallImageUrl(enriched.builderHallLevel);
  }

  // 2.B Imágenes de Ligas (Aldea Principal / LeagueTier y Base del Constructor)
  const { leagueName, leagueImageUrl } = resolvePlayerLeagueInfo(enriched);
  enriched.leagueName = leagueName;
  enriched.leagueImageUrl = leagueImageUrl;

  if (enriched.builderBaseLeague?.name) {
    const bbLeagueImg = getBuilderBaseLeagueImageUrl(enriched.builderBaseLeague.name);
    enriched.builderBaseLeagueImageUrl = bbLeagueImg;
    enriched.builderBaseLeague = {
      ...enriched.builderBaseLeague,
      imageUrl: bbLeagueImg
    };
  }

  // 3. Héroes y su Equipamiento activo
  if (Array.isArray(enriched.heroes)) {
    enriched.heroes = enriched.heroes.map((hero) => {
      const heroCopy = {
        ...hero,
        imageUrl: getHeroImageUrl(hero.name)
      };

      if (Array.isArray(hero.equipment)) {
        heroCopy.equipment = hero.equipment.map((eq) => ({
          ...eq,
          imageUrl: getEquipmentImageUrl(eq.name)
        }));
      }

      return heroCopy;
    });
  }

  // 4. Todo el Equipamiento de Héroes general desbloqueado
  if (Array.isArray(enriched.heroEquipment)) {
    enriched.heroEquipment = enriched.heroEquipment.map((eq) => ({
      ...eq,
      imageUrl: getEquipmentImageUrl(eq.name)
    }));
  }

  // 5. Tropas (Tropas normales, Súper tropas, Asedios, Mascotas)
  if (Array.isArray(enriched.troops)) {
    enriched.troops = enriched.troops.map((troop) => ({
      ...troop,
      imageUrl: getTroopImageUrl(troop.name, troop.village)
    }));
  }

  // 6. Hechizos
  if (Array.isArray(enriched.spells)) {
    enriched.spells = enriched.spells.map((spell) => ({
      ...spell,
      imageUrl: getSpellImageUrl(spell.name)
    }));
  }

  return enriched;
};

/**
 * Enriquece un objeto de Clan (o ítem de ranking de clan) con banderas, ligas de guerra,
 * ligas de capital, imágenes de Capital del Clan y ayuntamiento/liga de cada miembro.
 */
export const enrichClanWithAssets = (clan) => {
  if (!clan) return clan;

  const enriched = { ...clan };

  // 1. Ubicación con bandera
  if (enriched.location) {
    enriched.location = {
      ...enriched.location,
      flagUrl: enriched.location.countryCode
        ? getCountryFlagUrl(enriched.location.countryCode)
        : `${DEFAULT_ASSET_BASE}/icons/Icon_HV_Planet.png`
    };
  }

  // 2. Liga de Guerra (CWL)
  if (enriched.warLeague?.name) {
    const wlImg = getWarLeagueImageUrl(enriched.warLeague.name);
    enriched.warLeagueImageUrl = wlImg;
    enriched.warLeague = {
      ...enriched.warLeague,
      imageUrl: wlImg
    };
  }

  // 3. Liga de Capital
  if (enriched.capitalLeague?.name) {
    const clImg = getCapitalLeagueImageUrl(enriched.capitalLeague.name);
    enriched.capitalLeagueImageUrl = clImg;
    enriched.capitalLeague = {
      ...enriched.capitalLeague,
      imageUrl: clImg
    };
  }

  // 4. Capital del Clan y sus Distritos
  if (enriched.clanCapital) {
    enriched.clanCapital = {
      ...enriched.clanCapital,
      capitalHallImageUrl: getCapitalHallImageUrl(enriched.clanCapital.capitalHallLevel),
      ...(Array.isArray(enriched.clanCapital.districts)
        ? {
            districts: enriched.clanCapital.districts.map((d) => ({
              ...d,
              districtHallImageUrl:
                d.name === 'Capital Peak'
                  ? getCapitalHallImageUrl(d.districtHallLevel)
                  : getDistrictHallImageUrl(d.districtHallLevel)
            }))
          }
        : {})
    };
  }

  // 5. Enriquecer miembros del clan (members o memberList)
  const enrichMember = (m) => {
    const { leagueName, leagueImageUrl } = resolvePlayerLeagueInfo(m);
    const bbLeagueImg = m.builderBaseLeague?.name
      ? getBuilderBaseLeagueImageUrl(m.builderBaseLeague.name)
      : null;
    return {
      ...m,
      townHallImageUrl: m.townHallLevel ? getTownHallImageUrl(m.townHallLevel) : null,
      leagueName,
      leagueImageUrl,
      builderBaseLeagueImageUrl: bbLeagueImg
    };
  };

  if (Array.isArray(enriched.members)) {
    enriched.members = enriched.members.map(enrichMember);
  }
  if (Array.isArray(enriched.memberList)) {
    enriched.memberList = enriched.memberList.map(enrichMember);
  }

  return enriched;
};

