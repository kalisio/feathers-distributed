import { promisify } from 'util'
import { stripSlashes } from '@feathersjs/commons'
import errors from '@feathersjs/errors'
import feathers from '@feathersjs/feathers'
import makeCote from 'cote'
import { v4 as uuid } from 'uuid'
import makeDebug from 'debug'
import portfinder from 'portfinder'
import RemoteService from './service.js'

const { getServiceOptions } = feathers
const { NotFound, Unavailable, convert } = errors
const debug = makeDebug('feathers-distributed')
// Get the unique global symbol to store event listeners on a service object
const EVENT_LISTENER_KEY = Symbol.for('event-listener')
const DEFAULT_EVENTS = ['created', 'updated', 'patched', 'removed']
const DEFAULT_METHODS = ['find', 'get', 'create', 'update', 'patch', 'remove']

const isInternalService = (app, serviceDescriptor) => {
  // Default is to expose all services
  if (!app.distributionOptions.services) return false
  if (typeof app.distributionOptions.services === 'function') return !app.distributionOptions.services(serviceDescriptor)
  else return !app.distributionOptions.services.includes(serviceDescriptor.path)
}

const isDiscoveredService = (app, serviceDescriptor) => {
  // Default is to discover all services
  if (!app.distributionOptions.remoteServices) return true
  if (typeof app.distributionOptions.remoteServices === 'function') return app.distributionOptions.remoteServices(serviceDescriptor)
  else return app.distributionOptions.remoteServices.includes(serviceDescriptor.path)
}

const getService = (app, path) => {
  try {
    return app.service(path)
  } catch {
    // We return a false-y value in case the service wasn't found
    return null
  }
}

