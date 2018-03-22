module.exports = function(app) {
  if (typeof app.channel !== 'function') {
    // If no real-time functionality has been configured just return
    return;
  }

  app.on('connection', connection => {
    // On a new real-time connection, add it to the all channel
    app.channel('all').join(connection);
  });

  app.publish((data, context) => {
    return app.channel('all');
  });
};
