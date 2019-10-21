import authentication from '@feathersjs/authentication'
import auth from '@feathersjs/authentication-client'
import jwt from '@feathersjs/authentication-jwt'
import local from '@feathersjs/authentication-local'
import client from '@feathersjs/client'
import express from '@feathersjs/express'
import bodyParser from 'body-parser'
import feathers from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio'
import request from 'superagent'
import chai, { expect, util } from 'chai'
import chailint from 'chai-lint'
import spies from 'chai-spies'
import commonHooks from 'feathers-hooks-common'
import memory from 'feathers-memory'
import io from 'socket.io-client'
import plugin from '../src'

let startId = 6
const store = {
  0: {
    name: 'Jane Doe',
    email: 'user@test.com',
    password: '$2a$12$97.pHfXj/1Eqn0..1V4ixOvAno7emZKTZgz.OYEHYqOOM2z.cftAu',
    id: 0
  },
  1: { name: 'Jack Doe', id: 1 },
  2: { name: 'John Doe', id: 2 },
  3: { name: 'Rick Doe', id: 3 },
  4: { name: 'Dick Doe', id: 4 },
  5: { name: 'Dork Doe', id: 5 }
}
let beforeHook = (hook) => hook
let afterHook = (hook) => hook
let middleware = (req, res, next) => next()
let hookFromRemote

function channels (app) {
  if (typeof app.channel !== 'function') {
    return
  }
  app.on('connection', connection => {
    app.channel('all').join(connection)
  })
  app.publish((data, context) => {
    return app.channel('all')
  })
}

function clone (obj) {
  return JSON.parse(JSON.stringify(obj))
}

