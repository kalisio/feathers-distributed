// Initializes the `todos` service on path `/todos`
import createService from 'feathers-nedb';
import createModel from '../../models/todos.model.js';
import hooks from './todos.hooks.js';

export default function () {
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
