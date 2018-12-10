import authentication from '@feathersjs/authentication';
import auth from '@feathersjs/authentication-client';
import jwt from '@feathersjs/authentication-jwt';
import local from '@feathersjs/authentication-local';
import client from '@feathersjs/client';
import express from '@feathersjs/express';
import feathers from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio';
import socketioClient from '@feathersjs/socketio-client';
import chai, { expect, util } from 'chai';
import chailint from 'chai-lint';
import commonHooks from 'feathers-hooks-common';
import memory from 'feathers-memory';
import io from 'socket.io-client';

import plugin from '../src';

// import restClient from 'feathers-rest/client';
let startId = 6;
const store = {
  '0': {
    name: 'Jane Doe',
    email: 'user@test.com',
    password: '$2a$12$97.pHfXj/1Eqn0..1V4ixOvAno7emZKTZgz.OYEHYqOOM2z.cftAu',
    id: 0
  },
  '1': { name: 'Jack Doe', id: 1 },
  '2': { name: 'John Doe', id: 2 },
  '3': { name: 'Rick Doe', id: 3 },
  '4': { name: 'Dick Doe', id: 4 },
  '5': { name: 'Dork Doe', id: 5 }
};

function channels (app) {
  if (typeof app.channel !== 'function') {
    return;
  }

  app.on('connection', connection => {
    app.channel('all').join(connection);
  });

  app.publish((data, context) => {
    return app.channel('all');
  });
}

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('feathers-distributed', () => {
  let apps = [];
  let servers = [];
  let services = [];
  let clients = [];
  let clientServices = [];
  let checkAuthentication = false;
  let accessToken;
  const nbApps = 3;
  const gateway = 0;
  const service1 = 1;
  const service2 = 2;

  function createApp (index) {
    let app = express(feathers());
    app.configure(socketio());
    app.configure(express.rest());
    app.configure(authentication({ secret: '1234' }));
    let strategies = ['jwt'];
    app.configure(jwt());
    app.use(express.notFound());
    app.use(express.errorHandler());
    if (index === gateway) {
      strategies.push('local');
      app.configure(local());
    }
    // The `authentication` service is used to create a JWT.
    // The before `create` hook registers strategies that can be used
    // to create a new valid JWT (e.g. local or oauth2)
    app.service('authentication').hooks({
      before: {
        create: [authentication.hooks.authenticate(strategies)],
        remove: [authentication.hooks.authenticate('jwt')]
      }
    });
    /*
    app.hooks({
      before: { all: plugin.hooks.dispatch }
    });
    */
    return app;
  }

  before(() => {
    chailint(chai, util);
    for (let i = 0; i < nbApps; i++) {
      apps[i] = createApp(i);
    }
  });

  it('is CommonJS compatible', () => {
    expect(typeof plugin).to.equal('function');
  });

  function waitForService (apps, services, i) {
    return new Promise((resolve, reject) => {
      apps[i].on('service', data => {
        if (data.path === 'users') {
          services[i] = apps[i].service('users');
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

  it('register the service with hooks', () => {
    let app = express(feathers());
    app.configure(plugin({ hooks: {} }));
    expect(app).toExist();
  });

  it('register the service with errorHandler', () => {
    let app = express(feathers());
    app.configure(plugin({ errorHandler: express.errorHandler() }));
    expect(app).toExist();
  });

  it('registers the plugin/services', () => {
    let promises = [];
    for (let i = 0; i < nbApps; i++) {
      apps[i].configure(plugin());
      apps[i].configure(channels);
      // Only the first app has a local service
      if (i === gateway) {
        apps[i].use('users', memory({ store: clone(store), startId }));
        services[i] = apps[i].service('users');
        services[i].hooks({
          before: {
            all: [
              commonHooks.when(
                hook => hook.params.provider && checkAuthentication,
                authentication.hooks.authenticate('jwt')
              )
            ]
          }
        });
        expect(services[i]).toExist();
      } else {
        // For remote services we have to wait they are registered
        promises.push(waitForService(apps, services, i));
      }
    }
    return Promise.all(promises).then(pathes => {
      promises = [];
      for (let i = 0; i < nbApps; i++) {
        servers[i] = apps[i].listen(8080 + i);
        promises.push(waitForListen(servers[i]));
      }
      return Promise.all(promises);
    });
  })
    // Let enough time to process
    .timeout(10000);

  it('initiate the clients', () => {
    for (let i = 0; i < nbApps; i++) {
      const url = 'http://localhost:' + (8080 + i);
      clients[i] = client()
        .configure(socketioClient(io(url)))
        .configure(auth());
      expect(clients[i]).toExist();
      clientServices[i] = clients[i].service('users');
      expect(clientServices[i]).toExist();
    }
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch find service calls from remote to local without auth', () => {
    return clientServices[service1].find({}).then(users => {
      expect(users.length > 0).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch get service calls from remote to local without auth', () => {
    return clientServices[service1].get(1).then(user => {
      expect(user.id === 1).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch create service calls from remote to local without auth', () => {
    return clientServices[service1].create({ name: 'Donald Doe' }).then(user => {
      expect(user.id === startId).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch update service calls from remote to local without auth', () => {
    return clientServices[service1].update(startId, { name: 'Donald Dover' }).then(user => {
      expect(user.name === 'Donald Dover').beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch patch service calls from remote to local without auth', () => {
    return clientServices[service1].patch(startId, { name: 'Donald Doe' }).then(user => {
      expect(user.name === 'Donald Doe').beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch remove service calls from remote to local without auth', () => {
    return clientServices[service1].remove(startId).then(user => {
      expect(user.id === startId).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch create service events from local to remote without auth', done => {
    // Jump to next user
    startId += 1;
    clientServices[service2].once('created', user => {
      expect(user.id === startId).beTrue();
      done();
    });
    clientServices[gateway].create({ name: 'Donald Doe' });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch update service events from local to remote without auth', done => {
    clientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue();
      done();
    });
    clientServices[gateway].update(startId, { name: 'Donald Dover' });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch patch service events from local to remote without auth', done => {
    clientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue();
      done();
    });
    clientServices[gateway].patch(startId, { name: 'Donald Doe' });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch remove service events from local to remote without auth', done => {
    clientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue();
      done();
    });
    clientServices[gateway].remove(startId);
  })
    // Let enough time to process
    .timeout(5000);

  it('unauthenticated call should return 401 on local service with auth', () => {
    checkAuthentication = true;
    return clientServices[gateway].find({}).catch(err => {
      expect(err.code === 401).beTrue();
    });
  });

  it('unauthenticated call should return 401 on remote service with auth', () => {
    return clientServices[service1].find({}).catch(err => {
      expect(err.code === 401).beTrue();
    });
  });

  it('authenticate should return token', () => {
    // Local auth on gateway
    return clients[gateway]
      .authenticate({
        strategy: 'local',
        email: 'user@test.com',
        password: 'password'
      })
      .then(response => {
        accessToken = response.accessToken;
        expect(accessToken).toExist();
        // Local auth on service
        return clients[service1].authenticate({
          strategy: 'local',
          email: 'user@test.com',
          password: 'password'
        });
      })
      .then(response => {
        accessToken = response.accessToken;
        expect(accessToken).toExist();
        // JWT auth on service using JWT from gateway
        return clients[service2].authenticate({
          strategy: 'jwt',
          accessToken
        });
      })
      .then(response => {
        accessToken = response.accessToken;
        expect(accessToken).toExist();
      });
  });

  it('dispatch find service calls from remote to local with auth', () => {
    return clientServices[service1].find({}).then(users => {
      expect(users.length > 0).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch get service calls from remote to local with auth', () => {
    return clientServices[service1].get(1).then(user => {
      expect(user.id === 1).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch create service calls from remote to local with auth', () => {
    // Jump to next user
    startId += 1;
    return clientServices[service1].create({ name: 'Donald Doe' }).then(user => {
      expect(user.id === startId).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch update service calls from remote to local with auth', () => {
    return clientServices[service1].update(startId, { name: 'Donald Dover' }).then(user => {
      expect(user.name === 'Donald Dover').beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch patch service calls from remote to local with auth', () => {
    return clientServices[service1].patch(startId, { name: 'Donald Doe' }).then(user => {
      expect(user.name === 'Donald Doe').beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch remove service calls from remote to local with auth', () => {
    return clientServices[service1].remove(startId).then(user => {
      expect(user.id === startId).beTrue();
    });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch create service events from local to remote with auth', done => {
    // Jump to next user
    startId += 1;
    clientServices[service2].once('created', user => {
      expect(user.id === startId).beTrue();
      done();
    });
    clientServices[gateway].create({ name: 'Donald Doe' });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch update service events from local to remote with auth', done => {
    clientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue();
      done();
    });
    clientServices[gateway].update(startId, { name: 'Donald Dover' });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch patch service events from local to remote with auth', done => {
    clientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue();
      done();
    });
    clientServices[gateway].patch(startId, { name: 'Donald Doe' });
  })
    // Let enough time to process
    .timeout(5000);

  it('dispatch remove service events from local to remote with auth', done => {
    clientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue();
      done();
    });
    clientServices[gateway].remove(startId);
  })
    // Let enough time to process
    .timeout(5000);

  // Cleanup
  after(() => {
    for (let i = 0; i < nbApps; i++) {
      servers[i].close();
    }
  });
});
