import { supabaseAdmin, supabaseClient } from '../config/supabase.js';
import { supercellApi } from './supercell.service.js';
import { createAndSendNotification, getUserNotifications } from './notification.service.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // Cada 5 minutos
const notifiedUpgradeKeys = new Set();

let workerTimer = null;
const workerState = {
  active: false,
  isRunningCycle: false,
  intervalSeconds: DEFAULT_INTERVAL_MS / 1000,
  startedAt: null,
  lastRunAt: null,
  nextRunAt: null,
  runsCount: 0,
  villagesScanned: 0,
  upgradesEvaluated: 0,
  notificationsDispatched: 0,
  goldPassSeason: null,
  recentLogs: []
};

const addWorkerLog = (message, level = 'info') => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  workerState.recentLogs = [entry, ...workerState.recentLogs].slice(0, 15);
};

/**
 * Formatea segundos en texto legible (ej. "2h 15m" o "Completado")
 */
const formatRemainingTime = (seconds) => {
  if (seconds <= 0) return 'Completada';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
};

/**
 * Ejecuta un ciclo de sincronización y verificación de mejoras en segundo plano
 */
export const runBackgroundSyncNow = async ({
  triggeredByUserId = null,
  forceUserSummary = false
} = {}) => {
  if (workerState.isRunningCycle) {
    return getBackgroundWorkerStatus();
  }

  workerState.isRunningCycle = true;
  const startedCycleAt = Date.now();
  let cycleVillages = 0;
  let cycleUpgrades = 0;
  let cycleNotifications = 0;
  const userSummaryAlerts = [];

  try {
    const db = supabaseAdmin || supabaseClient;

    // 1. Consultar estado actual del Pase de Oro (Gold Pass)
    try {
      const gpRes = await supercellApi.get('/goldpass/seasons/current');
      if (gpRes?.data) {
        workerState.goldPassSeason = {
          startTime: gpRes.data.startTime,
          endTime: gpRes.data.endTime
        };
      }
    } catch {
      // No crítico si la API de Supercell no responde en este ciclo
    }

    // 2. Escanear aldeas claimeadas con datos de tracker
    let query = db
      .from('claimed_players')
      .select('id, user_id, player_tag, player_name, town_hall_level, village_data, last_imported_at')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (triggeredByUserId) {
      query = query.eq('user_id', triggeredByUserId);
    }

    const { data: claimedRows, error } = await query;
    if (error) throw error;

    const rows = claimedRows || [];
    cycleVillages = rows.length;
    const persistedKeysByUser = new Map();

    const hasAlreadyNotified = async (userId, dedupeKey) => {
      if (notifiedUpgradeKeys.has(dedupeKey)) return true;

      let userKeys = persistedKeysByUser.get(userId);
      if (!userKeys) {
        userKeys = new Set();
        try {
          const inbox = await getUserNotifications(userId);
          for (const notif of inbox.notifications || []) {
            if (Array.isArray(notif?.data?.dedupe_keys)) {
              for (const k of notif.data.dedupe_keys) {
                if (typeof k === 'string') userKeys.add(k);
              }
            }
          }
        } catch {
          // Si falla lectura, seguimos con el Set en memoria
        }
        persistedKeysByUser.set(userId, userKeys);
      }

      if (userKeys.has(dedupeKey)) {
        notifiedUpgradeKeys.add(dedupeKey);
        return true;
      }
      return false;
    };

    for (const row of rows) {
      if (!row.user_id) continue;
      const vd = row.village_data;
      if (!vd || !Array.isArray(vd.activeUpgrades)) continue;

      const importedAtMs = row.last_imported_at
        ? new Date(row.last_imported_at).getTime()
        : Date.now();
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - importedAtMs) / 1000));

      const completedNow = [];
      const finishingSoon = [];

      for (const upg of vd.activeUpgrades) {
        cycleUpgrades++;
        const rawTimer = Number(upg.timerSeconds || upg.timer || 0);
        if (rawTimer <= 0) continue;

        const remainingSeconds = Math.max(0, rawTimer - elapsedSeconds);
        const itemName = upg.spanishName || upg.name || 'Estructura';
        const targetLvl = upg.targetLevel || (Number(upg.level || 1) + 1);
        const dedupeKey = `${row.user_id}:${row.player_tag}:${itemName}:${targetLvl}:${row.last_imported_at || ''}`;

        if (remainingSeconds === 0) {
          completedNow.push({
            name: itemName,
            targetLevel: targetLvl,
            dedupeKey
          });
        } else if (remainingSeconds <= 3600) {
          finishingSoon.push({
            name: itemName,
            targetLevel: targetLvl,
            remainingSeconds,
            dedupeKey: `${dedupeKey}:soon`
          });
        }
      }

      // Enviar notificación por mejoras completadas
      const freshCompleted = [];
      for (const item of completedNow) {
        if (!(await hasAlreadyNotified(row.user_id, item.dedupeKey))) {
          freshCompleted.push(item);
        }
      }
      if (freshCompleted.length > 0) {
        freshCompleted.forEach((c) => notifiedUpgradeKeys.add(c.dedupeKey));
        const namesList = freshCompleted
          .slice(0, 3)
          .map((c) => `${c.name} (Nv. ${c.targetLevel})`)
          .join(', ');

        await createAndSendNotification({
          userId: row.user_id,
          title: `🔨 ¡Mejora completada en ${row.player_name}!`,
          body: `Constructor libre en ${row.player_tag}: ${namesList} ya terminó de mejorar.`,
          type: 'builder_completed',
          data: {
            player_tag: row.player_tag,
            player_name: row.player_name,
            completed_count: freshCompleted.length,
            dedupe_keys: freshCompleted.map((c) => c.dedupeKey)
          }
        });
        cycleNotifications++;
      }

      // Enviar notificación por mejoras a punto de terminar (< 1 hora)
      const freshSoon = [];
      for (const item of finishingSoon) {
        if (!(await hasAlreadyNotified(row.user_id, item.dedupeKey))) {
          freshSoon.push(item);
        }
      }
      if (freshSoon.length > 0) {
        freshSoon.forEach((s) => notifiedUpgradeKeys.add(s.dedupeKey));
        const firstSoon = freshSoon[0];

        await createAndSendNotification({
          userId: row.user_id,
          title: `⏳ Mejora por finalizar en ${row.player_name}`,
          body: `${firstSoon.name} (Nv. ${firstSoon.targetLevel}) terminará en ${formatRemainingTime(firstSoon.remainingSeconds)}.`,
          type: 'builder_soon',
          data: {
            player_tag: row.player_tag,
            player_name: row.player_name,
            dedupe_keys: freshSoon.map((s) => s.dedupeKey)
          }
        });
        cycleNotifications++;
      }

      if (triggeredByUserId && row.user_id === triggeredByUserId) {
        const activeStillRunning = vd.activeUpgrades.filter((u) => {
          const rem = Math.max(0, Number(u.timerSeconds || u.timer || 0) - elapsedSeconds);
          return rem > 0;
        });

        userSummaryAlerts.push({
          player_tag: row.player_tag,
          player_name: row.player_name,
          town_hall_level: row.town_hall_level || vd.townHallLevel || 16,
          overall_percentage: vd.progress?.overall_percentage ?? vd.completionPercentage ?? 0,
          active_upgrades_running: activeStillRunning.length,
          completed_since_import: completedNow.length,
          next_completion:
            activeStillRunning.length > 0
              ? {
                  name: activeStillRunning[0].spanishName || activeStillRunning[0].name,
                  remaining: formatRemainingTime(
                    Math.max(
                      0,
                      Number(activeStillRunning[0].timerSeconds || activeStillRunning[0].timer || 0) -
                        elapsedSeconds
                    )
                  )
                }
              : null
        });
      }
    }

    // Si el usuario ejecutó manualmente la sincronización en segundo plano y quiere confirmación
    if (triggeredByUserId && forceUserSummary && cycleNotifications === 0) {
      if (userSummaryAlerts.length > 0) {
        const first = userSummaryAlerts[0];
        const nextText = first.next_completion
          ? `Próxima mejora en terminar: ${first.next_completion.name} en ${first.next_completion.remaining}.`
          : `Progreso general al ${Number(first.overall_percentage).toFixed(1)}%.`;

        await createAndSendNotification({
          userId: triggeredByUserId,
          title: `🔄 Sincronización de ${first.player_name} (${first.player_tag})`,
          body: `Se verificaron ${first.active_upgrades_running} mejoras activas y ${first.completed_since_import} completadas. ${nextText}`,
          type: 'background_sync',
          data: {
            player_tag: first.player_tag,
            summary: first
          }
        });
        cycleNotifications++;
      } else {
        await createAndSendNotification({
          userId: triggeredByUserId,
          title: '🔄 Sincronización en Segundo Plano Completada',
          body: 'El worker verificó tu cuenta correctamente. Claimea e importa el JSON de tu aldea en Inicio para monitorear tus constructores automáticamente.',
          type: 'background_sync',
          data: {}
        });
        cycleNotifications++;
      }
    }

    workerState.runsCount += 1;
    workerState.lastRunAt = new Date().toISOString();
    workerState.nextRunAt = new Date(Date.now() + workerState.intervalSeconds * 1000).toISOString();
    workerState.villagesScanned += cycleVillages;
    workerState.upgradesEvaluated += cycleUpgrades;
    workerState.notificationsDispatched += cycleNotifications;

    addWorkerLog(
      `Ciclo #${workerState.runsCount} completado en ${Date.now() - startedCycleAt}ms (${cycleVillages} aldeas, ${cycleUpgrades} mejoras, ${cycleNotifications} alertas).`
    );
  } catch (err) {
    addWorkerLog(`Error en ciclo de segundo plano: ${err.message}`, 'error');
    console.warn('[BackgroundWorker] Error durante sincronización:', err.message);
  } finally {
    workerState.isRunningCycle = false;
  }

  return {
    ...getBackgroundWorkerStatus(),
    cycleSummary: {
      villagesScanned: cycleVillages,
      upgradesEvaluated: cycleUpgrades,
      notificationsDispatched: cycleNotifications,
      userVillages: userSummaryAlerts
    }
  };
};

