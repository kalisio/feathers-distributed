const users = require('./users/users.service.js');
module.exports = function () {
  const app = this; // eslint-disable-line no-unused-vars
  app.configure(users);
  // Initialize default user
  let userService = app.service('users');
  userService.find({})
  .then(users => {
    if (users.total === 0) {
      userService.create({
        email: 'user@test.com',
        password: 'password'
      }).then(result => {
        console.log('User created!', result);
      }).catch(error => {
        console.error('Error creating user!', error);
      });
    }
  });
};
