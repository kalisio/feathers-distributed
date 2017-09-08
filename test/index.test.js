import chai, { util, expect } from 'chai';
import chailint from 'chai-lint';
import feathers from 'feathers';
import client from 'feathers/client';
import hooks from 'feathers-hooks';
import memory from 'feathers-memory';
import io from 'socket.io-client';
import socketio from 'feathers-socketio';
import socketioClient from 'feathers-socketio/client';
import rest from 'feathers-rest';
// import restClient from 'feathers-rest/client';
import plugin from '../src';

const startId = 6;
const store = {
  '0': { name: 'Jane Doe', id: 0 },
  '1': { name: 'Jack Doe', id: 1 },
  '2': { name: 'John Doe', id: 2 },
  '3': { name: 'Rick Doe', id: 3 },
  '4': { name: 'Dick Doe', id: 4 },
  '5': { name: 'Dork Doe', id: 5 }
};

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('feathers-distributed', () => {
  let apps = [];
  let servers = [];
  let services = [];
  let clients = [];
  let clientServices = [];
  const nbApps = 3;

  function createApp () {
    let app = feathers();
    app.configure(hooks());
    app.configure(socketio());
    app.configure(rest());
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
      apps[i] = createApp();
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

  it('registers the plugin/services', () => {
    let promises = [];
    for (let i = 0; i < nbApps; i++) {
      apps[i].configure(plugin);
      // Only the first app has a local service
      if (i === 0) {
        apps[i].use('users', memory({ store: clone(store), startId }));
        services[i] = apps[i].service('users');
        expect(services[i]).toExist();
      } else {
        // For remote services we have to wait they are registered
        promises.push(waitForService(apps, services, i));
      }
    }
    return Promise.all(promises)
    .then(pathes => {
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
      clients[i] = client().configure(socketioClient(io(url)));
      expect(clients[i]).toExist();
      clientServices[i] = clients[i].service('users');
      expect(clientServices[i]).toExist();
    }
  })
  // Let enough time to process
  .timeout(10000);

  it('dispatch find service calls from remote to local', () => {
    return clientServices[1].find({})
    .then(users => {
      expect(users.length > 0).beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch get service calls from remote to local', () => {
    return clientServices[1].get(1)
    .then(user => {
      expect(user.id === 1).beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch create service calls from remote to local', () => {
    return clientServices[1].create({ name: 'Donald Doe' })
    .then(user => {
      expect(user.id === startId).beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch update service calls from remote to local', () => {
    return clientServices[1].update(startId, { name: 'Donald Dover' })
    .then(user => {
      expect(user.name === 'Donald Dover').beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch patch service calls from remote to local', () => {
    return clientServices[1].patch(startId, { name: 'Donald Doe' })
    .then(user => {
      expect(user.name === 'Donald Doe').beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch remove service calls from remote to local', () => {
    return clientServices[1].remove(startId)
    .then(user => {
      expect(user.id === startId).beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch create service events from local to remote', (done) => {
    clientServices[2].on('created', user => {
      expect(user.id === startId + 1).beTrue();
      done();
    });
    clientServices[0].create({ name: 'Donald Doe' });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch update service events from local to remote', (done) => {
    clientServices[2].on('updated', user => {
      expect(user.name === 'Donald Dover').beTrue();
      done();
    });
    clientServices[0].update(startId + 1, { name: 'Donald Dover' });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch patch service events from local to remote', (done) => {
    clientServices[2].on('patched', user => {
      expect(user.name === 'Donald Doe').beTrue();
      done();
    });
    clientServices[0].patch(startId + 1, { name: 'Donald Doe' });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch remove service events from local to remote', (done) => {
    clientServices[2].on('removed', user => {
      expect(user.id === startId + 1).beTrue();
      done();
    });
    clientServices[0].remove(startId + 1);
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
