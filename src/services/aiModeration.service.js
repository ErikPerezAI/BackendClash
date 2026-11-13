import { GoogleGenAI, Type } from '@google/genai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Modelo ultrarrápido y económico de última generación (gemini-3.5-flash-lite o gemini-flash-lite-latest)
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const SYSTEM_PROMPT = `Sos el moderador automatizado de ClashTactics, una comunidad de Clash of Clans.
Tu tarea es clasificar si el contenido es seguro para publicar.

Reglas:
1. PERMITIDO: Discusiones sobre Clash of Clans, estrategias, aldeas, críticas constructivas, competitividad y jerga bélica del juego (ej: "vamos a reventar esa base", "ataque perfecto", "manco", "ladrón de oscuro").
2. RECHAZADO: Acoso directo, insultos graves dirigidos a personas reales, odio/discriminación, compra/venta de cuentas/gemas (scam), links sospechosos o contenido sexual/NSFW (en texto o imagen adjunta).

Respondé ÚNICAMENTE un objeto JSON válido sin bloques markdown ni texto extra con esta estructura exacta:
{"ok": true, "reason": ""}
O si se rechaza:
{"ok": false, "reason": "<motivo breve de máximo 5 palabras>"}`;

/**
 * Cliente Google GenAI (inicializado con GEMINI_API_KEY si está disponible)
 */
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Descarga una imagen desde una URL pública o extrae un Data URI y la convierte a base64
 * @param {string} imageUrl
 * @returns {Promise<{ mimeType: string, data: string } | null>}
 */
const fetchImageAsBase64 = async (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== 'string') return null;

  const dataUriMatch = imageUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1].toLowerCase();
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    return {
      mimeType: allowedTypes.includes(mimeType) ? mimeType : 'image/jpeg',
      data: dataUriMatch[2]
    };
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 3000,
      maxContentLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClashTactics-ModerationBot/1.0)'
      }
    });

    const rawType = response.headers['content-type'] || 'image/jpeg';
    const mimeType = rawType.split(';')[0].trim().toLowerCase();
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const validMimeType = allowedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    const data = Buffer.from(response.data).toString('base64');
    return { mimeType: validMimeType, data };
  } catch (error) {
    console.warn(`[AI Moderation] No se pudo descargar la imagen (${imageUrl}): ${error.message}`);
    return null;
  }
};

/**
 * Filtro de respaldo local ultra rápido para desarrollo o pruebas sin clave
 */
const runFallbackLocalModeration = ({ text = '', imageUrl = '' }) => {
  const normalized = (text || '').toLowerCase();
  
  const basicBannedWords = [
    'mierda', 'idiota', 'estupido', 'estúpido', 'hdp', 'puto', 'puta', 
    'imbecil', 'imbécil', 'inútil', 'basura de jugador', 'pendejo', 'malparido'
  ];

  const foundWord = basicBannedWords.find(word => normalized.includes(word));
  const isTestNsfw = normalized.includes('[test_nsfw]') || (imageUrl && imageUrl.includes('nsfw-test'));
  const isTestProfanity = normalized.includes('[test_profanity]') || Boolean(foundWord);

  if (isTestNsfw || isTestProfanity) {
    return {
      ok: false,
      reason: isTestNsfw ? 'Contenido sexual o NSFW' : `Insultos o agresiones (${foundWord || 'infracción'})`
    };
  }

  return {
    ok: true,
    reason: ''
  };
};

/**
 * Modera una publicación del foro (título, descripción, autor e imagen opcional)
 * 
 * @param {Object} postData
 * @param {string} [postData.author] - Nombre de usuario o ID del autor
 * @param {string} postData.title - Título del post
 * @param {string} [postData.description] - Cuerpo o descripción del post
 * @param {string} [postData.category] - Categoría
 * @param {string} [postData.imageUrl] - URL de la imagen del diseño
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export const moderatePost = async ({ author = 'Usuario', title = '', description = '', category = '', imageUrl = null }) => {
  const client = getGeminiClient();

  if (!client) {
    return runFallbackLocalModeration({
      text: `${title} ${description}`,
      imageUrl
    });
  }

  try {
    const imageData = await fetchImageAsBase64(imageUrl);

    // Formato de payload limpio y conciso según la guía técnica
    const userPrompt = `Autor: ${author}\nTítulo: ${title}\nCuerpo: ${description}`;

    const contents = [
      { text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }
    ];

    if (imageData) {
      contents.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.data
        }
      });
    }

    const config = {
      temperature: 0,
      maxOutputTokens: 60,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ok: { type: Type.BOOLEAN },
          reason: { type: Type.STRING }
        },
        required: ['ok', 'reason']
      }
    };

    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents,
      config
    });

    const parsedResult = JSON.parse(response.text.trim());
    return {
      ok: Boolean(parsedResult.ok),
      reason: parsedResult.reason || ''
    };
  } catch (error) {
    console.error(`[AI Moderation Error]: ${error.message}`);
    return runFallbackLocalModeration({
      text: `${title} ${description}`,
      imageUrl
    });
  }
};

/**
 * Modera comentarios individuales del foro de forma ultrarrápida
 * 
 * @param {Object} params
 * @param {string} [params.author] - Autor del comentario
 * @param {string} params.content - Texto del comentario
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export const moderateComment = async ({ author = 'Usuario', content = '' }) => {
  const client = getGeminiClient();

  if (!client) {
    return runFallbackLocalModeration({ text: content });
  }

  try {
    const userPrompt = `Autor: ${author}\nCuerpo: ${content}`;

    const config = {
      temperature: 0,
      maxOutputTokens: 60,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ok: { type: Type.BOOLEAN },
          reason: { type: Type.STRING }
        },
        required: ['ok', 'reason']
      }
    };

    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }],
      config
    });

    const parsedResult = JSON.parse(response.text.trim());
    return {
      ok: Boolean(parsedResult.ok),
      reason: parsedResult.reason || ''
    };
  } catch (error) {
    console.error(`[AI Moderation Comment Error]: ${error.message}`);
    return runFallbackLocalModeration({ text: content });
  }
};

export default {
  moderatePost,
  moderateComment
};
