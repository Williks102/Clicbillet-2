import { RESEND_API_KEY, RESEND_FROM_EMAIL, ADMIN_NOTIFICATION_EMAIL } from "./config";

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
    const response = await fetch("https://api.resend.com/emails", {
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
      return false;
    }

    console.log(`[Email Service] ✉️ Email envoyé via Resend à ${to} ("${subject}")`);
    return true;
  } catch (err: any) {
    console.error(`[Email Service] Erreur réseau lors de l'envoi à ${to} :`, err.message || err);
    return false;
  }
}

export function emailLayout(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h1 style="color: #ea580c;">ClicBillet</h1>
      <h2 style="font-size: 18px;">${title}</h2>
      ${bodyHtml}
      <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">
        Cet email a été envoyé automatiquement par ClicBillet, ne pas répondre directement.
      </p>
    </div>
  `;
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
    <p>Bonjour ${name},</p>
    <p>Votre compte <strong>${roleLabel}</strong> a bien été créé sur ClicBillet, la plateforme de billetterie événementielle en Côte d'Ivoire.</p>
    <p>Vous pouvez dès à présent vous connecter et profiter de la plateforme.</p>
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
    <p>Bonjour ${name},</p>
    <p>Vous avez demandé à réinitialiser le mot de passe de votre compte ClicBillet. Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe :</p>
    <p><a href="${resetUrl}" style="display: inline-block; margin: 12px 0; padding: 12px 20px; background-color: #ea580c; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">Réinitialiser mon mot de passe</a></p>
    <p style="font-size: 12px; color: #6b7280;">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste inchangé.</p>
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
  const qrBlocks = order.tickets.map((t, i) => `
    <div style="margin-top: 18px; padding-top: 18px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 8px; font-weight: bold;">Billet ${i + 1}/${order.tickets.length} — ${t.tier === "vip" ? "VIP" : "Standard"}</p>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(t.qrCodeData)}" alt="QR Code billet ${i + 1}" width="220" height="220" />
    </div>
  `).join("");

  return emailLayout(order.tickets.length > 1 ? "Vos billets sont confirmés !" : "Votre billet est confirmé !", `
    <p>Bonjour ${order.buyerName},</p>
    <p>Merci pour votre achat. Voici les détails de votre commande :</p>
    <ul>
      <li><strong>Événement :</strong> ${order.eventTitle}</li>
      <li><strong>Date :</strong> ${order.eventDate} à ${order.eventTime}</li>
      <li><strong>Lieu :</strong> ${order.eventVenue}</li>
      <li><strong>Nombre de billets :</strong> ${order.tickets.length}</li>
    </ul>
    <p>Présentez le QR code correspondant à chaque billet à l'entrée (1 QR code = 1 personne) :</p>
    ${qrBlocks}
  `);
}

export async function sendTicketEmail(order: { buyerEmail: string; buyerName: string; eventTitle: string; eventDate: string; eventTime: string; eventVenue: string; tickets: { tier: string; qrCodeData: string }[] }): Promise<void> {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Vos billets pour ${order.eventTitle}`,
    html: buildTicketConfirmationHtml(order)
  });
}

// --- Acheteur : échec de paiement ---
export function buildPaymentFailedHtml(ticket: any): string {
  return emailLayout("Échec de votre paiement", `
    <p>Bonjour ${ticket.buyerName || ticket.buyer_name},</p>
    <p>Le paiement de votre commande pour l'événement <strong>${ticket.eventTitle || ticket.event_title}</strong> n'a pas pu être validé.</p>
    <p>Aucun montant n'a été débité de façon définitive. Vous pouvez retenter votre achat depuis la plateforme.</p>
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

// --- Organisateur : nouvelle vente ---
export function buildOrganizerSaleHtml(eventTitle: string, organizerName: string, ticket: any): string {
  return emailLayout("Nouvelle vente de billet !", `
    <p>Bonjour ${organizerName},</p>
    <p>Une nouvelle vente vient d'avoir lieu sur votre événement <strong>${eventTitle}</strong> :</p>
    <ul>
      <li><strong>Acheteur :</strong> ${ticket.buyerName || ticket.buyer_name}</li>
      <li><strong>Quantité :</strong> ${ticket.quantity}</li>
      <li><strong>Montant :</strong> ${ticket.pricePaid || ticket.price_paid} FCFA</li>
    </ul>
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
    <p>Bonjour ${organizerName},</p>
    <p>Votre événement <strong>${eventTitle}</strong> a été <strong>${statusLabel}</strong> par l'équipe de modération ClicBillet.</p>
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
  return emailLayout(`Votre demande de retrait est ${statusLabel}`, `
    <p>Bonjour ${organizerName},</p>
    <p>Votre demande de retrait de <strong>${payout.amount} FCFA</strong> (méthode : ${payout.method}) est désormais <strong>${statusLabel}</strong>.</p>
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
  return emailLayout("Nouvel organisateur inscrit", `
    <p>Un nouvel organisateur vient de s'inscrire sur ClicBillet :</p>
    <ul>
      <li><strong>Nom :</strong> ${user.name}</li>
      <li><strong>Email :</strong> ${user.email}</li>
    </ul>
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
  return emailLayout("Nouvelle demande de retrait", `
    <p>L'organisateur <strong>${organizerName}</strong> a soumis une nouvelle demande de retrait :</p>
    <ul>
      <li><strong>Montant :</strong> ${payout.amount} FCFA</li>
      <li><strong>Méthode :</strong> ${payout.method}</li>
    </ul>
    <p>Rendez-vous sur le tableau de bord admin pour la traiter.</p>
  `);
}

export async function sendAdminPayoutRequestEmail(organizerName: string, payout: any): Promise<void> {
  await sendEmail({
    to: ADMIN_NOTIFICATION_EMAIL,
    subject: `Nouvelle demande de retrait de ${organizerName}`,
    html: buildAdminPayoutRequestHtml(organizerName, payout)
  });
}

