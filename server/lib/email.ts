import crypto from "crypto";
import { RESEND_API_KEY, RESEND_FROM_EMAIL, ADMIN_NOTIFICATION_EMAIL, APP_ORIGIN, isSupabaseEnabled, supabase } from "./config.js";
import { getDB, saveDB } from "./db.js";
import { isQrUnlocked, getQrUnlockTime } from "./utils.js";

export const RESEND_API_BASE = "https://api.resend.com";

// Met un message de côté pour un réessai ultérieur (cf. supabase_setup.sql section 23, et la
// route de drainage /api/cron/drain-emails). Appelée quand l'envoi immédiat a échoué : le
// message n'est alors plus perdu, seulement retardé.
//
// Silencieuse en cas d'échec d'écriture : on est déjà dans un chemin de rattrapage, et faire
// remonter une erreur ici ferait échouer la route métier — précisément ce que le caractère
// « meilleur effort » des e-mails cherche à éviter.
export async function enqueueEmail(to: string, subject: string, html: string): Promise<void> {
  const id = `mail-${crypto.randomUUID()}`;
  try {
    if (isSupabaseEnabled && supabase) {
      const { error } = await supabase.from("email_outbox").insert({ id, recipient: to, subject, html });
      if (error) throw error;
      console.warn(`[Email Service] Envoi différé, message mis en file : "${subject}" -> ${to}`);
      return;
    }
    const db = getDB();
    db.emailOutbox = db.emailOutbox || [];
    db.emailOutbox.push({
      id, recipient: to, subject, html,
      status: "pending", attempts: 0, lastError: null,
      nextAttemptAt: new Date().toISOString(), createdAt: new Date().toISOString(), sentAt: null,
    });
    saveDB(db);
    console.warn(`[Email Service] Envoi différé (db.json), message mis en file : "${subject}" -> ${to}`);
  } catch (err: any) {
    console.error(`[Email Service] Message perdu — mise en file impossible pour ${to} :`, err?.message || err);
  }
}

// ==========================================
// SERVICE D'ENVOI D'EMAILS (Resend)
// ==========================================
// Best-effort partout : un échec d'envoi d'email ne doit jamais faire échouer
// la route métier qui l'a déclenché (achat de billet, inscription, etc.).
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!to) return false;

  if (!RESEND_API_KEY) {
    console.log(`[Email Mock Service] ✉️ (Resend non configuré) Sujet="${subject}" -> ${to}`);
    return false;
  }

  try {
    const response = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to,
        subject,
        html
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[Email Service] Échec d'envoi Resend (${response.status}) à ${to} :`, errorBody);
      // 429 (débit dépassé) comme 5xx : le message part en file plutôt qu'à la poubelle.
      await enqueueEmail(to, subject, html);
      return false;
    }

    console.log(`[Email Service] ✉️ Email envoyé via Resend à ${to} ("${subject}")`);
    return true;
  } catch (err: any) {
    console.error(`[Email Service] Erreur réseau lors de l'envoi à ${to} :`, err.message || err);
    await enqueueEmail(to, subject, html);
    return false;
  }
}

// ==========================================
// HELPERS DE FORMATAGE
// ==========================================

// Coalescence nulle (pas ||) : un montant de 0 (billet gratuit) est une valeur légitime,
// contrairement à undefined/null — sinon "0 FCFA" s'affichait "undefined FCFA".
export function formatXOF(amount: unknown): string {
  const n = Number(amount ?? 0);
  return `${Number.isFinite(n) ? n.toLocaleString("fr-FR") : "0"} FCFA`;
}

