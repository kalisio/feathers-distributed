import { authenticate } from '@feathersjs/authentication'
import auth from '@feathersjs/authentication-client'
import restClient from '@feathersjs/rest-client'
import socketClient from '@feathersjs/socketio-client'
import express from '@feathersjs/express'
import feathers from '@feathersjs/feathers'
import request from 'superagent'
import utils from 'util'
import chai, { expect, util, assert } from 'chai'
import chailint from 'chai-lint'
import spies from 'chai-spies'
import * as commonHooks from 'feathers-hooks-common'
import { MemoryService } from '@feathersjs/memory'
import io from 'socket.io-client'
import { createApp, waitForService, waitForServiceRemoval, channels, clone } from './utils.js'
import plugin, { finalize } from '../lib/index.js'

class CustomMemoryService extends MemoryService {
  // Add custom method
  custom (data, params) { return data.name }
}

let startId = 6
const authUser = {
  name: 'Jane Doe',
  email: 'user@test.com',
  password: '$2a$12$97.pHfXj/1Eqn0..1V4ixOvAno7emZKTZgz.OYEHYqOOM2z.cftAu',
  id: 0
}
const store = {
  0: authUser,
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

/* Some explanation about the tests
4 apps are created, each app has a distribution key corresponding to its index:
- a gateway with a local 'users' service then a dynamically added local 'custom' service with an additional 'custom' event ('created'/'custom' events distributed)
- a first app without any local service but with the distributed gateway services
- a second app without any local service but with the distributed gateway services
- a third app with a local 'no-events' service with an additional 'custom' event (all events distributed) and with the distributed gateway services
The 'custom' service is exposed remotely on a new 'custom-name' name
*/

describe('feathers-distributed:main', () => {
  const apps = []
  const servers = []
  let customServices = []
  const appServices = []
  const restClients = []
  const restClientServices = []
  const restClientCustomServices = []
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
  const hookContext = { query: {  } }

  before(async () => {
    chailint(chai, util)
    chai.use(spies)
    beforeHook = chai.spy(beforeHook)
    afterHook = chai.spy(afterHook)
    serviceMiddleware = chai.spy(serviceMiddleware)
    appMiddleware = chai.spy(appMiddleware)
    const promises = []

    for (let i = 0; i < nbApps; i++) {
      apps.push(createApp(i, { authentication: (i === gateway ? ['jwt', 'local'] : ['jwt']) }))
      apps[i].configure(plugin({
        hooks: { before: { all: beforeHook }, after: { all: afterHook } },
        middlewares: { after: express.errorHandler() },
        // Distribute only the test services
        services: (service) => service.path.endsWith('users') ||
                  service.path.endsWith('custom') ||
                  service.path.endsWith('no-events'),
        remoteServicePath: (service) => (service.path.endsWith('custom') ? service.path.replace('custom', 'custom-name') : service.path),
        remoteServiceOptions: (service) => service.path.endsWith('users') ? ['startId'] : null, // Distribute a memory service option
        key: i.toString(),
        coteDelay: 5000,
        publicationDelay: 5000,
        publishEvents: (i !== noEvents),
        distributedEvents: ['created', 'updated', 'patched', 'removed', 'custom'],
        distributedMethods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'custom'],
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
        apps[gateway].use('users', serviceMiddleware, new CustomMemoryService({ store: clone(store), startId }))
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
                authenticate('jwt')
              )
            ]
          }
        })
        promises.push(Promise.resolve(userService))
      } else if (i === noEvents) {
        apps[noEvents].use('no-events', new CustomMemoryService(), { events: ['custom'] })
        promises.push(waitForService(apps[i], 'users'))
      } else {
        // For remote services we have to wait they are registered
        promises.push(waitForService(apps[i], 'users'))
      }
    }

    await Promise.all(promises)

    for (let i = 0; i < nbApps; i++) {
      // See https://github.com/kalisio/feathers-distributed/issues/3
      // Now all services are registered setup handlers
      apps[i].use(express.notFound())
      apps[i].use(express.errorHandler())
      servers.push(await apps[i].listen(3030 + i))
    }

    for (let i = 0; i < nbApps; i++) {
      appServices.push(apps[i].service('users'))
      expect(appServices[i]).toExist()

      const url = 'http://localhost:' + (3030 + i)
      const restTransporter = restClient(url).superagent(request)
      const rClient = feathers()
        .configure(restTransporter)
        .configure(auth())
      restClients.push(rClient)
      // Need to register service with custom methods
      rClient.registerCustomService = function (name, methods) {
        rClient.use(name, restTransporter.service(name), { methods })
        return rClient.service(name)
      }

      const socket = io(url)
      sockets.push(socket)
      const socketTransporter = socketClient(socket)
      const sClient = feathers()
        .configure(socketTransporter)
        .configure(auth())
      socketClients.push(sClient)
      // Need to register service with custom methods
      sClient.registerCustomService = function (name, methods, events) {
        sClient.use(name, socketTransporter.service(name), { methods, events })
        return sClient.service(name)
      }
    }

    // Wait before all cote components have been discovered
    await utils.promisify(setTimeout)(10000)
  })

  it('is ES module compatible', () => {
    expect(typeof finalize).to.equal('function')
    expect(typeof plugin).to.equal('function')
  })

  it('initiate the rest clients', () => {
    for (let i = 0; i < nbApps; i++) {
      expect(restClients[i]).toExist()
      restClientServices[i] = restClients[i].service('users')
      expect(restClientServices[i]).toExist()
    }
  })

  it('initiate the socket clients', () => {
    for (let i = 0; i < nbApps; i++) {
      expect(socketClients[i]).toExist()
      socketClientServices[i] = socketClients[i].service('users')
      expect(socketClientServices[i]).toExist()
    }
  })

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
    // Listing all gateway services should be the same
    url = 'http://localhost:' + (3030 + gateway) + '/distribution/healthcheck/0'
    response = await request.get(url)
    expect(response.body).to.deep.equal({ 'no-events': true })
    url = 'http://localhost:' + (3030 + gateway) + '/distribution/healthcheck'
    response = await request.get(url)
    expect(response.body).to.deep.equal({ 'no-events': true })
  })

  it('ensure middleware can been called on app', async () => {
    const url = 'http://localhost:' + (3030 + gateway) + '/middleware'
    await request.get(url)
    expect(appMiddleware).to.have.been.called()
  })

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
    // Let enough time to process
    .timeout(5000)

  it('ensure local service hooks have been called with the remote service flag', () => {
    expect(hookFromRemote).beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('ensure middleware can been called on local service', async () => {
    const url = 'http://localhost:' + (3030 + gateway) + '/users'
    await request.get(url)
    expect(serviceMiddleware).to.have.been.called()
  })
    // Let enough time to process
    .timeout(5000)

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
    let count = 0
    // Jump to next user
    startId += 1
    socketClientServices[service1].once('created', user => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service1].once('created', (user, context) => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('created')
      expect(context.method).to.equal('create')
      expect(context.data).to.deep.equal({ name: 'Donald Doe' })
      expect(context.result).to.deep.equal({ name: 'Donald Doe', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      count++
      if (count === 2) done()
    })
    hookContext.query.id = startId
    socketClientServices[gateway].create({ name: 'Donald Doe' }, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update socket service events from local to remote without auth', done => {
    let count = 0
    socketClientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service2].once('updated', (user, context) => {
      expect(user.name === 'Donald Dover').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('updated')
      expect(context.method).to.equal('update')
      expect(context.data).to.deep.equal({ name: 'Donald Dover' })
      expect(context.result).to.deep.equal({ name: 'Donald Dover', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      count++
      if (count === 2) done()
    })
    socketClientServices[gateway].update(startId, { name: 'Donald Dover' }, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch socket service events from local to remote without auth', done => {
    let count = 0
    socketClientServices[service1].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service1].once('patched', (user, context) => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('patched')
      expect(context.method).to.equal('patch')
      expect(context.data).to.deep.equal({ name: 'Donald Doe' })
      expect(context.result).to.deep.equal({ name: 'Donald Doe', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      count++
      if (count === 2) done()
    })
    socketClientServices[gateway].patch(startId, { name: 'Donald Doe' }, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove socket service events from local to remote without auth', done => {
    let count = 0
    socketClientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service2].once('removed', (user, context) => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('removed')
      expect(context.method).to.equal('remove')
      expect(context.data).beUndefined()
      expect(context.id).to.equal(startId)
      expect(context.result).to.deep.equal({ name: 'Donald Doe', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      count++
      if (count === 2) done()
    })
    socketClientServices[gateway].remove(startId, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dynamically register a custom service', async () => {
    const customService = new CustomMemoryService()
    const methods = ['create', 'update', 'custom']
    const events = ['custom']
    // Ensure we can filter events and only send custom ones
    apps[gateway].use('custom', customService, {
      events,
      methods,
      distributedEvents: ['created', 'custom'],
      distributedMethods: methods
    })
    // Retrieve service with
    customServices.push(Promise.resolve(apps[gateway].service('custom')))
    customServices.push(waitForService(apps[service1], 'custom-name'))
    customServices.push(waitForService(apps[service2], 'custom-name'))
    customServices = await Promise.all(customServices)
    expect(customServices[gateway]).toExist()
    expect(customServices[service1]).toExist()
    expect(customServices[service2]).toExist()
    expect(typeof customServices[gateway].custom).to.equal('function')
    expect(typeof customServices[service1].custom).to.equal('function')
    expect(typeof customServices[service2].custom).to.equal('function')
    // Need to register service with custom methods
    restClientCustomServices.push(restClients[gateway].registerCustomService('custom', methods))
    restClientCustomServices.push(restClients[service1].registerCustomService('custom-name', methods))
    restClientCustomServices.push(restClients[service2].registerCustomService('custom-name', methods))
    expect(restClientCustomServices[gateway]).toExist()
    expect(restClientCustomServices[service1]).toExist()
    expect(restClientCustomServices[service2]).toExist()
    expect(typeof restClientCustomServices[gateway].custom).to.equal('function')
    expect(typeof restClientCustomServices[service1].custom).to.equal('function')
    expect(typeof restClientCustomServices[service2].custom).to.equal('function')
    socketClientCustomServices.push(socketClients[gateway].registerCustomService('custom', methods, events))
    socketClientCustomServices.push(socketClients[service1].registerCustomService('custom-name', methods, events))
    socketClientCustomServices.push(socketClients[service2].registerCustomService('custom-name', methods, events))
    expect(socketClientCustomServices[gateway]).toExist()
    expect(socketClientCustomServices[service1]).toExist()
    expect(socketClientCustomServices[service2]).toExist()
    expect(typeof socketClientCustomServices[gateway].custom).to.equal('function')
    expect(typeof socketClientCustomServices[service1].custom).to.equal('function')
    expect(typeof socketClientCustomServices[service2].custom).to.equal('function')
    // Wait before all cote components have been discovered
    await utils.promisify(setTimeout)(20000)
  })
    // Let enough time to process
    .timeout(60000)

  it('dispatch custom service calls from remote to local', async () => {
    let name = await customServices[service1].custom({ name: 'Donald Doe' })
    expect(name === 'Donald Doe').beTrue()
    name = await customServices[service2].custom({ name: 'Donald Doe' })
    expect(name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch custom rest service calls from remote to local without auth', async () => {
    let name = await restClientCustomServices[service1].custom({ name: 'Donald Doe' })
    expect(name === 'Donald Doe').beTrue()
    name = await restClientCustomServices[service2].custom({ name: 'Donald Doe' })
    expect(name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch custom socket service calls from remote to local without auth', async () => {
    let name = await socketClientCustomServices[service1].custom({ name: 'Donald Doe' })
    expect(name === 'Donald Doe').beTrue()
    name = await socketClientCustomServices[service2].custom({ name: 'Donald Doe' })
    expect(name === 'Donald Doe').beTrue()
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch custom events and ignore the ones not configured for distribution', (done) => {
    let createdCount = 0
    const updatedCount = 0
    let customCount = 0
    const removeListeners = () => {
      customServices[service1].removeAllListeners('created')
      customServices[service2].removeAllListeners('updated')
      customServices[service1].removeAllListeners('custom')
      socketClientCustomServices[service1].removeAllListeners('created')
      socketClientCustomServices[service2].removeAllListeners('updated')
      socketClientCustomServices[service1].removeAllListeners('custom')
    }
    const checkIsDone = () => {
      if ((createdCount === 2) && (updatedCount === 0) && (customCount === 2)) {
        removeListeners()
        done()
      }
    }
    // Ensure we can filter events and only send custom ones
    customServices[service1].once('created', user => {
      expect(user.id === 0).beTrue()
      createdCount++
      checkIsDone()
    })
    customServices[service2].once('updated', user => {
      // Should not occur so cleanup
      removeListeners()
      expect(false).beTrue()
    })
    customServices[service1].once('custom', data => {
      expect(data.payload === 'Donald Doe').beTrue()
      customCount++
      checkIsDone()
    })
    socketClientCustomServices[service1].once('created', user => {
      expect(user.id === 0).beTrue()
      createdCount++
      checkIsDone()
    })
    socketClientCustomServices[service2].once('updated', user => {
      // Should not occur so cleanup
      removeListeners()
      expect(false).beTrue()
    })
    socketClientCustomServices[service1].once('custom', data => {
      expect(data.payload === 'Donald Doe').beTrue()
      customCount++
      checkIsDone()
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
    // Let enough time to process
    .timeout(5000)

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
    // Let enough time to process
    .timeout(5000)

  it('unauthenticated call should return 401 on local service with auth', async () => {
    checkAuthentication = true
    try {
      await socketClientServices[gateway].find({})
    } catch (err) {
      // As internal service call should not use express handler
      expect(err.code).to.equal(401)
    }
  })
    // Let enough time to process
    .timeout(5000)

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
    // Let enough time to process
    .timeout(5000)

  it('unauthenticated call should return 401 on remote service with auth', async () => {
    try {
      await socketClientServices[service1].find({})
    } catch (err) {
      // As internal service call should not use express handler
      expect(err.code).to.equal(401)
    }
  })
    // Let enough time to process
    .timeout(5000)

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
    // Let enough time to process
    .timeout(5000)

  it('authenticate rest client should return token', async () => {
    // Local auth on gateway
    let response = await restClients[gateway].authenticate({
      strategy: 'local',
      email: 'user@test.com',
      password: 'password'
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
    // JWT auth on service using JWT from gateway
    response = await restClients[service1].authenticate({
      strategy: 'jwt',
      accessToken
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
    // Let enough time to process
    .timeout(5000)

  it('authenticate socket client should return token', async () => {
    // Local auth on gateway
    let response = await socketClients[gateway].authenticate({
      strategy: 'local',
      email: 'user@test.com',
      password: 'password'
    })
    accessToken = response.accessToken
    expect(accessToken).toExist()
    // JWT auth on service using JWT from gateway
    response = await socketClients[service1].authenticate({
      strategy: 'jwt',
      accessToken
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
    // Let enough time to process
    .timeout(5000)

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
    let count = 0
    // Jump to next user
    startId += 1
    socketClientServices[service2].once('created', user => {
      expect(user.id === startId).beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service2].once('created', (user, context) => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('created')
      expect(context.method).to.equal('create')
      expect(context.data).to.deep.equal({ name: 'Donald Doe' })
      expect(context.result).to.deep.equal({ name: 'Donald Doe', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      expect(context.params.user).to.deep.equal(authUser)
      count++
      if (count === 2) done()
    })
    hookContext.query.id = startId
    socketClientServices[gateway].create({ name: 'Donald Doe' }, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch update socket service events from local to remote with auth', done => {
    let count = 0
    socketClientServices[service2].once('updated', user => {
      expect(user.name === 'Donald Dover').beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service2].once('updated', (user, context) => {
      expect(user.name === 'Donald Dover').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('updated')
      expect(context.method).to.equal('update')
      expect(context.data).to.deep.equal({ name: 'Donald Dover' })
      expect(context.result).to.deep.equal({ name: 'Donald Dover', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      expect(context.params.user).to.deep.equal(authUser)
      count++
      if (count === 2) done()
    })
    socketClientServices[gateway].update(startId, { name: 'Donald Dover' }, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch patch socket service events from local to remote with auth', done => {
    let count = 0
    socketClientServices[service2].once('patched', user => {
      expect(user.name === 'Donald Doe').beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service1].once('patched', (user, context) => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('patched')
      expect(context.method).to.equal('patch')
      expect(context.data).to.deep.equal({ name: 'Donald Doe' })
      expect(context.result).to.deep.equal({ name: 'Donald Doe', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      expect(context.params.user).to.deep.equal(authUser)
      count++
      if (count === 2) done()
    })
    socketClientServices[gateway].patch(startId, { name: 'Donald Doe' }, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('dispatch remove socket service events from local to remote with auth', done => {
    let count = 0
    socketClientServices[service2].once('removed', user => {
      expect(user.id === startId).beTrue()
      count++
      if (count === 2) done()
    })
    // Server side we should have hook context
    appServices[service2].once('removed', (user, context) => {
      expect(user.name === 'Donald Doe').beTrue()
      expect(user.id === startId).beTrue()
      expect(context).toExist()
      expect(context.type).to.equal('around')
      expect(context.event).to.equal('removed')
      expect(context.method).to.equal('remove')
      expect(context.data).beUndefined()
      expect(context.id).to.equal(startId)
      expect(context.result).to.deep.equal({ name: 'Donald Doe', id: startId })
      expect(context.params).toExist()
      expect(context.params.query).to.deep.equal(hookContext.query)
      expect(context.params.user).to.deep.equal(authUser)
      count++
      if (count === 2) done()
    })
    socketClientServices[gateway].remove(startId, hookContext)
  })
    // Let enough time to process
    .timeout(5000)

  it('disable events publishing globally', () => {
    expect(apps[gateway].serviceEventsPublisher).toExist()
    expect(apps[service2].serviceEventsPublisher).toExist()
    expect(apps[noEvents].serviceEventsPublisher).beUndefined()
  })

  it('dynamically unregister a custom service', async () => {
    apps[gateway].unuse('custom')
    // Check service removal
    try {
      apps[gateway].service('custom')
      assert.fail()
    } catch {}
    await Promise.all([
      waitForServiceRemoval(apps[service1], 'custom-name'),
      waitForServiceRemoval(apps[service2], 'custom-name')
    ])
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
