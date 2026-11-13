import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { supabaseAdmin, supabaseClient } from '../config/supabase.js';
import { supercellApi } from './supercell.service.js';
import { queryFormattedPosts } from '../controllers/post.controller.js';
import {
  enrichPlayerWithAssets,
  getCapitalLeagueImageUrl,
  getCountryFlagUrl,
  getTownHallImageUrl,
  getWarLeagueImageUrl,
  resolvePlayerLeagueInfo
} from '../utils/assets.util.js';
import { encodeTag } from '../utils/tag.util.js';
import { moderatePost } from './aiModeration.service.js';
import * as calculatorService from './calculator.service.js';
import { getFullClanDetails } from './clan.service.js';
import * as gameDataService from './gameData.service.js';

dotenv.config();

const PRIMARY_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK_CHAT_MODEL = 'gemini-3.8-flash';

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Normaliza un tag de Clash of Clans para que siempre inicie con '#'
 */
const normalizeCocTag = (tag) => {
  if (!tag) return '';
  const decoded = decodeURIComponent(String(tag)).trim().toUpperCase().replace(/\s+/g, '');
  if (!decoded) return '';
  return decoded.startsWith('#') ? decoded : `#${decoded}`;
};

/**
 * Normaliza texto quitando tildes y caracteres especiales para búsqueda difusa
 */
const normalizeText = (value = '') =>
  String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Resuelve cualquier nombre o alias de estructura (en español o inglés) al ID oficial de gameDataService
 */
export const resolveDefenseTarget = (rawBuildingInput, rawLevel = null) => {
  const allDefenses = gameDataService.getAllDefenses().filter(
    (d) => d.id !== 'wall' && (d.levelsSummary?.some((l) => l.hp > 0) ?? true)
  );
  if (!rawBuildingInput) return null;

  const cleanInput = normalizeText(rawBuildingInput);

  const aliasMap = {
    'defensa aerea': 'air_defense',
    cohete: 'air_defense',
    cohetes: 'air_defense',
    antiaearea: 'air_defense',
    antiaerea: 'air_defense',
    'air defense': 'air_defense',
    'torre infernal': 'inferno_tower',
    infernal: 'inferno_tower',
    infierno: 'inferno_tower',
    inferno: 'inferno_tower',
    catapulta: 'scattershot',
    scattershot: 'scattershot',
    'artilleria aguila': 'eagle_artillery',
    aguila: 'eagle_artillery',
    eagle: 'eagle_artillery',
    monolito: 'monolith',
    monolith: 'monolith',
    ballesta: 'x_bow',
    'x bow': 'x_bow',
    xbow: 'x_bow',
    'torre de magos': 'wizard_tower',
    mago: 'wizard_tower',
    'torre de arqueras': 'archer_tower',
    'canon con rebote': 'ricochet_cannon',
    canon: 'cannon',
    'torre multiarquera': 'multi_archer_tower',
    multiarquera: 'multi_archer_tower',
    'torre de hechizos': 'spell_tower',
    'torre bombardera': 'bomb_tower',
    mortero: 'mortar',
    'controlador aereo': 'air_sweeper',
    soplador: 'air_sweeper',
    tesla: 'hidden_tesla',
    'tesla oculta': 'hidden_tesla',
    'choza de constructor': 'builders_hut',
    ayuntamiento: 'town_hall'
  };

  let matchedDefense = null;

  matchedDefense = allDefenses.find(
    (d) => d.id === String(rawBuildingInput).trim().toLowerCase()
  );

  if (!matchedDefense) {
    for (const [alias, targetId] of Object.entries(aliasMap)) {
      if (cleanInput === alias || cleanInput.includes(alias)) {
        matchedDefense = allDefenses.find((d) => d.id === targetId) || null;
        if (matchedDefense) break;
      }
    }
  }

  if (!matchedDefense) {
    matchedDefense =
      allDefenses.find((d) => normalizeText(d.spanishName) === cleanInput) ||
      allDefenses.find((d) => normalizeText(d.name) === cleanInput) ||
      allDefenses.find(
        (d) =>
          normalizeText(d.spanishName).includes(cleanInput) ||
          cleanInput.includes(normalizeText(d.spanishName)) ||
          normalizeText(d.name).includes(cleanInput)
      ) ||
      null;
  }

  if (!matchedDefense) return null;

  const minLvl = matchedDefense.minLevel || 1;
  const maxLvl = matchedDefense.maxLevel || 1;
  let resolvedLevel = Number(rawLevel);
  if (!resolvedLevel || Number.isNaN(resolvedLevel)) {
    resolvedLevel = maxLvl;
  } else {
    resolvedLevel = Math.max(minLvl, Math.min(maxLvl, Math.round(resolvedLevel)));
  }

  return {
    defense: matchedDefense,
    buildingId: matchedDefense.id,
    level: resolvedLevel
  };
};

/**
 * Obtiene el contexto resumido y seguro del usuario autenticado y sus aldeas claimeadas
 */
