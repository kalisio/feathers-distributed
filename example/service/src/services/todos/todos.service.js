// Initializes the `todos` service on path `/todos`
const createService = require('feathers-nedb');
const createModel = require('../../models/todos.model');
const hooks = require('./todos.hooks');

module.exports = function () {
  const app = this;
  const Model = createModel(app);
  const paginate = app.get('paginate');

  const options = {
    name: 'todos',
    Model,
    paginate
  };

  // Initialize our service with any options it requires
  app.use('/todos', createService(options));

  // Get our initialized service so that we can register hooks and filters
  const service = app.service('todos');

  service.hooks(hooks);
};
