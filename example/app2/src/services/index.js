const todos = require('./todos/todos.service.js');
module.exports = function () {
  const app = this; // eslint-disable-line no-unused-vars
  app.configure(todos);
  // Initialize default data
  let todoService = app.service('todos');
  todoService.find({})
  .then(todos => {
    if (todos.total === 0) {
      todoService.create({
        title: 'TODO1',
        description: 'You have a lot todo !'
      }).then(result => {
        console.log('Tddo created!', result);
      }).catch(error => {
        console.error('Error creating todo!', error);
      });
    }
  });
};
