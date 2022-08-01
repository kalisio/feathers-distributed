import assert from 'assert';
import app from '../../src/app.js';

describe('\'todos\' service', () => {
  it('registered the service', () => {
    const service = app.service('todos');

    assert.ok(service, 'Registered the service');
  });
});
