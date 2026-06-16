import https from 'https';

https.get('https://paiementpro.net/webservice/onlinepayment/js/paiementpro.v1.0.1.js', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
}).on('error', (err) => {
  console.log("Error: " + err.message);
});
