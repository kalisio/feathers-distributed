# feathers-distributed example

There are two applications folders named `app1`and `app2`.

The first one contains the *users* and *authentication* services. The second one constains the *todos* service.
They are feeded with a default user/todo.

The *index.html* is a simple web page connecting to app1 and requesting todos from the service in app2.

They have been generated using the `feathers-cli`:
```
// Initialize app1
mkdir app1
cd app1
feathers generate app
// Add authentication
feathers generate authentication
cd ..
// Initialize app2
mkdir app2
feathers generate app
// Add todos service
feathers generate service
```
