import { promisify } from 'util'
import makeDebug from 'debug'
import { stripSlashes } from '@feathersjs/commons'
import { DEFAULT_EVENTS, COMPONENTS, isDiscoveredService, getServicePath, getService } from './utils.js'
import { publishServices } from './publish.js'
import RemoteService from './service.js'

const debug = makeDebug('feathers-distributed:register')
const debugIgnore = makeDebug('feathers-distributed:ignore')

export async function registerApplication (app, applicationDescriptor) {
  if (applicationDescriptor.uuid === app.uuid) {
    debugIgnore('Ignoring service requester/events publisher creation for local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
    return
  }

  // Create the request/events manager for remote services
  const key = applicationDescriptor.key
  // No app already registered for this key
  if (!app.remoteApps[key]) app.remoteApps[key] = new Set()
  const isRegistered = app.remoteApps[key].has(applicationDescriptor.uuid)
  // The first time a new application is registered publish services for it
  if (!isRegistered) {
    debug('Registering remote app replica with uuid ' + applicationDescriptor.shortUuid + ' and key ' + key + ' in local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
    publishServices(app)
  }
  app.remoteApps[key].add(applicationDescriptor.uuid)
  // Service requester/event subscriber already registered for this key
  // as we only need one not one for each app (cote will dispatch)
  if (app.serviceRequesters[key]) {
    return
  }
  debug('Registering remote app with key ' + key + ' in local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
  // Create the request manager to remote services
  app.serviceRequesters[key] = new app.cote.Requester({
    name: COMPONENTS.SERVICES_REQUESTER,
    namespace: key,
    key,
    requests: ['find', 'get', 'create', 'update', 'patch', 'remove', 'healthcheck'],
    timeout: app.distributionOptions.timeout || 20000,
    appUuid: app.uuid,
    appDistributionKey: app.distributionKey
  }, app.coteOptions)
  debug('Service requester ready for remote app with key ' + key +
        ' in local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
  // Wait before instanciating new component to avoid too much concurrency on port allocation
  await promisify(setTimeout)(app.distributionOptions.componentDelay)
  // Subscriber to listen to events from other nodes
  const events = app.distributionOptions.distributedEvents || DEFAULT_EVENTS
  app.serviceEventsSubscribers[key] = new app.cote.Subscriber({
    name: COMPONENTS.SERVICES_EVENTS_SUBSCRIBER,
    namespace: key,
    key,
    subscribesTo: events,
    appUuid: app.uuid,
    appDistributionKey: app.distributionKey
  }, app.coteOptions)
  events.forEach(event => {
    app.serviceEventsSubscribers[key].on(event, object => {
      // Get hook context as cotejs does not allow it as a second argument in event emit but feathers wants it
      const context = object.context
      delete object.context
      debug(`Dispatching ${event} remote service event on path ${object.path} in local app with uuid ${app.shortUuid} and key ${app.distributionKey}`, object, context)
      const servicePath = getServicePath(app, object)
      const service = getService(app, servicePath)
      // Ensure we don't have any local service with the same name to avoid infinite looping
      if (service && service.remote) service.emit(event, object, context)
    })
  })
  debug('Service events subscriber ready for remote app with key ' + key +
        ' in local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
}

export async function unregisterApplication (app, applicationDescriptor) {
  if (applicationDescriptor.uuid === app.uuid) {
    debugIgnore('Ignoring service requester/events publisher removal for local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  // Remove the request/events manager for remote services
  const key = applicationDescriptor.key
  // Already unregistered
  if (!app.remoteApps[key]) {
    debugIgnore('Ignoring service requester/events publisher removal as already done for local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  app.remoteApps[key].delete(applicationDescriptor.uuid)
  // Some replicas remain for this distribution key, keep service requester/event subscriber alive for them
  if (app.remoteApps[key].size !== 0) {
    debugIgnore('Ignoring service requester/events publisher removal as replicas remain for local app with uuid ' + app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  // Clear service requester/event subscriber as no replicas remains for this key
  debug(`Finalizing service requester for remote app with key ${key} as no remaining replica in local app with uuid ${app.shortUuid} and key ${app.distributionKey}`)
  app.serviceRequesters[key].close()
  delete app.serviceRequesters[key]
  debug(`Finalizing service event subscriber for remote app with key ${key} as no remaining replica in local app with uuid ${app.shortUuid} and key ${app.distributionKey}`)
  app.serviceEventsSubscribers[key].close()
  delete app.serviceEventsSubscribers[key]
  Object.getOwnPropertyNames(app.services).forEach(path => {
    unregisterService(app, {
      uuid: applicationDescriptor.uuid,
      shortUuid: applicationDescriptor.shortUuid,
      key,
      path: stripSlashes(path)
    })
  })
}

export function registerService (app, serviceDescriptor) {
  // Do not register our own services
  if (serviceDescriptor.uuid === app.uuid) {
    debugIgnore('Ignoring local service registration on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  // Retrieve target service path as it could be different from remote one in case of alias
  const servicePath = getServicePath(app, serviceDescriptor)
  const service = getService(app, servicePath)

  if (service) {
    if (service instanceof RemoteService) {
      debugIgnore('Ignoring already registered service as remote on path ' + servicePath + ' for app with uuid ' +
            app.shortUuid + ' and key ' + app.distributionKey)
    } else {
      debugIgnore('Ignoring already registered local service on path ' + servicePath + ' for app with uuid ' +
            app.shortUuid + ' and key ' + app.distributionKey)
    }
    return
  }
  // Skip services we are not interested into
  if (!isDiscoveredService(app, serviceDescriptor)) {
    debugIgnore('Ignoring remote service on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.shortUuid + ' and key ' + app.distributionKey)
    return
  }

  // Initialize our service by providing any required middleware
  let args = [servicePath]
  if (app.distributionOptions.middlewares.before) args = args.concat(app.distributionOptions.middlewares.before)
  // Take care that feathers automatically adds default events to service options so we should not provide it
  // However the distributed events description include the complete list as we can skip default events if needed
  const events = []
  if (serviceDescriptor.events) {
    serviceDescriptor.events.forEach(event => {
      if (!DEFAULT_EVENTS.includes(event)) events.push(event)
    })
  }
  const options = Object.assign({}, serviceDescriptor, { events })
  args.push(new RemoteService(app, serviceDescriptor), options)
  if (app.distributionOptions.middlewares.after) args = args.concat(app.distributionOptions.middlewares.after)
  app.use(...args)
  debug('Registered remote service on path ' + servicePath + ' for app with uuid ' +
        app.shortUuid + ' and key ' + app.distributionKey, serviceDescriptor)

  // Register hook object on every remote service
  if (app.distributionOptions.hooks) {
    app.service(servicePath).hooks(app.distributionOptions.hooks)
  }
  // Register hook to avoid remote service to send events as this is managed by our event subscriber
  app.service(servicePath).hooks({
    after: {
      all: [(hook) => { hook.event = null }]
    }
  })
  debug('Registered hooks on remote service on path ' + servicePath + ' for app with uuid ' +
        app.shortUuid + ' and key ' + app.distributionKey)

  // Dispatch an event internally through node so that async processes can run
  app.emit('service', Object.assign({}, serviceDescriptor, { path: servicePath }))
}

export function unregisterService (app, serviceDescriptor) {
  // Retrieve target service path as it could be different from remote one in case of alias
  const servicePath = getServicePath(app, serviceDescriptor)
  const service = getService(app, servicePath)

  if (!service) {
    debugIgnore('Ignoring unregistration of already unregistered service on path ' + servicePath + ' for app with uuid ' +
                app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  if (!(service instanceof RemoteService)) {
    debugIgnore('Ignoring unregistration of local service on path ' + servicePath + ' for app with uuid ' +
                app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  // Skip services we are not interested into
  if (!isDiscoveredService(app, serviceDescriptor)) {
    debugIgnore('Ignoring unregistration of remote service on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.shortUuid + ' and key ' + app.distributionKey)
    return
  }
  app.unuse(servicePath)
  debug('Unregistered remote service on path ' + servicePath + ' for app with uuid ' +
        app.shortUuid + ' and key ' + app.distributionKey, serviceDescriptor)

  // Dispatch an event internally through node so that async processes can run
  app.emit('service-removed', Object.assign({}, serviceDescriptor, { path: servicePath }))
}