export function publishService (app, path) {
  // App not yet initialized, publishing will occur again once done
  if (!app.servicePublisher) return
  const service = app.service(path)
  if (!service || (typeof service !== 'object')) return
  if (service.remote) {
    debug('Ignoring remote service publication on path ' + path + ' for app with uuid ' +
          app.uuid + ' and key ' + app.distributionKey)
    return
  }
  const options = Object.assign(getServiceOptions(service), service.options)
  const serviceDescriptor = {
    uuid: app.uuid,
    key: app.distributionKey,
    path: stripSlashes(path),
    events: options.distributedEvents || options.events.concat(DEFAULT_EVENTS),
    methods: options.distributedMethods || options.methods // Default methods already included here unlike events
  }
  // Skip internal services
  if (isInternalService(app, serviceDescriptor)) {
    debug('Ignoring local service on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.uuid + ' and key ' + app.distributionKey)
    return
  }
  // Setup event listeners whenever required and if not already done
  if (app.distributionOptions.publishEvents && serviceDescriptor.events.length && !service[EVENT_LISTENER_KEY]) {
    serviceDescriptor.events.forEach(event => {
      // Publish events whenever required
      service.on(event, object => {
        debug(`Publishing ${event} local service event on path ` + serviceDescriptor.path +
              ' for app with uuid ' + app.uuid + ' and key ' + app.distributionKey, object)
        app.serviceEventsPublisher.publish(event, Object.assign({
          path: serviceDescriptor.path, key: app.distributionKey
        }, object))
      })
      // Tag service so that we will not install listeners twice
      service[EVENT_LISTENER_KEY] = true
    })
    debug('Publish callbacks registered for local service events on path ' + serviceDescriptor.path +
          ' for app with uuid ' + app.uuid + ' and key ' + app.distributionKey, serviceDescriptor.events)
  }
  // Publish new local service
  app.servicePublisher.publish('service', serviceDescriptor)
  debug('Published local service on path ' + serviceDescriptor.path + ' for app with uuid ' +
        app.uuid + ' and key ' + app.distributionKey, serviceDescriptor)
}

export function publishServices (app) {
  // Add a timeout so that the publisher/subscriber has been initialized on the node
  if (app.applicationPublicationTimeout) return
  app.applicationPublicationTimeout = setTimeout(_ => {
    Object.getOwnPropertyNames(app.services).forEach(path => {
      publishService(app, path)
    })
    // Reset timeout so that next queued publication will be scheduled
    app.applicationPublicationTimeout = null
  }, app.distributionOptions.publicationDelay)
  debug('Scheduled local services publishing for app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
}

export async function registerApplication (app, applicationDescriptor) {
  // Create the request/events manager for remote services only
  if (applicationDescriptor.uuid === app.uuid) {
    debug('Ignoring service requester/events publisher creation for local app with uuid ' + app.uuid)
    return
  }

  const key = applicationDescriptor.key
  // Already registered
  if (app.serviceRequesters[key]) {
    debug('Ignoring already registered remote app with uuid ' + app.uuid + ' and key ' + key)
    return
  }
  debug('Registering remote app with uuid ' + app.uuid + ' and key ' + key)
  // Create the request manager to remote services
  app.serviceRequesters[key] = new app.cote.Requester({
    name: 'feathers services requester',
    namespace: key,
    key,
    requests: ['find', 'get', 'create', 'update', 'patch', 'remove', 'healthcheck'],
    timeout: app.distributionOptions.timeout || 20000
  }, app.coteOptions)
  debug('Service requester ready for remote app with uuid ' + applicationDescriptor.uuid + ' and key ' + key +
        ' for app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
  // Wait before instanciating new component to avoid too much concurrency on port allocation
  await promisify(setTimeout)(app.distributionOptions.componentDelay)
  // Subscriber to listen to events from other nodes
  const events = app.distributionOptions.distributedEvents || DEFAULT_EVENTS
  app.serviceEventsSubscribers[key] = new app.cote.Subscriber({
    name: 'feathers services events subscriber',
    namespace: key,
    key,
    subscribesTo: events
  }, app.coteOptions)
  events.forEach(event => {
    app.serviceEventsSubscribers[key].on(event, object => {
      debug(`Dispatching ${event} remote service event on path ` + object.path, object)
      const service = getService(app, object.path)
      // Ensure we don't have any local service with the same name to avoid infinite looping
      if (service && service.remote) service.emit(event, object)
    })
  })
  debug('Service events subscriber ready for remote app with uuid ' + applicationDescriptor.uuid + ' and key ' + key +
        ' for app with uuid ' + app.uuid + ' and key ' + app.distributionKey)
}

export function registerService (app, serviceDescriptor) {
  // Do not register our own services
  if (serviceDescriptor.uuid === app.uuid) {
    debug('Ignoring local service registration on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.uuid + ' and key ' + app.distributionKey)
    return
  }
  const service = getService(app, serviceDescriptor.path)

  if (service) {
    if (service instanceof RemoteService) {
      debug('Already registered service as remote on path ' + serviceDescriptor.path + ' for app with uuid ' +
            app.uuid + ' and key ' + app.distributionKey)
    } else {
      debug('Already registered local service on path ' + serviceDescriptor.path + ' for app with uuid ' +
            app.uuid + ' and key ' + app.distributionKey)
    }
    return
  }
  // Skip services we are not interested into
  if (!isDiscoveredService(app, serviceDescriptor)) {
    debug('Ignoring remote service on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.uuid + ' and key ' + app.distributionKey)
    return
  }
  // Initialize our service by providing any required middleware
  let args = [serviceDescriptor.path]
  if (app.distributionOptions.middlewares.before) args = args.concat(app.distributionOptions.middlewares.before)
  args.push(new RemoteService(app, serviceDescriptor), serviceDescriptor)
  if (app.distributionOptions.middlewares.after) args = args.concat(app.distributionOptions.middlewares.after)
  app.use(...args)
  debug('Registered remote service on path ' + serviceDescriptor.path + ' for app with uuid ' +
        app.uuid + ' and key ' + app.distributionKey, serviceDescriptor)

  // registering hook object on every remote service
  if (app.distributionOptions.hooks) {
    app.service(serviceDescriptor.path).hooks(app.distributionOptions.hooks)
  }
  debug('Registered hooks on remote service on path ' + serviceDescriptor.path + ' for app with uuid ' +
        app.uuid + ' and key ' + app.distributionKey)

  // Dispatch an event internally through node so that async processes can run
  app.emit('service', serviceDescriptor)
}

export async function initialize (app) {
  debug('Initializing cote with options', app.coteOptions)
  // Setup cote with options
  app.cote = makeCote(app.coteOptions)
  app.distributionKey = app.distributionOptions.key || 'default'

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
  // Each time a new app pops up we republish local services so that
  // service distribution does not depend on the initialization order of the apps
  app.servicePublisher.on('cote:added', (data) => { publishServices(app) })
  // FIXME: we should manage apps going offline
  app.servicePublisher.on('cote:removed', (data) => { })

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
    if (!DEFAULT_METHODS.includes(method)) app.serviceResponder.on(method, async (req) => {
      const service = app.service(req.path)
      debug(`Responding ${method}() local service on path ` + req.path + ' with key ' + req.key, req)
      const result = await service[method](req.data, Object.assign({ fromRemote: true }, req.params))
      debug(`Successfully ${method}() local service on path ` + req.path + ' with key ' + req.key)
      return result
    })
  })
  // Placeholder for request/events managers for remote services
  app.serviceRequesters = {}
  app.serviceEventsSubscribers = {}

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

  // Tell others apps I'm here
  publishServices(app)
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
    const healthcheckRoute = (options.healthcheckPath || '/distribution/healthcheck/') + ':key?'
    debug('Initializing feathers-distributed healthcheck route', healthcheckRoute)
    app.use(healthcheckRoute, async (req, res, next) => {
      res.set('Content-Type', 'application/json')
      const key = req.params.key || 'default'
      // Not yet registered
      if (!app.serviceRequesters[key]) {
        const error = new NotFound(`No app registered with key ${key}`)
        res.status(error.code)
        res.json(Object.assign({}, error.toJSON()))
        return
      }
      // List all available services
      let services = Object.getOwnPropertyNames(app.services)
      // Filter non-remote ones
      services = services.filter(path => {
        const service = getService(app, path)
        return (service && service.remote && (service.key === key))
      })

      let status = 200
      let response = {}
      let errors = []
      // Perform all operations in // so that it will speed-up in case of eg timeouts
      await Promise.all(services.map(async path => {
        const service = getService(app, path)
        try {
          await service.healthcheck()
          // For more detail we store the list of failed/successful services
          Object.assign(response, { [service.path]: true })
        } catch (error) {
          errors.push(error)
          status = 503
          // For more detail we store the list of failed/successful services
          Object.assign(response, { [service.path]: false })
        }
      }))

      if (errors.length > 0) {
        Object.assign(response, {
          errors: errors.map(error => typeof error.toJSON === 'function' ? error.toJSON() : { message: error.message })
        })
      }
      res.status(status)
      res.json(response)
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
