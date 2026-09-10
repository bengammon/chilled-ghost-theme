// Alerting is deliberately about staleness, not individual errors. One failed run at
// 3am is noise; three in a row, or a failure that cannot self-heal, is signal.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export async function sendEmail(subject, body, env = process.env) {
  const apiKey = env.BREVO_API_KEY;
  const to = env.ALERT_EMAIL_TO;
  const from = env.ALERT_EMAIL_FROM || to;
  if (!apiKey || !to) {
    console.warn('[notify] Brevo not configured; skipping email:', subject);
    return false;
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'Training pipeline' },
        to: [{ email: to }],
        subject,
        textContent: body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[notify] Brevo returned ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // A failed alert must never take the run down with it.
    console.error('[notify] could not send email:', err.message);
    return false;
  }
}

// The external dead-man's switch. If cron stops running, this script cannot email —
// it isn't running. healthchecks.io notices the missing ping instead, which is the
// entire class of failure internal monitoring is structurally blind to.
export async function pingHealthcheck(env = process.env) {
  const url = env.HEALTHCHECKS_URL;
  if (!url) return false;
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return true;
  } catch (err) {
    console.error('[notify] healthcheck ping failed:', err.message);
    return false;
  }
}