// "2026-06-21" -> "21 juin 2026". Repli sur la chaîne d'origine si le format est inattendu,
// plutôt que d'afficher "Invalid Date".
export function formatEventDateFr(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// ==========================================
// GABARIT COMMUN (bandeau de marque + carte + pied de page)
// ==========================================
// Tableaux HTML (pas de flexbox/grid) pour un rendu fiable sur les clients mail les plus
// stricts (Outlook desktop notamment). Couleurs de fond explicites sur le bandeau et la
// carte : Gmail ne réinterprète en mode sombre que les emails qui n'en définissent aucune.
export function emailLayout(title: string, bodyHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:32px 16px; font-family:Arial,Helvetica,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#ffffff; border-radius:14px; border:1px solid #e5e7eb;">
            <tr>
              <td style="background-color:#ea580c; padding:20px 28px; border-radius:14px 14px 0 0;">
                <span style="color:#ffffff; font-size:18px; font-weight:bold; letter-spacing:-0.01em;">ClicBillet</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 8px;">
                <h2 style="margin:0 0 18px; font-size:19px; color:#0f172a;">${title}</h2>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 26px; border-top:1px solid #f1f1f2;">
                <p style="margin:0; font-size:11.5px; color:#9ca3af; line-height:1.6;">
                  Cet email a été envoyé automatiquement par ClicBillet, ne pas répondre directement.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

// Carte tintée pour une liste de paires libellé/valeur (détails d'événement, de vente...).
// La dernière ligne peut être mise en avant (montant) via emphasizeLast.
export function infoCard(rows: { label: string; value: string }[], emphasizeLastRow = false): string {
  const rowsHtml = rows.map((r, i) => {
    const isLast = emphasizeLastRow && i === rows.length - 1;
    const borderTop = i > 0 ? "border-top:1px solid #fde3c8;" : "";
    return `
      <tr>
        <td style="padding:7px 0; ${borderTop} font-size:11px; font-weight:bold; letter-spacing:0.04em; text-transform:uppercase; color:#9a3412;">${r.label}</td>
        <td style="padding:7px 0; ${borderTop} font-size:${isLast ? "16px" : "13.5px"}; font-weight:${isLast ? "800" : "600"}; color:${isLast ? "#c2410c" : "#1c1917"}; text-align:right;">${r.value}</td>
      </tr>
    `;
  }).join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff7ed; border:1px solid #fed7aa; border-radius:12px; margin-bottom:20px;">
      <tr>
        <td style="padding:6px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
        </td>
      </tr>
    </table>
  `;
}

function ctaButton(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block; margin:4px 0 22px; padding:12px 22px; background-color:#ea580c; color:#ffffff; text-decoration:none; border-radius:9px; font-weight:bold; font-size:13.5px;">${label}</a>`;
}

export const ROLE_LABELS: Record<string, string> = {
  client: "Acheteur",
  organizer: "Organisateur",
  admin: "Administrateur"
};

// --- Bienvenue (inscription) ---
export function buildWelcomeEmailHtml(name: string, role: string): string {
  const roleLabel = ROLE_LABELS[role] || "Membre";
  return emailLayout("Bienvenue sur ClicBillet !", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${name},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Votre compte <strong>${roleLabel}</strong> a bien été créé sur ClicBillet, la plateforme de billetterie événementielle en Côte d'Ivoire.</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Vous pouvez dès à présent vous connecter et profiter de la plateforme.</p>
  `);
}

export async function sendWelcomeEmail(user: { email: string; name: string; role: string }): Promise<void> {
  await sendEmail({
    to: user.email,
    subject: "Bienvenue sur ClicBillet !",
    html: buildWelcomeEmailHtml(user.name, user.role)
  });
}

// --- Réinitialisation de mot de passe ---
export function buildPasswordResetHtml(name: string, resetUrl: string): string {
  return emailLayout("Réinitialisation de votre mot de passe", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${name},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Vous avez demandé à réinitialiser le mot de passe de votre compte ClicBillet. Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe :</p>
    <p>${ctaButton("Réinitialiser mon mot de passe", resetUrl)}</p>
    <p style="font-size:12px; color:#6b7280; margin:0;">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste inchangé.</p>
  `);
}

export async function sendPasswordResetEmail(user: { email: string; name: string; resetUrl: string }): Promise<void> {
  await sendEmail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe ClicBillet",
    html: buildPasswordResetHtml(user.name, user.resetUrl)
  });
}

