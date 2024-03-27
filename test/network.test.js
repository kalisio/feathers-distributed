import express from '@feathersjs/express'
import feathers from '@feathersjs/feathers'
import request from 'superagent'
import utils from 'util'
import chai, { expect, util, assert } from 'chai'
import chailint from 'chai-lint'
import spies from 'chai-spies'
import * as commonHooks from 'feathers-hooks-common'
import { MemoryService } from '@feathersjs/memory'
import io from 'socket.io-client'
import { createApp, waitForService, waitForServiceRemoval, clone } from './utils.js'
import plugin, { finalize } from '../lib/index.js'

const startId = 2
const store = {
  0: { content: 'message 0', id: 0 },
  1: { content: 'message 1', id: 1 }
}

describe('feathers-distributed:network', () => {
  const apps = []
  const servers = []
  const nbApps = 3

  before(async () => {
    chailint(chai, util)
    const promises = []

    for (let i = 0; i < nbApps; i++) {
      apps.push(createApp(i, { authentication: false }))
      apps[i].configure(plugin({
        middlewares: { after: express.errorHandler() },
        // Distribute only the test service
        services: (service) => service.path.endsWith('messages'),
        key: (i === 0 ? 'app' : 'messages'),
        coteDelay: 2000,
        publicationDelay: 2000,
        cote: { // Use cote defaults
          helloInterval: 2000,
          checkInterval: 4000,
          nodeTimeout: 5000,
          masterTimeout: 6000,
          // We need 3 open ports by app
          basePort: 10000,
          highestPort: 10008
        }
      }))

      // Only the first app use distributed services
      if (i !== 0) {
        apps[i].use('messages', new MemoryService({ store: clone(store), startId }))
        const messagesService = apps[i].service('messages')
        expect(messagesService).toExist()
        promises.push(Promise.resolve(messagesService))
      } else {
        // Wait for remote service to be registered
        promises.push(waitForService(apps[i], 'messages'))
      }
    }

    await Promise.all(promises)

    for (let i = 0; i < nbApps; i++) {
      // See https://github.com/kalisio/feathers-distributed/issues/3
      // Now all services are registered setup handlers
      apps[i].use(express.notFound())
      apps[i].use(express.errorHandler())
      servers.push(await apps[i].listen(3030 + i))
    }
  })

  it('check remote service is accessible', async () => {
    const messages = await apps[0].service('messages').find({})
    expect(messages.length > 0).beTrue()
  })

  it('check remote service is accessible on partial failure', async () => {
    // Simulate network failure by closing the service subscriber socket
    // as this component is used to detect app loss
    apps[1].serviceSubscriber.close()
    // Wait before cote component has been flagged as unreachable
    await utils.promisify(setTimeout)(6000)
    const messages = await apps[0].service('messages').find({})
    expect(messages.length > 0).beTrue()
  })
    // Let enough time to process
    .timeout(10000)

  it('check remote service is not accessible anymore on complete failure', async () => {
    // Simulate network failure by closing the service subscriber socket
    // as this component is used to detect app loss
    apps[2].serviceSubscriber.close()
    // Wait before cote component has been flagged as unreachable
    await utils.promisify(setTimeout)(6000)
    try {
      const messages = await apps[0].service('messages').find({})
      assert.fail('accessing messages service should raise an error')
    } catch (error) {
      expect(error.message).to.equal(`Can not find service 'messages'`)
    }
  })

  // Cleanup
  after(async () => {
    for (let i = 0; i < nbApps; i++) {
      await servers[i].close()
      finalize(apps[i])
    }
  })
})