const loadUserTacticalContext = async ({ user, supabase, activePlayerTag }) => {
  if (!user || !supabase) {
    return {
      isAuthenticated: false,
      username: null,
      role: 'user',
      email: null,
      claimedPlayers: [],
      activeVillage: null,
      activeVillageRaw: null,
      inferredLevels: {}
    };
  }

  try {
    const [{ data: profile }, { data: claimedRows }] = await Promise.all([
      supabase.from('profiles').select('username, role').eq('id', user.id).maybeSingle(),
      supabase
        .from('claimed_players')
        .select('player_tag, player_name, town_hall_level, village_data, metadata, last_imported_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    ]);

    const list = claimedRows || [];
    const cleanActiveTag = activePlayerTag
      ? String(activePlayerTag).trim().toUpperCase()
      : null;

    const selected =
      (cleanActiveTag &&
        list.find((r) => String(r.player_tag).toUpperCase() === cleanActiveTag)) ||
      list[0] ||
      null;

    let inferredLevels = {};
    let activeSummary = null;

    if (selected) {
      const vd = selected.village_data || null;
      const spells = vd?.spells || vd?.laboratory?.spells || [];
      const equipment = vd?.equipment || [];

      const findSpellLvl = (slug) => {
        const found = spells.find(
          (s) =>
            String(s.id || s.slug || '').toLowerCase().includes(slug) ||
            String(s.name || '').toLowerCase().includes(slug)
        );
        return found?.level ? Number(found.level) : undefined;
      };

      const findEqLvl = (slug) => {
        const found = equipment.find(
          (e) =>
            String(e.id || e.slug || '').toLowerCase().includes(slug) ||
            String(e.name || '').toLowerCase().includes(slug.replace('_', ' '))
        );
        return found?.level ? Number(found.level) : undefined;
      };

      inferredLevels = {
        lightning: findSpellLvl('lightning'),
        earthquake: findSpellLvl('earthquake'),
        giant_arrow: findEqLvl('giant_arrow'),
        fireball: findEqLvl('fireball'),
        spiky_ball: findEqLvl('spiky_ball'),
        seeking_shield: findEqLvl('seeking_shield'),
        rocket_backpack: findEqLvl('rocket_backpack')
      };

      activeSummary = {
        player_tag: selected.player_tag,
        player_name: selected.player_name,
        town_hall_level: selected.town_hall_level || vd?.townHallLevel || 16,
        has_village_json: Boolean(vd),
        overall_percentage: vd?.progress?.overall_percentage ?? null,
        defenses_percentage: vd?.progress?.defenses_percentage ?? null,
        heroes_percentage: vd?.progress?.heroes_percentage ?? null,
        lab_percentage: vd?.progress?.lab_percentage ?? null,
        walls_percentage: vd?.progress?.walls_percentage ?? null,
        builders_busy: vd?.builders?.busy ?? null,
        builders_total: vd?.builders?.total ?? null,
        inferredLevels
      };
    }

    return {
      isAuthenticated: true,
      username:
        profile?.username ||
        user.user_metadata?.username ||
        user.email?.split('@')[0] ||
        'Estratega',
      role: profile?.role || 'user',
      email: user.email || null,
      claimedPlayers: list.map((c) => ({
        player_tag: c.player_tag,
        player_name: c.player_name,
        town_hall_level: c.town_hall_level || c.village_data?.townHallLevel || 1,
        has_json: Boolean(c.village_data)
      })),
      activeVillage: activeSummary,
      activeVillageRaw: selected || null,
      inferredLevels
    };
  } catch (err) {
    console.warn('[ChatService] No se pudo cargar el contexto de usuario:', err.message);
    return {
      isAuthenticated: true,
      username: user.user_metadata?.username || 'Estratega',
      role: 'user',
      email: user.email || null,
      claimedPlayers: [],
      activeVillage: null,
      activeVillageRaw: null,
      inferredLevels: {}
    };
  }
};

/**
 * Construye el prompt del sistema con información completa de ClashTactics y capacidades agénticas
 */
const buildSystemInstruction = (userContext) => {
  const authSummary = userContext.isAuthenticated
    ? `El usuario TIENE SESIÓN INICIADA como "${userContext.username}" (Rol: ${userContext.role.toUpperCase()} • ${userContext.email || 'correo verificado'}).`
    : 'El usuario NO ha iniciado sesión todavía (modo invitado).';

  const villageSummary = userContext.activeVillage
    ? `Aldea claimeada activa en Inicio: ${userContext.activeVillage.player_name} (${userContext.activeVillage.player_tag}) — Ayuntamiento TH${userContext.activeVillage.town_hall_level}. ` +
      (userContext.activeVillage.has_village_json
        ? `Progreso general: ${Number(userContext.activeVillage.overall_percentage || 0).toFixed(1)}% (Defensas: ${Number(userContext.activeVillage.defenses_percentage || 0).toFixed(1)}%, Héroes: ${Number(userContext.activeVillage.heroes_percentage || 0).toFixed(1)}%, Lab: ${Number(userContext.activeVillage.lab_percentage || 0).toFixed(1)}%). Niveles detectados para la calculadora: ${JSON.stringify(userContext.activeVillage.inferredLevels)}.`
        : 'Aún no ha importado su JSON de exportación en Inicio.')
    : 'El usuario no tiene aldeas claimeadas seleccionadas actualmente.';

  return `Eres el **Asistente Agéntico Oficial de ClashTactics**, una inteligencia artificial integrada que no solo responde preguntas, sino que **interactúa de forma autónoma con la aplicación**, carga datos en tiempo real, los analiza, ejecuta tareas en el sistema y asiste activamente al usuario.
Responde siempre en español claro, amigable, conciso y bien estructurado.

CONTEXTO ACTUAL DEL USUARIO:
- ${authSummary}
- ${villageSummary}

TUS CAPACIDADES AGÉNTICAS Y HERRAMIENTAS:
1. CARGAR Y ANALIZAR JUGADORES Y CLANES EN TIEMPO REAL:
   - \`load_and_analyze_player\`: Carga desde la API oficial de Clash of Clans cualquier jugador por su Tag (o el jugador activo del usuario si no indica tag), analiza su Ayuntamiento, liga, trofeos, héroes, equipamiento y tropas, y habilita un botón directo para abrir ese jugador en la pestaña *Jugadores*.
   - \`load_and_analyze_clan\`: Carga desde la API oficial el dashboard completo de un clan por su Tag, analiza su nivel, guerra actual, racha de victorias, liga CWL, Capital y miembros, y habilita un botón directo para abrir el clan en *Clanes*.
   - \`analyze_my_village_progress\`: Audita a fondo el JSON del Village Tracker del usuario (porcentajes por categoría, cuellos de botella, constructores ocupados, tiempos restantes de mejoras activas y prioridades de mejora recomendadas).

2. EJECUTAR ACCIONES Y TAREAS AUTÓNOMAS DENTRO DEL SISTEMA:
   - \`manage_favorite\`: Agrega, elimina o alterna de forma autónoma un jugador o clan en la lista de Favoritos del usuario en Supabase.
   - \`publish_community_post\`: Publica de forma autónoma una nueva estrategia de ejército (\`army_strategy\`) o diseño de aldea (\`base_layout\`) en la pestaña *Comunidad* a nombre del usuario (pasando por moderación IA).
   - \`update_my_profile\`: Actualiza de forma autónoma el nombre de usuario (\`username\`) o el rol (\`user\` / \`admin\`) del usuario autenticado.
   - \`set_app_theme\`: Cambia inmediatamente el tema visual de la aplicación entre modo Oscuro (\`dark\`) y modo Claro (\`light\`).

3. RECOMENDAR EJÉRCITOS Y DISEÑOS DE ALDEA (CON COMUNIDAD):
   - \`search_community_posts\`: Busca publicaciones reales en la pestaña *Comunidad* filtrando por tipo, TH y categoría.

4. CALCULADORA TÁCTICA DE DAÑO (RAYOS, TERREMOTOS Y HABILIDADES HEROICAS):
   - \`calculate_damage_recipes\`: Calcula la combinación óptima de Rayos, Terremotos y Habilidades Heroicas para derribar cualquier defensa.

5. GESTIÓN SEGURA DE CONTRASEÑA Y NAVEGACIÓN:
   - \`request_account_action\`: Si el usuario pide cambiar o recuperar su contraseña, NUNCA pidas la clave por texto; invoca \`request_account_action\` con \`open_change_password\` (si tiene sesión) u \`open_forgot_password\` (si no tiene sesión) para abrir el modal seguro.`;
};

/**
 * Declaraciones de herramientas (Tools) para la Interactions API de @google/genai
 */
const CHAT_TOOLS = [
  {
    type: 'function',
    name: 'search_community_posts',
    description:
      'Busca publicaciones reales en la pestaña Comunidad de ClashTactics (estrategias de ejército o diseños de aldea) filtrando por tipo, Ayuntamiento (TH), categoría o texto.',
    parameters: {
      type: 'object',
      properties: {
        post_type: {
          type: 'string',
          enum: ['army_strategy', 'base_layout'],
          description: 'Tipo de publicación: army_strategy (ejércitos) o base_layout (diseños de aldea).'
        },
        town_hall_level: {
          type: 'string',
          description: 'Nivel de Ayuntamiento, por ejemplo "TH16", "TH15", "16", etc.'
        },
        category: {
          type: 'string',
          enum: ['Guerra', 'Farming', 'Subida', 'Estrategia'],
          description: 'Categoría táctica opcional.'
        },
        query: {
          type: 'string',
          description: 'Palabra clave opcional para buscar en el título.'
        },
        limit: {
          type: 'integer',
          description: 'Cantidad máxima de resultados (por defecto 3, máximo 5).'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'calculate_damage_recipes',
    description:
      'Ejecuta la Calculadora Táctica de Daño de ClashTactics para saber con exactitud cuántos Hechizos de Rayo, Terremoto y Habilidades Heroicas destruyen una estructura defensiva.',
    parameters: {
      type: 'object',
      properties: {
        building: {
          type: 'string',
          description:
            'Nombre o ID de la defensa objetivo (ej: "air_defense", "inferno_tower", "scattershot", "eagle_artillery", "monolith", "x_bow", "defensa aerea", "torre infernal").'
        },
        level: {
          type: 'integer',
          description: 'Nivel de la defensa objetivo. Si no se indica, se usa el nivel máximo disponible.'
        },
        supercharge: {
          type: 'integer',
          description: 'Nivel de supercarga opcional (1 o 2).'
        },
        lightning_level: {
          type: 'integer',
          description: 'Nivel del Hechizo de Rayo del usuario (opcional).'
        },
        earthquake_level: {
          type: 'integer',
          description: 'Nivel del Hechizo de Terremoto del usuario (opcional).'
        },
        giant_arrow_level: {
          type: 'integer',
          description: 'Nivel de Flecha Gigante de la Reina Arquera (opcional).'
        },
        fireball_level: {
          type: 'integer',
          description: 'Nivel de Bola de Fuego del Gran Centinela (opcional).'
        },
        spiky_ball_level: {
          type: 'integer',
          description: 'Nivel de Bola con Pinchos del Rey Bárbaro (opcional).'
        },
        seeking_shield_level: {
          type: 'integer',
          description: 'Nivel de Escudo Rastreador de la Luchadora Real (opcional).'
        },
        rocket_backpack_level: {
          type: 'integer',
          description: 'Nivel de Mochila Cohete (opcional).'
        }
      },
      required: ['building']
    }
  },
  {
    type: 'function',
    name: 'load_and_analyze_player',
    description:
      'Carga en tiempo real los datos de un jugador de Clash of Clans desde la API oficial de Supercell por su Tag (o usa la aldea activa del usuario si no se envía tag) y analiza sus héroes, equipamiento, tropas y estadísticas.',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Tag del jugador de Clash of Clans (ej: "#Y8J8RPVJU"). Opcional si el usuario pide analizar su propio perfil activo.'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'load_and_analyze_clan',
    description:
      'Carga en tiempo real el dashboard completo de un clan desde la API oficial de Supercell por su Tag y analiza su nivel, guerra actual, registro de guerras, liga CWL y miembros.',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Tag del clan de Clash of Clans (ej: "#2PP").'
        }
      },
      required: ['tag']
    }
  },
  {
    type: 'function',
    name: 'analyze_my_village_progress',
    description:
      'Analiza el progreso detallado del Village Tracker de la aldea claimeada del usuario (porcentajes de estructuras, héroes, laboratorio, muros, mejoras activas con tiempo restante y cuellos de botella a priorizar).',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Tag opcional de la aldea claimeada a auditar.'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'manage_favorite',
    description:
      'Ejecuta la acción autónoma de agregar, eliminar o alternar un jugador o clan en los Favoritos del usuario dentro del sistema.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['player', 'clan'],
          description: 'Tipo de favorito: "player" (jugador) o "clan" (clan).'
        },
        target_tag: {
          type: 'string',
          description: 'Tag del jugador o clan (ej: "#Y8J8RPVJU" o "#2PP").'
        },
        action: {
          type: 'string',
          enum: ['add', 'remove', 'toggle'],
          description: 'Acción a realizar: "add" (agregar), "remove" (quitar) o "toggle" (alternar).'
        }
      },
      required: ['type', 'target_tag']
    }
  },
  {
    type: 'function',
    name: 'publish_community_post',
    description:
      'Crea y publica de forma autónoma un nuevo post en la pestaña Comunidad (estrategia de ejército o diseño de aldea) a nombre del usuario autenticado.',
    parameters: {
      type: 'object',
      properties: {
        post_type: {
          type: 'string',
          enum: ['army_strategy', 'base_layout'],
          description: 'Tipo de publicación: "army_strategy" o "base_layout".'
        },
        title: {
          type: 'string',
          description: 'Título atractivo de la publicación.'
        },
        description: {
          type: 'string',
          description: 'Explicación táctica de cómo ejecutar el ataque o cómo defiende la aldea.'
        },
        town_hall_level: {
          type: 'string',
          description: 'Nivel de Ayuntamiento en formato "TH16", "TH15", etc.'
        },
        category: {
          type: 'string',
          enum: ['Guerra', 'Farming', 'Subida', 'Estrategia'],
          description: 'Categoría de la publicación.'
        },
        deep_link: {
          type: 'string',
          description: 'Enlace directo opcional para copiar ejército o aldea en Clash of Clans.'
        }
      },
      required: ['post_type', 'title', 'description', 'town_hall_level']
    }
  },
  {
    type: 'function',
    name: 'update_my_profile',
    description:
      'Actualiza de forma autónoma el perfil del usuario autenticado (su nombre de usuario username o su rol user/admin).',
    parameters: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Nuevo nombre de usuario opcional.'
        },
        role: {
          type: 'string',
          enum: ['user', 'admin'],
          description: 'Nuevo rol opcional ("user" o "admin").'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'set_app_theme',
    description:
      'Cambia de forma autónoma e inmediata el tema visual de la aplicación entre modo oscuro ("dark"), modo claro ("light") o alternar ("toggle").',
    parameters: {
      type: 'object',
      properties: {
        theme: {
          type: 'string',
          enum: ['dark', 'light', 'toggle'],
          description: 'Tema visual a aplicar en la interfaz.'
        }
      },
      required: ['theme']
    }
  },
  {
    type: 'function',
    name: 'list_game_defenses',
    description:
      'Consulta el catálogo de defensas y estructuras disponibles en la Enciclopedia y Calculadora con sus rangos de niveles y puntos de vida (HP).',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Filtro opcional por nombre de la defensa.'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'request_account_action',
    description:
      'Muestra un botón de acción interactiva en el chat para ayudar al usuario a cambiar su contraseña, recuperar su contraseña, iniciar sesión, ir a la calculadora o ir a la comunidad.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'open_change_password',
            'open_forgot_password',
            'open_login',
            'open_calculator',
            'open_community',
            'open_claim_player',
            'open_paste_json'
          ],
          description: 'Acción rápida que se mostrará como botón debajo de la respuesta.'
        }
      },
      required: ['action']
    }
  }
];

