import makeDebug from 'debug'
import errors from '@feathersjs/errors'
import { DEFAULT_METHODS } from './utils.js'

const { convert } = errors
const debug = makeDebug('feathers-distributed:service')

// This is the Feathers service abstraction for a cote requester on remote
class RemoteService {
  constructor (app, options) {
    // Keep track of partition key
    this.key = options.key
    this.requester = app.serviceRequesters[options.key]
    this.path = options.path
    // This flag indicates to the plugin this is a remote service
    this.remote = true
    if (options.methods) {
      options.methods.forEach(method => {
        // If custom method add the corresponding function to service interface
        if (!DEFAULT_METHODS.includes(method)) this[method] = this.generateCustomMethod(method)
      })
    }
  }

  // Perform requests to other nodes
  async find (params) {
    debug('Requesting find() remote service on path ' + this.path + ' with key ' + this.key, params)
    try {
      const result = await this.requester.send({ type: 'find', key: this.key, path: this.path, params })
      debug('Successfully find() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async get (id, params) {
    debug('Requesting get() remote service on path ' + this.path + ' with key ' + this.key, id, params)
    try {
      const result = await this.requester.send({ type: 'get', key: this.key, path: this.path, id, params })
      debug('Successfully get() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async create (data, params) {
    debug('Requesting create() remote service on path ' + this.path + ' with key ' + this.key, data, params)
    try {
      const result = await this.requester.send({ type: 'create', key: this.key, path: this.path, data, params })
      debug('Successfully create() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async update (id, data, params) {
    debug('Requesting update() remote service on path ' + this.path + ' with key ' + this.key, id, data, params)
    try {
      const result = await this.requester.send({ type: 'update', key: this.key, path: this.path, id, data, params })
      debug('Successfully update() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async patch (id, data, params) {
    debug('Requesting patch() remote service on path ' + this.path + ' with key ' + this.key, id, data, params)
    try {
      const result = await this.requester.send({ type: 'patch', key: this.key, path: this.path, id, data, params })
      debug('Successfully patch() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async remove (id, params) {
    debug('Requesting remove() remote service on path ' + this.path + ' with key ' + this.key, id, params)
    try {
      const result = await this.requester.send({ type: 'remove', key: this.key, path: this.path, id, params })
      debug('Successfully remove() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  async healthcheck () {
    debug('Requesting healthcheck() remote service on path ' + this.path + ' with key ' + this.key)
    try {
      const result = await this.requester.send({ type: 'healthcheck', key: this.key, path: this.path })
      debug('Successfully healthcheck() remote service on path ' + this.path + ' with key ' + this.key)
      return result
    } catch (error) {
      throw convert(error)
    }
  }

  // Custom method call
  generateCustomMethod (method) {
    debug(`Generating ${method}() method for remote service on path ` + this.path + ' with key ' + this.key)
    return async function (data, params) {
      debug(`Requesting ${method}() remote service on path ` + this.path + ' with key ' + this.key, data, params)
      try {
        const result = await this.requester.send({ type: method, key: this.key, path: this.path, data, params })
        debug(`Successfully ${method}() remote service on path ` + this.path + ' with key ' + this.key)
        return result
      } catch (error) {
        throw convert(error)
      }
    }
  }
}

export default RemoteService
