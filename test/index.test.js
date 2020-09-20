// const log = require('why-is-node-running')
import path from 'path'
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
import utils from 'util'
import chai, { expect, util } from 'chai'
import chailint from 'chai-lint'
import spies from 'chai-spies'
import commonHooks from 'feathers-hooks-common'
import memory from 'feathers-memory'
import io from 'socket.io-client'
import plugin, { finalize } from '../src'

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
let serviceMiddleware = (req, res, next) => next()
let appMiddleware = (req, res, next) => res.json({})
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
  const customServices = []
  const restClients = []
  const restClientServices = []
  const sockets = []
  const socketClients = []
  const socketClientServices = []
  const socketClientCustomServices = []
  let checkAuthentication = false
  let accessToken
  const nbApps = 4
  const gateway = 0
  const service1 = 1
  const service2 = 2
  const noEvents = 3

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
    serviceMiddleware = chai.spy(serviceMiddleware)
    appMiddleware = chai.spy(appMiddleware)
    for (let i = 0; i < nbApps; i++) {
      apps[i] = createApp(i)
    }
  })

  it('is ES6 compatible', () => {
    expect(typeof finalize).to.equal('function')
    expect(typeof plugin).to.equal('function')
  })

  it('is CommonJS compatible', () => {
    const lib = require(path.join(__dirname, '..', 'lib'))
    expect(typeof lib).to.equal('function')
    expect(typeof lib.finalize).to.equal('function')
  })

  function waitForService (app, path) {
    return new Promise((resolve, reject) => {
      app.on('service', data => {
        if (data.path === path) {
          const service = app.service(path)
          expect(service).toExist()
          resolve(service)
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
        // Distribute only the test services
        services: (service) => service.path.endsWith('users') ||
                  service.path.endsWith('custom') ||
                  service.path.endsWith('no-events'),
        key: i.toString(),
        coteDelay: 5000,
        publicationDelay: 5000,
        publishEvents: (i !== noEvents),
        distributedEvents: ['created', 'updated', 'patched', 'removed', 'custom'],
        cote: { // Use cote defaults
          helloInterval: 2000,
          checkInterval: 4000,
          nodeTimeout: 5000,
          masterTimeout: 6000,
          basePort: 10000
        }
      }))
      // expect(apps[i].servicePublisher).toExist()
      // expect(apps[i].serviceSubscriber).toExist()
      apps[i].configure(channels)
      // Only the first (gateway) & noEvents apps have local services
      if (i === gateway) {
        apps[gateway].use('/middleware', appMiddleware)
        apps[gateway].use('users', serviceMiddleware, memory({ store: clone(store), startId }))
        const userService = apps[gateway].service('users')
        expect(userService).toExist()
        userService.hooks({
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
        promises.push(Promise.resolve(userService))
      } else if (i === noEvents) {
        apps[noEvents].use('no-events', memory({ events: ['custom'] }))
        promises.push(waitForService(apps[i], 'users'))
      } else {
        // For remote services we have to wait they are registered
        promises.push(waitForService(apps[i], 'users'))
      }
    }
    await Promise.all(promises)
    promises = []
    for (let i = 0; i < nbApps; i++) {
      // See https://github.com/kalisio/feathers-distributed/issues/3
      // Now all services are registered setup handlers
      apps[i].use(express.notFound())
      apps[i].use(express.errorHandler())
      servers[i] = apps[i].listen(3030 + i)
      promises.push(waitForListen(servers[i]))
    }
    await Promise.all(promises)
    // Wait before all cote components have been discovered
    await utils.promisify(setTimeout)(10000)
  })
    // Let enough time to process
    .timeout(60000)

  it('initiate the rest clients', () => {
    for (let i = 0; i < nbApps; i++) {
      const url = 'http://localhost:' + (3030 + i)
      restClients[i] = client()
        .configure(client.rest(url).superagent(request))
        .configure(auth())
      expect(restClients[i]).toExist()
      restClientServices[i] = restClients[i].service('users')
      expect(restClientServices[i]).toExist()
    }
  })
    // Let enough time to process
    .timeout(10000)

  it('initiate the socket clients', () => {
    for (let i = 0; i < nbApps; i++) {
      const url = 'http://localhost:' + (3030 + i)
      sockets[i] = io(url)
      socketClients[i] = client()
        .configure(client.socketio(sockets[i]))
        .configure(auth())
      expect(socketClients[i]).toExist()
      socketClientServices[i] = socketClients[i].service('users')
      expect(socketClientServices[i]).toExist()
    }
  })
    // Let enough time to process
    .timeout(10000)

  it('ensure healthcheck can been called on apps', async () => {
    // Service 1 & 2 should see the gateway 0
    let url = 'http://localhost:' + (3030 + service1) + '/distribution/healthcheck/0'
    let response = await request.get(url)
    expect(response.body).to.deep.equal({ users: true })
    url = 'http://localhost:' + (3030 + service2) + '/distribution/healthcheck/0'
    response = await request.get(url)
    expect(response.body).to.deep.equal({ users: true })
    // Gateway should see the no-events app 3
    url = 'http://localhost:' + (3030 + gateway) + '/distribution/healthcheck/3'
    response = await request.get(url)
    expect(response.body).to.deep.equal({ 'no-events': true })
  })
    // Let enough time to process
    .timeout(10000)

  it('ensure middleware can been called on app', async () => {
    const url = 'http://localhost:' + (3030 + gateway) + '/middleware'
    await request.get(url)
    expect(appMiddleware).to.have.been.called()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch find rest service calls from remote to local without auth', async () => {
    const users = await restClientServices[service1].find({})
    expect(users.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch get rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch create rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch update rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch patch rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch remove rest service calls from remote to local without auth', async () => {
    const user = await restClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('ensure distribution hooks have been called on remote service', () => {
    expect(beforeHook).to.have.been.called()
    expect(afterHook).to.have.been.called()
  })

  it('ensure local service hooks have been called with the remote service flag', () => {
    expect(hookFromRemote).beTrue()
  })

  it('ensure middleware can been called on local service', async () => {
    const url = 'http://localhost:' + (3030 + gateway) + '/users'
    await request.get(url)
    expect(serviceMiddleware).to.have.been.called()
  })

  it('dispatch find socket service calls from remote to local without auth', async () => {
    const users = await socketClientServices[service1].find({})
    expect(users.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch get socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch create socket service calls from remote to local without auth', async () => {
    // Jump to next user
    startId += 1
    const user = await socketClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch update socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch patch socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch remove socket service calls from remote to local without auth', async () => {
    const user = await socketClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch create socket service events from local to remote without auth', done => {
    // Jump to next user
    startId += 1
    socketClientServices[service2].once('created', user => {
      console.log(user)
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].create({ name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch update socket service events from local to remote without auth', done => {
    socketClientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue()
      done()
    })
    socketClientServices[gateway].update(startId, { name: 'Donald Dover' })
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch patch socket service events from local to remote without auth', done => {
    socketClientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue()
      done()
    })
    socketClientServices[gateway].patch(startId, { name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch remove socket service events from local to remote without auth', done => {
    socketClientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].remove(startId)
  })
    // Let enough time to process
    .timeout(10000)

  it('dynamically register a custom service', async () => {
    const customService = memory()
    // Ensure we can filter events and only send custom ones
    customService.events = ['custom']
    customService.distributedEvents = ['created', 'custom']
    apps[gateway].use('custom', customService)
    // Retrieve service with mixins
    customServices.push(apps[gateway].service('custom'))
    customServices.push(await waitForService(apps[service1], 'custom'))
    customServices.push(await waitForService(apps[service2], 'custom'))
    expect(customServices[gateway]).toExist()
    expect(customServices[service1]).toExist()
    expect(customServices[service2]).toExist()
    socketClientCustomServices.push(socketClients[gateway].service('custom'))
    socketClientCustomServices.push(socketClients[service1].service('custom'))
    socketClientCustomServices.push(socketClients[service2].service('custom'))
    expect(socketClientCustomServices[gateway]).toExist()
    expect(socketClientCustomServices[service1]).toExist()
    expect(socketClientCustomServices[service2]).toExist()
    // Wait before all cote components have been discovered
    await utils.promisify(setTimeout)(10000)
  })
    // Let enough time to process
    .timeout(60000)

  it('dispatch custom events and ignore the ones not configured for distribution', (done) => {
    let createdCount = 0
    let customCount = 0
    // Ensure we can filter events and only send custom ones
    customServices[service1].on('created', user => {
      expect(user.id === 0).beTrue()
      createdCount++
      if ((createdCount === 2) & (customCount === 2)) done()
    })
    customServices[service2].on('updated', user => {
      expect(false).beTrue()
    })
    customServices[service1].on('custom', data => {
      expect(data.payload === 'Donald Doe').beTrue()
      customCount++
      if ((createdCount === 2) & (customCount === 2)) done()
    })
    socketClientCustomServices[service1].on('created', user => {
      expect(user.id === 0).beTrue()
      createdCount++
      if ((createdCount === 2) & (customCount === 2)) done()
    })
    socketClientCustomServices[service2].on('updated', user => {
      expect(false).beTrue()
    })
    socketClientCustomServices[service1].on('custom', data => {
      expect(data.payload === 'Donald Doe').beTrue()
      customCount++
      if ((createdCount === 2) & (customCount === 2)) done()
    })
    utils.promisify(setTimeout)(5000) // Wait until publisher/subscribers are ready
      .then(_ => customServices[gateway].create({ name: 'Donald Doe' }))
      .then(_ => customServices[gateway].update(0, { name: 'Donald Dover' }))
      .then(_ => customServices[gateway].emit('custom', { payload: 'Donald Doe' }))
  })
    // Let enough time to process
    .timeout(20000)

  it('not found request should return 404 on local service', async () => {
    const url = 'http://localhost:' + (3030 + gateway) + '/xxx'
    try {
      await request.get(url)
    } catch (err) {
      // As external service call should use express handler
      expect(err.response.text.includes('NotFound')).beTrue()
      expect(err.status).to.equal(404)
    }
  })

  it('not found request should return 404 on remote service', async () => {
    const url = 'http://localhost:' + (3030 + service1) + '/xxx'
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
    const url = 'http://localhost:' + (3030 + gateway) + '/users'
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
    const url = 'http://localhost:' + (3030 + service1) + '/users'
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
    .timeout(10000)

  it('dispatch get rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch create rest service calls from remote to local with auth', async () => {
    // Jump to next user
    startId += 1
    const user = await restClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch update rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch patch rest service calls from remote to local with auth', async () => {
    const user = await restClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

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
    .timeout(10000)

  it('dispatch get socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].get(1)
    expect(user.id === 1).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch create socket service calls from remote to local with auth', async () => {
    // Jump to next user
    startId += 1
    const user = await socketClientServices[service1].create({ name: 'Donald Doe' })
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch update socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].update(startId, { name: 'Donald Dover' })
    expect(user.name === 'Donald Dover').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch patch socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].patch(startId, { name: 'Donald Doe' })
    expect(user.name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch remove socket service calls from remote to local with auth', async () => {
    const user = await socketClientServices[service1].remove(startId)
    expect(user.id === startId).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

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
    .timeout(10000)

  it('dispatch update socket service events from local to remote with auth', done => {
    socketClientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue()
      done()
    })
    socketClientServices[gateway].update(startId, { name: 'Donald Dover' })
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch patch socket service events from local to remote with auth', done => {
    socketClientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue()
      done()
    })
    socketClientServices[gateway].patch(startId, { name: 'Donald Doe' })
  })
    // Let enough time to process
    .timeout(10000)

  it('dispatch remove socket service events from local to remote with auth', done => {
    socketClientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue()
      done()
    })
    socketClientServices[gateway].remove(startId)
  })
    // Let enough time to process
    .timeout(10000)

  it('disable events publishing globally', () => {
    expect(apps[gateway].serviceEventsPublisher).toExist()
    expect(apps[service2].serviceEventsPublisher).toExist()
    expect(apps[noEvents].serviceEventsPublisher).beUndefined()
  })

  // Cleanup
  after(async () => {
    for (let i = 0; i < nbApps; i++) {
      await servers[i].close()
      finalize(apps[i])
      await sockets[i].close()
    }
    // log()
  })
})
