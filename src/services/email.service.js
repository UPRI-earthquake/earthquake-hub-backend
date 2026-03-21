const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const DEFAULT_FROM = 'UPRI Earthquake Hub <no-reply@upri.edu.ph>';
const DEFAULT_BRAND_NAME = 'UPRI Earthquake Hub';
const DEFAULT_PRIMARY_COLOR = '#0ea5e9';
const DEFAULT_ACCENT_COLOR = '#10b981';
const DEFAULT_LOGO_CID = 'upri-earthquake-hub-logo';
const DEFAULT_FRONTEND_PUBLIC_DIR = path.resolve(
  __dirname,
  '../../../earthquake-hub-frontend/public',
);

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function formatCellValue(value) {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

let cachedLogoAsset;
let logoLookupLogged = false;
let logoSelectionLogged = false;

function dedupePaths(paths = []) {
  const seen = new Set();
  return paths.filter((entry) => {
    const normalized = normalizeText(entry);
    if (!normalized) return false;
    const key = path.normalize(normalized);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveLogoPath(rawPath) {
  const normalized = normalizeText(rawPath);
  if (!normalized) return null;
  return path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized);
}

function getFrontendPublicDirCandidates() {
  return dedupePaths([
    resolveLogoPath(process.env.EMAIL_FRONTEND_PUBLIC_DIR),
    DEFAULT_FRONTEND_PUBLIC_DIR,
    path.resolve(process.cwd(), 'earthquake-hub-frontend/public'),
    path.resolve(process.cwd(), '../earthquake-hub-frontend/public'),
    path.resolve(process.cwd(), '../../earthquake-hub-frontend/public'),
    path.resolve(process.cwd(), '../earthquake-hub-web-client/earthquake-hub-frontend/public'),
    path.resolve(process.cwd(), 'frontend/public'),
  ]);
}

function resolvePublicLogoCandidates(rawFileName) {
  const fileName = path.basename(normalizeText(rawFileName));
  if (!fileName) return [];
  return getFrontendPublicDirCandidates().map((publicDir) => path.resolve(publicDir, fileName));
}

function getLogoAsset() {
  if (typeof cachedLogoAsset !== 'undefined') return cachedLogoAsset;

  const logoUrl = normalizeText(process.env.EMAIL_LOGO_URL);
  if (logoUrl) {
    cachedLogoAsset = { type: 'url', url: logoUrl };
    return cachedLogoAsset;
  }

  const candidatePaths = dedupePaths([
    resolveLogoPath(process.env.EMAIL_LOGO_PATH),
    ...resolvePublicLogoCandidates(process.env.EMAIL_LOGO_PUBLIC_FILE),
    ...resolvePublicLogoCandidates('badge-92x92.png'),
    ...resolvePublicLogoCandidates('logo192.png'),
    ...resolvePublicLogoCandidates('logo512.png'),
  ]);

  const existingPath = candidatePaths.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_err) {
      return false;
    }
  });

  if (!existingPath) {
    if (!logoLookupLogged) {
      logoLookupLogged = true;
      console.warn(
        `[email] Branding logo not found. Set EMAIL_LOGO_URL or EMAIL_LOGO_PATH, or set EMAIL_FRONTEND_PUBLIC_DIR + EMAIL_LOGO_PUBLIC_FILE. Last tried: ${candidatePaths.slice(0, 4).join(', ') || 'n/a'}`,
      );
    }
    cachedLogoAsset = null;
    return cachedLogoAsset;
  }

  if (!logoSelectionLogged && process.env.NODE_ENV !== 'production') {
    logoSelectionLogged = true;
    console.log(`[email] Branding logo resolved from file: ${existingPath}`);
  }

  cachedLogoAsset = {
    type: 'cid',
    cid: DEFAULT_LOGO_CID,
    path: existingPath,
    filename: path.basename(existingPath),
  };
  return cachedLogoAsset;
}

