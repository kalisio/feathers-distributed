import feathers from '@feathersjs/feathers'
import { AuthenticationService, JWTStrategy } from '@feathersjs/authentication'
import { LocalStrategy } from '@feathersjs/authentication-local'
import express from '@feathersjs/express'
import socketio from '@feathersjs/socketio'
import { expect } from 'chai'

export function createApp (index, options = { authentication: ['jwt', 'local'] }) {
  const app = express(feathers())
  let authService
  if (options.authentication) {
    authService = new AuthenticationService(app)

    app.set('authentication', {
      secret: '1234',
      entity: 'user',
      service: 'users',
      entityId: 'id',
      authStrategies: ['jwt', 'local'],
      local: {
        usernameField: 'email',
        passwordField: 'password'
      },
      jwtOptions: {
        header: { typ: 'access' },
        audience: 'https://yourdomain.com',
        issuer: 'feathers',
        algorithm: 'HS256',
        expiresIn: '1d'
      }
    })
    if (options.authentication.includes('jwt')) authService.register('jwt', new JWTStrategy())
    if (options.authentication.includes('local')) authService.register('local', new LocalStrategy())
  }

  app.use(express.json())
  app.configure(socketio())
  app.configure(express.rest())
  if (authService) app.use('/authentication', authService)

  return app
}

export function waitForService (app, path) {
  return new Promise((resolve, reject) => {
    app.on('service', data => {
      if (data.path === path) {
        let service
        try {
          service = app.service(path)
        } catch {
          reject(new Error(`Service on ${path} does not exist`))
          return
        }
        expect(service).toExist()
        if (path === 'users') {
          expect(service.remoteOptions).toExist()
          expect(service.remoteOptions.startId).toExist()
        }
        resolve(service)
      }
    })
  })
}

export function waitForServiceRemoval (app, path) {
  return new Promise((resolve, reject) => {
    app.on('service-removed', data => {
      if (data.path === path) {
        try {
          app.service(path)
          reject(new Error(`Service on ${path} do exists`))
        } catch {
          resolve()
        }
      }
    })
  })
}

export function channels (app) {
  if (typeof app.channel !== 'function') {
    return
  }
  app.on('connection', connection => {
    // console.log('App ' + app.uuid + ' with key ' + app.distributionKey + ' connects client ', connection)
    app.channel('all').join(connection)
  })
  app.publish((data, context) => {
    // console.log('App ' + app.uuid + ' with key ' + app.distributionKey + ' publishes ', data)
    return app.channel('all')
  })
}

export function clone (obj) {
  return JSON.parse(JSON.stringify(obj))
}
