import https from 'https';

const req = https.request('https://www.paiementpro.net/webservice/onlinepayment/js/initialize/initialize.php', {
  method: 'POST'
}, (res) => {
  console.log("Status:", res.statusCode);
  console.log("Headers:", res.headers);
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
