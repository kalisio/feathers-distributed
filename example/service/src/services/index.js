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
        title: 'TODO',
        description: 'You have a todo !'
      }).then(result => {
        console.log('Todo created!', result);
      }).catch(error => {
        console.error('Error creating todo!', error);
      });
    }
  });
};
