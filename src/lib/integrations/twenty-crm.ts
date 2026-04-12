/**
 * Sync Lastest users to Twenty CRM as People records.
 * Fire-and-forget — never throws, never blocks auth flow.
 */
export async function syncUserToTwentyCRM(user: { name: string; email: string }): Promise<void> {
  const apiUrl = process.env.TWENTY_API_URL;
  const apiKey = process.env.TWENTY_API_KEY;
  const companyId = process.env.TWENTY_COMPANY_ID;

  if (!apiUrl || !apiKey || !companyId) return;

  try {
    const nameParts = (user.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const response = await fetch(`${apiUrl}/rest/people`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: { firstName, lastName },
        emails: { primaryEmail: user.email, additionalEmails: [] },
        companyId,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Twenty CRM] Failed to sync user ${user.email}: ${response.status} ${text}`);
    }
  } catch (error) {
    console.error(`[Twenty CRM] Error syncing user ${user.email}:`, error);
  }
}
