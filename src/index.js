import { stripSlashes } from '@feathersjs/commons'
import makeCote from 'cote'
import uuid from 'uuid/v4'
import makeDebug from 'debug'
import portfinder from 'portfinder'
import { LocalService, RemoteService } from './service'

const debug = makeDebug('feathers-distributed')

export default function init (options) {
  return function () {
    const distributionOptions = Object.assign(
      {
        helloInterval: 10000,
        checkInterval: 20000,
        nodeTimeout: 30000,
        masterTimeout: 60000,
        publicationDelay: 5000,
        middlewares: {}
      },
      options
    )
    const isInternalService = service => {
      // Default is to expose all services
      if (!distributionOptions.services) return false
      if (typeof distributionOptions.services === 'function') return !distributionOptions.services(service)
      else return !distributionOptions.services.includes(service.path)
    }
    const isDiscoveredService = service => {
      // Default is to discover all services
      if (!distributionOptions.remoteServices) return true
      if (typeof distributionOptions.remoteServices === 'function') return distributionOptions.remoteServices(service)
      else return distributionOptions.remoteServices.includes(service.path)
    }
    const app = this
    // Because options are forwarded and assigned to defaults options of services allocate an empty object if nothing is provided
    app.coteOptions = distributionOptions.cote || {}
    // Change default base port for automated port finding
    portfinder.basePort = app.coteOptions.basePort || 10000
    app.cote = (distributionOptions.cote ? makeCote(distributionOptions.cote) : makeCote())
    // We need to uniquely identify the app to avoid infinite loop by registering our own services
    app.uuid = uuid()
    debug('Initializing feathers-distributed')

    // This publisher publishes an event each time a local app service is registered
    app.servicePublisher = new app.cote.Publisher(
      {
        name: 'feathers services publisher',
        namespace: 'services',
        broadcasts: ['service']
      },
      Object.assign({ log: false }, app.coteOptions)
    )
    // Also each time a new node pops up so that it does not depend of the initialization order of the apps
    app.servicePublisher.on('cote:added', data => {
      // console.log(data)
      // Add a timeout so that the subscriber has been initialized on the node
      setTimeout(_ => {
        Object.getOwnPropertyNames(app.services).forEach(path => {
          const service = app.services[path]
          if (service.remote) return
          const serviceDescriptor = { uuid: app.uuid, path }
          // Skip internal services
          if (isInternalService(serviceDescriptor)) {
            debug('Ignoring local service on path ' + serviceDescriptor.path)
            return
          }
          app.servicePublisher.publish('service', { uuid: app.uuid, path })
          debug('Republished local service on path ' + path)
        })
      }, distributionOptions.publicationDelay)
    })
    // This subscriber listen to an event each time a remote app service has been registered
    app.serviceSubscriber = new app.cote.Subscriber(
      {
        name: 'feathers services subscriber',
        namespace: 'services',
        subscribesTo: ['service']
      },
      Object.assign({ log: false }, app.coteOptions)
    )
    // When a remote service is declared create the local proxy interface to it
    app.serviceSubscriber.on('service', serviceDescriptor => {
      // Do not register our own services
      if (serviceDescriptor.uuid === app.uuid) return
      // Skip already registered services
      const service = app.service(serviceDescriptor.path)
      if (service) {
        if (service instanceof RemoteService) {
          debug('Already registered service as remote on path ' + serviceDescriptor.path)
        } else {
          debug('Already registered local service on path ' + serviceDescriptor.path)
        }
        return
      }
      // Skip services we are not interested into
      if (!isDiscoveredService(serviceDescriptor)) {
        debug('Ignoring remote service on path ' + serviceDescriptor.path)
        return
      }
      // Initialize our service by providing any required middleware
      let args = [serviceDescriptor.path]
      if (distributionOptions.middlewares.before) args = args.concat(distributionOptions.middlewares.before)
      args.push(new RemoteService(serviceDescriptor))
      if (distributionOptions.middlewares.after) args = args.concat(distributionOptions.middlewares.after)
      app.use(...args)
      debug('Registered remote service on path ' + serviceDescriptor.path)

      // registering hook object on every remote service
      if (distributionOptions.hooks) {
        app.service(serviceDescriptor.path).hooks(distributionOptions.hooks)
      }
      debug('Registered hooks on remote service on path ' + serviceDescriptor.path)

      // dispatch an event internally through node so that async processes can run
      app.emit('service', serviceDescriptor)
    })

    // We replace the use method to inject service publisher/responder
    const superUse = app.use
    app.use = function () {
      const path = arguments[0]
      // Register the service normally first
      superUse.apply(app, arguments)
      // With express apps we can directly register middlewares
      if (typeof path !== 'string') return
      const service = app.service(path)
      // Note: middlewares are not supported
      // Also avoid infinite loop by registering already registered remote services
      if (typeof service === 'object' && !service.remote) {
        const serviceDescriptor = { uuid: app.uuid, path: stripSlashes(path) }
        // Skip internal services
        if (isInternalService(serviceDescriptor)) {
          debug('Ignoring local service on path ' + serviceDescriptor.path)
          return
        }
        // Publish new local service
        app.servicePublisher.publish('service', serviceDescriptor)
        debug('Published local service on path ' + path)
        // Register the responder to handle remote calls to the service
        service.responder = new LocalService({ app, path: serviceDescriptor.path })
      }
    }
  }
}

init.RemoteService = RemoteService
init.LocalService = LocalService
