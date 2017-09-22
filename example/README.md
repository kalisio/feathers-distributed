# feathers-distributed example

There are two application folders named `gateway` and `service`.

The first one contains the *users* and *authentication* services and should act as API gateway. The second one constains the *todos* service and should act as a microservice. They are feeded with a default user/todo.

The *index.html* is a simple web page connecting to gateway and requesting TODOs from the service.

## Launch

The best experience is by launching this example using Docker:
```
docker-compose up
```

This should create 3 containers: the gateway and two instances of the microservice. Because in this example each microservice has its own embedded database, using the *index.html* or POSTMAN you should see that the TODOs are alternatively served from each instance because they have different IDs.

To launch these apps manually when developing:
```
// Launch gateway
cd gateway
npm/yarn install
npm start
// Launch service
cd service
npm/yarn install
npm start
```

Open the *index.html* file in your browser, you should see a TODO from the service.

If you use [cote monitoring tool](https://github.com/dashersw/cote#monitoring-tool) you should see something like that:
<p align="center">
  <img src="https://cdn.rawgit.com/kalisio/feathers-distributed/ac75ff0d4c1326cdcd5ca4522bb2f06179b9bd6f/example/monitor.jpg"/>
</p>

## Generation

These apps have been generated using the `feathers-cli`:
```
// Initialize gateway
mkdir gateway
cd gateway
feathers generate app
// Add authentication
feathers generate authentication
cd ..
// Initialize service
mkdir service
cd service
feathers generate app
// Add todos service
feathers generate service
```