// --- Acheteur : confirmation de billet(s) ---
// Une commande peut regrouper plusieurs billets (un QR code par billet, cf. /api/checkout) :
// on envoie UN SEUL email par commande listant tous les QR codes, plutôt qu'un email par billet.
export function buildTicketConfirmationHtml(order: { buyerName: string; eventTitle: string; eventDate: string; eventTime: string; eventVenue: string; tickets: { tier: string; qrCodeData: string }[] }): string {
  // Anti-fraude : le QR code réel n'est envoyé par email que s'il est déjà déverrouillé (achat
  // fait à moins de 4h de l'événement). Sinon, on renvoie l'acheteur vers son espace client, où
  // le QR code n'apparaîtra qu'à l'approche de l'événement (cf. GET /api/my-tickets).
  const unlocked = isQrUnlocked({ date: order.eventDate, time: order.eventTime });
  const unlockTimeLabel = unlocked ? null : getQrUnlockTime({ date: order.eventDate, time: order.eventTime })
    .toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  const qrBlocks = order.tickets.map((t, i) => {
    const isVip = t.tier === "vip";
    // t.tier est le nom du type de billet en minuscules (organisateur libre de le nommer,
    // cf. OrganizerDashboard.tsx) : on le met simplement en forme plutôt que de supposer
    // qu'il n'existe que "standard"/"vip".
    const tierLabel = isVip ? "VIP" : (t.tier || "standard").replace(/\b\w/g, (c) => c.toUpperCase());
    const pillBg = isVip ? "#fef3c7" : "#dbeafe";
    const pillColor = isVip ? "#92400e" : "#1e40af";
    const ticketLabel = `
      <p style="margin:0 0 14px; font-size:12.5px;">
        <span style="font-weight:bold; color:#6b7280;">Billet ${i + 1}/${order.tickets.length}</span>
        &nbsp;&nbsp;
        <span style="display:inline-block; font-size:10px; font-weight:bold; letter-spacing:0.04em; text-transform:uppercase; padding:3px 9px; border-radius:999px; background-color:${pillBg}; color:${pillColor};">${tierLabel}</span>
      </p>
    `;
    const body = unlocked
      ? `
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(t.qrCodeData)}" alt="QR Code billet ${i + 1}" width="220" height="220" style="border-radius:8px;" />
        <p style="margin:12px 0 0; font-size:11px; color:#9ca3af;">Valable une seule fois — présentez-le à l'entrée</p>
      `
      : `
        <div style="width:220px; height:220px; margin:0 auto; border-radius:8px; background-color:#f3f4f6; display:flex; align-items:center; justify-content:center;">
          <span style="font-size:34px;">&#128274;</span>
        </div>
        <p style="margin:12px 0 0; font-size:11.5px; color:#6b7280; font-weight:bold;">QR code disponible à partir du ${unlockTimeLabel}</p>
        <p style="margin:4px 0 0; font-size:11px; color:#9ca3af;">Consultez votre espace client "Mes Billets" ce jour-là pour l'afficher</p>
      `;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; margin-bottom:16px;">
        <tr>
          <td style="padding:18px; text-align:center;">
            ${ticketLabel}
            ${body}
          </td>
        </tr>
      </table>
    `;
  }).join("");

  const details = infoCard([
    { label: "Événement", value: order.eventTitle },
    { label: "Date", value: `${formatEventDateFr(order.eventDate)} à ${order.eventTime}` },
    { label: "Lieu", value: order.eventVenue },
    { label: "Billets", value: String(order.tickets.length) }
  ]);

  const intro = unlocked
    ? `<p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Présentez le QR code correspondant à chaque billet à l'entrée (1 QR code = 1 personne) :</p>`
    : `<p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Pour éviter toute fraude par capture d'écran, votre QR code ne sera visible que quelques heures avant l'événement, sur votre espace client :</p>`;

  const clientSpaceLink = unlocked ? "" : `
    <p style="text-align:center; margin:8px 0 20px;">
      <a href="${APP_ORIGIN}" style="display:inline-block; background-color:#ea580c; color:#ffffff; font-size:13px; font-weight:bold; padding:10px 22px; border-radius:8px; text-decoration:none;">Accéder à mon espace client</a>
    </p>
  `;

  return emailLayout(order.tickets.length > 1 ? "Vos billets sont confirmés !" : "Votre billet est confirmé !", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${order.buyerName},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Merci pour votre achat. Voici les détails de votre commande :</p>
    ${details}
    ${intro}
    ${qrBlocks}
    ${clientSpaceLink}
  `);
}

export async function sendTicketEmail(order: { buyerEmail: string; buyerName: string; eventTitle: string; eventDate: string; eventTime: string; eventVenue: string; tickets: { tier: string; qrCodeData: string }[] }): Promise<void> {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Vos billets pour ${order.eventTitle}`,
    html: buildTicketConfirmationHtml(order)
  });
}

// --- Destinataire d'un transfert de billet (cf. POST /api/tickets/:id/transfer) ---
// Même règle anti-fraude que la confirmation d'achat : le QR ne s'affiche que si l'événement
// est déjà à moins de 4h, sinon message + lien vers l'espace client.
export function buildTicketTransferredHtml(transfer: { recipientName: string; senderName: string; eventTitle: string; eventDate: string; eventTime: string; eventVenue: string; tier: string; qrCodeData: string }): string {
  const unlocked = isQrUnlocked({ date: transfer.eventDate, time: transfer.eventTime });
  const unlockTimeLabel = unlocked ? null : getQrUnlockTime({ date: transfer.eventDate, time: transfer.eventTime })
    .toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  const tierLabel = (transfer.tier || "standard").replace(/\b\w/g, (c) => c.toUpperCase());
  const details = infoCard([
    { label: "Événement", value: transfer.eventTitle },
    { label: "Date", value: `${formatEventDateFr(transfer.eventDate)} à ${transfer.eventTime}` },
    { label: "Lieu", value: transfer.eventVenue },
    { label: "Catégorie", value: tierLabel }
  ]);

  const qrSection = unlocked
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; margin-bottom:16px;">
        <tr>
          <td style="padding:18px; text-align:center;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(transfer.qrCodeData)}" alt="QR Code billet" width="220" height="220" style="border-radius:8px;" />
            <p style="margin:12px 0 0; font-size:11px; color:#9ca3af;">Valable une seule fois — présentez-le à l'entrée</p>
          </td>
        </tr>
      </table>
    `
    : `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; margin-bottom:16px;">
        <tr>
          <td style="padding:18px; text-align:center;">
            <div style="width:220px; height:220px; margin:0 auto; border-radius:8px; background-color:#f3f4f6; display:flex; align-items:center; justify-content:center;">
              <span style="font-size:34px;">&#128274;</span>
            </div>
            <p style="margin:12px 0 0; font-size:11.5px; color:#6b7280; font-weight:bold;">QR code disponible à partir du ${unlockTimeLabel}</p>
            <p style="margin:4px 0 0; font-size:11px; color:#9ca3af;">Consultez votre espace client "Mes Billets" ce jour-là pour l'afficher</p>
          </td>
        </tr>
      </table>
    `;

  const clientSpaceLink = unlocked ? "" : `
    <p style="text-align:center; margin:8px 0 20px;">
      <a href="${APP_ORIGIN}" style="display:inline-block; background-color:#ea580c; color:#ffffff; font-size:13px; font-weight:bold; padding:10px 22px; border-radius:8px; text-decoration:none;">Accéder à mon espace client</a>
    </p>
  `;

  return emailLayout("Un billet vient de vous être transféré !", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${transfer.recipientName},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;"><strong>${transfer.senderName}</strong> vous a transféré son billet pour l'événement suivant. Le billet qu'il avait reçu au départ est désormais invalide — seul celui-ci vous donne accès à l'entrée.</p>
    ${details}
    ${qrSection}
    ${clientSpaceLink}
  `);
}

