import https from 'https';

const postData = JSON.stringify({
  merchantId: 'ID_MARCHAND_DEMO'
});

const req = https.request('https://www.paiementpro.net/webservice/onlinepayment/js/initialize/initialize.php', {
  method: 'POST',
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Headers:", res.headers);
    console.log("Data:", data);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(postData);
req.end();