function buildLogoMarkup({ showLogo, brandName }) {
  if (showLogo === false) {
    return { html: '', attachments: [] };
  }

  const logo = getLogoAsset();
  if (logo && logo.type === 'url') {
    return {
      html: `
        <img
          src="${escapeAttribute(logo.url)}"
          alt="${escapeAttribute(brandName)} logo"
          width="52"
          style="display:block;width:52px;height:52px;border:0;outline:none;text-decoration:none;background:#ffffff;border-radius:8px;padding:4px;"
        />
      `.trim(),
      attachments: [],
    };
  }

  if (logo && logo.type === 'cid') {
    return {
      html: `
        <img
          src="cid:${escapeAttribute(logo.cid)}"
          alt="${escapeAttribute(brandName)} logo"
          width="52"
          style="display:block;width:52px;height:52px;border:0;outline:none;text-decoration:none;background:#ffffff;border-radius:8px;padding:4px;"
        />
      `.trim(),
      attachments: [{
        filename: logo.filename,
        path: logo.path,
        cid: logo.cid,
      }],
    };
  }

  return {
    html: `
      <div style="padding:10px 12px;background:#ffffff;border-radius:8px;color:#111827;font-weight:700;font-size:13px;line-height:1;">
        UPRI
      </div>
    `.trim(),
    attachments: [],
  };
}

