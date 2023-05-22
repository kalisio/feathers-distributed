import { promisify } from 'util'
import makeDebug from 'debug'
import { DEFAULT_EVENTS, isDiscoveredService, getServicePath, getService } from './utils.js'
import RemoteService from './service.js'

const debug = makeDebug('feathers-distributed:register')
const debugIgnore = makeDebug('feathers-distributed:ignore')

export async function registerApplication (app, applicationDescriptor) {
  // Create the request/events manager for remote services only
  if (applicationDescriptor.uuid === app.uuid) {
    debugIgnore('Ignoring service requester/events publisher creation for local app with uuid ' + app.uuid)
    return
  }

  const key = applicationDescriptor.key
  // Already registered
  if (app.serviceRequesters[key]) {
    debugIgnore('Ignoring already registered remote app with uuid ' + app.uuid + ' and key ' + key)
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
      const servicePath = getServicePath(app, object)
      const service = getService(app, servicePath)
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
    debugIgnore('Ignoring local service registration on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.uuid + ' and key ' + app.distributionKey)
    return
  }
  // Retrieve target service path as it could be different from remote one in case of alias
  const servicePath = getServicePath(app, serviceDescriptor)
  const service = getService(app, servicePath)

  if (service) {
    if (service instanceof RemoteService) {
      debugIgnore('Ignoring already registered service as remote on path ' + servicePath + ' for app with uuid ' +
            app.uuid + ' and key ' + app.distributionKey)
    } else {
      debugIgnore('Ignoring already registered local service on path ' + servicePath + ' for app with uuid ' +
            app.uuid + ' and key ' + app.distributionKey)
    }
    return
  }
  // Skip services we are not interested into
  if (!isDiscoveredService(app, serviceDescriptor)) {
    debugIgnore('Ignoring remote service on path ' + serviceDescriptor.path + ' for app with uuid ' +
          app.uuid + ' and key ' + app.distributionKey)
    return
  }

  // Initialize our service by providing any required middleware
  let args = [servicePath]
  if (app.distributionOptions.middlewares.before) args = args.concat(app.distributionOptions.middlewares.before)
  args.push(new RemoteService(app, serviceDescriptor), serviceDescriptor)
  if (app.distributionOptions.middlewares.after) args = args.concat(app.distributionOptions.middlewares.after)
  app.use(...args)
  debug('Registered remote service on path ' + servicePath + ' for app with uuid ' +
        app.uuid + ' and key ' + app.distributionKey, serviceDescriptor)

  // registering hook object on every remote service
  if (app.distributionOptions.hooks) {
    app.service(servicePath).hooks(app.distributionOptions.hooks)
  }
  debug('Registered hooks on remote service on path ' + servicePath + ' for app with uuid ' +
        app.uuid + ' and key ' + app.distributionKey)

  // Dispatch an event internally through node so that async processes can run
  app.emit('service', Object.assign({}, serviceDescriptor, { path: servicePath }))
}
