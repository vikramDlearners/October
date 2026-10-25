import { candidateDays, nearbyPlaces } from './sources.js';
import { decide } from './decide.js';
import { listWatches, updateWatch } from './store.js';

export const telegramEnabled = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export async function runCheck(watch) {
  const { days, horizon } = await candidateDays(watch);
  const places = await nearbyPlaces(watch).catch((err) => {
    console.warn(`places lookup failed for ${watch.place.name}: ${err.message}`);
    return [];
  });
  const decision = await decide(watch, days, places);
  const lastCheck = { at: new Date().toISOString(), horizon, days, places, ...decision };

  // Notify once per GO date, so a twice-daily schedule doesn't repeat the same alert.
  let notifiedFor = watch.notifiedFor;
  if (decision.verdict === 'GO' && decision.plan.date !== notifiedFor && telegramEnabled()) {
    try {
      await sendTelegram(formatAlert(watch, decision));
      notifiedFor = decision.plan.date;
    } catch (err) {
      // Keep the check and leave notifiedFor alone, so the next check retries the alert.
      lastCheck.alertError = err.message;
    }
  }
  return updateWatch(watch.id, { lastCheck, notifiedFor });
}

export async function checkAll() {
  for (const watch of await listWatches()) {
    try {
      const { lastCheck } = await runCheck(watch);
      console.log(`${watch.place.name}: ${lastCheck.verdict} (${lastCheck.decidedBy}) ${lastCheck.reason}`);
    } catch (err) {
      console.error(`${watch.place.name}: check failed: ${err.message}`);
    }
  }
}

function formatAlert(watch, { reason, plan }) {
  const stops = plan.stops.map((s) => `• ${s.time ? `${s.time} ` : ''}${s.name}${s.costInr ? ` (₹${s.costInr})` : ''}`);
  return [
    `🦥 GO to ${watch.place.name} on ${plan.date}`,
    reason,
    '',
    plan.summary,
    `🚌 ${plan.gettingThere}`,
    ...stops,
    plan.totalInr ? `\nTotal ≈ ₹${plan.totalInr}` : '',
    plan.packing?.length ? `\n🎒 Carry: ${plan.packing.map((p) => p.item).join(', ')}` : '',
  ].join('\n');
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
  });
  if (!res.ok) throw new Error(`Telegram responded ${res.status}: ${await res.text()}`);
}
