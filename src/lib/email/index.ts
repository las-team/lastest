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
}

export async function sendEmail({ to, subject, html, text }: SendEmailOptions) {
  if (!resend) {
    console.log('[Email] No RESEND_API_KEY configured, skipping email');
    console.log(`[Email] Would send to: ${to}`);
    console.log(`[Email] Subject: ${subject}`);
    return { success: true, messageId: 'dev-mode' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text,
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

export async function sendPasswordResetEmail(to: string, token: string) {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Reset Your Password</h2>
      <p>You requested to reset your password. Click the link below to set a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">
        This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
      <p style="color: #999; font-size: 12px; margin-top: 32px;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${resetUrl}">${resetUrl}</a>
      </p>
    </div>
  `;

  const text = `
Reset Your Password

You requested to reset your password. Visit the link below to set a new password:

${resetUrl}

This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
  `;

  return sendEmail({
    to,
    subject: 'Reset Your Password',
    html,
    text,
  });
}

export async function sendInvitationEmail(to: string, token: string, inviterName?: string) {
  const inviteUrl = `${APP_URL}/invite?token=${token}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You're Invited!</h2>
      <p>${inviterName ? `${inviterName} has invited you` : 'You have been invited'} to join LASTEST2 - Visual Regression Testing Platform.</p>
      <p style="margin: 24px 0;">
        <a href="${inviteUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Accept Invitation
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">
        This invitation will expire in 7 days.
      </p>
      <p style="color: #999; font-size: 12px; margin-top: 32px;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${inviteUrl}">${inviteUrl}</a>
      </p>
    </div>
  `;

  const text = `
You're Invited!

${inviterName ? `${inviterName} has invited you` : 'You have been invited'} to join LASTEST2 - Visual Regression Testing Platform.

Accept your invitation here: ${inviteUrl}

This invitation will expire in 7 days.
  `;

  return sendEmail({
    to,
    subject: 'You\'re Invited to LASTEST2',
    html,
    text,
  });
}
