import https from 'https';

const postData = JSON.stringify({
  merchantId: 'ID_MARCHAND_DEMO',
  amount: 5000,
  description: 'Test',
  channel: 'OMCIV2',
  countryCurrencyCode: '952',
  referenceNumber: 'TX-12345',
  customerEmail: 'test@test.com',
  customerFirstName: 'Test',
  customerLastname: 'Test',
  customerPhoneNumber: '0700000000',
  notificationURL: 'https://example.com/callback',
  returnURL: 'https://example.com/return',
  returnContext: ''
});

const req = https.request('https://paiementpro.net/webservice/onlinepayment/js/initialize/initialize.php', {
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
    console.log("Data:", data);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(postData);
req.end();
