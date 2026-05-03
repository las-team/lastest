import { Resend } from 'resend';

// Only instantiate Resend if API key is available
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@example.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  unsubscribeUrl?: string;
  unsubscribePostUrl?: string;
}

export async function sendEmail({ to, subject, html, text, unsubscribeUrl, unsubscribePostUrl }: SendEmailOptions) {
  if (!resend) {
    console.log('[Email] No RESEND_API_KEY configured, skipping email');
    console.log(`[Email] Would send to: ${to}`);
    console.log(`[Email] Subject: ${subject}`);
    return { success: true, messageId: 'dev-mode' };
  }

  try {
    // RFC 8058 one-click expects the POST endpoint to be the URL the mail
    // client hits. List the POST URL first; the GET landing page is a
    // fallback so users can still click an "Unsubscribe" link.
    const listUnsubscribeUrls = [unsubscribePostUrl, unsubscribeUrl]
      .filter((u): u is string => Boolean(u))
      .map((u) => `<${u}>`)
      .join(', ');

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text,
      headers: listUnsubscribeUrls
        ? {
            'List-Unsubscribe': listUnsubscribeUrls,
            ...(unsubscribePostUrl ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
          }
        : undefined,
    });

    if (error) {
      console.error('[Email] Send error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error('[Email] Exception:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

function emailShell(content: string, unsubscribeUrl?: string) {
  const unsubFooter = unsubscribeUrl
    ? `<br/><a href="${unsubscribeUrl}" style="color:#0891b2;text-decoration:underline;">Unsubscribe from these emails</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f1a;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <!-- Logo -->
  <tr><td align="center" style="padding-bottom:32px;">
    <a href="${APP_URL}" style="text-decoration:none;">
      <img src="${APP_URL}/icon.png" width="56" height="56" alt="Lastest" style="display:block;border-radius:14px;border:0;" />
    </a>
  </td></tr>
  <!-- Card -->
  <tr><td style="background-color:#1a1a2e;border-radius:16px;border:1px solid rgba(255,255,255,0.06);">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:40px 36px;">
        ${content}
      </td></tr>
    </table>
  </td></tr>
  <!-- Footer -->
  <tr><td align="center" style="padding-top:28px;">
    <p style="margin:0;font-size:12px;line-height:18px;color:#4a4a6a;">
      Lastest &mdash; Visual Regression Testing Platform<br/>
      <a href="${APP_URL}" style="color:#0891b2;text-decoration:none;">${APP_URL.replace('https://', '')}</a>${unsubFooter}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendPasswordResetEmail(to: string, token: string) {
  // Transactional: no List-Unsubscribe — that header is reserved for marketing
  // mail per RFC 8058, and a click here would revoke marketing consent for an
  // email the user didn't perceive as marketing.
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  const html = emailShell(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Reset your password</h1>
        <p style="margin:0 0 28px;font-size:15px;line-height:24px;color:#8888a8;">
          We received a request to reset the password for your account. Click the button below to choose a new one.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
          <tr><td align="center" style="background-color:#0891b2;border-radius:10px;">
            <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
              Reset Password
            </a>
          </td></tr>
        </table>
        <p style="margin:0 0 20px;font-size:13px;line-height:20px;color:#5a5a7a;">
          This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;">
            <p style="margin:0;font-size:12px;line-height:18px;color:#4a4a6a;word-break:break-all;">
              If the button doesn't work, paste this URL into your browser:<br/>
              <a href="${resetUrl}" style="color:#0891b2;text-decoration:none;">${resetUrl}</a>
            </p>
          </td></tr>
        </table>
  `);

  const text = `Reset your password

We received a request to reset the password for your account.

Reset here: ${resetUrl}

This link expires in 1 hour. If you didn't request this, you can safely ignore this email.

— Lastest`;

  return sendEmail({
    to,
    subject: 'Reset your password — Lastest',
    html,
    text,
  });
}

export async function sendInvitationEmail(to: string, token: string, inviterName?: string) {
  // Transactional: no List-Unsubscribe (see sendPasswordResetEmail).
  const inviteUrl = `${APP_URL}/invite?token=${token}`;
  const inviter = inviterName || 'Your team';

  const html = emailShell(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">You're invited</h1>
        <p style="margin:0 0 28px;font-size:15px;line-height:24px;color:#8888a8;">
          <strong style="color:#c8c8e0;">${inviter}</strong> has invited you to collaborate on
          <strong style="color:#c8c8e0;">Lastest</strong> &mdash; catch visual regressions before your users do.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
          <tr><td align="center" style="background-color:#0891b2;border-radius:10px;">
            <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
              Accept Invitation
            </a>
          </td></tr>
        </table>
        <p style="margin:0 0 20px;font-size:13px;line-height:20px;color:#5a5a7a;">
          This invitation expires in 7 days.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;">
            <p style="margin:0;font-size:12px;line-height:18px;color:#4a4a6a;word-break:break-all;">
              If the button doesn't work, paste this URL into your browser:<br/>
              <a href="${inviteUrl}" style="color:#0891b2;text-decoration:none;">${inviteUrl}</a>
            </p>
          </td></tr>
        </table>
  `);

  const text = `You're invited!

${inviter} has invited you to collaborate on Lastest — Visual Regression Testing Platform.

Accept your invitation: ${inviteUrl}

This invitation expires in 7 days.

— Lastest`;

  return sendEmail({
    to,
    subject: `${inviter} invited you to Lastest`,
    html,
    text,
  });
}