/**
 * Inicia el proceso periódico en segundo plano del servidor
 */
export const startBackgroundWorker = (intervalMs = DEFAULT_INTERVAL_MS) => {
  if (workerTimer) {
    clearInterval(workerTimer);
  }

  workerState.active = true;
  workerState.intervalSeconds = Math.round(intervalMs / 1000);
  workerState.startedAt = new Date().toISOString();
  workerState.nextRunAt = new Date(Date.now() + intervalMs).toISOString();

  addWorkerLog(`Worker en segundo plano iniciado (intervalo: ${workerState.intervalSeconds}s).`);

  // Ejecutar primer ciclo tras 8 segundos para no retrasar el arranque del servidor
  setTimeout(() => {
    runBackgroundSyncNow().catch(() => {});
  }, 8000);

  workerTimer = setInterval(() => {
    runBackgroundSyncNow().catch(() => {});
  }, intervalMs);

  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref();
  }

  return getBackgroundWorkerStatus();
};

/**
 * Devuelve el estado y métricas actuales del worker en segundo plano
 */
export const getBackgroundWorkerStatus = () => ({
  active: workerState.active,
  isRunningCycle: workerState.isRunningCycle,
  intervalSeconds: workerState.intervalSeconds,
  startedAt: workerState.startedAt,
  lastRunAt: workerState.lastRunAt,
  nextRunAt: workerState.nextRunAt,
  runsCount: workerState.runsCount,
  villagesScanned: workerState.villagesScanned,
  upgradesEvaluated: workerState.upgradesEvaluated,
  notificationsDispatched: workerState.notificationsDispatched,
  goldPassSeason: workerState.goldPassSeason,
  recentLogs: workerState.recentLogs
});

export default {
  startBackgroundWorker,
  runBackgroundSyncNow,
  getBackgroundWorkerStatus
};