export async function sendTicketTransferredEmail(transfer: { recipientEmail: string; recipientName: string; senderName: string; eventTitle: string; eventDate: string; eventTime: string; eventVenue: string; tier: string; qrCodeData: string }): Promise<void> {
  await sendEmail({
    to: transfer.recipientEmail,
    subject: `${transfer.senderName} vous a transféré un billet pour ${transfer.eventTitle}`,
    html: buildTicketTransferredHtml(transfer)
  });
}

// --- Expéditeur d'un transfert de billet : simple accusé de réception ---
export function buildTicketTransferConfirmationHtml(transfer: { senderName: string; recipientEmail: string; eventTitle: string }): string {
  return emailLayout("Votre billet a été transféré", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${transfer.senderName},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Votre billet pour <strong>${transfer.eventTitle}</strong> a bien été transféré à <strong>${transfer.recipientEmail}</strong>.</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Ce billet n'apparaît plus dans votre espace client et ne vous donnera plus accès à l'entrée. Si vous n'êtes pas à l'origine de cette action, contactez-nous immédiatement.</p>
  `);
}

export async function sendTicketTransferConfirmationEmail(transfer: { senderEmail: string; senderName: string; recipientEmail: string; eventTitle: string }): Promise<void> {
  await sendEmail({
    to: transfer.senderEmail,
    subject: `Votre billet pour ${transfer.eventTitle} a été transféré`,
    html: buildTicketTransferConfirmationHtml(transfer)
  });
}

// --- Acheteur : échec de paiement ---
export function buildPaymentFailedHtml(ticket: any): string {
  return emailLayout("Échec de votre paiement", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${ticket.buyerName || ticket.buyer_name},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Le paiement de votre commande pour l'événement <strong>${ticket.eventTitle || ticket.event_title}</strong> n'a pas pu être validé.</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Aucun montant n'a été débité de façon définitive. Vous pouvez retenter votre achat depuis la plateforme.</p>
  `);
}

