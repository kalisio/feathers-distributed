import chai, { util, expect } from 'chai';
import chailint from 'chai-lint';
import feathers from 'feathers';
import client from 'feathers/client';
import hooks from 'feathers-hooks';
import memory from 'feathers-memory';
import rest from 'feathers-rest';
import auth from 'feathers-authentication/client';
import authentication from 'feathers-authentication';
import jwt from 'feathers-authentication-jwt';
import local from 'feathers-authentication-local';
import io from 'socket.io-client';
import socketio from 'feathers-socketio';
import socketioClient from 'feathers-socketio/client';

const users = {
  '0': { email: 'user@test.com', password: '$2a$12$97.pHfXj/1Eqn0..1V4ixOvAno7emZKTZgz.OYEHYqOOM2z.cftAu', id: 0 }
};

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}
describe('auth', () => {
  let app;
  let server;
  let gwClient;

  before(() => {
    chailint(chai, util);
    app = feathers();
    app.configure(hooks());
    app.configure(rest());
    app.configure(socketio());
    app.configure(authentication({ secret: '1234' }));
    app.configure(jwt());
    app.configure(local());
    app.use('users', memory({ store: clone(users), startId: 1 }));
    server = app.listen(8085);
  });

  it('initiate the client', () => {
    const url = 'http://localhost:' + 8085;
    const socket = io(url);
    gwClient = client()
      .configure(socketioClient(socket))
      .configure(hooks())
      .configure(auth());
    expect(gwClient).toExist();
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

  // Cleanup
  after(() => {
    server.close();
  });
});
