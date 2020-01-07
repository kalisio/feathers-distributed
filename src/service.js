import cote from 'cote'
import makeDebug from 'debug'
import { convert } from '@feathersjs/errors'

const debug = makeDebug('feathers-distributed:service')

// This is the Feathers service abstraction for a cote requester on remote
class RemoteService {
  constructor (options) {
    // This flag indicates to the plugin this is a remote service
    this.remote = true
    this.remoteEvents = options.events || ['created', 'updated', 'patched', 'removed']
  }

  setup (app, path) {
    // Create the request manager to remote ones for this service
    this.requester = new app.cote.Requester({
      name: path + ' requester',
      namespace: path,
      key: path,
      requests: ['find', 'get', 'create', 'update', 'patch', 'remove']
    }, app.coteOptions)
    this.path = path
    debug('Requester created for remote service on path ' + this.path)

    if (app.distributionOptions.publishEvents && this.remoteEvents.length) {
      // Create the subscriber to listen to events from other nodes
      this.serviceEventsSubscriber = new app.cote.Subscriber({
        name: path + ' events subscriber',
        namespace: path,
        key: path,
        subscribesTo: this.remoteEvents
      }, app.coteOptions)
      this.remoteEvents.forEach(event => {
        this.serviceEventsSubscriber.on(event, object => {
          debug(`Dispatching ${event} remote service event on path ` + path, object)
          this.emit(event, object)
        })
      })
      debug('Subscriber created for remote service events on path ' + this.path, this.remoteEvents)
    }
  }

  // Perform requests to other nodes
  async find (params) {
    debug('Requesting find() remote service on path ' + this.path, params)
    try {
      const result = await this.requester.send({ type: 'find', params })
      debug('Successfully find() remote service on path ' + this.path)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async get (id, params) {
    debug('Requesting get() remote service on path ' + this.path, id, params)
    try {
      const result = await this.requester.send({ type: 'get', id, params })
      debug('Successfully get() remote service on path ' + this.path)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async create (data, params) {
    debug('Requesting create() remote service on path ' + this.path, data, params)
    try {
      const result = await this.requester.send({ type: 'create', data, params })
      debug('Successfully create() remote service on path ' + this.path)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async update (id, data, params) {
    debug('Requesting update() remote service on path ' + this.path, id, data, params)
    try {
      const result = await this.requester.send({ type: 'update', id, data, params })
      debug('Successfully update() remote service on path ' + this.path)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async patch (id, data, params) {
    debug('Requesting patch() remote service on path ' + this.path, id, data, params)
    try {
      const result = await this.requester.send({ type: 'patch', id, data, params })
      debug('Successfully patch() remote service on path ' + this.path)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async remove (id, params) {
    debug('Requesting remove() remote service on path ' + this.path, id, params)
    try {
      const result = await this.requester.send({ type: 'remove', id, params })
      debug('Successfully remove() remote service on path ' + this.path)
      return result
    } catch (error) {
      throw convert(error)
    }
  }
}

// This is the cote responder abstraction for a local Feathers service
class LocalService extends cote.Responder {
  constructor (options) {
    const app = options.app
    const path = options.path
    super({
      name: path + ' responder',
      namespace: path,
      key: path,
      respondsTo: ['find', 'get', 'create', 'update', 'patch', 'remove']
    }, app.coteOptions)
    debug('Responder created for local service on path ' + path)
    const service = app.service(path)

    // Answer requests from other nodes
    this.on('find', async (req) => {
      debug('Responding find() local service on path ' + path, req)
      const result = await service.find(Object.assign({ fromRemote: true }, req.params))
      debug('Successfully find() local service on path ' + path)
      return result
    })
    this.on('get', async (req) => {
      debug('Responding get() local service on path ' + path, req)
      const result = await service.get(req.id, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully get() local service on path ' + path)
      return result
    })
    this.on('create', async (req) => {
      debug('Responding create() local service on path ' + path, req)
      const result = await service.create(req.data, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully create() local service on path ' + path)
      return result
    })
    this.on('update', async (req) => {
      debug('Responding update() local service on path ' + path, req)
      const result = await service.update(req.id, req.data, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully update() local service on path ' + path)
      return result
    })
    this.on('patch', async (req) => {
      debug('Responding patch() local service on path ' + path, req)
      const result = await service.patch(req.id, req.data, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully patch() local service on path ' + path)
      return result
    })
    this.on('remove', async (req) => {
      debug('Responding remove() local service on path ' + path, req)
      const result = await service.remove(req.id, Object.assign({ fromRemote: true }, req.params))
      debug('Successfully remove() local service on path ' + path)
      return result
    })

    if (app.distributionOptions.publishEvents && options.events.length) {
      // Dispatch events to other nodes
      this.serviceEventsPublisher = new app.cote.Publisher({
        name: path + ' events publisher',
        namespace: path,
        key: path,
        broadcasts: options.events
      }, app.coteOptions)
      options.events.forEach(event => {
        service.on(event, object => {
          debug(`Publishing ${event} local service event on path ` + path, object)
          this.serviceEventsPublisher.publish(event, object)
        })
      })
      debug('Publisher created for local service events on path ' + path, options.events)
    }
  }
}

export default {
  RemoteService,
  LocalService
}
