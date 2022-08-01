/* eslint-disable no-console */
import logger from 'winston';
import app from './app.js';
const port = app.get('port');
const server = await app.listen(port);

process.on('unhandledRejection', (reason, p) =>
  logger.error('Unhandled Rejection at: Promise ', p, reason)
);

server.on('listening', () =>
  logger.info('Feathers application started on http://%s:%d', app.get('host'), port)
);
