import cote from 'cote'
import makeDebug from 'debug'

const debug = makeDebug('feathers-distributed:service')

// This is the Feathers service abstraction for a cote requester on remote
class RemoteService {
  constructor (options) {
    // This flag indicates to the plugin this is a remote service
    this.remote = true
  }

  setup (app, path) {
    // Create the request manager to remote ones for this service
    this.requester = new app.cote.Requester({
      name: path + ' requester',
      namespace: path,
      requests: ['find', 'get', 'create', 'update', 'patch', 'remove']
    }, Object.assign({ log: false }, app.coteOptions))
    this.path = path
    debug('Requester created for remote service on path ' + this.path)
    // Create the subscriber to listen to events from other nodes
    this.serviceEventsSubscriber = new app.cote.Subscriber({
      name: path + ' events subscriber',
      namespace: path,
      subscribesTo: ['created', 'updated', 'patched', 'removed']
    }, { log: false })
    this.serviceEventsSubscriber.on('created', object => {
      this.emit('created', object)
    })
    this.serviceEventsSubscriber.on('updated', object => {
      this.emit('updated', object)
    })
    this.serviceEventsSubscriber.on('patched', object => {
      this.emit('patched', object)
    })
    this.serviceEventsSubscriber.on('removed', object => {
      this.emit('removed', object)
    })
    debug('Subscriber created for remote service events on path ' + this.path)
  }

  // Perform requests to other nodes
  async find (params) {
    debug('Requesting find() remote service on path ' + this.path, params)
    const result = await this.requester.send({ type: 'find', params })
    debug('Successfully find() remote service on path ' + this.path)
    return result
  }

  async get (id, params) {
    debug('Requesting get() remote service on path ' + this.path, id, params)
    const result = await this.requester.send({ type: 'get', id, params })
    debug('Successfully get() remote service on path ' + this.path)
    return result
  }

  async create (data, params) {
    debug('Requesting create() remote service on path ' + this.path, data, params)
    const result = await this.requester.send({ type: 'create', data, params })
    debug('Successfully create() remote service on path ' + this.path)
    return result
  }

  async update (id, data, params) {
    debug('Requesting update() remote service on path ' + this.path, id, data, params)
    const result = await this.requester.send({ type: 'update', id, data, params })
    debug('Successfully update() remote service on path ' + this.path)
    return result
  }

  async patch (id, data, params) {
    debug('Requesting patch() remote service on path ' + this.path, id, data, params)
    const result = await this.requester.send({ type: 'patch', id, data, params })
    debug('Successfully patch() remote service on path ' + this.path)
    return result
  }

  async remove (id, params) {
    debug('Requesting remove() remote service on path ' + this.path, id, params)
    const result = await this.requester.send({ type: 'remove', id, params })
    debug('Successfully remove() remote service on path ' + this.path)
    return result
  }
}

// This is the cote responder abstraction for a local Feathers service
class LocalService extends cote.Responder {
  constructor (options) {
    const app = options.app
    const path = options.path
    super({ name: path + ' responder', namespace: path, respondsTo: ['find', 'get', 'create', 'update', 'patch', 'remove'] }, { log: false })
    debug('Responder created for local service on path ' + path)
    let service = app.service(path)

    // Answer requests from other nodes
    this.on('find', async (req) => {
      debug('Responding find() local service on path ' + path)
      const result = await service.find(req.params)
      debug('Successfully find() local service on path ' + path)
      return result
    })
    this.on('get', async (req) => {
      debug('Responding get() local service on path ' + path)
      const result = await service.get(req.id, req.params)
      debug('Successfully get() local service on path ' + path)
      return result
    })
    this.on('create', async (req) => {
      debug('Responding create() local service on path ' + path)
      const result = await service.create(req.data, req.params)
      debug('Successfully create() local service on path ' + path)
      return result
    })
    this.on('update', async (req) => {
      debug('Responding update() local service on path ' + path)
      const result = await service.update(req.id, req.data, req.params)
      debug('Successfully update() local service on path ' + path)
      return result
    })
    this.on('patch', async (req) => {
      debug('Responding patch() local service on path ' + path)
      const result = await service.patch(req.id, req.data, req.params)
      debug('Successfully patch() local service on path ' + path)
      return result
    })
    this.on('remove', async (req) => {
      debug('Responding remove() local service on path ' + path)
      const result = await service.remove(req.id, req.params)
      debug('Successfully remove() local service on path ' + path)
      return result
    })

    // Dispatch events to other nodes
    this.serviceEventsPublisher = new app.cote.Publisher({
      name: path + ' events publisher',
      namespace: path,
      broadcasts: ['created', 'updated', 'patched', 'removed']
    }, Object.assign({ log: false }, app.coteOptions))
    service.on('created', object => {
      this.serviceEventsPublisher.publish('created', object)
    })
    service.on('updated', object => {
      this.serviceEventsPublisher.publish('updated', object)
    })
    service.on('patched', object => {
      this.serviceEventsPublisher.publish('patched', object)
    })
    service.on('removed', object => {
      this.serviceEventsPublisher.publish('removed', object)
    })
    debug('Publisher created for local service events on path ' + path)
  }
}

export default {
  RemoteService,
  LocalService
}
