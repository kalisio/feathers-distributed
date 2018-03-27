const path = require('path');
const favicon = require('serve-favicon');
const compress = require('compression');
const cors = require('cors');
const helmet = require('helmet');

const feathers = require('@feathersjs/feathers');
const express = require('@feathersjs/express');
const configuration = require('@feathersjs/configuration');
const socketio = require('@feathersjs/socketio');
const distribution = require('../lib');

const middleware = require('./middleware');
const services = require('./services');
const appHooks = require('./app.hooks');
const channels = require('./channels');

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
app.configure(distribution());

// Configure other middleware (see `middleware/index.js`)
app.configure(middleware);
// Set up our services (see `services/index.js`)
app.configure(services);
// Set up channels
app.configure(channels);
// Configure a middleware for 404s and the error handler
// FIXME: this does not allow to declare remote services after the app has been launched
// Indeed this middleware is hit first...
app.use(express.notFound());
app.use(express.errorHandler());

app.hooks(appHooks);

module.exports = app;