describe('feathers-distributed', () => {
  const apps = []
  const servers = []
  const services = []
  const restClients = []
  const restClientServices = []
  const socketClients = []
  const socketClientServices = []
  let checkAuthentication = false
  let accessToken
  const nbApps = 3
  const gateway = 0
  const service1 = 1
  const service2 = 2

  function createApp (index) {
    const app = express(feathers())
    app.use(bodyParser.json())
    app.configure(socketio())
    app.configure(express.rest())
    app.configure(authentication({ secret: '1234' }))
    const strategies = ['jwt']
    app.configure(jwt())
    if (index === gateway) {
      strategies.push('local')
      app.configure(local())
    }
    // The `authentication` service is used to create a JWT.
    // The before `create` hook registers strategies that can be used
    // to create a new valid JWT (e.g. local or oauth2)
    app.service('authentication').hooks({
      before: {
        create: [authentication.hooks.authenticate(strategies)],
        remove: [authentication.hooks.authenticate('jwt')]
      }
    })
    /*
    app.hooks({
      before: { all: plugin.hooks.dispatch }
    });
    */
    return app
  }

  before(() => {
    chailint(chai, util)
    chai.use(spies)
    beforeHook = chai.spy(beforeHook)
    afterHook = chai.spy(afterHook)
    middleware = chai.spy(middleware)
    for (let i = 0; i < nbApps; i++) {
      apps[i] = createApp(i)
    }
  })

  it('is CommonJS compatible', () => {
    expect(typeof plugin).to.equal('function')
  })

  function waitForService (apps, services, i) {
    return new Promise((resolve, reject) => {
      apps[i].on('service', data => {
        if (data.path === 'users') {
          services[i] = apps[i].service('users')
          expect(services[i]).toExist()
          resolve(data.path)
        }
      })
    })
  }
  function waitForListen (server) {
    return new Promise((resolve, reject) => {
      server.once('listening', _ => resolve())
    })
  }

  it('registers the plugin with options and services', async () => {
    let promises = []
    for (let i = 0; i < nbApps; i++) {
      apps[i].configure(plugin({
        hooks: { before: { all: beforeHook }, after: { all: afterHook } },
        middlewares: { after: express.errorHandler() },
        // Distribute only the users service
        services: (service) => service.path.endsWith('users'),
        publicationDelay: 5000,
        cote: { // Use cote defaults
          helloInterval: 2000,
          checkInterval: 4000,
          nodeTimeout: 5000,
          masterTimeout: 6000
        }
      }))
      expect(apps[i].servicePublisher).toExist()
      expect(apps[i].serviceSubscriber).toExist()
      apps[i].configure(channels)
      // Only the first app has a local service
      if (i === gateway) {
        apps[i].use('users', middleware, memory({ store: clone(store), startId }))
        services[i] = apps[i].service('users')
        services[i].hooks({
          before: {
            all: [
              hook => {
                hookFromRemote = hook.params.fromRemote
                return hook
              },
              commonHooks.when(
                hook => hook.params.provider && checkAuthentication,
                authentication.hooks.authenticate('jwt')
              )
            ]
          }
        })
        expect(services[i]).toExist()
      } else {
        // For remote services we have to wait they are registered
        promises.push(waitForService(apps, services, i))
      }
    }
    await Promise.all(promises)
    promises = []
    for (let i = 0; i < nbApps; i++) {
      // See https://github.com/kalisio/feathers-distributed/issues/3
      // Now all services are registered setup handlers
      apps[i].use(express.notFound())
      apps[i].use(express.errorHandler())
      servers[i] = apps[i].listen(8080 + i)
      promises.push(waitForListen(servers[i]))
    }
    await Promise.all(promises)
  })
    // Let enough time to process
    .timeout(10000)

  it('initiate the rest clients', () => {
    for (let i = 0; i < nbApps; i++) {
      const url = 'http://localhost:' + (8080 + i)
      restClients[i] = client()
        .configure(client.rest(url).superagent(request))
        .configure(auth())
      expect(restClients[i]).toExist()
      restClientServices[i] = restClients[i].service('users')
      expect(restClientServices[i]).toExist()
    }
  })
    // Let enough time to process
    .timeout(5000)

  it('initiate the socket clients', () => {
    for (let i = 0; i < nbApps; i++) {
      const url = 'http://localhost:' + (8080 + i)
      socketClients[i] = client()
        .configure(client.socketio(io(url)))
        .configure(auth())
      expect(socketClients[i]).toExist()
      socketClientServices[i] = socketClients[i].service('users')
      expect(socketClientServices[i]).toExist()
    }
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch find rest service calls from remote to local without auth', async () => {
    const users = await restClientServices[service1].find({})
    expect(users.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch get rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch create rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('ensure distribution hooks have been called on remote service', () => {
    expect(beforeHook).to.have.been.called()
    expect(afterHook).to.have.been.called()
  })

  it('ensure local service hooks have been called with the remote service flag', () => {
    expect(hookFromRemote).beTrue()
  })

  it('ensure middleware can been called on local service', async () => {
    const url = 'http://localhost:' + (8080 + gateway) + '/users'
    await request.get(url)
    expect(middleware).to.have.been.called()
  })

  it('dispatch find socket service calls from remote to local without auth', async () => {
    const users = await socketClientServices[service1].find({})
    expect(users.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch get socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch create socket service calls from remote to local without auth', async () => {
    // Jump to next user
    startId += 1
    const user = await socketClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch create socket service events from local to remote without auth', done => {
    // Jump to next user
    startId += 1
    socketClientServices[service2].once('created', user => {
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].create({ name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update socket service events from local to remote without auth', done => {
    socketClientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue()
      done()
    })
    socketClientServices[gateway].update(startId, { name: 'Donald Dover' })
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch socket service events from local to remote without auth', done => {
    socketClientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue()
      done()
    })
    socketClientServices[gateway].patch(startId, { name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove socket service events from local to remote without auth', done => {
    socketClientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].remove(startId)
  })
    // Let enough time to process
    .timeout(5000)

  it('not found request should return 404 on local service', async () => {
    const url = 'http://localhost:' + (8080 + gateway) + '/xxx'
    try {
      await request.get(url)
    } catch (err) {
      // As external service call should use express handler
      expect(err.response.text.includes('NotFound')).beTrue()
      expect(err.status).to.equal(404)
    }
  })

  it('not found request should return 404 on remote service', async () => {
    const url = 'http://localhost:' + (8080 + service1) + '/xxx'
    try {
      await request.get(url)
    } catch (err) {
      // As external service call should use express handler
      expect(err.response.text.includes('NotFound')).beTrue()
      expect(err.status).to.equal(404)
    }
  })

  it('unauthenticated call should return 401 on local service with auth', async () => {
    checkAuthentication = true
    try {
      await socketClientServices[gateway].find({})
    } catch (err) {
      // As internal service call should not use express handler
      expect(err.code).to.equal(401)
    }
  })

  it('unauthenticated request should return 401 on local service with auth', async () => {
    const url = 'http://localhost:' + (8080 + gateway) + '/users'
    try {
      await request.get(url)
    } catch (err) {
      // As external service call should use express handler
      expect(err.response.text.includes('NotAuthenticated')).beTrue()
      expect(err.status).to.equal(401)
    }
  })

  it('unauthenticated call should return 401 on remote service with auth', async () => {
    try {
      await socketClientServices[service1].find({})
    } catch (err) {
      // As internal service call should not use express handler
      expect(err.code).to.equal(401)
    }
  })

  it('unauthenticated request should return 401 on remote service with auth', async () => {
    const url = 'http://localhost:' + (8080 + service1) + '/users'
    try {
      await request.get(url)
    } catch (err) {
      // As external service call should use express handler
      expect(err.response.text.includes('NotAuthenticated')).beTrue()
      expect(err.status).to.equal(401)
    }
  })

  it('authenticate rest client should return token', async () => {
    // Local auth on gateway
    let response = await restClients[gateway].authenticate({
      strategy: 'local',
      email: 'user@test.com',
      password: 'password'
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
    // Local auth on service
    response = await restClients[service1].authenticate({
      strategy: 'local',
      email: 'user@test.com',
      password: 'password'
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
    // JWT auth on service using JWT from gateway
    response = await restClients[service2].authenticate({
      strategy: 'jwt',
      accessToken
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
  })

  it('authenticate socket client should return token', async () => {
    // Local auth on gateway
    let response = await socketClients[gateway].authenticate({
      strategy: 'local',
      email: 'user@test.com',
      password: 'password'
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
    // Local auth on service
    response = await socketClients[service1].authenticate({
      strategy: 'local',
      email: 'user@test.com',
      password: 'password'
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
    // JWT auth on service using JWT from gateway
    response = await socketClients[service2].authenticate({
      strategy: 'jwt',
      accessToken
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
  })

  it('dispatch find rest service calls from remote to local with auth', async () => {
    const users = await restClientServices[service1].find({})
    expect(users.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch get rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch create rest service calls from remote to local with auth', async () => {
    // Jump to next user
    startId += 1
    const user = await restClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch find socket service calls from remote to local with auth', async () => {
    const users = await socketClientServices[service1].find({})
    expect(users.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch get socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch create socket service calls from remote to local with auth', async () => {
    // Jump to next user
    startId += 1
    const user = await socketClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch create socket service events from local to remote with auth', done => {
    // Jump to next user
    startId += 1
    socketClientServices[service2].once('created', user => {
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].create({ name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update socket service events from local to remote with auth', done => {
    socketClientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue()
      done()
    })
    socketClientServices[gateway].update(startId, { name: 'Donald Dover' })
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch socket service events from local to remote with auth', done => {
    socketClientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue()
      done()
    })
    socketClientServices[gateway].patch(startId, { name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove socket service events from local to remote with auth', done => {
    socketClientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].remove(startId)
  })
    // Let enough time to process
    .timeout(5000)

  // Cleanup
  after(async () => {
    for (let i = 0; i < nbApps; i++) {
      await servers[i].close()
    }
  })
})
