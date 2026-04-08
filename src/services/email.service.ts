import https from 'https';
import { EMAIL_FROM, MJ_APIKEY_PUBLIC, MJ_APIKEY_PRIVATE } from '../config/env.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@email.service');

const isMailjetConfigured = !!(MJ_APIKEY_PUBLIC && MJ_APIKEY_PRIVATE);

export async function sendOtpEmail(to: string, otp: string, name?: string): Promise<void> {
    if (!isMailjetConfigured) {
        logger.warn(`[DEV] Email OTP skipped (Mailjet not configured). OTP for ${to}: ${otp}`);
        return;
    }

    const displayName = name || 'there';
    const subject = 'Your Extract Bill & Pay OTP';

    const html = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f5f6f7; padding: 32px 0;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08); border: 1px solid rgba(0,0,0,0.06);">
        <div style="background: linear-gradient(135deg, #4647d3, #8126cf); padding: 28px 28px 20px 28px;">
          <div style="font-size: 20px; color: #ffffff; font-weight: 700; letter-spacing: -0.3px;">Extract Bill & Pay</div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px;">Secure one-time login code</div>
        </div>

        <div style="padding: 28px 28px 20px 28px; color: #2c2f30;">
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #595c5d;">Hi ${displayName},</p>
          <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #595c5d;">
            Use the following one-time passcode to sign in to your account:
          </p>

          <div style="margin: 0 0 24px 0; padding: 20px 16px; border-radius: 12px; background: #f5f6f7; border: 1px solid rgba(70,71,211,0.15); text-align: center;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #757778; margin-bottom: 8px;">Your OTP code</div>
            <div style="font-size: 36px; letter-spacing: 0.5em; color: #4647d3; font-weight: 700;">${otp}</div>
            <div style="margin-top: 10px; font-size: 12px; color: #757778;">Expires in 5 minutes. Do not share it with anyone.</div>
          </div>

          <p style="margin: 0; font-size: 13px; color: #757778;">
            If you did not request this code, you can safely ignore this email.
          </p>
        </div>

        <div style="padding: 16px 28px 20px 28px; border-top: 1px solid #f0f1f2;">
          <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.5;">
            This is an automated message from Extract Bill & Pay. Please do not reply to this email.
          </p>
        </div>
      </div>
    </div>
  `;

    const rawFrom = EMAIL_FROM || 'no-reply@extractbillpay.com';
    let fromEmail = rawFrom;
    let fromName: string | undefined;

    const match = rawFrom.match(/^(.*)<([^>]+)>$/);
    if (match) {
        fromName = match[1].trim().replace(/"/g, '');
        fromEmail = match[2].trim();
    }

    const payload = JSON.stringify({
        Messages: [
            {
                From: { Email: fromEmail, Name: fromName },
                To: [{ Email: to, Name: displayName }],
                Subject: subject,
                TextPart: `Your Extract Bill & Pay OTP is ${otp}. It expires in 5 minutes.`,
                HTMLPart: html,
            },
        ],
    });

    const authHeader = Buffer.from(`${MJ_APIKEY_PUBLIC}:${MJ_APIKEY_PRIVATE}`, 'utf8').toString('base64');

    await new Promise<void>((resolve, reject) => {
        const req = https.request(
            {
                hostname: 'api.mailjet.com',
                port: 443,
                path: '/v3.1/send',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${authHeader}`,
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk as Buffer));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        logger.error(`Mailjet send failed (${res.statusCode}): ${body}`);
                        reject(new Error('Mailjet send failed'));
                    }
                });
            },
        );
        req.on('error', (err) => {
            logger.error('Mailjet request error', err as Error);
            reject(err);
        });
        req.write(payload);
        req.end();
    });
}
