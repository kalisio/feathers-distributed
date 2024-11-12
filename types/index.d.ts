declare module '@kalisio/feathers-distributed' {
  import { Application, HooksObject } from '@feathersjs/feathers';

  interface CoteOptions {
    helloInterval?: number;
    checkInterval?: number;
    nodeTimeout?: number;
    masterTimeout?: number;
    log?: boolean;
    basePort?: number;
    highestPort?: number;
    [key: string]: any;
  }

  /**
   * Options for configuring distributed services in a Feathers application.
   *
   * @template A - The type of the Feathers application.
   */
  interface DistributedOptions<A extends Application = Application> {
    /**
     * Delay in milliseconds before publishing events.
     */
    publicationDelay?: number;

    /**
     * Delay in milliseconds before initializing components.
     */
    componentDelay?: number;

    /**
     * Delay in milliseconds before initializing cote.
     */
    coteDelay?: number;

    /**
     * Interval in milliseconds for heartbeat checks.
     */
    heartbeatInterval?: number;

    /**
     * Flag to indicate whether to publish events.
     */
    publishEvents?: boolean;

    /**
     * List of events to be distributed.
     */
    distributedEvents?: string[];

    /**
     * List of methods to be distributed.
     */
    distributedMethods?: string[];

    /**
     * By default the same partition key is used for all distributed apps, so that there is no communication segregation.
     * Sometimes it is better for security, maintenance or performance purpose to segregate services by following the principles of domain-driven design.
     * In that case you can always define your own partition key for each application using the key string option (defaults to 'default').
     *
     * A solid solution as suggested in issue #70 is to use your package name because duplicated apps will then have the same key while different projects will not, and it will be persistent across restart:
     *
     * @example
     * const package = require('path/to/your/package.json')
     *
     * app.configure(distributed({
     *   ...,
     *   key: package.name
     * }))
     *
     * @default 'default'
     */
    key?: string;

    /**
     * By default the module adds an express middleware on the /distribution/healthcheck/:key route.
     * You can perform a healthcheck status for each available partition key using this route and a GET HTTP method, the following responses are possible:
     * * HTTP code 200 with the list of registered remote services for this key
     * * HTTP code 404 if no application has been registered for this key
     * * HTTP code 503 if some remote services do not respond to the healthcheck signal
     *
     * If you don't use partition keys you can omit the key request parameter as it will default to the 'default' value.
     *
     */
    healthcheckPath?: string;

    /**
     * By default, all services will be exposed, but you can restrict the list of services to be exposed.
     * Can be a static list of service paths to be exposed or a function returning true for exposed services.
     *
     * @example
     * app.configure(
     *   distribution({
     *     // Can be a static list of service paths to be exposed
     *     services: ['api/service1', 'api/service2'],
     *     // Can be a function returning true for exposed services
     *     services: (service) => (service.path !== 'api/internal')
     *   })
     * )
     */
    services?: string[] | ((service: any) => boolean);

    /**
     * By default, all remote services will be consumed, but you can restrict the list of remote services to connect to.
     * Can be a static list of service paths to be consumed or a function returning true for consumed services.
     *
     * @example
     * app.configure(
     *   distribution({
     *     // Can be a static list of service paths to be consumed
     *     remoteServices: ['api/service1', 'api/service2'],
     *     // Can be a function returning true for consumed services
     *     remoteServices: (service) => (service.path !== 'api/external')
     *   })
     * )
     *
     * @description
     * By default, options used to create a service will not be associated with the corresponding
     * remote service, as it might contain references to complex objects not serializable "as is".
     * However, you can use the remoteServiceOptions option to define a list of options to be serialized and provided to the remote service when created.
     * These options will then be available in the remoteService.remoteOptions object:
     *
     * @example
     * app.configure(
     *   distribution({
     *     // Function returning the array of distributed options for the service
     *     remoteServiceOptions: (service) => (service.path === 'service1' ? ['option1', 'option2'] : null)
     *   })
     * )
     * app.use('service1', new MyService({ option1: 'xxx', option2: 'yyy' }))
     * // In remote app
     * if (app.service('service1').remoteOptions.option1 === 'xxx') ...
     */
    remoteServices?: string[] | ((service: any) => boolean);

    /**
     * Options for configuring cote.
     */
    cote?: CoteOptions;

    /**
     * Hooks to be applied to each registered remote service.
     * This is typically useful to enforce authentication in a gateway scenario.
     *
     * @example
     * app.configure(
     *   distribution({
     *     hooks: {
     *       before: {
     *         all: [authenticate('jwt')]
     *       }
     *     }
     *   })
     * )
     */
    hooks?: HooksObject;

    /**
     * Middleware functions to be applied to each registered remote service.
     * This is typically useful to enforce correct error handling in a gateway scenario.
     *
     * @example
     * const express = require('@feathersjs/express');
     *
     * app.configure(
     *   distribution({
     *     middlewares: {
     *       before: (req, res, next) => next(),
     *       after: express.errorHandler()
     *     }
     *   })
     * );
     */
    middlewares?: { [key: string]: any };

    /**
     * Timeout for service requester.
     *
     * @example
     * const express = require('@feathersjs/express')
     *
     * app.configure(
     *   distribution({
     *     timeout: 30000 // 30s
     *   })
     * );
     *
     * @default 20 seconds
     */
    timeout?: number;
  }

  interface DistributedApplication<A extends Application = Application> {
    uuid: string;
    shortUuid: string;
    cote: any;
    coteOptions: CoteOptions;
    distributionOptions: DistributedOptions<A>;
    distributionKey: string;
    serviceRequesters: { [key: string]: any };
    serviceEventsSubscribers: { [key: string]: any };
    remoteApps: { [key: string]: any };
    serviceSubscriber: any;
    servicePublisher: any;
    serviceEventsPublisher?: any;
    serviceResponder: any;
    heartbeatInterval?: NodeJS.Timeout;
    coteInitializationTimeout?: NodeJS.Timeout;
    applicationPublicationTimeout?: NodeJS.Timeout;
    use: (...args: any[]) => any;
    unuse: (...args: any[]) => any;
  }

  export function initialize<A extends Application = Application>(app: DistributedApplication<A>): Promise<void>;

  export function finalize<A extends Application = Application>(app: DistributedApplication<A>): Promise<void>;

  export default function init<A extends Application = Application>(options?: DistributedOptions<A>): (app: A) => void;
}
