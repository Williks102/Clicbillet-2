const fetch = globalThis.fetch || require('node-fetch');
const url = 'http://127.0.0.1:3002';
(async () => {
  try {
    const callbackPayload = { referenceNumber: 'tkt-simulated-1', status: 'success' };
    const callbackRes = await fetch(`${url}/api/payment/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PaiementPro-Signature': 'sha256=invalidsig' },
      body: JSON.stringify(callbackPayload),
    });
    console.log('CALLBACK STATUS', callbackRes.status);
    console.log('CALLBACK BODY', await callbackRes.text());
  } catch (err) {
    console.error('CALLBACK ERROR', err.message || err);
  }

  try {
    const simRes = await fetch(`${url}/api/dev/simulate-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceNumber: 'tkt-simulated-1' }),
    });
    console.log('SIM STATUS', simRes.status);
    console.log('SIM BODY', await simRes.text());
  } catch (err) {
    console.error('SIM ERROR', err.message || err);
  }
})();
