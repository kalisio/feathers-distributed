// A hook that logs service method before, after and error
const logger = require('winston');

module.exports = function () {
  return function (hook) {
    let message = `${hook.type}: ${hook.path} - Method: ${hook.method}`;

    if (hook.type === 'error') {
      message += `: ${hook.error.message}`;
    }

    if (hook.error) {
      logger.error(message, hook.error.stack);
    } else {
      logger.debug(message);
    }

    logger.silly('hook.data', hook.data);
    logger.silly('hook.params', hook.params);

    if (hook.result) {
      logger.silly('hook.result', hook.result);
    }
  };
};
