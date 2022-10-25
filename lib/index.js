import { promisify } from 'util'
import errors from '@feathersjs/errors'
import makeCote from 'cote'
import { v4 as uuid } from 'uuid'
import makeDebug from 'debug'
import portfinder from 'portfinder'
import { DEFAULT_METHODS, DEFAULT_EVENTS, healthcheck, isExpressApp } from './utils.js'
import { publishService, publishServices } from './publish.js'
import { registerService, registerApplication } from './register.js'

const { NotFound, Unavailable } = errors
const debug = makeDebug('feathers-distributed')

export async function initialize (app) {
  debug('Initializing cote with options', app.coteOptions)
  // Setup cote with options
  app.cote = makeCote(app.coteOptions)
  app.distributionKey = app.distributionOptions.key || 'default'
  // Placeholder for request/events managers for remote services
  app.serviceRequesters = {}
  app.serviceEventsSubscribers = {}

  // This subscriber listen to an event each time a remote app service has been registered
  app.serviceSubscriber = new app.cote.Subscriber({
    name: 'feathers services subscriber',
    namespace: 'services',
    key: 'services',
    subscribesTo: ['service']
  }, app.coteOptions)
  debug('Services subscriber ready for app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
  // When a remote service is declared create the local proxy interface to it
  app.serviceSubscriber.on('service', async serviceDescriptor => {
    // When a new app pops up create the required proxy to it first
    await registerApplication(app, serviceDescriptor)
    registerService(app, serviceDescriptor)
  })

  // Wait before instanciating new component to avoid too much concurrency on port allocation
  await promisify(setTimeout)(app.distributionOptions.componentDelay)
  // This publisher publishes an event each time a local app or service is registered
  app.servicePublisher = new app.cote.Publisher({
    name: 'feathers services publisher',
    namespace: 'services',
    key: 'services',
    broadcasts: ['service']
  }, app.coteOptions)
  debug('Services publisher ready for app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
  // Dispatcher of service events to other nodes) {
  if (app.distributionOptions.publishEvents) {
    // Wait before instanciating new component to avoid too much concurrency on port allocation
    await promisify(setTimeout)(app.distributionOptions.componentDelay)
    app.serviceEventsPublisher = new app.cote.Publisher({
      name: 'feathers service events publisher',
      namespace: app.distributionKey,
      key: app.distributionKey,
      broadcasts: app.distributionOptions.distributedEvents || DEFAULT_EVENTS
    }, app.coteOptions)
    debug('Service events publisher ready for local app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
  }
  // Wait before instanciating new component to avoid too much concurrency on port allocation
  await promisify(setTimeout)(app.distributionOptions.componentDelay)
  // Create the response manager for local services
  const methods = app.distributionOptions.distributedMethods || DEFAULT_METHODS
  app.serviceResponder = new app.cote.Responder({
    name: 'feathers services responder',
    namespace: app.distributionKey,
    key: app.distributionKey,
    requests: methods.concat(['healthcheck'])
  }, app.coteOptions)
  debug('Service responder ready for local app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
  debug('Registering listeners for ', methods.concat(['healthcheck']))
  // Answer requests from other nodes
  if (methods.includes('find')) {
    app.serviceResponder.on('find', async (req) => {
      const service = app.service(req.path)
      debug('Responding find() local service on path ' + req.path + ' with key ' + req.key, req)
      const result = await service.find(Object.assign({ fromRemote: true }, req.params))
      debug('Successfully find() local service on path ' + req.path + ' with key ' + req.key)
      return result
    })
  }
  if (methods.includes('get')) {
    app.serviceResponder.on('get', async (req) => {
      const service = app.service(req.path)
      debug('Responding get() local service on path ' + req.path + ' with key ' + req.key, req)
      const result = await service.get(req.id, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully get() local service on path ' + req.path + ' with key ' + req.key)
      return result
    })
  }
  if (methods.includes('create')) {
    app.serviceResponder.on('create', async (req) => {
      const service = app.service(req.path)
      debug('Responding create() local service on path ' + req.path + ' with key ' + req.key, req)
      const result = await service.create(req.data, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully create() local service on path ' + req.path + ' with key ' + req.key)
      return result
    })
  }
  if (methods.includes('update')) {
    app.serviceResponder.on('update', async (req) => {
      const service = app.service(req.path)
      debug('Responding update() local service on path ' + req.path + ' with key ' + req.key, req)
      const result = await service.update(req.id, req.data, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully update() local service on path ' + req.path + ' with key ' + req.key)
      return result
    })
  }
  if (methods.includes('patch')) {
    app.serviceResponder.on('patch', async (req) => {
      const service = app.service(req.path)
      debug('Responding patch() local service on path ' + req.path + ' with key ' + req.key, req)
      const result = await service.patch(req.id, req.data, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully patch() local service on path ' + req.path + ' with key ' + req.key)
      return result
    })
  }
  if (methods.includes('remove')) {
    app.serviceResponder.on('remove', async (req) => {
      const service = app.service(req.path)
      debug('Responding remove() local service on path ' + req.path + ' with key ' + req.key, req)
      const result = await service.remove(req.id, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully remove() local service on path ' + req.path + ' with key ' + req.key)
      return result
    })
  }
  // Healthcheck is always used
  app.serviceResponder.on('healthcheck', async (req) => {
    debug('Responding healthcheck() local service on path ' + req.path + ' with key ' + req.key, req)
    const service = app.service(req.path)
    if (!service) throw new Unavailable('Unavailable distributed service on path ' + req.path + ' with key ' + req.key)
    debug('Successfully healthcheck() local service on path ' + req.path + ' with key ' + req.key)
    return true
  })
  // Process custom methods
  methods.forEach(method => {
    if (!DEFAULT_METHODS.includes(method)) {
      app.serviceResponder.on(method, async (req) => {
        const service = app.service(req.path)
        debug(`Responding ${method}() local service on path ` + req.path + ' with key ' + req.key, req)
        const result = await service[method](req.data, Object.assign({ fromRemote: true }, req.params))
        debug(`Successfully ${method}() local service on path ` + req.path + ' with key ' + req.key)
        return result
      })
    }
  })

  // Each time a new app pops up we republish local services so that
  // service distribution does not depend on the initialization order of the apps
  app.servicePublisher.on('cote:added', (data) => { publishServices(app) })
  // FIXME: we should manage apps going offline
  app.servicePublisher.on('cote:removed', (data) => { })

  // Tell others apps I'm here
  publishServices(app)

  // Add an interval so that we regularly publish services to others nodes
  if (app.distributionOptions.heartbeatInterval > 0) {
    app.heartbeatInterval = setInterval(_ => {
      Object.getOwnPropertyNames(app.services).forEach(path => {
        publishService(app, path)
      })
    }, app.distributionOptions.heartbeatInterval)
    debug('Scheduled heartbeat local services publishing for app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
  }
}

export function finalize (app) {
  debug('Finalizing cote')
  if (app.serviceRequesters) {
    Object.getOwnPropertyNames(app.serviceRequesters).forEach(key => {
      debug(`Finalizing service requester for remote app with key ${key}`)
      app.serviceRequesters[key].close()
    })
    delete app.serviceRequesters
  }
  if (app.serviceEventsSubscribers) {
    Object.getOwnPropertyNames(app.serviceEventsSubscribers).forEach(key => {
      debug(`Finalizing service event subscriber for remote app with key ${key}`)
      app.serviceEventsSubscribers[key].close()
    })
    delete app.serviceEventsSubscribers
  }
  if (app.serviceSubscriber) {
    debug(`Finalizing service subscriber for local app with key ${app.distributionKey}`)
    app.serviceSubscriber.close()
    delete app.serviceSubscriber
  }
  if (app.servicePublisher) {
    debug(`Finalizing service publisher for local app with key ${app.distributionKey}`)
    app.servicePublisher.close()
    delete app.servicePublisher
  }
  if (app.serviceResponder) {
    debug(`Finalizing service responder for local app with key ${app.distributionKey}`)
    app.serviceResponder.close()
    delete app.serviceResponder
  }
  if (app.applicationPublicationTimeout) clearTimeout(app.applicationPublicationTimeout)
  if (app.coteInitializationTimeout) clearTimeout(app.coteInitializationTimeout)
  if (app.heartbeatInterval) clearInterval(app.heartbeatInterval)
}

export default function init (options = {}) {
  return function (app) {
    // We need to uniquely identify the app to avoid infinite loop by registering our own services
    // This uuid is also used a partition key in cote unless provided
    app.uuid = uuid()
    app.coteOptions = Object.assign({
      helloInterval: 10000,
      checkInterval: 20000,
      nodeTimeout: 30000,
      masterTimeout: 60000,
      log: (!!process.env.COTE_LOG),
      basePort: (process.env.BASE_PORT ? Number(process.env.BASE_PORT) : 10000),
      highestPort: (process.env.HIGHEST_PORT ? Number(process.env.HIGHEST_PORT) : 20000)
    }, options.cote)
    app.distributionOptions = Object.assign({
      publicationDelay: (process.env.PUBLICATION_DELAY ? Number(process.env.PUBLICATION_DELAY) : 10000),
      componentDelay: (process.env.COMPONENT_DELAY ? Number(process.env.COMPONENT_DELAY) : 1000),
      coteDelay: (process.env.COTE_DELAY ? Number(process.env.COTE_DELAY) : undefined),
      heartbeatInterval: (process.env.HEARTBEAT_INTERVAL ? Number(process.env.HEARTBEAT_INTERVAL) : undefined),
      middlewares: {},
      publishEvents: true,
      distributedEvents: DEFAULT_EVENTS,
      distributedMethods: DEFAULT_METHODS
    }, options)

    debug('Initializing feathers-distributed with options', app.distributionOptions)
    // Change default base/highest port for automated port finding
    portfinder.basePort = app.coteOptions.basePort
    portfinder.highestPort = app.coteOptions.highestPort

    // Setup cote with options and required delay
    if (app.distributionOptions.coteDelay) {
      // -1 means the caller wants to initialize byitself
      if (app.distributionOptions.coteDelay > 0) {
        app.coteInitializationTimeout = setTimeout(_ => { initialize(app) }, app.distributionOptions.coteDelay)
      }
    } else {
      initialize(app)
    }

    // Healthcheck endpoint(s)
    const healthcheckRoute = (options.healthcheckPath || '/distribution/healthcheck/') + ':key'
    debug('Initializing feathers-distributed healthcheck route', healthcheckRoute)
    app.use(healthcheckRoute, {
      async find (params) {
        const key = params.route.key || 'default'
        // Not yet registered
        if (!app.serviceRequesters[key]) {
          throw new NotFound(`No app registered with key ${key}`)
        }

        return healthcheck(app, key)
      }
    })

    // We replace the use method to inject service publisher/responder
    const superUse = app.use
    app.use = function () {
      const path = arguments[0]
      // Register the service normally first
      const superReturn = superUse.apply(app, arguments)
      // Check if cote has already been initialized
      if (!app.cote) return superReturn
      // With express apps we can directly register middlewares: not supported
      if (typeof path !== 'string') return superReturn
      publishService(app, path)
      return superReturn
    }
  }
}