export async function sendPaymentFailedEmail(ticket: any): Promise<void> {
  const to = ticket.buyerEmail || ticket.buyer_email;
  await sendEmail({
    to,
    subject: `Échec du paiement pour ${ticket.eventTitle || ticket.event_title}`,
    html: buildPaymentFailedHtml(ticket)
  });
}

// --- Acheteur : réservation expirée faute de paiement dans les temps ---
export function buildReservationExpiredHtml(ticket: any): string {
  return emailLayout("Votre réservation a expiré", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${ticket.buyerName || ticket.buyer_name},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Votre réservation pour l'événement <strong>${ticket.eventTitle || ticket.event_title}</strong> a expiré car le paiement n'a pas été finalisé dans le délai imparti.</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Aucun montant n'a été débité. Les places ont été remises en vente ; vous pouvez retenter votre achat depuis la plateforme si des billets sont encore disponibles.</p>
  `);
}

export async function sendReservationExpiredEmail(ticket: any): Promise<void> {
  const to = ticket.buyerEmail || ticket.buyer_email;
  await sendEmail({
    to,
    subject: `Votre réservation pour ${ticket.eventTitle || ticket.event_title} a expiré`,
    html: buildReservationExpiredHtml(ticket)
  });
}

// --- Organisateur : nouvelle vente ---
export function buildOrganizerSaleHtml(eventTitle: string, organizerName: string, ticket: any): string {
  const details = infoCard([
    { label: "Acheteur", value: ticket.buyerName || ticket.buyer_name },
    { label: "Quantité", value: `${ticket.quantity} billet${Number(ticket.quantity) > 1 ? "s" : ""}` },
    { label: "Montant", value: formatXOF(ticket.pricePaid ?? ticket.price_paid) }
  ], true);

  return emailLayout("Nouvelle vente de billet !", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${organizerName},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Une nouvelle vente vient d'avoir lieu sur votre événement <strong>${eventTitle}</strong> :</p>
    ${details}
  `);
}

export async function sendOrganizerSaleEmail(organizerEmail: string, organizerName: string, eventTitle: string, ticket: any): Promise<void> {
  if (!organizerEmail) return;
  await sendEmail({
    to: organizerEmail,
    subject: `Nouvelle vente pour ${eventTitle}`,
    html: buildOrganizerSaleHtml(eventTitle, organizerName, ticket)
  });
}

// --- Organisateur : statut de l'événement ---
export function buildOrganizerEventStatusHtml(eventTitle: string, organizerName: string, status: string): string {
  const statusLabel = status === "approved" ? "approuvé" : "rejeté";
  return emailLayout(`Votre événement a été ${statusLabel}`, `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${organizerName},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Votre événement <strong>${eventTitle}</strong> a été <strong>${statusLabel}</strong> par l'équipe de modération ClicBillet.</p>
  `);
}

export async function sendOrganizerEventStatusEmail(organizerEmail: string, organizerName: string, eventTitle: string, status: string): Promise<void> {
  if (!organizerEmail) return;
  const statusLabel = status === "approved" ? "approuvé" : "rejeté";
  await sendEmail({
    to: organizerEmail,
    subject: `Votre événement "${eventTitle}" a été ${statusLabel}`,
    html: buildOrganizerEventStatusHtml(eventTitle, organizerName, status)
  });
}

