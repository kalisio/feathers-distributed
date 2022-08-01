import path from 'path';
import favicon from 'serve-favicon';
import compress from 'compression';
import cors from 'cors';
import helmet from 'helmet';

import feathers from '@feathersjs/feathers';
import express from '@feathersjs/express';
import configuration from '@feathersjs/configuration';
import socketio from '@feathersjs/socketio';
import authentication from '@feathersjs/authentication'
import distribution from '../../../lib/index.js';

import middleware from './middleware/index.js';
import services from './services/index.js';
import appHooks from './app.hooks.js';
import channels from './channels.js';

import auth from './authentication.js';

const { authenticate } = authentication.hooks;

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
app.configure(distribution({
  hooks: { before: { all: [authenticate('jwt')] } },
  middlewares: { after: express.errorHandler() },
  // We don't produce services we only consume
  services: (service) => false,
  timeout: 5000
}));

// Configure other middleware (see `middleware/index.js`)
app.configure(middleware);
app.configure(auth);
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