/**
 * Construye el objeto de botón de acción para el frontend
 */
const buildActionObject = (actionType, extra = {}) => {
  const defaultLabels = {
    open_change_password: 'Cambiar contraseña ahora',
    open_forgot_password: 'Recuperar contraseña en Más',
    open_login: 'Iniciar sesión en Más',
    open_calculator: 'Abrir Calculadora Táctica',
    open_community: 'Explorar pestaña Comunidad',
    open_claim_player: 'Ir a Jugadores para Claimear',
    open_paste_json: 'Pegar JSON de aldea en Inicio',
    open_player: extra.label || `Ver jugador ${extra.tag || ''}`,
    open_clan: extra.label || `Ver clan ${extra.tag || ''}`
  };

  if (!defaultLabels[actionType]) return null;
  return {
    type: actionType,
    label: extra.label || defaultLabels[actionType],
    ...extra
  };
};

/**
 * Ejecuta la carga y análisis en tiempo real de un jugador de Clash of Clans
 */
const executeLoadAndAnalyzePlayer = async (args, userContext) => {
  const rawTag = args.tag || userContext.activeVillage?.player_tag;
  const cleanTag = normalizeCocTag(rawTag);

  if (!cleanTag) {
    return {
      ok: false,
      error: 'Debes indicar un Tag de jugador (por ejemplo #Y8J8RPVJU) o tener una aldea claimeada activa.'
    };
  }

  try {
    const encoded = encodeTag(cleanTag);
    const response = await supercellApi.get(`/players/${encoded}`);
    const enriched = enrichPlayerWithAssets(response.data);
    const heroes = (enriched.heroes || []).filter((h) => h.village === 'home');
    const equipment = enriched.heroEquipment || [];
    const maxTroops = (enriched.troops || []).filter(
      (t) => t.village === 'home' && t.level === t.maxLevel
    );

    const preview = {
      tag: enriched.tag,
      name: enriched.name,
      townHallLevel: enriched.townHallLevel || 1,
      townHallImageUrl:
        enriched.townHallImageUrl || getTownHallImageUrl(enriched.townHallLevel || 1),
      expLevel: enriched.expLevel || 1,
      trophies: enriched.trophies || 0,
      bestTrophies: enriched.bestTrophies || 0,
      warStars: enriched.warStars || 0,
      attackWins: enriched.attackWins || 0,
      clanName: enriched.clan?.name || 'Sin clan',
      clanTag: enriched.clan?.tag || null,
      clanBadgeUrl:
        enriched.clan?.badgeUrls?.small ||
        enriched.clan?.badgeUrls?.medium ||
        null,
      leagueName: enriched.leagueName || enriched.league?.name || 'Sin liga',
      leagueImageUrl: enriched.leagueImageUrl || null,
      heroesSummary: heroes.map((h) => ({
        name: h.name,
        level: h.level,
        maxLevel: h.maxLevel
      })),
      maxedHomeTroopsCount: maxTroops.length,
      totalEquipmentCount: equipment.length
    };

    return {
      ok: true,
      preview
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo cargar el jugador ${cleanTag} desde la API oficial (${err.response?.data?.message || err.message}).`
    };
  }
};

/**
 * Ejecuta la carga y análisis en tiempo real de un clan de Clash of Clans
 */
const executeLoadAndAnalyzeClan = async (args, supabase, userContext) => {
  const cleanTag = normalizeCocTag(args.tag);
  if (!cleanTag) {
    return {
      ok: false,
      error: 'Debes indicar un Tag de clan válido (por ejemplo #2PP).'
    };
  }

  try {
    const fullClan = await getFullClanDetails(
      cleanTag,
      supabase || supabaseClient,
      userContext.user?.id || null
    );

    const preview = {
      tag: fullClan.tag,
      name: fullClan.name,
      clanLevel: fullClan.clanLevel || 1,
      badgeUrl:
        fullClan.badgeUrls?.medium ||
        fullClan.badgeUrls?.large ||
        fullClan.badgeUrls?.small ||
        null,
      membersCount: fullClan.members || fullClan.memberList?.length || 0,
      clanPoints: fullClan.clanPoints || 0,
      clanCapitalPoints: fullClan.clanCapitalPoints || 0,
      warLeagueName: fullClan.warLeague?.name || 'Sin liga',
      capitalLeagueName: fullClan.capitalLeague?.name || 'Sin liga',
      warWinStreak: fullClan.warWinStreak || 0,
      warWins: fullClan.warWins || 0,
      currentWarState: fullClan.currentWar?.state || 'notInWar',
      description: fullClan.description || ''
    };

    return {
      ok: true,
      preview
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo cargar el clan ${cleanTag} desde la API oficial (${err.response?.data?.message || err.message}).`
    };
  }
};

