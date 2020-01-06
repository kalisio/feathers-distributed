import { stripSlashes } from '@feathersjs/commons'
import makeCote from 'cote'
import uuid from 'uuid/v4'
import makeDebug from 'debug'
import portfinder from 'portfinder'
import { LocalService, RemoteService } from './service'

const debug = makeDebug('feathers-distributed')

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

function publishApplication (app) {
  app.servicePublisher.publish('application', { uuid: app.uuid })
  debug('Published local app with uuid ' + app.uuid)
}

function publishService (app, path) {
  const service = app.service(path)
  if (!service || (typeof service !== 'object')) return
  if (service.remote) {
    debug('Ignoring remote service publication on path ' + path + ' for app with uuid ' + app.uuid)
    return
  }
  const serviceDescriptor = {
    uuid: app.uuid,
    path: stripSlashes(path),
    events: service.distributedEvents || service._serviceEvents
  }
  // Skip internal services
  if (isInternalService(app, serviceDescriptor)) {
    debug('Ignoring local service on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)
    return
  }
  // Register the responder to handle remote calls to the service
  if (!service.responder) service.responder = new LocalService(Object.assign({ app }, serviceDescriptor))
  // Publish new local service
  app.servicePublisher.publish('service', serviceDescriptor)
  debug('Published local service on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)
}

function registerService (app, serviceDescriptor) {
  // Do not register our own services
  if (serviceDescriptor.uuid === app.uuid) {
    debug('Ignoring local service registration on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)
    return
  }
  // Skip already registered services
  const service = app.service(serviceDescriptor.path)
  if (service) {
    if (service instanceof RemoteService) {
      debug('Already registered service as remote on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)
    } else {
      debug('Already registered local service on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)
    }
    return
  }
  // Skip services we are not interested into
  if (!isDiscoveredService(app, serviceDescriptor)) {
    debug('Ignoring remote service on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)
    return
  }
  // Initialize our service by providing any required middleware
  let args = [serviceDescriptor.path]
  if (app.distributionOptions.middlewares.before) args = args.concat(app.distributionOptions.middlewares.before)
  args.push(new RemoteService(serviceDescriptor))
  if (app.distributionOptions.middlewares.after) args = args.concat(app.distributionOptions.middlewares.after)
  app.use(...args)
  debug('Registered remote service on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)

  // registering hook object on every remote service
  if (app.distributionOptions.hooks) {
    app.service(serviceDescriptor.path).hooks(app.distributionOptions.hooks)
  }
  debug('Registered hooks on remote service on path ' + serviceDescriptor.path + ' for app with uuid ' + app.uuid)

  // Dispatch an event internally through node so that async processes can run
  app.emit('service', serviceDescriptor)
}

function initializeCote (app) {
  debug('Initializing cote with options', app.coteOptions)
  // Setup cote with options
  app.cote = makeCote(app.coteOptions)

  // This subscriber listen to an event each time a remote app service has been registered
  app.serviceSubscriber = new app.cote.Subscriber({
    name: 'feathers services subscriber',
    namespace: 'services',
    key: 'services',
    subscribesTo: ['application', 'service']
  }, app.coteOptions)
  debug('Services subscriber ready for app with uuid ' + app.uuid)
  // When a remote service is declared create the local proxy interface to it
  app.serviceSubscriber.on('service', serviceDescriptor => {
    registerService(app, serviceDescriptor)
  })
  // This publisher publishes an event each time a local app or service is registered
  app.servicePublisher = new app.cote.Publisher({
    name: 'feathers services publisher',
    namespace: 'services',
    key: 'services',
    broadcasts: ['application', 'service']
  }, app.coteOptions)
  debug('Services publisher ready for app with uuid ' + app.uuid)
  // Also each time a new app pops up so that it does not depend of the initialization order of the apps
  app.serviceSubscriber.on('application', applicationDescriptor => {
    Object.getOwnPropertyNames(app.services).forEach(path => {
      publishService(app, path)
    })
  })
  // Tell others apps I'm here
  // Add a timeout so that the publisher/subscriber has been initialized on the node
  setTimeout(_ => { publishApplication(app) }, app.distributionOptions.publicationDelay)
}

export default function init (options = {}) {
  return function () {
    const app = this
    app.coteOptions = Object.assign({
      helloInterval: 10000,
      checkInterval: 20000,
      nodeTimeout: 30000,
      masterTimeout: 60000,
      log: false,
      basePort: process.env.BASE_PORT || 10000
    }, options.cote)
    app.distributionOptions = Object.assign({
      publicationDelay: process.env.PUBLICATION_DELAY || 10000,
      coteDelay: process.env.COTE_DELAY,
      middlewares: {},
      publishEvents: true
    }, options)

    debug('Initializing feathers-distributed with options', app.distributionOptions)
    // Change default base port for automated port finding
    portfinder.basePort = app.coteOptions.basePort
    // We need to uniquely identify the app to avoid infinite loop by registering our own services
    app.uuid = uuid()
    // Setup cote with options and required delay
    if (app.distributionOptions.coteDelay) setTimeout(_ => { initializeCote(app) }, app.distributionOptions.coteDelay)
    else initializeCote(app)

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

init.RemoteService = RemoteService
init.LocalService = LocalService
