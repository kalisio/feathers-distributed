# feathers-distributed

[![Build Status](https://travis-ci.org/kalisio/feathers-distributed.png?branch=master)](https://travis-ci.org/feathersjs/feathers-distributed)
[![Code Climate](https://codeclimate.com/github/kalisio/feathers-distributed/badges/gpa.svg)](https://codeclimate.com/github/kalisio/feathers-distributed)
[![Test Coverage](https://codeclimate.com/github/kalisio/feathers-distributed/badges/coverage.svg)](https://codeclimate.com/github/kalisio/feathers-distributed/coverage)
[![Dependency Status](https://img.shields.io/david/kalisio/feathers-distributed.svg?style=flat-square)](https://david-dm.org/feathersjs/feathers-distributed)
[![Download Status](https://img.shields.io/npm/dm/feathers-distributed.svg?style=flat-square)](https://www.npmjs.com/package/feathers-distributed)

> Distribute your Feathers services as microservices

**This plugin is under heavy development, breaking changes could be pushed unexpectedly.
As a consequence it should be considered unstable, not yet ready for production use.**

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

## Installation

```
npm install feathers-distributed --save
```

## Documentation

**TODO**

Please wait for the [full feathers-distributed docs](http://docs.feathersjs.com/).

![Microservice architecture](https://cdn.rawgit.com/kalisio/feathers-distributed/018e21e750851be3796d322d3805f871636a91a6/Architecture%20Diagram.svg)

When the plugin initializes the following is done for your app:
* creates a [publisher](https://github.com/dashersw/cote#creating-a-publisher) to dispatch its *locally registered services* to other nodes. 
* creates a [subscriber](https://github.com/dashersw/cote#creating-a-subscriber) to be aware of *remotely registered services* from other nodes. 

What is done by overriding `app.use` is the following: 
* each *local* Feathers service of your app creates a [responder](https://github.com/dashersw/cote#creating-a-responder) to handle incoming requests from other nodes.
* each *local* Feathers service of your app creates a [publisher](https://github.com/dashersw/cote#creating-a-publisher) to dispatch service-level events to other nodes.

What is done when your app is aware of a new remotely registered service is the following: 
* creates a local Feathers service *acting as a proxy* to the remote one by creating a [requester](https://github.com/dashersw/cote#creating-a-requester) to send incoming requests to other nodes.
* this proxy service also creates a [subscriber](https://github.com/dashersw/cote#creating-a-subscriber) to be aware of service-level events coming from other nodes.

## License

Copyright (c) 2016

Licensed under the [MIT license](LICENSE).
