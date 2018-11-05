import cote from 'cote';
import makeDebug from 'debug';

const debug = makeDebug('feathers-distributed:service');

// This is the Feathers service abstraction for a cote requester on remote
class RemoteService {
  constructor (options) {
    // This flag indicates to the plugin this is a remote service
    this.remote = true;
  }

  setup (app, path) {
    // Create the request manager to remote ones for this service
    this.requester = new app.cote.Requester({
      name: path + ' requester',
      namespace: path,
      requests: ['find', 'get', 'create', 'update', 'patch', 'remove']
    }, Object.assign({ log: false }, app.coteOptions));
    this.path = path;
    debug('Requester created for remote service on path ' + this.path);
    // Create the subscriber to listen to events from other nodes
    this.serviceEventsSubscriber = new app.cote.Subscriber({
      name: path + ' events subscriber',
      namespace: path,
      subscribesTo: ['created', 'updated', 'patched', 'removed']
    }, { log: false });
    this.serviceEventsSubscriber.on('created', object => {
      this.emit('created', object);
    });
    this.serviceEventsSubscriber.on('updated', object => {
      this.emit('updated', object);
    });
    this.serviceEventsSubscriber.on('patched', object => {
      this.emit('patched', object);
    });
    this.serviceEventsSubscriber.on('removed', object => {
      this.emit('removed', object);
    });
    debug('Subscriber created for remote service events on path ' + this.path);
  }

  // Perform requests to other nodes
  find (params) {
    debug('Requesting find() remote service on path ' + this.path, params);
    return this.requester.send({ type: 'find', params }).then(result => {
      debug('Successfully find() remote service on path ' + this.path);
      return result;
    });
  }

  get (id, params) {
    debug('Requesting get() remote service on path ' + this.path, id, params);
    return this.requester.send({ type: 'get', id, params }).then(result => {
      debug('Successfully get() remote service on path ' + this.path);
      return result;
    });
  }

  create (data, params) {
    debug('Requesting create() remote service on path ' + this.path, data, params);
    return this.requester.send({ type: 'create', data, params }).then(result => {
      debug('Successfully create() remote service on path ' + this.path);
      return result;
    });
  }

  update (id, data, params) {
    debug('Requesting update() remote service on path ' + this.path, id, data, params);
    return this.requester.send({ type: 'update', id, data, params }).then(result => {
      debug('Successfully update() remote service on path ' + this.path);
      return result;
    });
  }

  patch (id, data, params) {
    debug('Requesting patch() remote service on path ' + this.path, id, data, params);
    return this.requester.send({ type: 'patch', id, data, params }).then(result => {
      debug('Successfully patch() remote service on path ' + this.path);
      return result;
    });
  }

  remove (id, params) {
    debug('Requesting remove() remote service on path ' + this.path, id, params);
    return this.requester.send({ type: 'remove', id, params }).then(result => {
      debug('Successfully remove() remote service on path ' + this.path);
      return result;
    });
  }
}

// This is the cote responder abstraction for a local Feathers service
class LocalService extends cote.Responder {
  constructor (options) {
    const app = options.app;
    const path = options.path;
    super({ name: path + ' responder', namespace: path, respondsTo: ['find', 'get', 'create', 'update', 'patch', 'remove'] }, { log: false });
    debug('Responder created for local service on path ' + path);
    let service = app.service(path);

    // Answer requests from other nodes
    this.on('find', (req) => {
      debug('Responding find() local service on path ' + path);
      return service.find(req.params).then((result) => {
        debug('Successfully find() local service on path ' + path);
        return result;
      });
    });
    this.on('get', (req) => {
      debug('Responding get() local service on path ' + path);
      return service.get(req.id, req.params).then((result) => {
        debug('Successfully get() local service on path ' + path);
        return result;
      });
    });
    this.on('create', (req) => {
      debug('Responding create() local service on path ' + path);
      return service.create(req.data, req.params).then((result) => {
        debug('Successfully create() local service on path ' + path);
        return result;
      });
    });
    this.on('update', (req) => {
      debug('Responding update() local service on path ' + path);
      return service.update(req.id, req.data, req.params).then((result) => {
        debug('Successfully update() local service on path ' + path);
        return result;
      });
    });
    this.on('patch', (req) => {
      debug('Responding patch() local service on path ' + path);
      return service.patch(req.id, req.data, req.params).then((result) => {
        debug('Successfully patch() local service on path ' + path);
        return result;
      });
    });
    this.on('remove', (req) => {
      debug('Responding remove() local service on path ' + path);
      return service.remove(req.id, req.params).then((result) => {
        debug('Successfully remove() local service on path ' + path);
        return result;
      });
    });

    // Dispatch events to other nodes
    this.serviceEventsPublisher = new app.cote.Publisher({
      name: path + ' events publisher',
      namespace: path,
      broadcasts: ['created', 'updated', 'patched', 'removed']
    }, Object.assign({ log: false }, app.coteOptions));
    service.on('created', object => {
      this.serviceEventsPublisher.publish('created', object);
    });
    service.on('updated', object => {
      this.serviceEventsPublisher.publish('updated', object);
    });
    service.on('patched', object => {
      this.serviceEventsPublisher.publish('patched', object);
    });
    service.on('removed', object => {
      this.serviceEventsPublisher.publish('removed', object);
    });
    debug('Publisher created for local service events on path ' + path);
  }
}

export default {
  RemoteService,
  LocalService
};
