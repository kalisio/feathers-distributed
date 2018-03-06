//
import chai, { util, expect } from 'chai';
import chailint from 'chai-lint';
import feathers from 'feathers';
import client from 'feathers/client';
import hooks from 'feathers-hooks';
import memory from 'feathers-memory';
import io from 'socket.io-client';
import socketio from 'feathers-socketio';
import socketioClient from 'feathers-socketio/client';
// import restClient from 'feathers-rest/client';
import rest from 'feathers-rest';
import auth from 'feathers-authentication-client';
// import request from 'request';
import plugin from '../src';

const authentication = require('feathers-authentication');
const jwt = require('feathers-authentication-jwt');
const local = require('feathers-authentication-local');

const users = {
  '0': {
    name: 'Jane Doe',
    email: 'user@test.com',
    password: '$2a$12$97.pHfXj/1Eqn0..1V4ixOvAno7emZKTZgz.OYEHYqOOM2z.cftAu',
    id: 0
  }
};
const todos = {
  '0': { title: 'todo', id: 0 }
};

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('feathers-distributed with auth', () => {
  let apps = [];
  let servers = [];
  let services = [];
  let gwServer;
  let gwClient;
  const nbApps = 2;

  function createGateway () {
    let app = createApp();
    configureAuth(app);
    app.configure(
      plugin({
        hooks: {
          before: {
            all: [authentication.hooks.authenticate('jwt')]
          }
        }
      })
    );
    app.use('users', memory({ store: clone(users), startId: 1 }));
    gwServer = app.listen(8085);
  }

  function configureAuth (app) {
    app.configure(authentication({ secret: '1234' }));
    app.configure(jwt());
    app.configure(local());
    return app;
  }

  function createApp () {
    let app = feathers();
    app.configure(hooks());
    app.configure(socketio());
    app.configure(rest());
    return app;
  }

  before(() => {
    chailint(chai, util);
    createGateway();
    for (let i = 0; i < nbApps; i++) {
      apps[i] = createApp();
    }
  });

  function waitForService (apps, services, i) {
    return new Promise((resolve, reject) => {
      apps[i].on('service', data => {
        if (data.path === 'todos') {
          services[i] = apps[i].service('todos');
          expect(services[i]).toExist();
          resolve(data.path);
        }
      });
    });
  }
  function waitForListen (server) {
    return new Promise((resolve, reject) => {
      server.once('listening', _ => resolve());
    });
  }

  it('registers the plugin/services', () => {
    let promises = [];
    for (let i = 0; i < nbApps; i++) {
      apps[i].configure(plugin());
      // Only the first app has a local service
      if (i === 0) {
        apps[i].use('todos', memory({ store: clone(todos), startId: 1 }));
        services[i] = apps[i].service('todos');
        expect(services[i]).toExist();
      } else {
        // For remote services we have to wait they are registered
        promises.push(waitForService(apps, services, i));
      }
    }
    return Promise.all(promises).then(pathes => {
      promises = [];
      for (let i = 0; i < nbApps; i++) {
        servers[i] = apps[i].listen(8086 + i);
        promises.push(waitForListen(servers[i]));
      }
      return Promise.all(promises);
    });
  })
    // Let enough time to process
    .timeout(10000);

  it('initiate the gw-client', () => {
    const url = 'http://localhost:' + 8085;
    const socket = io(url);
    gwClient = client()
      .configure(socketioClient(socket))
      .configure(hooks())
      .configure(auth());

    expect(gwClient).toExist();
  });

  it('find should return 401', () => {
    return gwClient
      .service('todos')
      .find({})
      .catch(err => {
        expect(err.code === 401).beTrue();
      });
  });

  it('authenticate should return token', () => {
    return gwClient
      .authenticate({
        strategy: 'local',
        email: 'user@test.com',
        password: 'password'
      })
      .then(token => {
        expect(token).toExist();
      });
  });

  it('find should return todos', () => {
    return gwClient
      .authenticate({
        strategy: 'local',
        email: 'user@test.com',
        password: 'password'
      })
      .then(token => {
        gwClient
          .service('todos')
          .find({})
          .then(todos => {
            expect(todos.length > 0).beTrue();
          });
      });
  });

  // Cleanup
  after(() => {
    for (let i = 0; i < nbApps; i++) {
      servers[i].close();
    }
    gwServer.close();
  });
});
