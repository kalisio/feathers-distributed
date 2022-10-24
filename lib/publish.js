import { stripSlashes } from '@feathersjs/commons'
import feathers from '@feathersjs/feathers'
import makeDebug from 'debug'
import { DEFAULT_EVENTS, isInternalService } from './utils.js'

const { getServiceOptions } = feathers
const debug = makeDebug('feathers-distributed:publish')
// Get the unique global symbol to store event listeners on a service object
const EVENT_LISTENER_KEY = Symbol.for('event-listener')

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
        if (app.serviceEventsPublisher) {
          debug(`Publishing ${event} local service event on path ` + serviceDescriptor.path +
                ' for app with uuid ' + app.uuid + ' and key ' + app.distributionKey, object)
          app.serviceEventsPublisher.publish(event, Object.assign({
            path: serviceDescriptor.path, key: app.distributionKey
          }, object))
        }
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
