// Initializes the `users` service on path `/users`
import createService from 'feathers-nedb';
import createModel from '../../models/users.model.js';
import hooks from './users.hooks.js';

export default function () {
  const app = this;
  const Model = createModel(app);
  const paginate = app.get('paginate');

  const options = {
    name: 'users',
    Model,
    paginate
  };

  // Initialize our service with any options it requires
  app.use('/users', createService(options));

  // Get our initialized service so that we can register hooks and filters
  const service = app.service('users');

  service.hooks(hooks);
};