// --- Organisateur : statut de retrait (payout) ---
export function buildOrganizerPayoutStatusHtml(organizerName: string, payout: any): string {
  const statusLabels: Record<string, string> = { completed: "complété", rejected: "rejeté", pending: "en attente" };
  const statusLabel = statusLabels[payout.status] || payout.status;
  const details = infoCard([
    { label: "Méthode", value: payout.method },
    { label: "Montant", value: formatXOF(payout.amount) }
  ], true);
  return emailLayout(`Votre demande de retrait est ${statusLabel}`, `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Bonjour ${organizerName}, votre demande de retrait est désormais <strong>${statusLabel}</strong> :</p>
    ${details}
  `);
}

export async function sendOrganizerPayoutStatusEmail(organizerEmail: string, organizerName: string, payout: any): Promise<void> {
  if (!organizerEmail) return;
  await sendEmail({
    to: organizerEmail,
    subject: `Statut de votre demande de retrait : ${payout.status}`,
    html: buildOrganizerPayoutStatusHtml(organizerName, payout)
  });
}

// --- Admin : nouvelle inscription organisateur ---
export function buildAdminNewOrganizerHtml(user: { name: string; email: string }): string {
  const details = infoCard([
    { label: "Nom", value: user.name },
    { label: "Email", value: user.email }
  ]);
  return emailLayout("Nouvel organisateur inscrit", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Un nouvel organisateur vient de s'inscrire sur ClicBillet :</p>
    ${details}
  `);
}

export async function sendAdminNewOrganizerEmail(user: { name: string; email: string }): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: "Nouvel organisateur inscrit sur ClicBillet",
    html: buildAdminNewOrganizerHtml(user)
  });
}

// --- Admin : nouvelle demande de retrait ---
export function buildAdminPayoutRequestHtml(organizerName: string, payout: any): string {
  const details = infoCard([
    { label: "Méthode", value: payout.method },
    { label: "Montant", value: formatXOF(payout.amount) }
  ], true);
  return emailLayout("Nouvelle demande de retrait", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">L'organisateur <strong>${organizerName}</strong> a soumis une nouvelle demande de retrait :</p>
    ${details}
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Rendez-vous sur le tableau de bord admin pour la traiter.</p>
  `);
}

export async function sendAdminPayoutRequestEmail(organizerName: string, payout: any): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `Nouvelle demande de retrait de ${organizerName}`,
    html: buildAdminPayoutRequestHtml(organizerName, payout)
  });
}

// --- Admin : message reçu via le formulaire de contact public ---
// Contrairement aux autres emails de ce fichier (données d'utilisateurs authentifiés,
// réutilisées dans LEURS PROPRES emails), ce formulaire est accessible sans authentification :
// chaque champ doit être échappé avant injection dans le HTML de l'email, sans quoi un
// visiteur pourrait y injecter du HTML/JS arbitraire visible par l'administrateur.
function escapeHtmlForEmail(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildAdminContactMessageHtml(payload: { name: string; email: string; subject: string; message: string }): string {
  const details = infoCard([
    { label: "Nom", value: escapeHtmlForEmail(payload.name) },
    { label: "Email", value: escapeHtmlForEmail(payload.email) },
    { label: "Sujet", value: escapeHtmlForEmail(payload.subject) }
  ]);
  return emailLayout("Nouveau message de contact", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Un visiteur a soumis le formulaire de contact du site :</p>
    ${details}
    <p style="font-size:13px; font-weight:bold; color:#9a3412; margin:20px 0 6px; text-transform:uppercase; letter-spacing:0.04em;">Message</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0; white-space:pre-wrap;">${escapeHtmlForEmail(payload.message)}</p>
  `);
}

export async function sendAdminContactMessageEmail(payload: { name: string; email: string; subject: string; message: string }): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `[Contact] ${payload.subject} — ${payload.name}`,
    html: buildAdminContactMessageHtml(payload)
  });
}

// --- Admin : demande de passage acheteur -> organisateur ---
// Contenu saisi librement par le demandeur (nom de structure, motivation) : échappé avant
// injection dans le HTML, comme le formulaire de contact ci-dessus.
export interface OrganizerRequestPayload {
  userName: string;
  userEmail: string;
  publicCode?: string | null;
  organizationName: string;
  phone: string;
  motivation?: string | null;
}

export function buildAdminOrganizerRequestHtml(request: OrganizerRequestPayload): string {
  const rows = [
    { label: "Demandeur", value: escapeHtmlForEmail(request.userName) },
    { label: "Email", value: escapeHtmlForEmail(request.userEmail) },
    { label: "Code client", value: escapeHtmlForEmail(request.publicCode || "—") },
    { label: "Structure", value: escapeHtmlForEmail(request.organizationName) },
    { label: "Téléphone", value: escapeHtmlForEmail(request.phone) }
  ];

  const motivationBlock = request.motivation
    ? `
      <p style="font-size:13px; font-weight:bold; color:#9a3412; margin:20px 0 6px; text-transform:uppercase; letter-spacing:0.04em;">Activité décrite</p>
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px; white-space:pre-wrap;">${escapeHtmlForEmail(request.motivation)}</p>
    `
    : "";

  return emailLayout("Demande pour devenir organisateur", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Un acheteur demande à passer en compte organisateur :</p>
    ${infoCard(rows)}
    ${motivationBlock}
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Approuvez ou refusez la demande depuis l'onglet <strong>Demandes organisateur</strong> du tableau de bord admin.</p>
  `);
}

export async function sendAdminOrganizerRequestEmail(request: OrganizerRequestPayload): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `Demande organisateur — ${request.organizationName}`,
    html: buildAdminOrganizerRequestHtml(request)
  });
}