function renderDetailsTable(details) {
  const rows = toArray(details)
    .map((entry) => ({
      label: normalizeText(entry && entry.label),
      value: normalizeText(entry && entry.value),
    }))
    .filter((entry) => entry.label || entry.value);

  if (rows.length === 0) return '';

  const rowsHtml = rows.map((entry) => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-size:13px;font-weight:600;vertical-align:top;width:38%;">
        ${formatCellValue(entry.label || 'Detail')}
      </td>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;vertical-align:top;">
        ${formatCellValue(entry.value || 'n/a')}
      </td>
    </tr>
  `).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;margin:18px 0;">
      ${rowsHtml}
    </table>
  `;
}

function renderParagraphs(paragraphs) {
  const list = toArray(paragraphs)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  if (list.length === 0) return '';

  return list
    .map((entry) => `
      <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:22px;">
        ${formatCellValue(entry)}
      </p>
    `)
    .join('');
}

function renderBrandedLayout(layout = {}) {
  const brandName = normalizeText(layout.brandName) || DEFAULT_BRAND_NAME;
  const primaryColor = normalizeText(layout.primaryColor) || DEFAULT_PRIMARY_COLOR;
  const accentColor = normalizeText(layout.accentColor) || DEFAULT_ACCENT_COLOR;
  const preheader = normalizeText(layout.preheader) || `${brandName} notification`;
  const eyebrow = normalizeText(layout.eyebrow);
  const badge = normalizeText(layout.badge);
  const title = normalizeText(layout.title) || `${brandName} Notification`;
  const lead = normalizeText(layout.lead);
  const codeBlock = normalizeText(layout.codeBlock);
  const ctaLabel = normalizeText(layout.ctaLabel) || 'View details';
  const ctaUrl = normalizeText(layout.ctaUrl);
  const footer = normalizeText(layout.footer)
    || `This is an automated message from ${brandName}. Please do not reply to this email.`;

  const paragraphsHtml = renderParagraphs(layout.paragraphs);
  const detailsHtml = renderDetailsTable(layout.details);
  const codeBlockHtml = codeBlock
    ? `
      <pre style="margin:18px 0 0;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:12px;color:#111827;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;">${formatCellValue(codeBlock)}</pre>
    `
    : '';
  const ctaHtml = ctaUrl
    ? `
      <p style="margin:20px 0 0;">
        <a
          href="${escapeAttribute(ctaUrl)}"
          style="display:inline-block;background:linear-gradient(120deg, ${escapeAttribute(primaryColor)}, ${escapeAttribute(accentColor)});color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 16px;border-radius:8px;"
        >
          ${escapeHtml(ctaLabel)}
        </a>
      </p>
      <p style="margin:10px 0 0;color:#6b7280;font-size:12px;line-height:18px;word-break:break-all;">
        ${escapeHtml(ctaUrl)}
      </p>
    `
    : '';

  const { html: logoHtml, attachments } = buildLogoMarkup({
    showLogo: layout.showLogo,
    brandName,
  });

  const html = `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f8ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;line-height:1px;color:transparent;">
      ${escapeHtml(preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f8ff;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(120deg, ${escapeAttribute(primaryColor)}, ${escapeAttribute(accentColor)});padding:16px 22px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;width:68px;">${logoHtml}</td>
                    <td style="vertical-align:middle;text-align:right;color:#ffffff;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">
                      ${escapeHtml(brandName)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                ${eyebrow ? `<p style="margin:0 0 8px;color:#6b7280;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">${escapeHtml(eyebrow)}</p>` : ''}
                ${badge ? `<p style="margin:0 0 10px;"><span style="display:inline-block;background:#e0f2fe;color:#0b4f6c;border:1px solid #bae6fd;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(badge)}</span></p>` : ''}
                <h1 style="margin:0 0 12px;color:#111827;font-size:23px;line-height:30px;font-weight:700;">
                  ${escapeHtml(title)}
                </h1>
                ${lead ? `<p style="margin:0 0 14px;color:#1f2937;font-size:15px;line-height:23px;font-weight:600;">${formatCellValue(lead)}</p>` : ''}
                ${paragraphsHtml}
                ${detailsHtml}
                ${codeBlockHtml}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px;background:#fafafa;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#6b7280;font-size:12px;line-height:18px;">
                  ${escapeHtml(footer)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();

  return {
    html,
    attachments,
  };
}

function buildLayoutText(layout = {}) {
  const brandName = normalizeText(layout.brandName) || DEFAULT_BRAND_NAME;
  const lines = [brandName];
  const title = normalizeText(layout.title);
  const lead = normalizeText(layout.lead);
  const paragraphs = toArray(layout.paragraphs).map((entry) => normalizeText(entry)).filter(Boolean);
  const details = toArray(layout.details)
    .map((entry) => ({
      label: normalizeText(entry && entry.label),
      value: normalizeText(entry && entry.value),
    }))
    .filter((entry) => entry.label || entry.value);
  const codeBlock = normalizeText(layout.codeBlock);
  const ctaLabel = normalizeText(layout.ctaLabel) || 'Open link';
  const ctaUrl = normalizeText(layout.ctaUrl);
  const footer = normalizeText(layout.footer);

  if (title) lines.push('', title);
  if (lead) lines.push('', lead);
  if (paragraphs.length > 0) lines.push('', ...paragraphs);
  if (details.length > 0) {
    lines.push('', 'Details:');
    details.forEach((entry) => {
      lines.push(`- ${entry.label || 'Detail'}: ${entry.value || 'n/a'}`);
    });
  }
  if (codeBlock) lines.push('', codeBlock);
  if (ctaUrl) lines.push('', `${ctaLabel}: ${ctaUrl}`);
  if (footer) lines.push('', footer);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

let transporterPromise = null;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  const transport = process.env.EMAIL_TRANSPORT || 'smtp';
  if (transport !== 'smtp') {
    throw new Error(`Unsupported EMAIL_TRANSPORT "${transport}". Only "smtp" is supported right now.`);
  }

  const host = process.env.EMAIL_HOST || 'localhost';
  const port = Number(process.env.EMAIL_PORT || 1025);
  const secure = parseBoolean(process.env.EMAIL_SECURE, false);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  const auth = user || pass ? { user, pass } : undefined;

  transporterPromise = nodemailer.createTransport({
    host,
    port,
    secure,
    auth,
  });

  return transporterPromise;
}

/**
 * Send an email using the configured transport. Defaults are tuned for local
 * SMTP testing (e.g., MailHog/Mailpit).
 * @param {object} options - Nodemailer mail options
 */
async function sendMail(options = {}) {
  const transporter = await getTransporter();
  const { layout, ...baseOptions } = options;
  const mailOptions = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    ...baseOptions,
  };

  if (layout && typeof layout === 'object') {
    const renderedLayout = renderBrandedLayout(layout);
    if (!mailOptions.html) {
      mailOptions.html = renderedLayout.html;
    }
    if (!mailOptions.text) {
      mailOptions.text = buildLayoutText(layout);
    }
    if (renderedLayout.attachments.length > 0) {
      const existingAttachments = Array.isArray(mailOptions.attachments)
        ? mailOptions.attachments
        : mailOptions.attachments
          ? [mailOptions.attachments]
          : [];
      const hasLogoAttachment = existingAttachments.some(
        (attachment) => attachment && attachment.cid === DEFAULT_LOGO_CID,
      );
      mailOptions.attachments = hasLogoAttachment
        ? existingAttachments
        : existingAttachments.concat(renderedLayout.attachments);
    }
  }

  if (!mailOptions.to) {
    throw new Error('Email recipient (to) is required.');
  }

  const info = await transporter.sendMail(mailOptions);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[email] message sent to ${mailOptions.to} (id: ${info?.messageId || 'n/a'})`);
  }
  return info;
}

module.exports = {
  sendMail,
};
