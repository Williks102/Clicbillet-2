// Génère un document imprimable/téléchargeable en PDF via un iframe sandboxé et
// window.print() — même technique déjà utilisée pour le pass de billet (ClientDashboard),
// réutilisée ici pour les factures/reçus. Pas de dépendance PDF côté serveur : le navigateur
// s'en charge nativement ("Enregistrer en PDF" dans la boîte de dialogue d'impression).
//
// Important : print()/le nettoyage de l'iframe sont déclenchés depuis CE fichier (bundlé,
// donc couvert par script-src 'self'), jamais via un <script> inline écrit dans le document
// généré — la CSP de production (server.ts, scriptSrc sans 'unsafe-inline' hors dev) bloque
// silencieusement tout <script> inline, ce qui rendait le bouton "Télécharger PDF" inopérant.
// Les styles, eux, peuvent rester inline (style-src autorise 'unsafe-inline' en prod comme en dev).
const DEFAULT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; padding: 32px; margin: 0; background: #fff; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 4px; font-size: 12px; }
  th { color: #9ca3af; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; border-bottom: 2px solid #f3f4f6; }
  td { border-bottom: 1px solid #f3f4f6; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #ea580c; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 20px; font-weight: 900; color: #111827; }
  .brand span { color: #ea580c; }
  .muted { color: #9ca3af; }
  .right { text-align: right; }
  .totals { margin-top: 16px; margin-left: auto; width: 260px; }
  .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; }
  .totals-row.grand { border-top: 2px solid #111827; font-weight: 800; font-size: 14px; padding-top: 10px; margin-top: 6px; }
  .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #9ca3af; border-top: 1px solid #f3f4f6; padding-top: 12px; }
`;

export function printHtmlDocument(title: string, bodyHtml: string, styles: string = DEFAULT_STYLES) {
  const printFrame = document.createElement("iframe");
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";
  document.body.appendChild(printFrame);

  const printDocument = printFrame.contentWindow?.document || printFrame.contentDocument;
  if (!printDocument) return;

  printFrame.onload = () => {
    const frameWindow = printFrame.contentWindow;
    if (!frameWindow) return;
    frameWindow.focus();
    frameWindow.print();
    setTimeout(() => {
      printFrame.remove();
    }, 1000);
  };

  printDocument.open();
  printDocument.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>${styles}</style>
      </head>
      <body>
        ${bodyHtml}
      </body>
    </html>
  `);
  printDocument.close();
}