// --- Demandeur : décision sur sa demande d'accès organisateur ---
export function buildOrganizerRequestDecisionHtml(name: string, status: string, reviewNote?: string | null): string {
  const approved = status === "approved";
  const noteBlock = reviewNote
    ? `<p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px; white-space:pre-wrap;"><strong>Message de l'équipe :</strong><br/>${escapeHtmlForEmail(reviewNote)}</p>`
    : "";

  const body = approved
    ? `
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonne nouvelle : votre compte ClicBillet est désormais un <strong>compte organisateur</strong>.</p>
      ${noteBlock}
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Vous gardez le même identifiant de connexion et l'historique de vos achats. Reconnectez-vous pour accéder à votre tableau de bord et créer votre premier événement.</p>
      <p style="font-size:12px; color:#6b7280; margin:0;">Pensez à activer la double authentification depuis votre profil : elle protège un compte qui encaisse désormais des paiements.</p>
    `
    : `
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Votre demande de passage en compte organisateur n'a pas été retenue pour le moment.</p>
      ${noteBlock}
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Votre compte acheteur reste pleinement actif, et vous pouvez soumettre une nouvelle demande plus tard.</p>
    `;

  return emailLayout(approved ? "Votre compte organisateur est activé" : "Suite à votre demande d'accès organisateur", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${escapeHtmlForEmail(name)},</p>
    ${body}
  `);
}

export async function sendOrganizerRequestDecisionEmail(user: { email: string; name: string }, status: string, reviewNote?: string | null): Promise<void> {
  if (!user.email) return;
  await sendEmail({
    to: user.email,
    subject: status === "approved"
      ? "Votre compte organisateur ClicBillet est activé"
      : "Suite à votre demande d'accès organisateur ClicBillet",
    html: buildOrganizerRequestDecisionHtml(user.name, status, reviewNote)
  });
}

// ==========================================
// MARCHÉ DE PRESTATAIRES — mêmes gabarits que ci-dessus (demande, décision), plus la
// notification de nouvelle demande de devis reçue sur une fiche.
// ==========================================

// --- Admin : demande de fiche prestataire ---
export interface VendorRequestPayload {
  userName: string;
  userEmail: string;
  publicCode?: string | null;
  businessName: string;
  phone: string;
  city: string;
  categoryLabels: string[];
  description?: string | null;
}

export function buildAdminVendorRequestHtml(request: VendorRequestPayload): string {
  const rows = [
    { label: "Demandeur", value: escapeHtmlForEmail(request.userName) },
    { label: "Email", value: escapeHtmlForEmail(request.userEmail) },
    { label: "Code client", value: escapeHtmlForEmail(request.publicCode || "—") },
    { label: "Structure", value: escapeHtmlForEmail(request.businessName) },
    { label: "Téléphone", value: escapeHtmlForEmail(request.phone) },
    { label: "Ville", value: escapeHtmlForEmail(request.city) },
    { label: "Catégories", value: escapeHtmlForEmail(request.categoryLabels.join(", ")) }
  ];

  const descriptionBlock = request.description
    ? `
      <p style="font-size:13px; font-weight:bold; color:#9a3412; margin:20px 0 6px; text-transform:uppercase; letter-spacing:0.04em;">Activité décrite</p>
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px; white-space:pre-wrap;">${escapeHtmlForEmail(request.description)}</p>
    `
    : "";

  return emailLayout("Demande de fiche prestataire", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Un compte demande à publier une fiche prestataire :</p>
    ${infoCard(rows)}
    ${descriptionBlock}
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Approuvez ou refusez la demande depuis l'onglet <strong>Prestataires</strong> du tableau de bord admin.</p>
  `);
}

