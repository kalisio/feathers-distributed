# feathers-distributed

[![Latest Release](https://img.shields.io/github/v/tag/kalisio/feathers-distributed?sort=semver&label=latest)](https://github.com/kalisio/feathers-distributed/releases)
[![Build Status](https://travis-ci.com/kalisio/feathers-distributed.png?branch=master)](https://travis-ci.com/kalisio/feathers-distributed)
[![Code Climate](https://codeclimate.com/github/kalisio/feathers-distributed/badges/gpa.svg)](https://codeclimate.com/github/kalisio/feathers-distributed)
[![Test Coverage](https://codeclimate.com/github/kalisio/feathers-distributed/badges/coverage.svg)](https://codeclimate.com/github/kalisio/feathers-distributed/coverage)
[![Dependency Status](https://img.shields.io/david/kalisio/feathers-distributed.svg?style=flat-square)](https://david-dm.org/kalisio/feathers-distributed)
[![Download Status](https://img.shields.io/npm/dm/@kalisio/feathers-distributed.svg?style=flat-square)](https://www.npmjs.com/package/@kalisio/feathers-distributed)

> Distribute your Feathers services as microservices

The [`master`](https://github.com/kalisio/feathers-distributed) branch and >= 0.3.x version is expected to work with [Feathers v3](https://buzzard.docs.feathersjs.com/) (a.k.a. Buzzard) and [Feathers v4](https://docs.feathersjs.com/) (a.k.a. Crow).

> Please note that the underlying architecture has been changed from one requester/publisher and responder/subscriber per service to one requester/publisher and responder/subscriber per application between v0.7 and v1.x. This **breaking change** has been required to improve performances and reliability by simplifying the underlying mesh network (see for instance [#48](https://github.com/kalisio/feathers-distributed/issues/48) or [#49](https://github.com/kalisio/feathers-distributed/issues/49)). As a consequence, applications running under v1.x will not be compatible with applications running prior versions.

The [`auk`](https://github.com/kalisio/feathers-distributed/tree/auk) branch and 0.2.x version is expected to work with [Feathers v2](https://auk.docs.feathersjs.com/) (a.k.a. Auk) **but it is deprecated**.

This plugin relies on [cote](https://github.com/dashersw/cote) and takes benefits of it:
- **Zero-configuration:** no IP addresses, no ports, no routing to configure
- **Decentralized:** No fixed parts, no "manager" nodes, no single point of
                     failure
- **Auto-discovery:** Services discover each other without a central bookkeeper
- **Fault-tolerant:** Don't lose any requests when a service is down
- **Scalable:** Horizontally scale to any number of machines
- **Performant:** Process thousands of messages per second

**cote** requires your cloud provider to support IP broadcast or multicast. You can still have the same functionality
with [Weave overlay networks](https://github.com/weaveworks/weave), eg on Docker's Cloud. In any other cases you can use [centralized discovery](https://github.com/dashersw/cote#using-centralized-discovery-tools).

> cote works out of the box with Docker Swarm and Docker Cloud but we are seeking for volunteers to test this module under various Cloud providers like AWS, Google Cloud, etc. Please open an issue if you'd like to do so and report your findings.

You might find this [presentation](http://slides.com/armaganamcalar/apiconf-zero-conf-microservices#/) really helpful to understand it. You might also be interested in reading this typical [use case](https://blog.feathersjs.com/a-use-case-of-microservices-with-feathersjs-building-a-geospatial-platform-56373604db71).

## Installation

```
npm install @kalisio/feathers-distributed --save
```

**To get the latest version please use the following command:**
```
npm install https://github.com/kalisio/feathers-distributed --save
```

`feathers-distributed` is as least intrusive as possible so for most use cases you simply need to configure it along with your applications holding your services:
```javascript
const distribution = require('@kalisio/feathers-distributed');
...
app.configure(hooks());
app.configure(socketio());
app.configure(distribution());
...
```

> A common problem with distribution is that it can register new remote services to your app after it has been configured and started, which typically causes 404 errors, read [the documentation](https://github.com/kalisio/feathers-distributed#remote-services) about this issue.

If you are not running a long-lived server and want to use distribution in your test suite for instance, you can clean it up gracefully like this: 
```javascript
const distribution = require('@kalisio/feathers-distributed');
...
server.on('close', () => distribution.finalize(app));
server.close();
...
```

## Architecture

![Microservice architecture](https://cdn.rawgit.com/kalisio/feathers-distributed/dd436d9e1a70b66607a893ba9efeaeab339fd50e/Architecture%20Diagram.svg)

When the plugin initializes the following is done for your local app:
* creates a local [publisher](https://github.com/dashersw/cote#creating-a-publisher) to dispatch its *locally registered services* to other apps. 
* creates a local [subscriber](https://github.com/dashersw/cote#creating-a-subscriber) to be aware of *remotely registered services* from other apps. 
* creates a local [responder](https://github.com/dashersw/cote#creating-a-responder) to handle *incoming requests from other apps* to locally registered services.
* creates a local [publisher](https://github.com/dashersw/cote#creating-a-publisher) to dispatch locally registered services events to *remote apps*.

What is done by overriding `app.use` is the following: 
* each *local* Feathers service of your app is published using the local [publisher](https://github.com/dashersw/cote#creating-a-publisher) to remote apps.

What is done when your app is aware of a new remotely registered app is the following: 
* creates a local [requester](https://github.com/dashersw/cote#creating-a-requester) to send requests to the remote [responder](https://github.com/dashersw/cote#creating-a-responder) for remote services operations.
* creates a local [subscriber](https://github.com/dashersw/cote#creating-a-subscriber) to be aware of service events sent by the remote events [publisher](https://github.com/dashersw/cote#creating-a-publisher) for remote services.

What is done when your app is aware of a new remotely registered service is the following: 
* creates a local Feathers service *acting as a proxy* to the remote one by using the local [requester](https://github.com/dashersw/cote#creating-a-requester).

## Configuration options

### Local services

By default all your services will be exposed, you can use the `services` option to indicate which services need to be published if you'd like to keep some available only internally:
```javascript
app.configure(
  distribution({
    // Can be a static list of service path to be exposed
    services: ['api/service1', 'api/service2']
    // Can be a function returning true for exposed services
    services: (service) => (service.path !== 'api/internal')
  })
)
```

### Remote services

By default all remote services will be consumed, you can use the `remoteServices` option to indicate which services need to be consumed if you don't want to be polluted by unused ones:
```javascript
app.configure(
  distribution({
    // Can be a static list of service path to be consumed
    remoteServices: ['api/service1', 'api/service2']
    // Can be a function returning true for consumed services
    remoteServices: (service) => (service.path !== 'api/external')
  })
)
```

You can add hooks to each registered remote service by using the `hooks` option, this is typically useful to enforce authentication on a [gateway scenario](https://github.com/kalisio/feathers-distributed#api-gateway):
```javascript
app.configure(
  distribution({
    hooks: {
      before: {
        all: [authenticate('jwt')]
      },
    },
  })
);
```

You can add middlewares to each registered remote service by using the `middlewares` option, this is typically useful to enfore correct [error handling](https://docs.feathersjs.com/api/express.html#expresserrorhandler) on a [gateway scenario](https://github.com/kalisio/feathers-distributed#api-gateway):
```javascript
const express = require('@feathersjs/express')

app.configure(
  distribution({
    middlewares: {
      before: (req, res, next) => next(),
      after: express.errorHandler()
    },
  })
);
```
Indeed, Feathers does not allow to register new services after the app has been setup so that application middlewares like [not found](https://docs.feathersjs.com/api/express.html#expressnotfoundoptions) or [error handler](https://docs.feathersjs.com/api/express.html#appuseexpresserrorhandleroptions) will be hit first. However, `feathers-distributed` dynamically adds new services during app lifecycle. As a consequence, you should not register these middlewares at app level and register them whenever a new service pops up using this option.

### Events

By default all [real-time events](https://docs.feathersjs.com/api/events.html) from local services are distributed to remote ones but you can customize the events to be dispatched by providing the list in the `distributedEvents` property of your service or disable all events publishing with the `publishEvents` boolean option.

### Partition keys

By default the same [partition key](https://github.com/dashersw/cote#keys) is used for all distributed apps, so that there is no communication segregation. Sometimes it is better for security, maintenance or performance purpose to segregate services by following the principles of domain-driven design. In that case you can always define your own partition key for each application using the `key` string options (defaults to `'default'`). 

A solid solution as suggested in [issue #70](https://github.com/kalisio/feathers-distributed/issues/70) is to use your package name because duplicated apps will then have the same key while different projects will not, and it will be persistent across restart:
```
const package = require('path/to/your/package.json')

app.configure(distributed({
  ...,
  key: package.name
}))
```

### Healthcheck

By default the module adds an express middleware on the `/distribution/healthcheck/:key` route. You can perform a healthcheck status for each available partition key using this route and a GET HTTP method, the following responses are possible:
* HTTP code 200 with the list of registered remote services for this key
* HTTP code 404 if no application has been registered for this key
* HTTP code 500 if the none remote application responds to the healthcheck signal

If you don't use partition keys you can omit the key request parameter as it will default to the `'default'` value.

You can change the healthcheck endpoint URL using the `healthcheckPath` option.

## Hooks

In some cases it can be useful to know in a hook if the method has been called from a remote service or a local one (e.g. in order to skip authentication). For this you can use the `fromRemote` flag in parameters:
```javascript
services[i].hooks({
  before: {
    all: hook => {
      // Do something specific in this case
      if (hook.params.fromRemote) ...
      return hook
    }
  }
})
```

## Example

To launch the example:
```
npm start
```
Wait a couple of seconds so that each app is aware of other apps on the network. Open the *example/index.html* file in your browser, you should see a TODO coming from a microservice.

Look for details into the [example folder](./example).

## Authentication

There are two scenarios:
* the **API gateway**, where you have a single entry point (ie node) to authenticate and access your API but services are distributed accross different nodes
* the **distributed application**, where you can distribute and access any service on any node on your network mesh with authentication

### API gateway: 

In this case you have to [install the authentication plugin](https://auk.docs.feathersjs.com/api/authentication/server.html#authentication) on your gateway and register a hook that will enforce authentication on each registered remote service by using the `hooks` option:
```javascript
app.configure(
  distribution({
    hooks: {
      before: {
        all: [authenticate('jwt')],
      },
    },
  })
);
```
You don't need to install the authentication plugin or hook on each service served from your nodes.

You process as usual to [authenticate your client](https://auk.docs.feathersjs.com/api/authentication/client.html#additional-feathersclient-methods) first on the gateway with a local or JWT strategy for instance.

Our [example folder](./example) is a good start for this use case.

### Distributed application

In this case you have to [install the authentication plugin](https://auk.docs.feathersjs.com/api/authentication/server.html#authentication) on each of your nodes and register a hook that will enforce authentication on each service as usual.

You process as usual to [authenticate your client](https://auk.docs.feathersjs.com/api/authentication/client.html#additional-feathersclient-methods) first on any node with a local or JWT strategy for instance.

Our [tests](https://github.com/kalisio/feathers-distributed/blob/master/test/index.test.js) contain a good example for this use case.

> To make it work all nodes must share the same authentication configuration (i.e. secret)

## Tips

### Initialization

1) The library overrides `app.use()` to **automatically publish any new service** defined, so that you can usually safely initialize it before registering your services like others feathers plugins (transport, configuration, etc.). However, you might also configure some middlewares with `options.middlewares` and in this case you probably need to initialize the express plugin beforehand.

2) The library immediately initializes the underlying cote module **unless you intentionally add some delay** (`coteDelay` option in ms, defaults to none). This delay can be required because it appears that in some scenarios, e.g. [Docker deployment](https://github.com/kalisio/feathers-distributed/issues/36) the network setup takes some time and cote is not able to correctly initialize (e.g. allocate ports or reach Redis) before.

3) As the library also relies on cote components to publish/subscribe events, and **these components take some time to initialize**, there is also a publication delay (`publicationDelay` option in ms, defaults to 10s) that is respected before publishing app services once initialized.

### Environment variables

Some options can be directly provided as environment variables:
* `COTE_LOG` to activate logging for all underlying cote components
* `BASE_PORT` to select the starting port of the port range to be used by cote
* `HIGHEST_PORT` to select the ending port of the port range to be used by cote
* `COTE_DELAY` (ms) to define the delay before initializing cote
* `PUBLICATION_DELAY` (ms) to define the delay before publishing services

### Cloud deployment

Cloud providers don't (and they probably won't) support broadcast/multicast out of the box as required to be a zero-configuration module. In this case, the most simple approach is usually to rely on a centralized discovery based on [Redis](https://redis.io/) instance. More details can be found in the [cote documentation](https://github.com/dashersw/cote#using-centralized-discovery-tools) but you can have a look to our [Kargo](https://kalisio.github.io/kargo/) solution for a working configuration.

More specifically check the [docker compose files](https://github.com/kalisio/kargo/tree/master/deploy) of our Redis instance and one of our app running `feathers-distributed`like [Kano](https://kalisio.github.io/kano/). You will see that you need to open at least some port to make it work and take care of initialization delay if you'd like to add a healthcheck.

## License

Copyright (c) 2017 Kalisio

Licensed under the [MIT license](LICENSE).