/**
 * Audita a fondo el progreso del Village Tracker del usuario
 */
const executeAnalyzeMyVillageProgress = (args, userContext) => {
  if (!userContext.isAuthenticated) {
    return {
      ok: false,
      needsLogin: true,
      error: 'El usuario debe iniciar sesión para auditar su aldea claimeada.'
    };
  }

  const rawRow = userContext.activeVillageRaw;
  if (!rawRow) {
    return {
      ok: false,
      needsClaim: true,
      error: 'El usuario aún no tiene ninguna aldea claimeada en su cuenta.'
    };
  }

  const vd = rawRow.village_data;
  if (!vd) {
    return {
      ok: false,
      needsJson: true,
      player_tag: rawRow.player_tag,
      player_name: rawRow.player_name,
      town_hall_level: rawRow.town_hall_level || 16,
      error: `La aldea ${rawRow.player_name} (${rawRow.player_tag}) está claimeada pero aún no tiene un JSON de exportación importado en Inicio.`
    };
  }

  const progress = {
    overall: Number(vd.progress?.overall_percentage ?? vd.completionPercentage ?? 0),
    defenses: Number(vd.progress?.defenses_percentage ?? 0),
    heroes: Number(vd.progress?.heroes_percentage ?? 0),
    laboratory: Number(vd.progress?.lab_percentage ?? 0),
    walls: Number(vd.progress?.walls_percentage ?? 0)
  };

  const categoryEntries = [
    { name: 'Héroes', pct: progress.heroes, priorityHint: 'Prioridad #1 ofensiva y defensiva' },
    { name: 'Laboratorio (Tropas y Hechizos)', pct: progress.laboratory, priorityHint: 'Esencial para ataques de guerra de 3 estrellas' },
    { name: 'Defensas Principales', pct: progress.defenses, priorityHint: 'Prioriza Monolito, Águila, Catapultas e Infernales' },
    { name: 'Muros', pct: progress.walls, priorityHint: 'Mejora con recursos sobrantes entre constructores' }
  ].sort((a, b) => a.pct - b.pct);

  const importedAtMs = rawRow.last_imported_at
    ? new Date(rawRow.last_imported_at).getTime()
    : Date.now();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - importedAtMs) / 1000));

  const activeUpgrades = (vd.activeUpgrades || []).map((upg) => {
    const rawTimer = Number(upg.timerSeconds || upg.timer || 0);
    const remainingSeconds = Math.max(0, rawTimer - elapsedSeconds);
    const hours = Math.floor(remainingSeconds / 3600);
    const mins = Math.floor((remainingSeconds % 3600) / 60);
    return {
      name: upg.spanishName || upg.name || 'Estructura',
      currentLevel: upg.level,
      targetLevel: upg.targetLevel || (Number(upg.level || 1) + 1),
      category: upg.category || 'general',
      remainingSeconds,
      status: remainingSeconds === 0 ? 'Completada' : `${hours}h ${mins}m restantes`
    };
  });

  return {
    ok: true,
    audit: {
      player_tag: rawRow.player_tag,
      player_name: rawRow.player_name,
      town_hall_level: rawRow.town_hall_level || vd.townHallLevel || 16,
      progress,
      bottleneckCategory: categoryEntries[0],
      sortedCategories: categoryEntries,
      builders: vd.builders || { busy: activeUpgrades.filter((u) => u.remainingSeconds > 0).length, total: 5 },
      activeUpgrades: activeUpgrades.slice(0, 8)
    }
  };
};

/**
 * Ejecuta autónomamente agregar/quitar un jugador o clan en Favoritos
 */
const executeManageFavorite = async (args, supabase, userContext) => {
  if (!userContext.isAuthenticated || !userContext.user || !supabase) {
    return {
      ok: false,
      needsLogin: true,
      error: 'Debes iniciar sesión para que pueda guardar jugadores o clanes en tus Favoritos.'
    };
  }

  const type = args.type === 'clan' ? 'clan' : 'player';
  const cleanTag = normalizeCocTag(args.target_tag);
  const action = args.action || 'add';

  if (!cleanTag) {
    return {
      ok: false,
      error: 'Se requiere un tag válido (#...) para gestionar el favorito.'
    };
  }

  try {
    const { data: existing } = await supabase
      .from('favorites')
      .select('id, target_name')
      .eq('user_id', userContext.user.id)
      .eq('type', type)
      .eq('target_tag', cleanTag)
      .maybeSingle();

    if (action === 'remove' || (action === 'toggle' && existing)) {
      if (existing) {
        await supabase
          .from('favorites')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', userContext.user.id);
      }
      return {
        ok: true,
        isFavorite: false,
        type,
        tag: cleanTag,
        name: existing?.target_name || cleanTag,
        message: `${existing?.target_name || cleanTag} fue eliminado de tus Favoritos.`
      };
    }

    if (existing && action === 'add') {
      return {
        ok: true,
        isFavorite: true,
        type,
        tag: cleanTag,
        name: existing.target_name,
        message: `${existing.target_name} (${cleanTag}) ya estaba en tus Favoritos.`
      };
    }

    // Consultar Supercell API para obtener nombre y metadata real
    const encoded = encodeTag(cleanTag);
    let targetName = cleanTag;
    let metadata = {};

    if (type === 'player') {
      const res = await supercellApi.get(`/players/${encoded}`);
      const { leagueName, leagueImageUrl } = resolvePlayerLeagueInfo(res.data);
      targetName = res.data.name;
      metadata = {
        town_hall: res.data.townHallLevel || 1,
        town_hall_image_url: getTownHallImageUrl(res.data.townHallLevel || 1),
        trophies: res.data.trophies ?? 0,
        best_trophies: res.data.bestTrophies ?? 0,
        exp_level: res.data.expLevel ?? 1,
        clan_name: res.data.clan?.name || null,
        clan_tag: res.data.clan?.tag || null,
        league: leagueName,
        league_image_url: leagueImageUrl,
        badge_url:
          res.data.clan?.badgeUrls?.small ||
          res.data.clan?.badgeUrls?.medium ||
          null
      };
    } else {
      const res = await supercellApi.get(`/clans/${encoded}`);
      const warLeagueName = res.data.warLeague?.name || null;
      const capitalLeagueName = res.data.capitalLeague?.name || null;
      const countryCode = res.data.location?.countryCode || null;
      targetName = res.data.name;
      metadata = {
        clan_level: res.data.clanLevel || 1,
        members: res.data.members ?? 0,
        clan_points: res.data.clanPoints ?? 0,
        war_league: warLeagueName,
        war_league_image_url: getWarLeagueImageUrl(warLeagueName),
        capital_league: capitalLeagueName,
        capital_league_image_url: getCapitalLeagueImageUrl(capitalLeagueName),
        country_code: countryCode,
        flag_url: countryCode ? getCountryFlagUrl(countryCode) : null,
        badge_url:
          res.data.badgeUrls?.medium ||
          res.data.badgeUrls?.small ||
          null
      };
    }

    await supabase.from('favorites').insert({
      user_id: userContext.user.id,
      type,
      target_tag: cleanTag,
      target_name: targetName,
      metadata
    });

    return {
      ok: true,
      isFavorite: true,
      type,
      tag: cleanTag,
      name: targetName,
      message: `${targetName} (${cleanTag}) fue agregado a tus Favoritos.`
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo gestionar el favorito ${cleanTag}: ${err.response?.data?.message || err.message}`
    };
  }
};

/**
 * Ejecuta autónomamente la publicación de un post en Comunidad
 */
const executePublishCommunityPost = async (args, supabase, userContext) => {
  if (!userContext.isAuthenticated || !userContext.user || !supabase) {
    return {
      ok: false,
      needsLogin: true,
      error: 'Debes iniciar sesión para que el asistente pueda publicar estrategias o aldeas en Comunidad a tu nombre.'
    };
  }

  const postType = args.post_type === 'base_layout' ? 'base_layout' : 'army_strategy';
  const title = String(args.title || '').trim();
  const description = String(args.description || '').trim();
  const rawTh = String(args.town_hall_level || userContext.activeVillage?.town_hall_level || 'TH16')
    .trim()
    .toUpperCase();
  const formattedTh = rawTh.startsWith('TH') ? rawTh : `TH${rawTh.replace(/[^0-9]/g, '') || '16'}`;
  const category = ['Guerra', 'Farming', 'Subida', 'Estrategia'].includes(args.category)
    ? args.category
    : 'Guerra';

  if (!title || title.length < 4) {
    return {
      ok: false,
      error: 'El título de la publicación debe tener al menos 4 caracteres.'
    };
  }

  const moderation = await moderatePost({
    author: userContext.username || 'Estratega',
    title,
    description,
    category,
    imageUrl: null
  });

  if (!moderation.ok) {
    return {
      ok: false,
      error: `La moderación automática rechazó el contenido: ${moderation.reason}`
    };
  }

  try {
    const { data, error } = await supabase
      .from('community_posts')
      .insert({
        author_id: userContext.user.id,
        post_type: postType,
        title,
        description: description || null,
        town_hall_level: formattedTh,
        category,
        deep_link: args.deep_link || null,
        is_moderated: true
      })
      .select(`
        *,
        author:profiles (id, username, avatar_url, role)
      `)
      .single();

    if (error) throw error;

    const formattedPost = {
      ...data,
      ratings_count: 0,
      average_rating: 0,
      my_rating: null,
      comments_count: 0
    };

    return {
      ok: true,
      post: formattedPost
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo crear la publicación: ${err.message}`
    };
  }
};