export async function sendAdminVendorRequestEmail(request: VendorRequestPayload): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `Demande prestataire — ${request.businessName}`,
    html: buildAdminVendorRequestHtml(request)
  });
}

// --- Demandeur : décision sur sa demande de fiche prestataire ---
export function buildVendorRequestDecisionHtml(name: string, status: string, reviewNote?: string | null): string {
  const approved = status === "approved";
  const noteBlock = reviewNote
    ? `<p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px; white-space:pre-wrap;"><strong>Message de l'équipe :</strong><br/>${escapeHtmlForEmail(reviewNote)}</p>`
    : "";

  const body = approved
    ? `
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonne nouvelle : votre fiche <strong>prestataire</strong> est désormais publiée sur ClicBillet.</p>
      ${noteBlock}
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Reconnectez-vous pour compléter votre fiche (photo de couverture, portfolio) depuis votre espace prestataire.</p>
    `
    : `
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Votre demande de fiche prestataire n'a pas été retenue pour le moment.</p>
      ${noteBlock}
      <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Vous pouvez soumettre une nouvelle demande plus tard.</p>
    `;

  return emailLayout(approved ? "Votre fiche prestataire est publiée" : "Suite à votre demande de fiche prestataire", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${escapeHtmlForEmail(name)},</p>
    ${body}
  `);
}

export async function sendVendorRequestDecisionEmail(user: { email: string; name: string }, status: string, reviewNote?: string | null): Promise<void> {
  if (!user.email) return;
  await sendEmail({
    to: user.email,
    subject: status === "approved"
      ? "Votre fiche prestataire ClicBillet est publiée"
      : "Suite à votre demande de fiche prestataire ClicBillet",
    html: buildVendorRequestDecisionHtml(user.name, status, reviewNote)
  });
}

// --- Prestataire : nouvelle demande de devis reçue sur sa fiche ---
export interface VendorLeadPayload {
  vendorName: string;
  vendorEmail: string;
  senderName: string;
  senderEmail: string;
  senderPhone?: string | null;
  eventDate?: string | null;
  message: string;
}

export function buildVendorLeadHtml(lead: VendorLeadPayload): string {
  const rows = [
    { label: "Nom", value: escapeHtmlForEmail(lead.senderName) },
    { label: "Email", value: escapeHtmlForEmail(lead.senderEmail) },
    { label: "Téléphone", value: escapeHtmlForEmail(lead.senderPhone || "—") },
    { label: "Date de l'événement", value: escapeHtmlForEmail(lead.eventDate || "—") }
  ];

  return emailLayout("Nouvelle demande de devis", `
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 14px;">Bonjour ${escapeHtmlForEmail(lead.vendorName)},</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px;">Vous avez reçu une nouvelle demande de devis depuis votre fiche ClicBillet :</p>
    ${infoCard(rows)}
    <p style="font-size:13px; font-weight:bold; color:#9a3412; margin:20px 0 6px; text-transform:uppercase; letter-spacing:0.04em;">Message</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0 0 20px; white-space:pre-wrap;">${escapeHtmlForEmail(lead.message)}</p>
    <p style="font-size:14px; line-height:1.6; color:#374151; margin:0;">Répondez directement à ${escapeHtmlForEmail(lead.senderEmail)} pour donner suite. Cette demande reste aussi consultable depuis votre espace prestataire.</p>
  `);
}

export async function sendVendorLeadEmail(lead: VendorLeadPayload): Promise<void> {
  if (!lead.vendorEmail) return;
  await sendEmail({
    to: lead.vendorEmail,
    subject: `Nouvelle demande de devis — ${lead.senderName}`,
    html: buildVendorLeadHtml(lead)
  });
}
