import path from 'path';
import favicon from 'serve-favicon';
import compress from 'compression';
import cors from 'cors';
import helmet from 'helmet';

import feathers from '@feathersjs/feathers';
import express from '@feathersjs/express';
import configuration from '@feathersjs/configuration';
import socketio from '@feathersjs/socketio';
import distribution from '../../../lib/index.js';
import middleware from './middleware/index.js';
import services from './services/index.js';
import appHooks from './app.hooks.js';
import channels from './channels.js';

const app = express(feathers());

// Load app configuration
app.configure(configuration());
// Enable CORS, security, compression, favicon and body parsing
app.use(cors());
app.use(helmet());
app.use(compress());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(favicon(path.join(app.get('public'), 'favicon.ico')));
// Host the public folder
app.use('/', express.static(app.get('public')));

app.configure(express.rest());
app.configure(socketio());
// Don't consume any remote service in any cas we'd like to replicate
app.configure(distribution({
  // We don't consume services we only produce
  remoteServices: (service) => false,
  key: 'services'
}));

// Configure other middleware (see `middleware/index.js`)
app.configure(middleware);
// Set up our services (see `services/index.js`)
app.configure(services);
// Set up channels
app.configure(channels);
// Configure a middleware for 404s and the error handler
// FIXME: this does not allow to declare remote services after the app has been launched
// Indeed this middleware is hit first...
//app.use(express.notFound());
//app.use(express.errorHandler());

app.hooks(appHooks);

export default app;
