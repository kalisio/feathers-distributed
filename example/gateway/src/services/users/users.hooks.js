import authentication from '@feathersjs/authentication';
import commonHooks from 'feathers-hooks-common';
import local from '@feathersjs/authentication-local'

const { hashPassword } = local.hooks;
const { authenticate } = authentication.hooks;

export default {
  before: {
    all: [],
    find: [ authenticate('jwt') ],
    get: [ authenticate('jwt') ],
    create: [ hashPassword('password') ],
    update: [ authenticate('jwt'), hashPassword('password') ],
    patch: [ authenticate('jwt'), hashPassword('password') ],
    remove: [ authenticate('jwt') ]
  },

  after: {
    all: [
      commonHooks.when(
        hook => hook.params.provider,
        commonHooks.discard('password')
      )
    ],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
};
