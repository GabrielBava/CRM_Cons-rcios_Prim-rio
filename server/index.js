'use strict';
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const { server } = createApp();
server.listen(PORT, HOST, () => {
  console.log(`Vero Consórcios (ERP/CRM) em execução: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
