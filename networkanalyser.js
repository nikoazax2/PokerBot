#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let HttpMitmProxy;
try {
  HttpMitmProxy = require('http-mitm-proxy');
} catch (e) {
  console.error('❌ Impossible de charger http-mitm-proxy. Fais : npm install http-mitm-proxy@0.8.1');
  process.exit(1);
}

const proxy = HttpMitmProxy();
const LOG_FILE = path.join(__dirname, 'traffic.log');

// Réinitialise le log au démarrage
fs.writeFileSync(LOG_FILE, '', 'utf8');

const appendLog = (txt) => {
  process.stdout.write(txt);
  fs.appendFileSync(LOG_FILE, txt);
};

proxy.onError((ctx, err, errorKind) => {
  appendLog(`[ERROR ${new Date().toISOString()}] (${errorKind}) ${err && err.message}\n`);
});

// Interception de toutes les requêtes
proxy.onRequest((ctx, callback) => {
  const req = ctx.clientToProxyRequest;
  const method = req.method;
  const host = req.headers.host || '';
  const url = `${ctx.isSSL ? 'https' : 'http'}://${host}${req.url || ''}`;

  appendLog(`\n=== REQUEST ${method} ${url} ===\n`);
  appendLog(`-> Request headers:\n${JSON.stringify(req.headers, null, 2)}\n`);

  let reqBody = '';
  ctx.onRequestData((ctx, chunk, cb) => {
    reqBody += chunk.toString('utf8');
    cb(null, chunk); // passe la donnée
  });

  ctx.onRequestEnd((ctx, cb) => {
    if (reqBody) {
      appendLog(`-> Request body:\n${reqBody}\n`);
    }
    cb();
  });

  ctx.onResponse((ctx, cb) => {
    const res = ctx.serverToProxyResponse;
    appendLog(`<-- RESPONSE ${method} ${url} [${res.statusCode}]\n`);
    appendLog(`<-- Response headers:\n${JSON.stringify(res.headers, null, 2)}\n`);
    cb();
  });

  let resBody = '';
  ctx.onResponseData((ctx, chunk, cb) => {
    // Attention : certains réponses sont binaires, on force en string pour debug (peut être trituré)
    resBody += chunk.toString('utf8');
    cb(null, chunk);
  });

  ctx.onResponseEnd((ctx, cb) => {
    if (resBody) {
      appendLog(`<-- Response body:\n${resBody}\n`);
    }
    appendLog(`=== END ${method} ${url} ===\n`);
    cb();
  });

  callback(); // continue le pipeline
});

proxy.listen({ port: 8080 }, () => {
  console.log(`✅ Proxy HTTP(S) actif sur : http://localhost:8080`);
  console.log(`🔍 Log dans : ${LOG_FILE}`);
  console.log('ℹ️ Pour intercepter HTTPS : installe le certificat racine généré par http-mitm-proxy (dans %USERPROFILE%\\.http-mitm-proxy\\).');
});
