import { stripSlashes, _ } from '@feathersjs/commons'
import feathers from '@feathersjs/feathers'
import makeDebug from 'debug'
import { DEFAULT_EVENTS, getService, isInternalService, getDistributedServiceOptions } from './utils.js'

const { getServiceOptions } = feathers
const debug = makeDebug('feathers-distributed:publish')
const debugIgnore = makeDebug('feathers-distributed:ignore')
// Get the unique global symbol to store event listeners on a service object
const EVENT_LISTENERS_KEY = Symbol.for('event-listeners')

export function publishService (app, path) {
  // App not yet initialized, publishing will occur again once done
  if (!app.servicePublisher) return
  const service = getService(app, path)
  if (!service || (typeof service !== 'object')) return
  if (service.remote) {
    debugIgnore('Ignoring remote service publication on path ' + path + ' for app with uuid ' +
          app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  const options = Object.assign(getServiceOptions(service), service.options)
  const serviceDescriptor = {
    uuid: app.uuid,
    shortUuid: app.shortUuid,
    key: app.distributionKey,
    path: stripSlashes(path),
    events: options.distributedEvents || options.events.concat(DEFAULT_EVENTS),
    methods: options.distributedMethods || options.methods // Default methods already included here unlike events
  }
  // Skip internal services
  if (isInternalService(app, serviceDescriptor)) {
    debugIgnore('Ignoring local service publication on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  // Add distributed service options if any
  const distributedOptions = getDistributedServiceOptions(app, serviceDescriptor)
  if (distributedOptions) {
    const remoteOptions = {}
    distributedOptions.forEach(distributedOption => {
      remoteOptions[distributedOption] = options[distributedOption]
    })
    serviceDescriptor.remoteOptions = remoteOptions
  }
  // Setup event listeners whenever required and if not already done
  if (app.distributionOptions.publishEvents && serviceDescriptor.events.length && !service[EVENT_LISTENERS_KEY]) {
    // Tag service so that we will not install listeners twice
    service[EVENT_LISTENERS_KEY] = {}
    serviceDescriptor.events.forEach(event => {
      service[EVENT_LISTENERS_KEY][event] = (object, context) => {
        if (app.serviceEventsPublisher) {
          let serializedContext = (context && (typeof context.toJSON === 'function') ? context.toJSON() : context)
          serializedContext = (serializedContext ? _.omit(serializedContext, 'app', 'service', 'self') : serializedContext)
          debug(`Publishing ${event} local service event on path ` + serviceDescriptor.path +
                ' for app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey, object, serializedContext)
          // Add hook context in event payload as cotejs does not allow it as a second argument in event emit
          app.serviceEventsPublisher.publish(event, Object.assign({
            path: serviceDescriptor.path, key: app.distributionKey, context: serializedContext
          }, object))
        }
      }
      // Publish events whenever required
      service.on(event, service[EVENT_LISTENERS_KEY][event])
    })
    debug('Publish callbacks registered for local service events on path ' + serviceDescriptor.path +
          ' for app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey, serviceDescriptor.events)
  }
  // Publish new local service
  app.servicePublisher.publish('service', serviceDescriptor)
  debug('Published local service on path ' + serviceDescriptor.path + ' for app with uuid ' +
        app.shortUuid + ' and key ' + app.distributionKey, serviceDescriptor)
}

export function unpublishService (app, path) {
  // App not yet initialized, publishing will occur again once done
  if (!app.servicePublisher) return
  const service = getService(app, path)
  if (!service || (typeof service !== 'object')) return

  const options = Object.assign(getServiceOptions(service), service.options)
  const serviceDescriptor = {
    uuid: app.uuid,
    shortUuid: app.shortUuid,
    key: app.distributionKey,
    path: stripSlashes(path),
    events: options.distributedEvents || options.events.concat(DEFAULT_EVENTS)
  }
  // Skip internal services
  if (isInternalService(app, serviceDescriptor)) {
    debugIgnore('Ignoring local service unpublication on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  // Remove event listeners whenever required and if not already done
  if (app.distributionOptions.publishEvents && serviceDescriptor.events.length && service[EVENT_LISTENERS_KEY]) {
    serviceDescriptor.events.forEach(event => {
      service.off(event, service[EVENT_LISTENERS_KEY][event])
    })
    // Untag service so that we will not uninstall listeners twice
    delete service[EVENT_LISTENERS_KEY]
    debug('Publish callbacks unregistered for local service events on path ' + serviceDescriptor.path +
          ' for app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey, serviceDescriptor.events)
  }
  // Unpublish removed local service
  app.servicePublisher.publish('service-removed', serviceDescriptor)
  debug('Unpublished local service on path ' + serviceDescriptor.path + ' for app with uuid ' +
        app.shortUuid + ' and key ' + app.distributionKey, serviceDescriptor)
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
  debug('Scheduled local services publishing for app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
}
