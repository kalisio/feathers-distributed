# feathers-distributed example

There are two applications folders named `gateway` and `service`.

The first one contains the *users* and *authentication* services and should act as API gateway. The second one constains the *todos* service and should act as a microservice.
They are feeded with a default user/todo.

The *index.html* is a simple web page connecting to gateway and requesting todos from the service.

## Launch

To launch these apps using Docker:
```
docker-compose up
```

This should create 3 containers: the gateway and two instance of the microservice. Using the *index.html* or POSTMAN you should see that TODO are alternatively served from each instance.

To launch these apps manually:
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