/**
 * Ejecuta autónomamente la actualización del perfil o rol del usuario
 */
const executeUpdateMyProfile = async (args, supabase, userContext) => {
  if (!userContext.isAuthenticated || !userContext.user || !supabase) {
    return {
      ok: false,
      needsLogin: true,
      error: 'Debes iniciar sesión para actualizar tu perfil o rol.'
    };
  }

  const updates = {
    updated_at: new Date().toISOString()
  };

  if (args.username && String(args.username).trim()) {
    updates.username = String(args.username).trim();
  }

  if (args.role && ['user', 'admin'].includes(String(args.role).toLowerCase())) {
    updates.role = String(args.role).toLowerCase();
  }

  const dbClient = updates.role ? (supabaseAdmin || supabase) : supabase;

  try {
    const { data, error } = await dbClient
      .from('profiles')
      .update(updates)
      .eq('id', userContext.user.id)
      .select()
      .single();

    if (error) throw error;

    return {
      ok: true,
      profile: data
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo actualizar el perfil: ${err.message}`
    };
  }
};

/**
 * Ejecuta una búsqueda flexible en community_posts con degradación gradual
 */
const executeCommunitySearch = async (supabase, args, userContext) => {
  const client = supabase || supabaseClient;
  const maxItems = Math.min(Math.max(Number(args.limit) || 3, 1), 5);
  const rawTh =
    args.town_hall_level ||
    (userContext.activeVillage?.town_hall_level
      ? `TH${userContext.activeVillage.town_hall_level}`
      : undefined);

  let { posts } = await queryFormattedPosts(client, {
    post_type: args.post_type,
    town_hall_level: rawTh,
    category: args.category,
    search: args.query,
    limit: maxItems,
    sort: 'top_rated',
    userId: userContext.user?.id || null
  });

  let matchNote = 'exact';

  if (posts.length === 0 && args.query) {
    const retryNoQuery = await queryFormattedPosts(client, {
      post_type: args.post_type,
      town_hall_level: rawTh,
      category: args.category,
      limit: maxItems,
      sort: 'top_rated'
    });
    posts = retryNoQuery.posts;
    matchNote = 'relaxed_query';
  }

  if (posts.length === 0 && args.category) {
    const retryNoCat = await queryFormattedPosts(client, {
      post_type: args.post_type,
      town_hall_level: rawTh,
      limit: maxItems,
      sort: 'top_rated'
    });
    posts = retryNoCat.posts;
    matchNote = 'relaxed_category';
  }

  if (posts.length === 0) {
    const retryAnyTh = await queryFormattedPosts(client, {
      post_type: args.post_type,
      limit: maxItems,
      sort: 'top_rated'
    });
    posts = retryAnyTh.posts;
    matchNote = 'fallback_any_th';
  }

  return {
    posts,
    matchNote,
    requestedTh: rawTh || null
  };
};

/**
 * Ejecuta el cálculo de recetas óptimas resolviendo nombres y niveles del usuario
 */
const executeDamageCalculation = (args, userContext) => {
  const resolved = resolveDefenseTarget(args.building, args.level);
  if (!resolved) {
    return {
      ok: false,
      error: `No se encontró una defensa llamada "${args.building}". Usa list_game_defenses para ver los nombres disponibles.`
    };
  }

  const inferred = userContext.inferredLevels || {};

  const userLevels = {
    lightning: args.lightning_level ?? inferred.lightning ?? 11,
    earthquake: args.earthquake_level ?? inferred.earthquake ?? 5,
    giant_arrow:
      args.giant_arrow_level !== undefined
        ? args.giant_arrow_level
        : (inferred.giant_arrow ?? 18),
    fireball:
      args.fireball_level !== undefined ? args.fireball_level : (inferred.fireball ?? null),
    spiky_ball:
      args.spiky_ball_level !== undefined
        ? args.spiky_ball_level
        : (inferred.spiky_ball ?? null),
    seeking_shield:
      args.seeking_shield_level !== undefined
        ? args.seeking_shield_level
        : (inferred.seeking_shield ?? null),
    rocket_backpack:
      args.rocket_backpack_level !== undefined
        ? args.rocket_backpack_level
        : (inferred.rocket_backpack ?? null)
  };

  try {
    const calcResult = calculatorService.calculateOptimalRecipes({
      building: resolved.buildingId,
      level: resolved.level,
      supercharge: args.supercharge ?? null,
      userLevels
    });

    return {
      ok: true,
      result: calcResult
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
};

/**
 * Detecta intenciones clave en el texto del usuario
 */
const detectUserIntents = (message = '') => {
  const norm = normalizeText(message);
  return {
    wantsPasswordHelp:
      norm.includes('contrasena') ||
      norm.includes('clave') ||
      norm.includes('password') ||
      norm.includes('cambiar mi') ||
      norm.includes('olvide'),
    wantsThemeChange:
      norm.includes('tema claro') ||
      norm.includes('modo claro') ||
      norm.includes('tema oscuro') ||
      norm.includes('modo oscuro') ||
      norm.includes('cambiar tema'),
    wantsVillageAudit:
      norm.includes('audita') ||
      norm.includes('analiza mi aldea') ||
      norm.includes('mi progreso') ||
      norm.includes('que mejorar') ||
      norm.includes('constructores'),
    wantsArmy:
      norm.includes('ejercito') ||
      norm.includes('ejercitos') ||
      norm.includes('ataque') ||
      norm.includes('tropa') ||
      norm.includes('estrategia'),
    wantsLayout:
      norm.includes('aldea') ||
      norm.includes('diseno') ||
      norm.includes('base') ||
      norm.includes('layout') ||
      norm.includes('farming') ||
      norm.includes('guerra'),
    wantsCalculator:
      norm.includes('calculadora') ||
      norm.includes('rayo') ||
      norm.includes('rayos') ||
      norm.includes('terremoto') ||
      norm.includes('flecha gigante') ||
      norm.includes('bola de fuego') ||
      norm.includes('destruir') ||
      norm.includes('derribar') ||
      norm.includes('zap')
  };
};

/**
 * Asistente local de respaldo cuando GEMINI_API_KEY no está disponible o falla la red
 */
const runFallbackChatAssistant = async ({
  message,
  userContext,
  supabase
}) => {
  const intents = detectUserIntents(message);
  const recommendedPosts = [];
  let calculatorResult = null;
  let playerPreview = null;
  let clanPreview = null;
  const executedTasks = [];
  const clientEffects = {};
  const actionsMap = new Map();

  const addAction = (type, extra = {}) => {
    const obj = buildActionObject(type, extra);
    if (obj) actionsMap.set(`${type}:${extra.tag || ''}`, obj);
  };

  if (intents.wantsThemeChange) {
    const norm = normalizeText(message);
    const targetTheme = norm.includes('claro') ? 'light' : norm.includes('oscuro') ? 'dark' : 'toggle';
    clientEffects.themeMode = targetTheme;
    executedTasks.push({
      id: `task_theme_${Date.now()}`,
      tool: 'set_app_theme',
      title: 'Tema visual actualizado',
      detail: `Modo ${targetTheme === 'light' ? 'Claro' : targetTheme === 'dark' ? 'Oscuro' : 'Alternado'} aplicado`,
      status: 'completed'
    });
    return {
      reply: `¡Listo! He cambiado automáticamente el tema visual de la aplicación a **Modo ${targetTheme === 'light' ? 'Claro' : 'Oscuro'}**.`,
      recommendedPosts: [],
      calculatorResult: null,
      playerPreview: null,
      clanPreview: null,
      executedTasks,
      clientEffects,
      actions: Array.from(actionsMap.values()),
      mode: 'fallback'
    };
  }

  if (intents.wantsVillageAudit) {
    const auditRes = executeAnalyzeMyVillageProgress({}, userContext);
    if (auditRes.ok && auditRes.audit) {
      const a = auditRes.audit;
      executedTasks.push({
        id: `task_audit_${Date.now()}`,
        tool: 'analyze_my_village_progress',
        title: 'Auditoría de aldea completada',
        detail: `${a.player_name} (TH${a.town_hall_level}) • ${a.progress.overall.toFixed(1)}% total`,
        status: 'completed'
      });
      return {
        reply:
          `Realicé la auditoría táctica de tu aldea **${a.player_name} (${a.player_tag} • TH${a.town_hall_level})**:\n\n` +
          `• **Progreso General**: ${a.progress.overall.toFixed(1)}% (Defensas: ${a.progress.defenses.toFixed(1)}% • Héroes: ${a.progress.heroes.toFixed(1)}% • Lab: ${a.progress.laboratory.toFixed(1)}% • Muros: ${a.progress.walls.toFixed(1)}%)\n` +
          `• **Cuello de botella principal**: **${a.bottleneckCategory.name}** (${a.bottleneckCategory.pct.toFixed(1)}%) — ${a.bottleneckCategory.priorityHint}.\n` +
          `• **Mejoras activas (${a.activeUpgrades.length})**: ${a.activeUpgrades.map((u) => `${u.name} Nv.${u.targetLevel} (${u.status})`).join(', ') || 'Ninguna activa actualmente'}.`,
        recommendedPosts: [],
        calculatorResult: null,
        playerPreview: null,
        clanPreview: null,
        executedTasks,
        clientEffects,
        actions: Array.from(actionsMap.values()),
        mode: 'fallback'
      };
    }
  }

  const thMatch = String(message).match(/(?:th|ayuntamiento)\s*(\d{1,2})/i);
  const explicitTh = thMatch ? `TH${thMatch[1]}` : undefined;

  if (intents.wantsPasswordHelp) {
    if (userContext.isAuthenticated) {
      addAction('open_change_password');
      return {
        reply:
          `¡Claro, ${userContext.username}! Puedo ayudarte a cambiar tu contraseña ahora mismo de forma segura:\n\n` +
          `1. Toca el botón **"Cambiar contraseña ahora"** que aparece aquí abajo para abrir el formulario seguro sin salir del chat.\n` +
          `2. Ingresa tu **contraseña actual** y escribe tu **nueva contraseña** (mínimo 6 caracteres, diferente a la actual).\n` +
          `3. Presiona **"Actualizar contraseña"** y tu sesión se mantendrá activa automáticamente.`,
        recommendedPosts: [],
        calculatorResult: null,
        playerPreview: null,
        clanPreview: null,
        executedTasks,
        clientEffects,
        actions: Array.from(actionsMap.values()),
        mode: 'fallback'
      };
    } else {
      addAction('open_login');
      addAction('open_forgot_password');
      return {
        reply:
          `Con gusto te ayudo con tu contraseña:\n\n` +
          `• **Si recuerdas tu contraseña actual**: primero inicia sesión tocando **"Iniciar sesión en Más"** y luego podrás cambiarla desde aquí.\n` +
          `• **Si olvidaste tu contraseña**: toca **"Recuperar contraseña en Más"**, ingresa tu correo electrónico para recibir un código OTP y define tu nueva clave.`,
        recommendedPosts: [],
        calculatorResult: null,
        playerPreview: null,
        clanPreview: null,
        executedTasks,
        clientEffects,
        actions: Array.from(actionsMap.values()),
        mode: 'fallback'
      };
    }
  }

  if (intents.wantsCalculator) {
    const levelMatch = String(message).match(/nivel\s*(\d{1,2})|niv\.?\s*(\d{1,2})/i);
    const parsedLevel = levelMatch ? Number(levelMatch[1] || levelMatch[2]) : null;
    const calcExec = executeDamageCalculation(
      {
        building: message,
        level: parsedLevel
      },
      userContext
    );

    if (calcExec.ok && calcExec.result) {
      calculatorResult = calcExec.result;
      const best = calcResultBest(calcExec.result);
      executedTasks.push({
        id: `task_calc_${Date.now()}`,
        tool: 'calculate_damage_recipes',
        title: 'Simulación de daño ejecutada',
        detail: `${calcExec.result.target.spanishName} Nv.${calcExec.result.target.level}`,
        status: 'completed'
      });
      addAction('open_calculator', {
        building: calcExec.result.target.id,
        level: calcExec.result.target.level
      });

      return {
        reply:
          `Calculé la receta óptima para **${calcExec.result.target.spanishName} (Nivel ${calcExec.result.target.level} • ${calcExec.result.target.maxHp.toLocaleString('es-ES')} HP)**:\n\n` +
          (best
            ? `• **Combinación recomendada**: ${best.name}\n• **Detalle**: ${best.description}\n• **Espacio de hechizos**: ${best.spellHousingSpace} • **Daño total**: ${best.totalDamage.toLocaleString('es-ES')} (Overkill: +${best.overkill} HP)`
            : 'Revisa las combinaciones en la tarjeta inferior.'),
        recommendedPosts: [],
        calculatorResult,
        playerPreview,
        clanPreview,
        executedTasks,
        clientEffects,
        actions: Array.from(actionsMap.values()),
        mode: 'fallback'
      };
    }
  }

  if (intents.wantsArmy || intents.wantsLayout) {
    const postType =
      intents.wantsArmy && !intents.wantsLayout
        ? 'army_strategy'
        : intents.wantsLayout && !intents.wantsArmy
          ? 'base_layout'
          : undefined;
    const searchRes = await executeCommunitySearch(
      supabase,
      {
        post_type: postType,
        town_hall_level: explicitTh,
        limit: 3
      },
      userContext
    );

    recommendedPosts.push(...searchRes.posts);
    addAction('open_community');

    const thLabel =
      explicitTh ||
      (userContext.activeVillage?.town_hall_level
        ? `TH${userContext.activeVillage.town_hall_level}`
        : 'tu Ayuntamiento');

    const postListText =
      recommendedPosts.length > 0
        ? recommendedPosts
            .map(
              (p, i) =>
                `${i + 1}. **${p.title}** (${p.town_hall_level} • ${p.category} • ⭐ ${Number(p.average_rating || 0).toFixed(1)})`
            )
            .join('\n')
        : 'Aún no hay publicaciones específicas para ese filtro, pero puedes explorar o publicar en la pestaña Comunidad.';

    return {
      reply:
        `Aquí tienes recomendaciones tácticas de la pestaña **Comunidad** pensadas para **${thLabel}**:\n\n` +
        `${postListText}\n\n` +
        `Toca cualquiera de las tarjetas de abajo para **copiar el enlace directo en Clash of Clans** o **ver los detalles en Comunidad**.`,
      recommendedPosts,
      calculatorResult: null,
      playerPreview: null,
      clanPreview: null,
      executedTasks,
      clientEffects,
      actions: Array.from(actionsMap.values()),
      mode: 'fallback'
    };
  }

  if (userContext.isAuthenticated) {
    addAction('open_change_password');
  } else {
    addAction('open_login');
  }
  addAction('open_community');
  addAction('open_calculator');

  return {
    reply:
      `¡Hola! Soy el **Asistente Agéntico de ClashTactics**. Puedo analizar datos en tiempo real y ejecutar acciones por ti dentro de la app:\n\n` +
      `• **Cargar y analizar Jugadores o Clanes en vivo**: Dime *"Analiza al jugador #Y8J8RPVJU"* o *"Analiza el clan #2PP"*.\n` +
      `• **Auditar tu Aldea**: Pídeme *"Analiza el progreso de mi aldea y qué debo mejorar primero"*.\n` +
      `• **Ejecutar tareas en el sistema**: Pídeme *"Agrega #2PP a mis favoritos"*, *"Publica un ejército en Comunidad"*, *"Cambia al tema claro/oscuro"* o *"Quiero cambiar mi contraseña"*.\n` +
      `• **Recomendar Ejércitos y Calculadora de Daño**: Pregúntame por ejércitos de la Comunidad o cuántos rayos/terremotos destruyen cualquier defensa.`,
    recommendedPosts: [],
    calculatorResult: null,
    playerPreview: null,
    clanPreview: null,
    executedTasks,
    clientEffects,
    actions: Array.from(actionsMap.values()),
    mode: 'fallback'
  };
};

const calcResultBest = (res) => {
  if (!res) return null;
  return (
    res.bestRecipeForSelection ||
    (res.recipes && res.recipes.find((r) => r.isBestForSelectedAbilities)) ||
    (res.recipes && res.recipes[0]) ||
    null
  );
};

/**
 * Procesa un mensaje de chat utilizando Gemini Interactions API + Function Calling Agéntico
 */
export const processChatMessage = async ({
  message,
  history = [],
  activePlayerTag = null,
  user = null,
  supabase = null
}) => {
  const userContext = await loadUserTacticalContext({
    user,
    supabase,
    activePlayerTag
  });
  userContext.user = user;

  const client = getGeminiClient();
  if (!client) {
    return runFallbackChatAssistant({ message, userContext, supabase });
  }

  const recommendedPostsMap = new Map();
  let calculatorResult = null;
  let playerPreview = null;
  let clanPreview = null;
  const executedTasks = [];
  const clientEffects = {};
  const actionsMap = new Map();

  const addAction = (type, extra = {}) => {
    const obj = buildActionObject(type, extra);
    if (obj) actionsMap.set(`${type}:${extra.tag || ''}`, obj);
  };

  const sanitizedHistory = Array.isArray(history) ? history.slice(-10) : [];
  const interactionSteps = [];

  for (const turn of sanitizedHistory) {
    const textVal =
      typeof turn?.content === 'string'
        ? turn.content.trim()
        : typeof turn?.text === 'string'
          ? turn.text.trim()
          : '';
    if (!textVal) continue;
    if (turn.role === 'assistant') {
      interactionSteps.push({
        type: 'model_output',
        content: [{ type: 'text', text: textVal }]
      });
    } else if (turn.role === 'user') {
      interactionSteps.push({
        type: 'user_input',
        content: [{ type: 'text', text: textVal }]
      });
    }
  }

  interactionSteps.push({
    type: 'user_input',
    content: [{ type: 'text', text: String(message).trim() }]
  });

  const systemInstruction = buildSystemInstruction(userContext);

  const runInteractionCall = async (stepsInput, modelToUse = PRIMARY_CHAT_MODEL) => {
    try {
      return await client.interactions.create({
        model: modelToUse,
        store: false,
        system_instruction: systemInstruction,
        input: stepsInput,
        tools: CHAT_TOOLS,
        generation_config: {
          max_output_tokens: 1200
        }
      });
    } catch (firstErr) {
      if (modelToUse !== FALLBACK_CHAT_MODEL) {
        return await client.interactions.create({
          model: FALLBACK_CHAT_MODEL,
          store: false,
          system_instruction: systemInstruction,
          input: stepsInput,
          tools: CHAT_TOOLS,
          generation_config: {
            max_output_tokens: 1200
          }
        });
      }
      throw firstErr;
    }
  };

  try {
    let response = await runInteractionCall(interactionSteps);

    for (let round = 0; round < 4; round++) {
      const steps = Array.isArray(response?.steps) ? response.steps : [];
      const functionCalls = steps.filter((s) => s.type === 'function_call');

      if (functionCalls.length === 0) {
        break;
      }

      interactionSteps.push(...steps);

      for (const fc of functionCalls) {
        const args = fc.arguments || {};
        let toolOutput = {};

        if (fc.name === 'search_community_posts') {
          const searchData = await executeCommunitySearch(supabase, args, userContext);
          for (const p of searchData.posts) {
            recommendedPostsMap.set(String(p.id), p);
          }
          addAction('open_community');
          executedTasks.push({
            id: `task_search_${Date.now()}_${round}`,
            tool: 'search_community_posts',
            title: 'Búsqueda en Comunidad ejecutada',
            detail: `${searchData.posts.length} publicaciones encontradas`,
            status: 'completed'
          });

          toolOutput = {
            count: searchData.posts.length,
            match_type: searchData.matchNote,
            requested_town_hall: searchData.requestedTh,
            posts: searchData.posts.map((p) => ({
              id: p.id,
              post_type: p.post_type,
              title: p.title,
              town_hall_level: p.town_hall_level,
              category: p.category,
              description: p.description,
              average_rating: p.average_rating,
              ratings_count: p.ratings_count,
              author: p.author?.username || 'Estratega CoC',
              army_composition: p.army_composition || null,
              has_copy_link: Boolean(p.deep_link)
            }))
          };
        } else if (fc.name === 'calculate_damage_recipes') {
          const calcData = executeDamageCalculation(args, userContext);
          if (calcData.ok && calcData.result) {
            calculatorResult = calcData.result;
            addAction('open_calculator', {
              building: calcData.result.target.id,
              level: calcData.result.target.level
            });
            executedTasks.push({
              id: `task_calc_${Date.now()}_${round}`,
              tool: 'calculate_damage_recipes',
              title: 'Cálculo de daño completado',
              detail: `${calcData.result.target.spanishName} Nv.${calcData.result.target.level} (${calcData.result.target.maxHp} HP)`,
              status: 'completed'
            });
            const best = calcResultBest(calcData.result);
            toolOutput = {
              ok: true,
              target: calcData.result.target,
              userLevelsEvaluated: calcData.result.userLevelsEvaluated,
              bestRecipe: best,
              topAlternatives: (calcData.result.recipes || []).slice(0, 4).map((r) => ({
                name: r.name,
                description: r.description,
                spellHousingSpace: r.spellHousingSpace,
                totalDamage: r.totalDamage,
                overkill: r.overkill
              }))
            };
          } else {
            toolOutput = {
              ok: false,
              error: calcData.error
            };
          }
        } else if (fc.name === 'load_and_analyze_player') {
          const playerData = await executeLoadAndAnalyzePlayer(args, userContext);
          if (playerData.ok && playerData.preview) {
            playerPreview = playerData.preview;
            executedTasks.push({
              id: `task_player_${Date.now()}_${round}`,
              tool: 'load_and_analyze_player',
              title: 'Jugador cargado y analizado en vivo',
              detail: `${playerData.preview.name} (${playerData.preview.tag}) • TH${playerData.preview.townHallLevel}`,
              status: 'completed'
            });
            addAction('open_player', {
              tag: playerData.preview.tag,
              label: `Abrir perfil de ${playerData.preview.name} (${playerData.preview.tag})`
            });
          }
          toolOutput = playerData;
        } else if (fc.name === 'load_and_analyze_clan') {
          const clanData = await executeLoadAndAnalyzeClan(args, supabase, userContext);
          if (clanData.ok && clanData.preview) {
            clanPreview = clanData.preview;
            executedTasks.push({
              id: `task_clan_${Date.now()}_${round}`,
              tool: 'load_and_analyze_clan',
              title: 'Clan cargado y analizado en vivo',
              detail: `${clanData.preview.name} (${clanData.preview.tag}) • Nivel ${clanData.preview.clanLevel}`,
              status: 'completed'
            });
            addAction('open_clan', {
              tag: clanData.preview.tag,
              label: `Abrir clan ${clanData.preview.name} (${clanData.preview.tag})`
            });
          }
          toolOutput = clanData;
        } else if (fc.name === 'analyze_my_village_progress') {
          const auditData = executeAnalyzeMyVillageProgress(args, userContext);
          if (auditData.ok && auditData.audit) {
            executedTasks.push({
              id: `task_audit_${Date.now()}_${round}`,
              tool: 'analyze_my_village_progress',
              title: 'Auditoría de progreso ejecutada',
              detail: `${auditData.audit.player_name} • ${auditData.audit.progress.overall.toFixed(1)}% completado`,
              status: 'completed'
            });
          } else if (auditData.needsLogin) {
            addAction('open_login');
          } else if (auditData.needsClaim) {
            addAction('open_claim_player');
          } else if (auditData.needsJson) {
            addAction('open_paste_json');
          }
          toolOutput = auditData;
        } else if (fc.name === 'manage_favorite') {
          const favRes = await executeManageFavorite(args, supabase, userContext);
          if (favRes.ok) {
            executedTasks.push({
              id: `task_fav_${Date.now()}_${round}`,
              tool: 'manage_favorite',
              title: favRes.isFavorite ? 'Agregado a Favoritos' : 'Eliminado de Favoritos',
              detail: `${favRes.name} (${favRes.tag})`,
              status: 'completed'
            });
            clientEffects.favoriteUpdated = {
              type: favRes.type,
              tag: favRes.tag,
              name: favRes.name,
              isFavorite: favRes.isFavorite
            };
            if (favRes.type === 'player') {
              addAction('open_player', {
                tag: favRes.tag,
                label: `Ver jugador ${favRes.name}`
              });
            } else {
              addAction('open_clan', {
                tag: favRes.tag,
                label: `Ver clan ${favRes.name}`
              });
            }
          } else if (favRes.needsLogin) {
            addAction('open_login');
          }
          toolOutput = favRes;
        } else if (fc.name === 'publish_community_post') {
          const pubRes = await executePublishCommunityPost(args, supabase, userContext);
          if (pubRes.ok && pubRes.post) {
            recommendedPostsMap.set(String(pubRes.post.id), pubRes.post);
            executedTasks.push({
              id: `task_post_${Date.now()}_${round}`,
              tool: 'publish_community_post',
              title: 'Publicación creada en Comunidad',
              detail: `${pubRes.post.title} (${pubRes.post.town_hall_level} • ${pubRes.post.category})`,
              status: 'completed'
            });
            clientEffects.postCreated = pubRes.post;
            addAction('open_community');
          } else if (pubRes.needsLogin) {
            addAction('open_login');
          }
          toolOutput = pubRes;
        } else if (fc.name === 'update_my_profile') {
          const profRes = await executeUpdateMyProfile(args, supabase, userContext);
          if (profRes.ok && profRes.profile) {
            executedTasks.push({
              id: `task_prof_${Date.now()}_${round}`,
              tool: 'update_my_profile',
              title: 'Perfil actualizado en el sistema',
              detail: `@${profRes.profile.username} • Rol: ${String(profRes.profile.role || 'user').toUpperCase()}`,
              status: 'completed'
            });
            clientEffects.profileUpdated = profRes.profile;
          } else if (profRes.needsLogin) {
            addAction('open_login');
          }
          toolOutput = profRes;
        } else if (fc.name === 'set_app_theme') {
          const targetTheme = ['dark', 'light', 'toggle'].includes(args.theme)
            ? args.theme
            : 'toggle';
          clientEffects.themeMode = targetTheme;
          executedTasks.push({
            id: `task_theme_${Date.now()}_${round}`,
            tool: 'set_app_theme',
            title: 'Tema visual cambiado',
            detail:
              targetTheme === 'light'
                ? 'Modo Claro activado'
                : targetTheme === 'dark'
                  ? 'Modo Oscuro activado'
                  : 'Tema alternado',
            status: 'completed'
          });
          toolOutput = {
            ok: true,
            theme_applied: targetTheme
          };
        } else if (fc.name === 'list_game_defenses') {
          const allDefs = gameDataService.getAllDefenses();
          const filterText = args.search ? normalizeText(args.search) : '';
          const filtered = filterText
            ? allDefs.filter(
                (d) =>
                  normalizeText(d.spanishName).includes(filterText) ||
                  normalizeText(d.name).includes(filterText) ||
                  normalizeText(d.id).includes(filterText)
              )
            : allDefs;

          toolOutput = {
            total: filtered.length,
            defenses: filtered.slice(0, 20).map((d) => ({
              id: d.id,
              spanishName: d.spanishName,
              name: d.name,
              minLevel: d.minLevel,
              maxLevel: d.maxLevel
            }))
          };
        } else if (fc.name === 'request_account_action') {
          const requested = args.action;
          if (requested === 'open_change_password' && !userContext.isAuthenticated) {
            addAction('open_login');
            addAction('open_forgot_password');
            toolOutput = {
              ok: true,
              note: 'El usuario no ha iniciado sesión; se agregaron botones para iniciar sesión y recuperar contraseña.'
            };
          } else {
            addAction(requested);
            toolOutput = {
              ok: true,
              action_added: requested
            };
          }
        } else {
          toolOutput = { error: `Herramienta desconocida: ${fc.name}` };
        }

        interactionSteps.push({
          type: 'function_result',
          name: fc.name,
          call_id: fc.id,
          result: [{ type: 'text', text: JSON.stringify(toolOutput) }]
        });
      }

      response = await runInteractionCall(interactionSteps);
    }

    const intents = detectUserIntents(message);
    if (intents.wantsPasswordHelp) {
      if (userContext.isAuthenticated) {
        addAction('open_change_password');
      } else {
        addAction('open_login');
        addAction('open_forgot_password');
      }
    }

    const replyText =
      response?.output_text?.trim() ||
      extractTextFromSteps(response?.steps) ||
      '¡Listo! He ejecutado las acciones solicitadas. Revisa los resultados aquí abajo.';

    return {
      reply: replyText,
      recommendedPosts: Array.from(recommendedPostsMap.values()).slice(0, 4),
      calculatorResult,
      playerPreview,
      clanPreview,
      executedTasks,
      clientEffects,
      actions: Array.from(actionsMap.values()),
      mode: 'ai'
    };
  } catch (error) {
    console.error(`[ChatService Gemini Error]: ${error.message}`);
    return runFallbackChatAssistant({ message, userContext, supabase });
  }
};

/**
 * Extrae texto de los pasos model_output en caso de que output_text no venga poblado directamente
 */
const extractTextFromSteps = (steps = []) => {
  if (!Array.isArray(steps)) return '';
  const parts = [];
  for (const step of steps) {
    if (step?.type === 'model_output' && Array.isArray(step.content)) {
      for (const item of step.content) {
        if (item?.type === 'text' && item.text) {
          parts.push(item.text);
        }
      }
    }
  }
  return parts.join('\n').trim();
};

export default {
  processChatMessage,
  resolveDefenseTarget
};
