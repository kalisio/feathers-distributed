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
  let firstApp, secondApp, firstServer, secondServer, localService, remoteService,
    firstClient, secondClient, localClientService, remoteClientService;

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
    firstApp = createApp();
    secondApp = createApp();
  });

  it('is CommonJS compatible', () => {
    expect(typeof plugin).to.equal('function');
  });

  it('registers the plugin/services', (done) => {
    firstApp.configure(plugin);
    firstApp.use('users', memory({ store: clone(store), startId }));
    localService = firstApp.service('users');
    expect(localService).toExist();
    firstServer = firstApp.listen(8081);
    firstServer.once('listening', _ => {
      secondApp.configure(plugin);
      secondApp.on('service', data => {
        if (data.path === 'users') {
          remoteService = secondApp.service('users');
          expect(remoteService).toExist();
          secondServer = secondApp.listen(8082);
          secondServer.once('listening', _ => done());
        }
      });
    });
  });

  it('initiate the clients', () => {
    firstClient = client().configure(socketioClient(io('http://localhost:8081')));
    expect(firstClient).toExist();
    // The first client will target the first app
    localClientService = firstClient.service('users');
    expect(localClientService).toExist();
    secondClient = client().configure(socketioClient(io('http://localhost:8082')));
    expect(secondClient).toExist();
    // The second client will target the first app through the second one
    remoteClientService = secondClient.service('users');
    expect(remoteClientService).toExist();
  });

  it('dispatch service calls from remote to local', () => {
    return remoteClientService.find({})
    .then(users => {
      expect(users.length > 0).beTrue();
    });
  })
  // Let enough time to process
  .timeout(5000);

  it('dispatch service events from local to remote', (done) => {
    remoteService.on('created', user => {
      expect(user).toExist();
      done();
    })
    localClientService.create({ name: 'Donald Doe' });
  })
  // Let enough time to process
  .timeout(5000);

  // Cleanup
  after(() => {
    if (firstServer) firstServer.close();
    if (secondServer) secondServer.close();
  });
});
